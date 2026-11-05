import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { serviceIdentity } from './paths';
import { getRuntimeInstallDir, installedRuntime, verifyRuntime } from './runtime';
import { checkRuntime } from './runtime-manifest';
import { releaseDirectory } from './store';
import { clearMaintenance, exclusiveActivity, exclusiveDatabaseAccess, writeMaintenance } from './maintenance';
import type { MaintenanceGate } from './maintenance-state';
import { validateDatabase } from './checkpoint';
import { createSnapshot, listSnapshots, restoreSnapshot, snapshotChanges, SNAPSHOT_RETENTION_MS, type SnapshotChanges } from './snapshot';
import { beginActivation, clearActivation, readActivation, type Activation } from './activation';
import { withStoreLock } from './store';
import { checkRelease, downloadRelease, releasePolicy, type Release } from './release';
import { MaintenanceWindowSchema, type MaintenanceWindow } from './update-settings';

export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'ready' | 'waiting' | 'draining' | 'checkpointing' | 'validating' | 'committed' | 'failed' | 'recovery-required';
/** A release built on this computer from a checkout (docs/always-on-spec.md
 * section 8). It takes the same switch as a published one, without the feed. */
export interface LocalRelease { commit?: string; checkout?: string }
export interface UpdateRecord {
  format: 1; phase: UpdatePhase; release?: Release; priorId?: string; checkpoint?: string;
  approved?: boolean; bytes?: number; reason?: string; error?: string; changedAt: string;
  committedAt?: string; window?: MaintenanceWindow;
  local?: LocalRelease;
  /** Update now: switch even though chats are running, which ends them. */
  force?: boolean;
  /** A rollback under way, written before it changes anything, so a crash at
   * any step finishes it instead of guessing from what's on disk (7.6). */
  rollback?: { to: string; leaving: string; snapshot: string };
}
export interface RuntimeTarget { id: string; repo: string; node: string }
export interface UpdateBackend {
  /** A connected device never checkpoints, opens or migrates a Home database. */
  storage?: 'home' | 'worker';
  /** The connected device's journal writer lock, held through validation/recovery. */
  exclusiveStorage?(): Promise<() => void>;
  activity(): Promise<string[]>;
  /** Work that rules out a switch before draining starts. Unlike `activity`, it
   * leaves out idle agent processes, which only draining can close. */
  work?(): Promise<string[]>;
  /** Local formats and unresolved work on peers must remain readable. */
  compatibility?(target: RuntimeTarget): Promise<string[]>;
  verify?(resources: string): Promise<{ id: string }>;
  download?(release: Release, progress: (bytes: number) => void): Promise<unknown>;
  /** A Home's snapshot (section 7.4 step 3), or a connected device's journal
   * checkpoint in `recovery`. Returns where it was saved. */
  checkpoint?(request: { from: string; to: string; recovery: string }): Promise<string>;
  restore?(directory: string): Promise<unknown>;
  /** Migrations the target would apply to this Home's database. */
  pendingMigrations?(target: RuntimeTarget): Promise<number>;
  verifyDatabase?(target: RuntimeTarget): Promise<unknown>;
  prepareIdle?(): Promise<void>;
  resumeAdmission?(): Promise<void>;
  stop(): Promise<void>;
  /** The check-only start. `migrations` it will apply, which can take minutes. */
  validate(target: RuntimeTarget, token: string, migrations?: number): Promise<void>;
  activate(): Promise<void>;
  restart(target: RuntimeTarget): Promise<void>;
  unavailable?(error: string): void;
  assertNoLegacyWriters(): Promise<void>;
}
export interface RollbackStatus {
  available: boolean;
  reason?: string;
  /** The release rollback goes back to, and the one it leaves. */
  from?: string;
  to?: string;
  snapshot?: string;
  createdAt?: string;
  expiresAt?: string;
  changes?: SnapshotChanges;
}
const transient = new Set<UpdatePhase>(['draining', 'checkpointing', 'validating']);
const RELEASE_ID = /^[a-f0-9]{64}$/;

/** What the target's migrations would change, read without writing anything. */
export async function pendingMigrations(target: RuntimeTarget): Promise<number> {
  const folder = path.join(/* turbopackIgnore: true */ target.repo, 'drizzle');
  if (!fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ folder, 'meta/_journal.json'))) return 0;
  const database = serviceIdentity().database;
  if (!fs.existsSync(/* turbopackIgnore: true */ database)) return 0;
  const [{ inspectMigrationHistory }, { default: Database }] = await Promise.all([import('@/lib/db/migrate'), import('better-sqlite3')]);
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try { return inspectMigrationHistory(db, folder).pending.length; } finally { db.close(); }
}

/**
 * The snapshots recovery still needs, which retention must leave alone. Once a
 * new release has started work, its snapshot only serves a rollback on request
 * and follows the 7-day rule, or it would hold old database blocks on the disk
 * until the next update.
 */
export function snapshotsInUse(record: Pick<UpdateRecord, 'phase' | 'checkpoint' | 'rollback'>, activation: Pick<Activation, 'candidate' | 'restore'>): string[] {
  if (record.rollback) return [record.rollback.snapshot];
  if (!record.checkpoint) return [];
  return ['validating', 'recovery-required'].includes(record.phase) || activation.candidate || activation.restore ? [record.checkpoint] : [];
}

/** One instance in the service owner. Every GUI/CLI action uses its private
 * control socket, so there is no second updater or independent DB migrator. */
const DRAIN_RETRY_MS = 5 * 60_000;

export class UpdateCoordinator {
  private busy = false;
  /** The release already fully checked: once per update, not once per try. */
  private verified?: string;
  /** A drain closes the Home to new work, so after one that couldn't finish the
   * next waits. The 30-second tick would otherwise keep it closed half the time. */
  private drainAfter = 0;
  private record: UpdateRecord;
  private readonly file: string;
  constructor(private backend: UpdateBackend, private directory = getRuntimeInstallDir(), private timing = { drain: 15_000, poll: 500, grace: 2000 }) {
    this.file = path.join(/* turbopackIgnore: true */ directory, 'update.json');
    this.record = fs.existsSync(/* turbopackIgnore: true */ this.file) ? JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ this.file, 'utf8')) : { format: 1, phase: 'idle', changedAt: new Date().toISOString() };
    if (this.record.format !== 1 || !['idle', 'available', 'downloading', 'ready', 'waiting', ...transient, 'committed', 'failed', 'recovery-required'].includes(this.record.phase)) throw new Error('Unsupported update record. Recovery is required.');
  }
  status() {
    const policy = releasePolicy();
    return { ...this.record, configured: !!policy, busy: this.busy, policy: policy ? {
      channel: policy.channel, automaticDownload: policy.automaticDownload, metered: policy.metered,
    } : null };
  }
  private save(change: Partial<UpdateRecord>) {
    this.record = { ...this.record, ...change, changedAt: new Date().toISOString() };
    atomicWriteFile(this.file, JSON.stringify(this.record));
  }
  /** `full` hashes every file. Without it, only the manifest and entry files
   * are checked, for a release verified earlier in the same step or that ran. */
  private async target(id: string, full = false): Promise<RuntimeTarget> {
    if (!RELEASE_ID.test(id)) throw new Error('Invalid runtime selection');
    const directory = releaseDirectory(id, this.directory);
    const manifest = !full ? checkRuntime(directory) : this.backend.verify ? await this.backend.verify(directory) : verifyRuntime(directory);
    if (manifest.id !== id) throw new Error('Staged runtime identity mismatch');
    return { id, repo: path.join(/* turbopackIgnore: true */ directory, 'server'), node: path.join(/* turbopackIgnore: true */ directory, 'node/bin/node') };
  }
  /** Move this Home's pointers under the store's lock, so another Home's
   * cleanup never sees a release both of them have just stopped naming. */
  private async select(id: string, previous?: string) {
    await this.target(id);
    // A finished update stays recorded, so every controller start lands here
    // with nothing to change. Homes booting together shouldn't queue for this
    // lock, and recovery failing on it would leave a Home down.
    const pointer = (name: string) => { try { return fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ this.directory, name), 'utf8').trim(); } catch { return null; } };
    if (pointer('active-release') === id && (!previous || pointer('previous-release') === previous)) return;
    withStoreLock(() => {
      if (previous) atomicWriteFile(path.join(/* turbopackIgnore: true */ this.directory, 'previous-release'), `${previous}\n`);
      atomicWriteFile(path.join(/* turbopackIgnore: true */ this.directory, 'active-release'), `${id}\n`);
    });
  }
  private async exclusive<T>(action: () => Promise<T>) {
    if (this.busy) throw new Error('Another update action is in progress');
    this.busy = true;
    try { return await action(); }
    catch (error) { if (this.record.phase !== 'recovery-required') this.save({ error: message(error) }); throw error; }
    finally { this.busy = false; }
  }
  async check() {
    return this.exclusive(async () => {
      if (transient.has(this.record.phase) || this.record.phase === 'recovery-required') throw new Error('Resolve the current update before checking another release');
      // A release built from a checkout waits for its switch. The feed doesn't replace it.
      if (this.record.local && ['ready', 'waiting'].includes(this.record.phase)) return this.status();
      const release = await checkRelease();
      const current = installedRuntime(this.directory);
      if (this.record.release?.runtime.id === release.runtime.id && ['ready', 'waiting'].includes(this.record.phase)) return this.status();
      this.save({ release, phase: release.runtime.id === current?.id ? 'idle' : 'available', approved: false, force: false, bytes: 0, error: undefined, reason: undefined, committedAt: undefined, checkpoint: undefined, priorId: undefined, local: undefined });
      return this.status();
    });
  }
  async download() {
    return this.exclusive(async () => {
      if (!this.record.release || !['available', 'failed'].includes(this.record.phase) || this.record.local) throw new Error('Check for an eligible release first');
      // Recheck withdrawal/expiry just before downloading, not just discovery.
      const release = await checkRelease();
      if (release.runtime.id !== this.record.release.runtime.id) throw new Error('The release changed. Check for updates again.');
      this.save({ phase: 'downloading', bytes: 0, error: undefined });
      try {
        let lastProgress = 0;
        await (this.backend.download ?? downloadRelease)(release, bytes => { if (Date.now() - lastProgress > 1000 || bytes === release.runtime.size) { lastProgress = Date.now(); this.save({ bytes }); } });
        this.save({ phase: 'ready', bytes: release.runtime.size });
      } catch (error) { this.save({ phase: 'failed', error: message(error) }); throw error; }
      return this.status();
    });
  }
  /** A release staged on this computer, built from a checkout (section 8). */
  async offer(id: string, local: LocalRelease = {}) {
    return this.exclusive(async () => {
      if (transient.has(this.record.phase) || this.record.phase === 'recovery-required') throw new Error('Resolve the current update before offering another release');
      // It could never switch, and would sit waiting and refuse to be moved.
      if (!installedRuntime(this.directory)) throw new Error("This Home doesn't run a release yet. `ri start` moves it to one.");
      const target = await this.target(id);
      const version = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ target.repo, 'package.json'), 'utf8')).version as string;
      const reset = { approved: false, force: false, bytes: 0, error: undefined, reason: undefined, committedAt: undefined, checkpoint: undefined, priorId: undefined, window: undefined };
      if (installedRuntime(this.directory)?.id === id) this.save({ ...reset, phase: 'idle', release: undefined, local: undefined });
      else this.save({ ...reset, phase: 'ready', local, release: { version, runtime: { id } } as unknown as Release });
      return this.status();
    });
  }
  approve(window?: UpdateRecord['window'], force = false) {
    if (this.busy || !['ready', 'waiting'].includes(this.record.phase)) throw new Error('Download an update before scheduling activation');
    if (window) window = MaintenanceWindowSchema.parse(window);
    this.drainAfter = 0;
    this.save({ approved: true, phase: 'waiting', window, force, reason: 'Waiting for the service to be idle' });
    return this.status();
  }
  later() {
    if (this.busy || transient.has(this.record.phase)) throw new Error('The update is already in progress');
    if (this.record.phase === 'waiting') this.save({ approved: false, force: false, phase: 'ready', window: undefined, reason: undefined });
    return this.status();
  }
  async tick() {
    if (this.busy || !this.record.approved || this.record.phase !== 'waiting') return;
    if (!this.record.force && Date.now() < this.drainAfter) return;
    const window = this.record.window;
    if (window) {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: window.timeZone }).format());
      if ((hour - window.hour + 24) % 24 >= window.durationHours) { this.save({ reason: `Waiting for the maintenance window (${window.timeZone})` }); return; }
    }
    await this.apply().catch(() => {});
  }

  /** Close admission and wait for in-flight requests and, unless forced, for
   * running work. Returns the exclusive activity lease, or the reasons to wait. */
  private async drain(gate: MaintenanceGate, waitFor: () => Promise<string[]>, force: boolean): Promise<{ lease?: () => void } | { reasons: string[] }> {
    writeMaintenance(gate);
    try { await this.backend.prepareIdle?.(); }
    catch (error) { if (!force) return { reasons: [message(error)] }; }
    const reasons = await waitFor();
    if (reasons.length) return { reasons };
    // Give every viewer a chance to flush. New foreground/background work
    // is refused, document PATCH completions still get acknowledged.
    const started = Date.now();
    const deadline = started + this.timing.drain;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, this.timing.poll));
      const current = await waitFor();
      if (current.length) { this.save({ reason: current.join(', ') }); continue; }
      if (Date.now() - started < this.timing.grace) continue;
      try { return { lease: exclusiveActivity() }; } catch { /* admitted request/CLI is still draining */ }
    }
    // Running turns hold the lease until the server stops, and Update now is
    // asking for exactly that, so it goes ahead without it.
    return force ? {} : { reasons: ['Waiting for active requests, CLI commands or background work'] };
  }

  /** With the server gone, its turns have let go, and any `ri` command an agent
   * left running gets a moment to finish. */
  private async leaseAfterStop() {
    const deadline = Date.now() + this.timing.drain;
    while (Date.now() < deadline) {
      try { return exclusiveActivity(); } catch { await new Promise(resolve => setTimeout(resolve, this.timing.poll)); }
    }
    return exclusiveActivity();
  }

  async apply() {
    return this.exclusive(async () => {
      if (!this.record.release || !['ready', 'waiting'].includes(this.record.phase)) throw new Error('No verified update is ready');
      if (this.backend.storage === 'worker' && (!this.backend.checkpoint || !this.backend.restore || !this.backend.verifyDatabase || !this.backend.exclusiveStorage)) throw new Error('Connected-device updates require local journal checkpoint, restore, verification and writer lock support');
      const prior = installedRuntime(this.directory);
      if (!prior) throw new Error('Managed updates require a staged installation');
      // Update now still drains requests and keeps peers compatible. It only
      // stops waiting for running chats, which the restart then ends.
      const force = !!this.record.force;
      // This runs every 30 seconds for as long as a chat takes. Waiting costs
      // nothing: the Home stays open, nothing is hashed, and a later `--now` is
      // free to act.
      if (!force) {
        const running = await this.backend.work?.() ?? [];
        if (running.length) { this.save({ phase: 'waiting', reason: running.join(', ') }); return this.status(); }
      }
      // The one full check of the release, while the Home still serves.
      const id = this.record.release.runtime.id;
      let target: RuntimeTarget;
      try { target = await this.target(id, this.verified !== id); }
      catch (error) {
        // Asks again only when someone does: this would rehash on every tick.
        this.save({ phase: 'failed', approved: false, force: false, error: message(error) });
        throw error;
      }
      this.verified = id;
      if (!this.record.local) {
        try {
          const eligible = await checkRelease();
          if (eligible.runtime.id !== target.id) throw new Error('This release is no longer eligible. Check for updates again.');
        } catch (error) {
          // Do not repeatedly hash/retry a withdrawn or untrusted release every
          // idle tick. A fresh check and approval are required after failure.
          this.save({ phase: 'failed', approved: false, error: message(error) });
          throw error;
        }
      }
      const compatibility = () => this.backend.compatibility?.(target) ?? Promise.resolve([]);
      const blocked = await compatibility();
      if (blocked.length) { this.save({ phase: 'waiting', reason: blocked.join(', ') }); return this.status(); }
      const token = randomBytes(32).toString('hex');
      const gate = { phase: 'draining' as const, token, startedAt: new Date().toISOString() };
      this.save({ phase: 'draining', priorId: prior.id, checkpoint: undefined, error: undefined, committedAt: undefined });
      let activity: (() => void) | undefined;
      let access: (() => void) | undefined;
      let stopped = false;
      try {
        const drained = await this.drain(gate, async () => [...(force ? [] : await this.backend.activity()), ...await compatibility()], force);
        if ('reasons' in drained) {
          this.drainAfter = Date.now() + DRAIN_RETRY_MS;
          clearMaintenance(); this.save({ phase: 'waiting', reason: drained.reasons.join(', ') }); return this.status();
        }
        activity = drained.lease;
        writeMaintenance({ ...gate, phase: 'offline' });
        stopped = true;
        await this.backend.stop();
        activity ??= await this.leaseAfterStop();
        access = this.backend.storage === 'worker' ? await this.backend.exclusiveStorage!() : exclusiveDatabaseAccess();
        await this.backend.assertNoLegacyWriters();
        this.save({ phase: 'checkpointing' });
        const recovery = path.join(/* turbopackIgnore: true */ this.directory, 'recovery', `${Date.now()}-${target.id.slice(0, 12)}`);
        const checkpoint = await (this.backend.checkpoint ?? (request => createSnapshot(request)))({ from: prior.id, to: target.id, recovery });
        this.save({ phase: 'validating', checkpoint });
        const migrations = this.backend.storage === 'worker' ? 0 : await (this.backend.pendingMigrations ?? pendingMigrations)(target);
        // The check-only start: the database is prepared and nothing that acts
        // outside it runs, so the snapshot can still undo everything (7.4 step 4).
        await this.backend.validate(target, token, migrations);
        // A full integrity check reads the whole database. It can only find
        // something new when this update changed the schema.
        if (this.backend.storage === 'worker') await this.backend.verifyDatabase?.(target);
        else if (migrations > 0) {
          if (this.backend.verifyDatabase) await this.backend.verifyDatabase(target);
          else validateDatabase(serviceIdentity().database, true);
        }
        // Durable point of no rollback. From here every recovery preserves
        // the upgraded DB, even if activation or the controller then crashes.
        // The fallback first: committed with no activation record would leave
        // the launcher unable to put the previous release back.
        beginActivation(target.id, prior.id, this.directory);
        this.save({ phase: 'committed', committedAt: new Date().toISOString(), approved: false, force: false, reason: undefined });
        await this.select(target.id, prior.id);
        access?.(); access = undefined;
        activity(); activity = undefined;
        clearMaintenance();
        await this.backend.activate();
        stopped = false;
        return this.status();
      } catch (error) {
        if (this.record.committedAt) {
          this.save({ phase: 'recovery-required', error: `The new database is retained. ${message(error)}` });
          // Validation can still be alive if runtime selection or handoff
          // failed. Recovery must never swap/select under that backend.
          await this.backend.stop();
          throw error;
        }
        if (stopped) {
          await this.backend.stop();
          if (this.record.checkpoint) {
            try {
              if (!access) access = this.backend.storage === 'worker' ? await this.backend.exclusiveStorage!() : exclusiveDatabaseAccess();
              await (this.backend.restore ?? restoreSnapshot)(this.record.checkpoint);
            } catch (recoveryError) {
              this.save({ phase: 'recovery-required', approved: false, error: `Recovery needs attention. ${message(recoveryError)}` });
              throw recoveryError;
            }
          }
          await this.select(prior.id);
          clearActivation(this.directory);
        }
        clearMaintenance();
        access?.(); access = undefined;
        activity?.(); activity = undefined;
        this.save({ phase: 'failed', approved: false, force: false, error: message(error) });
        if (stopped) {
          try { await this.backend.restart(await this.target(prior.id)); stopped = false; }
          catch (restartError) { this.save({ error: message(restartError) }); throw restartError; }
        }
        throw error;
      } finally {
        access?.(); activity?.();
        if (!stopped) await this.backend.resumeAdmission?.();
        if (stopped) this.backend.unavailable?.(this.record.error ?? 'The backend stopped during an update. Review recovery before restarting.');
      }
    });
  }

  /** Whether `ri update --rollback` can go back one release (section 7.6), and
   * until when: the snapshot from the last switch is kept for 7 days. */
  rollbackStatus(now = Date.now()): RollbackStatus {
    if (this.backend.storage === 'worker') return { available: false, reason: 'A connected computer keeps no Home data to roll back.' };
    if (transient.has(this.record.phase) || this.record.phase === 'recovery-required') return { available: false, reason: 'An update is still in progress or needs recovery.' };
    const current = installedRuntime(this.directory)?.id;
    const latest = listSnapshots()[0];
    if (!latest) return { available: false, reason: "There's no snapshot from an update to go back to. Snapshots are kept for 7 days." };
    const { directory, manifest } = latest;
    if (manifest.to !== current) return { available: false, reason: "The last snapshot doesn't belong to the version this Home runs, so there's nothing to roll back." };
    // A Home's first move to a release: no older release here to go back to.
    if (manifest.from === manifest.to) return { available: false, reason: `This Home has run only this version on this computer, so there's nothing older to go back to. A copy of its database from before its migrations is in ${directory}.` };
    const expiresAt = new Date(Date.parse(manifest.createdAt) + 7 * 24 * 60 * 60_000).toISOString();
    if (now - Date.parse(manifest.createdAt) > SNAPSHOT_RETENTION_MS) return { available: false, reason: `Rollback expired on ${expiresAt}.`, expiresAt };
    if (!fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ releaseDirectory(manifest.from, this.directory), 'runtime-manifest.json'))) {
      return { available: false, reason: 'The version to go back to is no longer on this computer.' };
    }
    return { available: true, from: manifest.from, to: manifest.to, snapshot: directory, createdAt: manifest.createdAt, expiresAt };
  }

  /** What a rollback would lose: everything written since the switch. */
  rollbackPreview(now = Date.now()): RollbackStatus {
    const state = this.rollbackStatus(now);
    if (!state.available) return state;
    const manifest = listSnapshots()[0]!.manifest;
    return { ...state, changes: snapshotChanges(manifest) };
  }

  /** Go back one release on request (section 7.6): restore the snapshot from
   * the switch, point the Home at the release before it, and hand over. */
  async rollback() {
    return this.exclusive(async () => {
      const state = this.rollbackStatus();
      if (!state.available) throw new Error(state.reason);
      const target = await this.target(state.from!, true);
      const gate = { phase: 'draining' as const, token: randomBytes(32).toString('hex'), startedAt: new Date().toISOString() };
      let activity: (() => void) | undefined;
      let access: (() => void) | undefined;
      try {
        // Rolling back is a deliberate request: it waits for requests, not for chats.
        const drained = await this.drain(gate, async () => [], true);
        if ('reasons' in drained) { clearMaintenance(); throw new Error(drained.reasons.join(', ')); }
        activity = drained.lease;
        writeMaintenance({ ...gate, phase: 'offline' });
        await this.backend.stop();
        activity ??= await this.leaseAfterStop();
        access = exclusiveDatabaseAccess();
        await this.backend.assertNoLegacyWriters();
        // From here a crash finishes the rollback: recovery reads this record.
        this.save({ rollback: { to: target.id, leaving: state.to!, snapshot: state.snapshot! } });
        await this.finishRollback();
        access(); access = undefined;
        activity(); activity = undefined;
        clearMaintenance();
        await this.backend.activate();
        return this.status();
      } catch (error) {
        clearMaintenance();
        access?.(); activity?.();
        // Stopped before anything changed: the controller starts the server
        // again on its next probe. Past that point, a person has to look.
        if (this.record.rollback) {
          this.save({ phase: 'recovery-required', error: `The rollback didn't finish. ${message(error)}` });
          this.backend.unavailable?.(this.record.error!);
        }
        throw error;
      }
    });
  }

  /** Safe to repeat: a restore already done changes nothing the second time. */
  private async finishRollback() {
    const { to, leaving, snapshot } = this.record.rollback!;
    await (this.backend.restore ?? restoreSnapshot)(snapshot);
    await this.select(to, leaving);
    clearActivation(this.directory);
    const left = this.record.release?.version;
    this.save({ phase: 'idle', approved: false, force: false, committedAt: undefined, checkpoint: undefined, priorId: undefined, release: undefined, local: undefined, error: undefined, rollback: undefined,
      reason: `Rolled back${left ? ` from ${left}` : ''} at ${new Date().toISOString()}.` });
  }

  /** Runs before any token bootstrap, DB opener, scheduler or public socket. */
  async recover(retry = false) {
    // Restoring a checkpoint can await an out-of-process helper. Keep the
    // controller's busy fence held so a concurrent recover/stop/handoff cannot
    // race the database replacement or release ownership while it runs.
    return this.exclusive(() => this.recoverExclusive(retry));
  }
  private async recoverExclusive(retry: boolean) {
    // Update now is a choice about the chats running when it was asked. A later
    // start of this controller mustn't end the ones running by then.
    if (this.record.force && this.record.phase === 'waiting') this.save({ force: false });
    if (this.record.rollback) {
      const release = exclusiveDatabaseAccess();
      try {
        await this.backend.assertNoLegacyWriters();
        await this.finishRollback();
        clearMaintenance();
      } catch (error) { this.save({ phase: 'recovery-required', error: `The rollback didn't finish. ${message(error)}` }); throw error; }
      finally { release(); }
      return;
    }
    const activation = readActivation(this.directory);
    if (activation.restore) return this.recoverFailedActivation(activation);
    if (retry && this.record.phase === 'recovery-required') {
      if (!this.record.committedAt && (!this.record.checkpoint || !this.record.priorId)) throw new Error('No complete recovery record is available. Inspect the preserved data before proceeding.');
      this.save({ phase: this.record.committedAt ? 'committed' : 'validating' });
    }
    if (this.record.phase === 'recovery-required') throw new Error(this.record.error ?? 'Manual recovery required');
    if (this.record.committedAt && this.record.release) {
      await this.select(this.record.release.runtime.id, this.record.priorId); clearMaintenance(); return;
    }
    if (this.record.phase === 'validating') {
      if (this.backend.storage === 'worker' && !this.backend.exclusiveStorage) throw new Error('Connected-device recovery requires its journal writer lock.');
      const release = this.backend.storage === 'worker' ? await this.backend.exclusiveStorage!() : exclusiveDatabaseAccess();
      try {
        await this.backend.assertNoLegacyWriters();
        if (!this.record.checkpoint || !this.record.priorId) throw new Error('Incomplete recovery record');
        await (this.backend.restore ?? restoreSnapshot)(this.record.checkpoint);
        await this.select(this.record.priorId);
        clearMaintenance();
        this.save({ phase: 'failed', approved: false, error: 'Interrupted update recovered. The prior version and data were restored.' });
        clearActivation(this.directory);
      } catch (error) { this.save({ phase: 'recovery-required', error: message(error) }); throw error; }
      finally { release(); }
    } else if (transient.has(this.record.phase) || this.record.phase === 'downloading') {
      clearMaintenance();
      this.save({ phase: this.record.phase === 'downloading' ? 'available' : 'ready', approved: false, reason: 'Interrupted update. Review and retry.' });
    }
  }

  /** The launcher put the previous release back because the new one never
   * started work (section 7.6). Only its check-only start ran, which changed
   * nothing outside the database and config, so the snapshot undoes it exactly. */
  private async recoverFailedActivation(activation: Activation) {
    const release = this.backend.storage === 'worker' ? await this.backend.exclusiveStorage?.() : exclusiveDatabaseAccess();
    try {
      await this.backend.assertNoLegacyWriters();
      if (this.record.checkpoint) await (this.backend.restore ?? restoreSnapshot)(this.record.checkpoint);
      const back = activation.previous ?? this.record.priorId;
      if (back && installedRuntime(this.directory)?.id !== back) await this.select(back);
      const version = this.record.release?.version;
      // The record first, the evidence last: a crash between them repeats this
      // recovery, which is safe, instead of selecting the rejected release.
      this.save({ phase: 'failed', approved: false, force: false, committedAt: undefined,
        error: `The update${version ? ` to ${version}` : ''} didn't start, so Ri went back to the version it ran before. Nothing it did needed undoing, because it never started work.` });
      clearActivation(this.directory);
      clearMaintenance();
    } catch (error) { this.save({ phase: 'recovery-required', error: message(error) }); throw error; }
    finally { release?.(); }
  }
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Update failed'; }
