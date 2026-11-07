import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeInstallDir, installedRuntime, stageRuntime, verifyRuntime } from './runtime';
import { writeOrigin } from './origin';
import { readActivation } from './activation';
import { listSnapshots, restoreSnapshot } from './snapshot';
import { writeRuntimeFixture } from './runtime-fixture';
import { snapshotsInUse, UpdateCoordinator, type UpdateBackend } from './update';
import { beginActivity, readMaintenance, writeMaintenance } from './maintenance';

const mocked = vi.hoisted(() => ({ check: vi.fn(), policy: vi.fn(), space: vi.fn() }));
vi.mock('./release', () => ({ checkRelease: mocked.check, checkReleaseVersion: mocked.check, releasePolicy: mocked.policy, downloadRelease: vi.fn() }));
vi.mock('./snapshot', async original => ({ ...await original<typeof import('./snapshot')>(), snapshotSpaceProblem: mocked.space }));

let root: string;
let directory: string;
let database: string;
let prior: string;
let candidate: string;
let backend: UpdateBackend;
const timing = { drain: 30, poll: 1, grace: 0 };
const coordinator = () => new UpdateCoordinator(backend, directory, timing);
function write(body: string) { const db = new Database(database); try { db.prepare('UPDATE notes SET body = ?').run(body); } finally { db.close(); } }
function read() { const db = new Database(database); try { return db.prepare('SELECT body FROM notes').pluck().get(); } finally { db.close(); } }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-update-switch-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home')); vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  fs.mkdirSync(path.join(root, 'home'));
  database = path.join(root, 'home/data.db');
  const db = new Database(database); db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes VALUES (1, 'before');"); db.close();
  const resources = path.join(root, 'resources');
  prior = writeRuntimeFixture(resources, { version: '0.1.0' }).id; stageRuntime(resources);
  candidate = writeRuntimeFixture(resources, { version: '0.2.0' }).id; stageRuntime(resources);
  directory = getRuntimeInstallDir();
  mocked.check.mockRejectedValue(new Error('A checkout release never asks the feed'));
  mocked.policy.mockReturnValue(null);
  mocked.space.mockReturnValue(null);
  backend = {
    activity: vi.fn(async () => []), stop: vi.fn(async () => {}), validate: vi.fn(async () => { write('migrated'); }),
    activate: vi.fn(async () => {}), restart: vi.fn(async () => {}), assertNoLegacyWriters: vi.fn(async () => {}),
    pendingMigrations: vi.fn(async () => 0), verifyDatabase: vi.fn(async () => {}),
  };
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('switches to a release built from a checkout without asking the feed, and records how to go back', async () => {
  const updater = coordinator();
  await updater.offer(candidate, { commit: 'a'.repeat(40) });
  expect(updater.status()).toMatchObject({ phase: 'ready', local: { commit: 'a'.repeat(40) }, release: { version: '0.2.0' } });
  await updater.apply();
  expect(mocked.check).not.toHaveBeenCalled();
  expect(updater.status().phase).toBe('committed');
  expect(installedRuntime()?.id).toBe(candidate);
  expect(readActivation(directory)).toEqual({ candidate, previous: prior, restore: false });
  expect(fs.readFileSync(path.join(directory, 'previous-release'), 'utf8').trim()).toBe(prior);
  expect(backend.activate).toHaveBeenCalledOnce();
});

it('reports a release that is already running as up to date', async () => {
  const updater = coordinator();
  await updater.offer(prior);
  expect(updater.status().phase).toBe('idle');
});

it('waits for running chats, unless asked to update now', async () => {
  backend.activity = vi.fn(async () => ['2 executions']);
  const waiting = coordinator(); await waiting.offer(candidate); waiting.approve(); await waiting.apply();
  expect(waiting.status()).toMatchObject({ phase: 'waiting', reason: '2 executions' });
  const now = coordinator(); now.approve(undefined, true); await now.apply();
  expect(now.status().phase).toBe('committed');
  expect(installedRuntime()?.id).toBe(candidate);
});

it('runs the full integrity check only when the update changes the schema', async () => {
  const updater = coordinator(); await updater.offer(candidate); await updater.apply();
  expect(backend.verifyDatabase).not.toHaveBeenCalled();
  fs.writeFileSync(path.join(directory, 'active-release'), `${prior}\n`);
  backend.pendingMigrations = vi.fn(async () => 2);
  const migrating = coordinator(); await migrating.offer(candidate); await migrating.apply();
  expect(backend.verifyDatabase).toHaveBeenCalledOnce();
  // The check-only start learns it migrates, so the controller gives it longer.
  expect(backend.validate).toHaveBeenLastCalledWith(expect.objectContaining({ id: candidate }), expect.any(String), 2);
});

it('restores the snapshot exactly when the launcher put the previous release back', async () => {
  const updater = coordinator(); await updater.offer(candidate); await updater.apply();
  expect(read()).toBe('migrated');
  // The launcher: the candidate exited twice before starting work.
  fs.writeFileSync(path.join(directory, 'active-release'), `${prior}\n`);
  fs.writeFileSync(path.join(directory, 'activation/restore'), '');
  fs.rmSync(path.join(directory, 'activation/candidate'));
  const restarted = coordinator();
  await restarted.recover();
  expect(read()).toBe('before');
  expect(installedRuntime()?.id).toBe(prior);
  expect(restarted.status()).toMatchObject({ phase: 'failed', error: expect.stringContaining("didn't start") });
  expect(restarted.status().committedAt).toBeUndefined();
  expect(readActivation(directory)).toEqual({ candidate: null, previous: null, restore: false });
  // A later start doesn't select the failed release again.
  await coordinator().recover();
  expect(installedRuntime()?.id).toBe(prior);
});

it('keeps the launcher\'s fallback whichever side of the commit a crash lands on', async () => {
  const updater = coordinator(); await updater.offer(candidate);
  const seen: string[] = [];
  backend.activate = vi.fn(async () => { seen.push('activate'); });
  await updater.apply();
  const record = path.join(directory, 'update.json');
  const committed = JSON.parse(fs.readFileSync(record, 'utf8'));
  // The fallback was written first, so a committed update always has one.
  expect(readActivation(directory)).toMatchObject({ candidate, previous: prior });

  // Crash just after the commit, before the pointer moved.
  fs.writeFileSync(path.join(directory, 'active-release'), `${prior}\n`);
  await coordinator().recover();
  expect(installedRuntime()?.id).toBe(candidate);
  expect(readActivation(directory)).toMatchObject({ candidate, previous: prior });
  expect(fs.readFileSync(path.join(directory, 'previous-release'), 'utf8').trim()).toBe(prior);

  // Crash just before the commit: the fallback exists, the journal says validating.
  // Nothing was committed, so the update is undone and the record goes with it.
  fs.writeFileSync(path.join(directory, 'active-release'), `${prior}\n`);
  fs.writeFileSync(record, JSON.stringify({ ...committed, phase: 'validating', committedAt: undefined }));
  write('changed by the check-only start');
  const restarted = coordinator();
  await restarted.recover();
  expect(read()).toBe('before');
  expect(installedRuntime()?.id).toBe(prior);
  expect(restarted.status().phase).toBe('failed');
  expect(readActivation(directory)).toEqual({ candidate: null, previous: null, restore: false });
});

it('changes nothing when a finished update is recovered on an ordinary start', async () => {
  const updater = coordinator(); await updater.offer(candidate); await updater.apply();
  const active = path.join(directory, 'active-release');
  const before = fs.statSync(active).mtimeMs;
  await new Promise(resolve => setTimeout(resolve, 20));
  await coordinator().recover();
  expect(fs.statSync(active).mtimeMs).toBe(before);
  expect(installedRuntime()?.id).toBe(candidate);
});

it('finishes a rollback whose restore failed, instead of selecting the release it was leaving', async () => {
  const before = coordinator(); await before.offer(candidate); await before.apply();
  write('written after the update');
  const crashed = coordinator();
  backend.restore = vi.fn(async () => { throw new Error('power cut'); });
  await expect(crashed.rollback()).rejects.toThrow('power cut');
  expect(crashed.status()).toMatchObject({ phase: 'recovery-required', rollback: { to: prior, leaving: candidate } });
  expect(read()).toBe('written after the update');
  delete backend.restore;
  const restarted = coordinator();
  await restarted.recover();
  expect(read()).toBe('before');
  expect(installedRuntime()?.id).toBe(prior);
  expect(restarted.status()).toMatchObject({ phase: 'idle', reason: expect.stringContaining('Rolled back') });
  expect(restarted.status().rollback).toBeUndefined();
});

it('finishes a rollback that crashed after its restore, before moving the pointers', async () => {
  const before = coordinator(); await before.offer(candidate); await before.apply();
  write('written after the update');
  const snapshot = coordinator().rollbackStatus().snapshot!;
  // The journal says a rollback is under way, the database is already back, and
  // the Home still points at the release it was leaving.
  const record = path.join(directory, 'update.json');
  fs.writeFileSync(record, JSON.stringify({ ...JSON.parse(fs.readFileSync(record, 'utf8')), rollback: { to: prior, leaving: candidate, snapshot } }));
  await restoreSnapshot(snapshot);
  expect(installedRuntime()?.id).toBe(candidate);
  const restarted = coordinator();
  await restarted.recover();
  expect(read()).toBe('before');
  expect(installedRuntime()?.id).toBe(prior);
  expect(fs.readFileSync(path.join(directory, 'previous-release'), 'utf8').trim()).toBe(candidate);
  expect(restarted.status()).toMatchObject({ phase: 'idle' });
  expect(restarted.status().committedAt).toBeUndefined();
  // The next start doesn't select the release it left.
  await coordinator().recover();
  expect(installedRuntime()?.id).toBe(prior);
});

it('leaves the server to come back when a rollback stops before changing anything', async () => {
  const before = coordinator(); await before.offer(candidate); await before.apply();
  backend.assertNoLegacyWriters = vi.fn(async () => { throw new Error('another writer'); });
  const updater = coordinator();
  await expect(updater.rollback()).rejects.toThrow('another writer');
  // Nothing was touched, so this isn't a recovery a person must finish.
  expect(updater.status().phase).toBe('committed');
  expect(updater.status().rollback).toBeUndefined();
  expect(read()).toBe('migrated');
});

it('repeats a failed-update recovery that crashed, instead of selecting the rejected release', async () => {
  const updater = coordinator(); await updater.offer(candidate); await updater.apply();
  fs.writeFileSync(path.join(directory, 'active-release'), `${prior}\n`);
  fs.writeFileSync(path.join(directory, 'activation/restore'), '');
  fs.rmSync(path.join(directory, 'activation/candidate'));
  await coordinator().recover();
  // A crash after the record was saved, before the evidence went: it comes back.
  fs.mkdirSync(path.join(directory, 'activation'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'activation/restore'), '');
  const restarted = coordinator();
  await restarted.recover();
  expect(installedRuntime()?.id).toBe(prior);
  expect(read()).toBe('before');
  expect(restarted.status().phase).toBe('failed');
  expect(readActivation(directory).restore).toBe(false);
});

it('releases a snapshot once recovery no longer needs it, so retention applies', () => {
  const none = { candidate: null, restore: false };
  const checkpoint = '/snapshot';
  expect(snapshotsInUse({ phase: 'validating', checkpoint }, none)).toEqual([checkpoint]);
  expect(snapshotsInUse({ phase: 'recovery-required', checkpoint }, none)).toEqual([checkpoint]);
  expect(snapshotsInUse({ phase: 'committed', checkpoint }, { candidate: 'a', restore: false })).toEqual([checkpoint]);
  expect(snapshotsInUse({ phase: 'committed', checkpoint }, { candidate: null, restore: true })).toEqual([checkpoint]);
  // A new release that started work: only the 7-day rule applies from here.
  expect(snapshotsInUse({ phase: 'committed', checkpoint }, none)).toEqual([]);
  expect(snapshotsInUse({ phase: 'idle', rollback: { to: 'a', leaving: 'b', snapshot: '/rolling' } }, none)).toEqual(['/rolling']);
});

it('offers no rollback for a Home that has run only this version here, and says where its copy is', async () => {
  const updater = coordinator(); await updater.offer(candidate); await updater.apply();
  const { createSnapshot } = await import('./snapshot');
  const copy = await createSnapshot({ from: candidate, to: candidate });
  expect(coordinator().rollbackStatus()).toMatchObject({ available: false, reason: expect.stringContaining(copy) });
});

it('rolls back on request, listing what it loses, until the snapshot expires', async () => {
  const before = coordinator();
  expect(before.rollbackStatus().available).toBe(false);
  await before.offer(candidate); await before.apply();
  write('written after the update');
  const updater = coordinator();
  const preview = updater.rollbackPreview();
  expect(preview).toMatchObject({ available: true, from: prior, to: candidate, changes: { notes: 0, tasks: 0, chats: 0, messages: 0 } });
  expect(Date.parse(preview.expiresAt!) - Date.parse(preview.createdAt!)).toBe(7 * 24 * 60 * 60_000);
  expect(updater.rollbackStatus(Date.parse(preview.createdAt!) + 8 * 24 * 60 * 60_000)).toMatchObject({ available: false, reason: expect.stringContaining('expired') });
  await updater.rollback();
  expect(read()).toBe('before');
  expect(installedRuntime()?.id).toBe(prior);
  expect(fs.readFileSync(path.join(directory, 'previous-release'), 'utf8').trim()).toBe(candidate);
  expect(updater.status()).toMatchObject({ phase: 'idle', reason: expect.stringContaining('Rolled back from 0.2.0') });
  expect(backend.activate).toHaveBeenCalledTimes(2);
  // Nothing left to roll back: the snapshot belonged to the release this Home left.
  expect(coordinator().rollbackStatus().available).toBe(false);
  expect(listSnapshots()).toHaveLength(1);
});

it('waits for running work with the Home open and nothing hashed, and --now then acts at once', async () => {
  backend.work = vi.fn(async () => ['1 chat']);
  backend.verify = vi.fn(async (folder: string) => (await import('./runtime-manifest')).verifyRuntime(folder));
  backend.prepareIdle = vi.fn(async () => {});
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick(); await updater.tick(); await updater.tick();
  expect(updater.status()).toMatchObject({ phase: 'waiting', approved: true, reason: '1 chat', busy: false });
  expect(backend.verify).not.toHaveBeenCalled();
  expect(backend.prepareIdle).not.toHaveBeenCalled();
  expect(readMaintenance()).toBeNull();
  // `ri update --now` asks again while it waits, as the waiting message says to.
  await updater.offer(candidate);
  updater.approve(undefined, true);
  await updater.tick();
  expect(backend.verify).toHaveBeenCalledOnce();
  expect(backend.stop).toHaveBeenCalledOnce();
  expect(updater.status().phase).toBe('committed');
  expect(installedRuntime(directory)!.id).toBe(candidate);
});

it('switches by itself once the running work finishes', async () => {
  let running = ['1 chat'];
  backend.work = vi.fn(async () => running);
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick();
  expect(backend.stop).not.toHaveBeenCalled();
  running = [];
  await updater.tick();
  expect(backend.stop).toHaveBeenCalledOnce();
  expect(installedRuntime(directory)!.id).toBe(candidate);
});

it('checks a release in full once per update, however many tries the switch takes', async () => {
  let blocked = ['A connected device runs an older version'];
  backend.compatibility = vi.fn(async () => blocked);
  backend.verify = vi.fn(async (folder: string) => (await import('./runtime-manifest')).verifyRuntime(folder));
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick(); await updater.tick();
  expect(updater.status().phase).toBe('waiting');
  blocked = [];
  await updater.tick();
  expect(backend.verify).toHaveBeenCalledOnce();
  expect(installedRuntime(directory)!.id).toBe(candidate);
});

it('refuses a release for a Home with none, so it never waits on a switch it can\'t make', async () => {
  fs.rmSync(path.join(directory, 'active-release'));
  const updater = coordinator();
  await expect(updater.offer(candidate)).rejects.toThrow("doesn't run a release yet");
  expect(updater.status().phase).not.toBe('waiting');
  expect(updater.status().approved).toBeFalsy();
});

it('still drains a Home with only idle agent processes, because draining is what closes them', async () => {
  let idle = ['1 running process (claude)'];
  backend.work = vi.fn(async () => []);
  backend.activity = vi.fn(async () => idle);
  backend.prepareIdle = vi.fn(async () => { idle = []; });
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick();
  expect(backend.prepareIdle).toHaveBeenCalledOnce();
  expect(installedRuntime(directory)!.id).toBe(candidate);
});

it('reopens a Home when it can\'t drain, tries again after a while, and hashes once', async () => {
  // A lease nothing reports as work: a message queued for a device that's away.
  const held = beginActivity();
  backend.work = vi.fn(async () => []);
  backend.prepareIdle = vi.fn(async () => {});
  backend.verify = vi.fn(async (folder: string) => (await import('./runtime-manifest')).verifyRuntime(folder));
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick();
  expect(updater.status()).toMatchObject({ phase: 'waiting', reason: expect.stringContaining('active requests'), busy: false });
  expect(readMaintenance()).toBeNull();
  // The next ticks leave the Home open, rather than closing it half the time.
  await updater.tick(); await updater.tick();
  expect(backend.prepareIdle).toHaveBeenCalledOnce();
  expect(backend.stop).not.toHaveBeenCalled();
  // Asking again tries again, and the release isn't hashed a second time.
  held();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick();
  expect(backend.verify).toHaveBeenCalledOnce();
  expect(installedRuntime(directory)!.id).toBe(candidate);
});

it('--now goes through while a chat turn holds its lease, because stopping the server ends the turn', async () => {
  const turn = beginActivity();
  backend.stop = vi.fn(async () => { turn(); });
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve(undefined, true);
  await updater.tick();
  expect(backend.stop).toHaveBeenCalledOnce();
  expect(backend.activate).toHaveBeenCalledOnce();
  expect(updater.status()).toMatchObject({ phase: 'committed', force: false });
  expect(installedRuntime(directory)!.id).toBe(candidate);
  expect(readMaintenance()).toBeNull();
});

it('--now gives up honestly if something outside the server won\'t let go, and restarts what ran', async () => {
  const stuck = beginActivity();
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve(undefined, true);
  await updater.tick();
  expect(backend.stop).toHaveBeenCalled();
  expect(backend.restart).toHaveBeenCalledOnce();
  expect(updater.status()).toMatchObject({ phase: 'failed', approved: false, force: false });
  expect(installedRuntime(directory)!.id).toBe(prior);
  expect(readMaintenance()).toBeNull();
  stuck();
});

it('rolling back goes through while a chat turn holds its lease', async () => {
  const updater = coordinator();
  await updater.offer(candidate);
  await updater.apply();
  const turn = beginActivity();
  backend.stop = vi.fn(async () => { turn(); });
  await coordinator().rollback();
  expect(installedRuntime(directory)!.id).toBe(prior);
});

it('stops asking after a release fails its check, until someone asks again', async () => {
  backend.verify = vi.fn(async () => { throw new Error('The release is damaged'); });
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick(); await updater.tick();
  expect(backend.verify).toHaveBeenCalledOnce();
  expect(updater.status()).toMatchObject({ phase: 'failed', approved: false, error: 'The release is damaged' });
});

it('waits when an idle agent won\'t close, and --now goes on without it', async () => {
  backend.prepareIdle = vi.fn(async () => { throw new Error('An idle harness did not close. The update will wait.'); });
  const waiting = coordinator();
  await waiting.offer(candidate);
  waiting.approve();
  await waiting.tick();
  expect(waiting.status()).toMatchObject({ phase: 'waiting', approved: true, reason: expect.stringContaining('did not close') });
  expect(readMaintenance()).toBeNull();
  await waiting.offer(candidate);
  waiting.approve(undefined, true);
  await waiting.tick();
  expect(installedRuntime(directory)!.id).toBe(candidate);
});

it('forgets --now when the controller restarts, so it can\'t end a chat started later', async () => {
  backend.compatibility = vi.fn(async () => ['A connected device runs an older version']);
  const before = coordinator();
  await before.offer(candidate);
  before.approve(undefined, true);
  await before.tick();
  expect(before.status()).toMatchObject({ phase: 'waiting', force: true });
  const after = coordinator();
  await after.recover();
  expect(after.status()).toMatchObject({ phase: 'waiting', approved: true, force: false });
});

it('keeps waiting when the server stalls during a drain, rather than failing the update', async () => {
  backend.work = vi.fn(async () => []);
  let stalled = true;
  backend.activity = vi.fn(async () => { if (stalled) throw new Error('Backend readiness is unavailable'); return []; });
  const updater = coordinator();
  await updater.offer(candidate);
  updater.approve();
  await updater.tick();
  expect(updater.status()).toMatchObject({ phase: 'waiting', approved: true, reason: 'the server to answer' });
  expect(readMaintenance()).toBeNull();
  stalled = false;
  await updater.offer(candidate);
  updater.approve();
  await updater.tick();
  expect(installedRuntime(directory)!.id).toBe(candidate);
});

it('clears a gate a crash left behind, so the server can open the database again', async () => {
  writeMaintenance({ phase: 'offline', token: 'left-by-a-crash', startedAt: new Date().toISOString() });
  await coordinator().recover();
  expect(readMaintenance()).toBeNull();
});

it('keeps the gate when recovery needs a person', async () => {
  writeMaintenance({ phase: 'offline', token: 'left-by-a-crash', startedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(directory, 'update.json'), JSON.stringify({ format: 1, phase: 'recovery-required', changedAt: new Date().toISOString() }));
  await expect(coordinator().recover()).rejects.toThrow();
  expect(readMaintenance()).not.toBeNull();
});

describe('the automatic update rule (section 7.2)', () => {
  const MINUTE = 60_000;
  let now: number;
  let lastUseAt: number;
  let work: string[];
  beforeEach(() => {
    now = Date.parse('2026-11-07T12:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    lastUseAt = 0; work = [];
    backend.quiet = vi.fn(async () => ({ work, lastUseAt }));
    backend.work = vi.fn(async () => work);
  });
  afterEach(() => { vi.useRealTimers(); });
  async function waiting() {
    const updater = coordinator();
    await updater.offer(candidate);
    updater.approveAutomatically();
    return updater;
  }

  it('waits 10 quiet minutes, gives a minute\'s heads-up, then switches', async () => {
    const updater = await waiting();
    await updater.tick();
    expect(updater.status()).toMatchObject({ phase: 'waiting', automatic: true, reason: 'a quiet moment' });
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
    expect(backend.stop).not.toHaveBeenCalled();
    now += MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(backend.stop).toHaveBeenCalledOnce();
    expect(updater.status()).toMatchObject({ phase: 'committed', approved: false });
    expect(updater.status().lastAutomaticAt).toBe(new Date(now).toISOString());
    expect(installedRuntime(directory)!.id).toBe(candidate);
  });

  it('settles everything that could stop it before the notice, so Not now always works', async () => {
    backend.verify = vi.fn(async (resources: string) => verifyRuntime(resources));
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(backend.verify).toHaveBeenCalledOnce();
    expect(updater.status().headsUpAt).toBeTruthy();
    expect(() => updater.later()).not.toThrow();
    expect(updater.status().headsUpAt).toBeUndefined();
    now += 61 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
    // It asks again, so the answer has to be there again.
    expect(updater.status().heldUntil).toBeUndefined();
    now += MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().phase).toBe('committed');
    expect(backend.verify).toHaveBeenCalledOnce();
  });

  it('shows no notice for a release that fails its check, and stays off it', async () => {
    backend.verify = vi.fn(async () => { throw new Error('A file changed on disk'); });
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status()).toMatchObject({ phase: 'failed', error: 'A file changed on disk', rejected: candidate, approved: false });
    expect(updater.status().headsUpAt).toBeUndefined();
    expect(backend.stop).not.toHaveBeenCalled();
  });

  it('shows no notice while a connected computer would be left behind', async () => {
    backend.compatibility = vi.fn(async () => ['a connected computer needs a compatible bridge first']);
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeUndefined();
    expect(updater.status().reason).toContain('compatible bridge');
    backend.compatibility = vi.fn(async () => []);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
  });

  it('stands down when automatic updates are turned off, even mid-notice', async () => {
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
    writeOrigin({ auto: false });
    now += 5 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(backend.stop).not.toHaveBeenCalled();
    expect(updater.status()).toMatchObject({ phase: 'ready', approved: false });
    expect(updater.status().headsUpAt).toBeUndefined();
    // Someone can still ask.
    updater.approve();
    await updater.tick();
    expect(updater.status().phase).toBe('committed');
  });

  it('holds a scheduled update to the rule inside its window, and lets Update now go ahead of it', async () => {
    const hour = new Date(now).getUTCHours();
    const inside = { hour, durationHours: 1, timeZone: 'UTC' };
    const updater = coordinator();
    await updater.offer(candidate);
    updater.approve(inside, false, false);
    await updater.tick();
    expect(updater.status()).toMatchObject({ phase: 'waiting', reason: 'a quiet moment', window: inside });
    expect(backend.stop).not.toHaveBeenCalled();
    updater.later();

    const outside = { hour: (hour + 6) % 24, durationHours: 1, timeZone: 'UTC' };
    updater.approve(outside, false, false);
    now += 11 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().reason).toContain('maintenance window');
    updater.approve();
    await updater.tick();
    expect(updater.status().phase).toBe('committed');
    expect(updater.status().window).toEqual(outside);
  });

  it('hears Not now even while it is deciding, and keeps the hold', async () => {
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
    now += MINUTE; vi.setSystemTime(now);
    let answer!: (reasons: string[]) => void;
    backend.compatibility = vi.fn(() => new Promise<string[]>(resolve => { answer = resolve; }));
    const deciding = updater.tick();
    await vi.waitFor(() => expect(backend.compatibility).toHaveBeenCalled());
    updater.later();
    answer([]);
    await deciding;
    expect(backend.stop).not.toHaveBeenCalled();
    expect(updater.status().heldUntil).toBeTruthy();
    expect(updater.status().headsUpAt).toBeUndefined();
  });

  it('does not hold a shutdown mid-check against the release', async () => {
    backend.verify = vi.fn(async () => { throw Object.assign(new Error('The service stopped this runtime job'), { stopped: true }); });
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status()).toMatchObject({ phase: 'waiting', automatic: true });
    expect(updater.status().rejected).toBeUndefined();
  });

  it('waits for room on the disk, with the Home still serving, and shows no notice meanwhile', async () => {
    mocked.space.mockReturnValue('Not enough free disk space to update safely. The update needs 2.0 GiB free and 1.0 GiB is.');
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeUndefined();
    expect(updater.status().reason).toContain('Not enough free disk space');
    expect(backend.stop).not.toHaveBeenCalled();
    mocked.space.mockReturnValue(null);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
  });

  it('asks nothing of a person who asked, but still waits for room', async () => {
    mocked.space.mockReturnValue('Not enough free disk space to update safely. The update needs 2.0 GiB free and 1.0 GiB is.');
    const updater = coordinator();
    await updater.offer(candidate);
    updater.approve();
    await updater.apply();
    expect(updater.status()).toMatchObject({ phase: 'waiting', reason: expect.stringContaining('Not enough free disk space') });
    expect(updater.status().rejected).toBeUndefined();
    expect(backend.stop).not.toHaveBeenCalled();
  });

  it('does not stop the Home again after a snapshot that had no room, until the disk has it', async () => {
    backend.checkpoint = vi.fn(async () => { throw new Error('Not enough free disk space to update safely. This disk needs more.'); });
    const updater = coordinator();
    await updater.offer(candidate);
    updater.approve(undefined, true);
    await updater.apply().catch(() => {});
    expect(updater.status().force).toBe(false);
    expect(backend.stop).toHaveBeenCalled();
    const stops = vi.mocked(backend.stop).mock.calls.length;
    // The tick right after: asked for now, but no longer forced past the wait.
    await updater.tick();
    expect(vi.mocked(backend.stop).mock.calls.length).toBe(stops);
  });

  it('goes back and waits if the disk fills up between the check and the snapshot', async () => {
    backend.checkpoint = vi.fn(async () => { throw new Error('Not enough free disk space to update safely. This disk needs more.'); });
    const updater = coordinator();
    await updater.offer(candidate);
    updater.approve();
    await updater.apply().catch(() => {});
    expect(updater.status()).toMatchObject({ phase: 'waiting', reason: expect.stringContaining('Not enough free disk space') });
    expect(updater.status().rejected).toBeUndefined();
    expect(installedRuntime(directory)!.id).toBe(prior);
    expect(backend.restart).toHaveBeenCalledOnce();
  });

  it('cancels the heads-up when someone uses Ri, and starts the wait over', async () => {
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
    lastUseAt = now + 1000;
    now += 30_000; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeUndefined();
    now += 9 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeUndefined();
    expect(backend.stop).not.toHaveBeenCalled();
  });

  it('cancels the heads-up when a chat starts, and counts 10 minutes from when it ends', async () => {
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    work = ['1 chat'];
    now += 30_000; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status()).toMatchObject({ reason: '1 chat' });
    expect(updater.status().headsUpAt).toBeUndefined();
    work = [];
    now += 9 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeUndefined();
    now += MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
  });

  it('never stops running work, however long it runs, and says so after a day', async () => {
    work = ['2 chats'];
    const updater = await waiting();
    now += 25 * 60 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(backend.stop).not.toHaveBeenCalled();
    expect(updater.status()).toMatchObject({ phase: 'waiting', reason: '2 chats', waitingLong: true });
  });

  it('holds for an hour after Not now, then asks again', async () => {
    const updater = await waiting();
    now += 10 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    updater.later();
    expect(updater.status().headsUpAt).toBeUndefined();
    expect(updater.status().phase).toBe('waiting');
    now += 59 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeUndefined();
    now += MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
  });

  it('lets Update now skip the wait, and waits for chats unless told to end them', async () => {
    work = ['1 chat'];
    const updater = await waiting();
    updater.approve();
    await updater.tick();
    expect(updater.status()).toMatchObject({ automatic: false, reason: '1 chat' });
    expect(backend.stop).not.toHaveBeenCalled();
    work = [];
    await updater.tick();
    expect(backend.stop).toHaveBeenCalledOnce();
  });

  it('updates by itself at most every 12 hours', async () => {
    const updater = await waiting();
    now += 11 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    now += MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(installedRuntime(directory)!.id).toBe(candidate);
    await updater.offer(prior);
    expect(updater.status().phase).toBe('ready');
    updater.approveAutomatically();
    now += 60 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().reason).toMatch(/12 hours/);
    expect(installedRuntime(directory)!.id).toBe(candidate);
    now += 12 * 60 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().headsUpAt).toBeTruthy();
  });

  it('survives a controller restart, starting the quiet stretch again', async () => {
    const first = await waiting();
    now += 9 * MINUTE; vi.setSystemTime(now);
    await first.tick();
    const second = coordinator();
    expect(second.status()).toMatchObject({ phase: 'waiting', automatic: true });
    now += 2 * MINUTE; vi.setSystemTime(now);
    await second.tick();
    expect(second.status().headsUpAt).toBeUndefined();
    now += 8 * MINUTE; vi.setSystemTime(now);
    await second.tick();
    expect(second.status().headsUpAt).toBeTruthy();
  });

  it('never moves by itself to a release that failed here', async () => {
    backend.validate = vi.fn(async () => { throw new Error('The check-only start failed'); });
    const updater = await waiting();
    now += 11 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    now += MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status()).toMatchObject({ phase: 'failed', rejected: candidate });
    expect(installedRuntime(directory)!.id).toBe(prior);
    await updater.offer(candidate);
    updater.approveAutomatically();
    expect(updater.status().phase).toBe('ready');
    // A person asking still can.
    backend.validate = vi.fn(async () => {});
    updater.approve();
    now += MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(installedRuntime(directory)!.id).toBe(candidate);
    expect(updater.status().rejected).toBeUndefined();
  });

  it('never moves by itself back to a release its owner rolled back', async () => {
    const first = coordinator();
    await first.offer(candidate);
    await first.apply();
    const updater = coordinator();
    await updater.rollback();
    expect(updater.status().rejected).toBe(candidate);
  });

  it('leaves a server that does not answer waiting', async () => {
    backend.quiet = vi.fn(async () => { throw new Error('No answer'); });
    const updater = await waiting();
    now += 60 * MINUTE; vi.setSystemTime(now);
    await updater.tick();
    expect(updater.status().phase).toBe('waiting');
    expect(backend.stop).not.toHaveBeenCalled();
  });
});
