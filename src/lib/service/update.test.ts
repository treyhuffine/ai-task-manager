import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntimeManifest, stageRuntime, installedRuntime, getRuntimeInstallDir } from './runtime';
import { readMaintenance, acquireDatabaseAccess, beginActivity } from './maintenance';
import { createCheckpoint } from './checkpoint';
import { UpdateCoordinator, type UpdateBackend, type UpdateRecord } from './update';
import type { Release } from './release';
const mocked = vi.hoisted(() => ({ check: vi.fn(), policy: vi.fn() }));
vi.mock('./release', () => ({ checkRelease: mocked.check, releasePolicy: mocked.policy, downloadRelease: vi.fn() }));
let directory: string;
let root: string;
let prior: string;
let candidate: string;
let release: Release;
let backend: UpdateBackend;
let database: string;
const timing = { drain: 30, poll: 1, grace: 0 };
function write(body: string) { const db = new Database(database); try { db.prepare('UPDATE notes SET body=?').run(body); } finally { db.close(); } }
function read() { const db = new Database(database); try { return db.prepare('SELECT body FROM notes').pluck().get(); } finally { db.close(); } }
function save(record: Partial<UpdateRecord>) { fs.writeFileSync(path.join(directory, 'update.json'), JSON.stringify({ format: 1, phase: 'ready', release, priorId: prior, changedAt: new Date().toISOString(), ...record })); }
function coordinator() { return new UpdateCoordinator(backend, directory, timing); }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-update-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home')); vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  fs.mkdirSync(path.join(root, 'home'));
  database = path.join(root, 'home/data.db');
  const db = new Database(database); db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes VALUES (1, 'before');"); db.close();
  const resources = path.join(root, 'resources');
  for (const file of ['node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs']) {
    fs.mkdirSync(path.dirname(path.join(resources, file)), { recursive: true }); fs.writeFileSync(path.join(resources, file), file);
  }
  fs.writeFileSync(path.join(resources, 'server/package.json'), '{"version":"0.1.0"}');
  prior = createRuntimeManifest(resources).id; stageRuntime(resources);
  fs.writeFileSync(path.join(resources, 'server/package.json'), '{"version":"0.2.0"}');
  candidate = createRuntimeManifest(resources).id; stageRuntime(resources);
  directory = getRuntimeInstallDir();
  release = { runtime: { id: candidate }, version: '0.2.0' } as Release;
  mocked.check.mockResolvedValue(release); mocked.policy.mockReturnValue({});
  backend = { activity: vi.fn(async () => []), stop: vi.fn(async () => {}), validate: vi.fn(async () => { write('migrated'); }), activate: vi.fn(async () => {}), restart: vi.fn(async () => {}), assertNoLegacyWriters: vi.fn(async () => {}) };
  save({});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('preserves an approved maintenance window across controller restarts', () => {
  const window = { hour: 23, durationHours: 3, timeZone: 'America/Denver' };
  coordinator().approve(window);
  expect(coordinator().status()).toMatchObject({ phase: 'waiting', approved: true, window });
});
it('honors cross-midnight windows and never stops busy work inside a window', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-26T04:00:00Z'));
  backend.activity = vi.fn(async () => ['2 executions']);
  coordinator().approve({ hour: 23, durationHours: 3, timeZone: 'UTC' });
  const updater = coordinator();
  await updater.tick();
  expect(backend.activity).not.toHaveBeenCalled();
  expect(updater.status().reason).toMatch(/maintenance window/);
  vi.setSystemTime(new Date('2026-09-27T00:00:00Z'));
  await updater.tick();
  expect(backend.activity).toHaveBeenCalledOnce();
  expect(backend.stop).not.toHaveBeenCalled();
  expect(updater.status()).toMatchObject({ phase: 'waiting', approved: true, reason: '2 executions' });
});
it('lets an explicit immediate request replace a schedule and Later revoke approval', () => {
  const updater = coordinator();
  updater.approve({ hour: 3, durationHours: 2, timeZone: 'UTC' });
  updater.approve();
  expect(coordinator().status()).toMatchObject({ approved: true });
  expect(coordinator().status().window).toBeUndefined();
  updater.later();
  expect(coordinator().status()).toMatchObject({ phase: 'ready', approved: false });
});
it('rejects an invalid schedule without approving the release', () => {
  const updater = coordinator();
  expect(() => updater.approve({ hour: 3, durationHours: 2, timeZone: 'invalid' })).toThrow();
  expect(updater.status().approved).not.toBe(true);
});

it('checkpoints and validates before the durable commit and admission reopening', async () => {
  backend.validate = vi.fn(async (_target, token) => {
    expect(readMaintenance()).toMatchObject({ phase: 'offline', token });
    expect(() => acquireDatabaseAccess(database)).toThrow();
    expect(() => beginActivity()).toThrow();
    write('migrated');
  });
  backend.activate = vi.fn(async () => { expect(readMaintenance()).toBeNull(); expect(installedRuntime()?.id).toBe(candidate); });
  const updater = coordinator(); await updater.apply();
  expect(updater.status().phase).toBe('committed'); expect(read()).toBe('migrated');
  expect(backend.activate).toHaveBeenCalledOnce();
});
it('leaves busy work on the original runtime', async () => {
  backend.activity = vi.fn(async () => ['1 execution']);
  const updater = coordinator(); updater.approve(); await updater.apply();
  expect(updater.status()).toMatchObject({ phase: 'waiting', reason: '1 execution', approved: true });
  expect(backend.stop).not.toHaveBeenCalled(); expect(readMaintenance()).toBeNull();
});
it('reports a completed fast download while runtime verification is still busy', async () => {
  release.runtime.size = 100;
  save({ phase: 'available' });
  const updater = coordinator();
  backend.download = async (_release, progress) => {
    progress(10); progress(100);
    expect(updater.status()).toMatchObject({ phase: 'downloading', bytes: 100, busy: true });
  };
  await updater.download();
  expect(updater.status()).toMatchObject({ phase: 'ready', bytes: 100, busy: false });
});
it('cancels pending activation when the publisher withdraws the release', async () => {
  mocked.check.mockRejectedValueOnce(new Error('This release was withdrawn'));
  const updater = coordinator(); updater.approve();
  await expect(updater.apply()).rejects.toThrow('withdrawn');
  expect(updater.status()).toMatchObject({ phase: 'failed', approved: false });
  expect(backend.stop).not.toHaveBeenCalled(); expect(readMaintenance()).toBeNull();
});
it('waits when an admitted operation races the idle check', async () => {
  const finish = beginActivity();
  try { const updater = coordinator(); await updater.apply(); expect(updater.status().phase).toBe('waiting'); expect(backend.stop).not.toHaveBeenCalled(); }
  finally { finish(); }
  expect(readMaintenance()).toBeNull();
});
it('restores the checkpoint after migration or validation failure', async () => {
  backend.validate = vi.fn(async () => { write('half-migrated'); throw new Error('candidate crashed'); });
  const updater = coordinator(); await expect(updater.apply()).rejects.toThrow('candidate crashed');
  expect(read()).toBe('before'); expect(installedRuntime()?.id).toBe(prior);
  expect(updater.status().phase).toBe('failed'); expect(backend.restart).toHaveBeenCalledOnce();
});
it('never restores a checkpoint after committing, even if activation fails', async () => {
  backend.unavailable = vi.fn();
  backend.activate = vi.fn(async () => { write('new user data'); throw new Error('activation failed'); });
  const updater = coordinator(); await expect(updater.apply()).rejects.toThrow('activation failed');
  expect(read()).toBe('new user data'); expect(updater.status().phase).toBe('recovery-required');
  expect(backend.stop).toHaveBeenCalledTimes(2);
  expect(backend.unavailable).toHaveBeenCalledWith(expect.stringContaining('new database is retained'));
  await expect(coordinator().recover()).rejects.toThrow('retained');
  expect(read()).toBe('new user data');
});
it('exposes a stopped recovery failure to the controller instead of remaining updating', async () => {
  backend.validate = vi.fn(async () => { write('candidate'); throw new Error('candidate crashed'); });
  backend.restore = vi.fn(async () => { throw new Error('checkpoint unavailable'); });
  backend.unavailable = vi.fn();
  const updater = coordinator();
  await expect(updater.apply()).rejects.toThrow('checkpoint unavailable');
  expect(updater.status()).toMatchObject({ phase: 'recovery-required', busy: false });
  expect(backend.unavailable).toHaveBeenCalledWith(expect.stringContaining('checkpoint unavailable'));
  expect(backend.restart).not.toHaveBeenCalled();
});
it('exposes a failed prior-runtime restart while retaining its restored database', async () => {
  backend.validate = vi.fn(async () => { write('candidate'); throw new Error('candidate crashed'); });
  backend.restart = vi.fn(async () => { throw new Error('prior backend could not restart'); });
  backend.unavailable = vi.fn();
  const updater = coordinator();
  await expect(updater.apply()).rejects.toThrow('prior backend could not restart');
  expect(read()).toBe('before');
  expect(backend.unavailable).toHaveBeenCalledOnce();
  await expect(updater.recover(true)).resolves.toBeUndefined();
});
it.each(['draining', 'checkpointing'] as const)('recovers a controller crash in %s without restoring untouched data', async phase => {
  save({ phase }); const updater = coordinator(); await updater.recover();
  expect(read()).toBe('before'); expect(updater.status().phase).toBe('ready');
});
it('recovers a controller crash during candidate validation', async () => {
  const checkpoint = await createCheckpoint(path.join(directory, 'recovery/test'));
  write('candidate'); save({ phase: 'validating', checkpoint });
  await coordinator().recover(); expect(read()).toBe('before'); expect(installedRuntime()?.id).toBe(prior);
});
it('preserves the new database after a crash at the committed phase', async () => {
  write('accepted after commit'); save({ phase: 'committed', committedAt: new Date().toISOString() });
  await coordinator().recover(); expect(read()).toBe('accepted after commit'); expect(installedRuntime()?.id).toBe(candidate);
});
it('keeps failed post-commit startup offline until explicit forward recovery', async () => {
  write('new user data'); save({ phase: 'committed', committedAt: new Date().toISOString() });
  const updater = coordinator(); updater.startupFailed(new Error('backend failed'));
  await expect(coordinator().recover()).rejects.toThrow('retained');
  expect(read()).toBe('new user data');
  await coordinator().recover(true);
  expect(read()).toBe('new user data'); expect(installedRuntime()?.id).toBe(candidate);
});
it('leaves corrupted recovery material untouched and refuses to boot', async () => {
  const checkpoint = await createCheckpoint(path.join(directory, 'recovery/test'));
  fs.appendFileSync(path.join(checkpoint, 'database.sqlite'), 'corrupt');
  write('candidate'); save({ phase: 'validating', checkpoint });
  const updater = coordinator(); await expect(updater.recover()).rejects.toThrow('checksum');
  expect(updater.status().phase).toBe('recovery-required'); expect(read()).toBe('candidate');
});
it('excludes other controller actions throughout an asynchronous recovery', async () => {
  let finishRestore!: () => void;
  let restored!: () => void;
  const restoreStarted = new Promise<void>(resolve => { restored = resolve; });
  const restorePending = new Promise<void>(resolve => { finishRestore = resolve; });
  backend.restore = vi.fn(async () => { restored(); await restorePending; });
  save({ phase: 'validating', checkpoint: '/verified/checkpoint' });
  const updater = coordinator();
  const recovery = updater.recover();
  await restoreStarted;
  try {
    expect(updater.status().busy).toBe(true);
    await expect(updater.recover(true)).rejects.toThrow('Another update action');
    await expect(updater.check()).rejects.toThrow('Another update action');
    expect(backend.restore).toHaveBeenCalledOnce();
  } finally { finishRestore(); await recovery; }
  expect(updater.status()).toMatchObject({ busy: false, phase: 'failed' });
});
