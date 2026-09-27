import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { serviceIdentity } from './paths';
import { getRuntimeInstallDir, installedRuntime, verifyRuntime } from './runtime';
import { clearMaintenance, exclusiveActivity, exclusiveDatabaseAccess, writeMaintenance } from './maintenance';
import { createCheckpoint, restoreCheckpointDatabase, validateDatabase } from './checkpoint';
import { checkRelease, downloadRelease, releasePolicy, type Release } from './release';
import { MaintenanceWindowSchema, type MaintenanceWindow } from './update-settings';

export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'ready' | 'waiting' | 'draining' | 'checkpointing' | 'validating' | 'committed' | 'failed' | 'recovery-required';
export interface UpdateRecord {
  format: 1; phase: UpdatePhase; release?: Release; priorId?: string; checkpoint?: string;
  approved?: boolean; bytes?: number; reason?: string; error?: string; changedAt: string;
  committedAt?: string; window?: MaintenanceWindow;
}
export interface RuntimeTarget { id: string; repo: string; node: string }
export interface UpdateBackend {
  activity(): Promise<string[]>;
  verify?(resources: string): Promise<{ id: string }>;
  download?(release: Release, progress: (bytes: number) => void): Promise<unknown>;
  checkpoint?(directory: string): Promise<string>;
  restore?(directory: string): Promise<unknown>;
  verifyDatabase?(target: RuntimeTarget): Promise<unknown>;
  prepareIdle?(): Promise<void>;
  stop(): Promise<void>;
  validate(target: RuntimeTarget, token: string): Promise<void>;
  activate(): Promise<void>;
  restart(target: RuntimeTarget): Promise<void>;
  unavailable?(error: string): void;
  assertNoLegacyWriters(): Promise<void>;
}
const transient = new Set<UpdatePhase>(['draining', 'checkpointing', 'validating']);

/** One instance in the service owner. Every GUI/CLI action uses its private
 * control socket, so there is no second updater or independent DB migrator. */
export class UpdateCoordinator {
  private busy = false;
  private record: UpdateRecord;
  private readonly file: string;
  constructor(private backend: UpdateBackend, private directory = getRuntimeInstallDir(), private timing = { drain: 15_000, poll: 500, grace: 2000 }) {
    this.file = path.join(directory, 'update.json');
    this.record = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { format: 1, phase: 'idle', changedAt: new Date().toISOString() };
    if (this.record.format !== 1 || !['idle', 'available', 'downloading', 'ready', 'waiting', ...transient, 'committed', 'failed', 'recovery-required'].includes(this.record.phase)) throw new Error('Unsupported update record. Recovery is required.');
  }
  status() {
    const policy = releasePolicy();
    return { ...this.record, configured: !!policy, busy: this.busy, policy: policy ? {
      channel: policy.channel, automaticDownload: policy.automaticDownload, metered: policy.metered,
    } : null };
  }
  startupFailed(error: unknown) {
    if (this.record.committedAt) this.save({ phase: 'recovery-required', approved: false, error: `The new database is retained. Startup failed: ${message(error)}` });
  }
  private save(change: Partial<UpdateRecord>) {
    this.record = { ...this.record, ...change, changedAt: new Date().toISOString() };
    atomicWriteFile(this.file, JSON.stringify(this.record));
  }
  private async target(id: string): Promise<RuntimeTarget> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid runtime selection');
    const directory = path.join(this.directory, 'releases', id);
    const manifest = this.backend.verify ? await this.backend.verify(directory) : verifyRuntime(directory);
    if (manifest.id !== id) throw new Error('Staged runtime identity mismatch');
    return { id, repo: path.join(directory, 'server'), node: path.join(directory, 'node/bin/node') };
  }
  private async select(id: string) { await this.target(id); atomicWriteFile(path.join(this.directory, 'active-release'), `${id}\n`); }
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
      const release = await checkRelease();
      const current = installedRuntime();
      if (this.record.release?.runtime.id === release.runtime.id && ['ready', 'waiting'].includes(this.record.phase)) return this.status();
      this.save({ release, phase: release.runtime.id === current?.id ? 'idle' : 'available', approved: false, bytes: 0, error: undefined, reason: undefined, committedAt: undefined, checkpoint: undefined, priorId: undefined });
      return this.status();
    });
  }
  async download() {
    return this.exclusive(async () => {
      if (!this.record.release || !['available', 'failed'].includes(this.record.phase)) throw new Error('Check for an eligible release first');
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
  approve(window?: UpdateRecord['window']) {
    if (this.busy || !['ready', 'waiting'].includes(this.record.phase)) throw new Error('Download an update before scheduling activation');
    if (window) window = MaintenanceWindowSchema.parse(window);
    this.save({ approved: true, phase: 'waiting', window, reason: 'Waiting for the service to be idle' });
    return this.status();
  }
  later() {
    if (this.busy || transient.has(this.record.phase)) throw new Error('The update is already in progress');
    if (this.record.phase === 'waiting') this.save({ approved: false, phase: 'ready', window: undefined, reason: undefined });
    return this.status();
  }
  async tick() {
    if (this.busy || !this.record.approved || this.record.phase !== 'waiting') return;
    const window = this.record.window;
    if (window) {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: window.timeZone }).format());
      if ((hour - window.hour + 24) % 24 >= window.durationHours) { this.save({ reason: `Waiting for the maintenance window (${window.timeZone})` }); return; }
    }
    await this.apply().catch(() => {});
  }
  async apply() {
    return this.exclusive(async () => {
      if (!this.record.release || !['ready', 'waiting'].includes(this.record.phase)) throw new Error('No verified update is ready');
      const target = await this.target(this.record.release.runtime.id);
      const prior = installedRuntime();
      if (!prior) throw new Error('Managed updates require a staged installation');
      try {
        const eligible = await checkRelease();
        if (eligible.runtime.id !== target.id) throw new Error('This release is no longer eligible. Check for updates again.');
      } catch (error) {
        // Do not repeatedly hash/retry a withdrawn or untrusted release every
        // idle tick. A fresh check and approval are required after failure.
        this.save({ phase: 'failed', approved: false, error: message(error) });
        throw error;
      }
      const token = randomBytes(32).toString('hex');
      const gate = { phase: 'draining' as const, token, startedAt: new Date().toISOString() };
      this.save({ phase: 'draining', priorId: prior.id, checkpoint: undefined, error: undefined, committedAt: undefined });
      writeMaintenance(gate);
      let activity: (() => void) | undefined;
      let access: (() => void) | undefined;
      let stopped = false;
      try {
        await this.backend.prepareIdle?.();
        const reasons = await this.backend.activity();
        if (reasons.length) { clearMaintenance(); this.save({ phase: 'waiting', reason: reasons.join(', ') }); return this.status(); }
        // Give every viewer a chance to flush. New foreground/background work
        // is refused, document PATCH completions still get acknowledged.
        const started = Date.now();
        const deadline = started + this.timing.drain;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, this.timing.poll));
          const current = await this.backend.activity();
          if (current.length) { this.save({ reason: current.join(', ') }); continue; }
          if (Date.now() - started < this.timing.grace) continue;
          try { activity = exclusiveActivity(); break; } catch { /* admitted request/CLI is still draining */ }
        }
        if (!activity) { clearMaintenance(); this.save({ phase: 'waiting', reason: 'Waiting for active requests, CLI commands or background work' }); return this.status(); }
        writeMaintenance({ ...gate, phase: 'offline' });
        stopped = true;
        await this.backend.stop();
        access = exclusiveDatabaseAccess();
        await this.backend.assertNoLegacyWriters();
        this.save({ phase: 'checkpointing' });
        const checkpoint = await (this.backend.checkpoint ?? createCheckpoint)(path.join(this.directory, 'recovery', `${Date.now()}-${target.id.slice(0, 12)}`));
        this.save({ phase: 'validating', checkpoint });
        await this.backend.validate(target, token);
        if (this.backend.verifyDatabase) await this.backend.verifyDatabase(target);
        else validateDatabase(serviceIdentity().database, true);
        // Durable point of no rollback. From here every recovery preserves
        // the upgraded DB, even if activation or the controller then crashes.
        this.save({ phase: 'committed', committedAt: new Date().toISOString(), approved: false, reason: undefined });
        await this.select(target.id);
        access(); access = undefined;
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
              if (!access) access = exclusiveDatabaseAccess();
              await (this.backend.restore ?? restoreCheckpointDatabase)(this.record.checkpoint);
            } catch (recoveryError) {
              this.save({ phase: 'recovery-required', approved: false, error: `Recovery needs attention. ${message(recoveryError)}` });
              throw recoveryError;
            }
          }
          await this.select(prior.id);
        }
        clearMaintenance();
        access?.(); access = undefined;
        activity?.(); activity = undefined;
        this.save({ phase: 'failed', approved: false, error: message(error) });
        if (stopped) {
          try { await this.backend.restart(await this.target(prior.id)); stopped = false; }
          catch (restartError) { this.save({ error: message(restartError) }); throw restartError; }
        }
        throw error;
      } finally {
        access?.(); activity?.();
        if (stopped) this.backend.unavailable?.(this.record.error ?? 'The backend stopped during an update. Review recovery before restarting.');
      }
    });
  }

  /** Runs before any token bootstrap, DB opener, scheduler or public socket. */
  async recover(retry = false) {
    // Restoring a checkpoint can await an out-of-process helper. Keep the
    // controller's busy fence held so a concurrent recover/stop/handoff cannot
    // race the database replacement or release ownership while it runs.
    return this.exclusive(() => this.recoverExclusive(retry));
  }
  private async recoverExclusive(retry: boolean) {
    if (retry && this.record.phase === 'recovery-required') {
      if (!this.record.committedAt && (!this.record.checkpoint || !this.record.priorId)) throw new Error('No complete recovery record is available. Inspect the preserved data before proceeding.');
      this.save({ phase: this.record.committedAt ? 'committed' : 'validating' });
    }
    if (this.record.phase === 'recovery-required') throw new Error(this.record.error ?? 'Manual recovery required');
    if (this.record.committedAt && this.record.release) {
      await this.select(this.record.release.runtime.id); clearMaintenance(); return;
    }
    if (this.record.phase === 'validating') {
      const release = exclusiveDatabaseAccess();
      try {
        await this.backend.assertNoLegacyWriters();
        if (!this.record.checkpoint || !this.record.priorId) throw new Error('Incomplete recovery record');
        await (this.backend.restore ?? restoreCheckpointDatabase)(this.record.checkpoint);
        await this.select(this.record.priorId);
        clearMaintenance();
        this.save({ phase: 'failed', approved: false, error: 'Interrupted update recovered. The prior version and data were restored.' });
      } catch (error) { this.save({ phase: 'recovery-required', error: message(error) }); throw error; }
      finally { release(); }
    } else if (transient.has(this.record.phase) || this.record.phase === 'downloading') {
      clearMaintenance();
      this.save({ phase: this.record.phase === 'downloading' ? 'available' : 'ready', approved: false, reason: 'Interrupted update. Review and retry.' });
    }
  }
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Update failed'; }
