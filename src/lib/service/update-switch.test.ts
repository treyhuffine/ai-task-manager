import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getRuntimeInstallDir, installedRuntime, stageRuntime } from './runtime';
import { readActivation } from './activation';
import { listSnapshots, restoreSnapshot } from './snapshot';
import { writeRuntimeFixture } from './runtime-fixture';
import { snapshotsInUse, UpdateCoordinator, type UpdateBackend } from './update';

const mocked = vi.hoisted(() => ({ check: vi.fn(), policy: vi.fn() }));
vi.mock('./release', () => ({ checkRelease: mocked.check, releasePolicy: mocked.policy, downloadRelease: vi.fn() }));

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
