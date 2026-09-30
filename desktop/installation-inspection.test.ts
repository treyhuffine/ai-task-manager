import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/lib/db/migrate';
import { inspectExistingInstallation } from './installation-inspection';
import { getRuntimeInstallDir } from '../src/lib/service/paths';
import { createRuntimeManifest, installedRuntime, stageRuntime } from '../src/lib/service/runtime';
import { createCheckpoint } from '../src/lib/service/checkpoint';
import { UpdateCoordinator, type UpdateBackend, type UpdateRecord } from '../src/lib/service/update';
import type { Release } from '../src/lib/service/release-trust';
import { consumeDesktopInitialization, stageFirstDesktopRuntime } from '../src/lib/service/initialization';

const mocks = vi.hoisted(() => ({ status: vi.fn(), legacy: vi.fn() }));
vi.mock('../src/lib/service/client', () => ({ serviceStatus: mocks.status }));
vi.mock('../src/lib/server-runtime/record', () => ({ readLiveServerRuntime: mocks.legacy }));
let directory: string;
let database: string;
beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-inspection-'))); database = path.join(directory, 'data.db');
  fs.mkdirSync(path.join(directory, '.config')); fs.mkdirSync(path.join(directory, '.work'));
  fs.mkdirSync(path.join(directory, 'drizzle/meta'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'drizzle/meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [{ idx: 0, version: '6', when: 1000, tag: '0000_test', breakpoints: true }] }));
  fs.writeFileSync(path.join(directory, 'drizzle/0000_test.sql'), 'CREATE TABLE retained (value TEXT);');
  for (const [key, value] of Object.entries({ RI_ROOT: directory, RI_DB_PATH: '', RI_CONFIG_DIR: '', RI_WORK_DIR: '', RI_DESKTOP_REPO: directory, RI_INSTALL_ROOT: `${directory}-runtime` })) vi.stubEnv(key, value);
  mocks.status.mockResolvedValue(null); mocks.legacy.mockReturnValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); fs.rmSync(`${directory}-runtime`, { recursive: true, force: true }); });
function stageExistingRuntime(firstInitialization = false) {
  const resources = path.join(directory, 'resources');
  for (const name of ['node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs']) {
    const file = path.join(resources, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, name);
  }
  fs.writeFileSync(path.join(resources, 'server/package.json'), '{"version":"0.1.0"}');
  fs.cpSync(path.join(directory, 'drizzle'), path.join(resources, 'server/drizzle'), { recursive: true });
  createRuntimeManifest(resources);
  return (firstInitialization ? stageFirstDesktopRuntime(resources) : stageRuntime(resources)).repo;
}

it('allows fresh setup to retry its selected runtime after a configuration failure before DB bootstrap', async () => {
  const repo = stageExistingRuntime(true);
  const originalRuntime = installedRuntime()!.id;
  fs.writeFileSync(path.join(directory, '.config/local-service.json'), '{"version":1,"port":0}');
  mocks.status.mockResolvedValue({ phase: 'failed', error: 'Invalid local service endpoint configuration' });
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: false, phase: 'failed' });
  // Recovery stops the failed owner after the endpoint configuration is fixed.
  mocks.status.mockResolvedValue(null);
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, phase: 'initialization-pending' });
  expect(installedRuntime()?.id).toBe(originalRuntime);
  expect(fs.existsSync(database)).toBe(false);
  consumeDesktopInitialization();
  await expect(inspectExistingInstallation()).rejects.toThrow();
  const db = new Database(database); runMigrations(db, path.join(repo, 'drizzle')); db.close();
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, phase: 'stopped' });
  fs.unlinkSync(database);
  await expect(inspectExistingInstallation()).rejects.toThrow();
  expect(fs.existsSync(database)).toBe(false);
});

it('does not skip an existing database schema check when first initialization is still pending', async () => {
  stageExistingRuntime(true);
  const db = new Database(database); db.close();
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: false, phase: 'stopped', pendingMigrations: 1 });
});

async function interruptedUpdate(committed = false) {
  const priorRepo = stageExistingRuntime();
  const priorId = installedRuntime()!.id;
  const db = new Database(database);
  runMigrations(db, path.join(priorRepo, 'drizzle')); db.prepare('INSERT INTO retained VALUES (?)').run('before update'); db.close();
  const checkpoint = await createCheckpoint(path.join(getRuntimeInstallDir(), 'recovery', 'interrupted-test'));
  const candidate = path.join(directory, 'candidate');
  fs.cpSync(path.dirname(priorRepo), candidate, { recursive: true });
  fs.writeFileSync(path.join(candidate, 'server/package.json'), '{"version":"0.2.0"}');
  const journal = path.join(candidate, 'server/drizzle/meta/_journal.json');
  const contents = JSON.parse(fs.readFileSync(journal, 'utf8'));
  contents.entries.push({ idx: 1, version: '6', when: 2000, tag: '0001_candidate', breakpoints: true });
  fs.writeFileSync(journal, JSON.stringify(contents));
  fs.writeFileSync(path.join(candidate, 'server/drizzle/0001_candidate.sql'), 'CREATE TABLE candidate_data (value TEXT);');
  const manifest = createRuntimeManifest(candidate); stageRuntime(candidate);
  const candidateDb = new Database(database);
  runMigrations(candidateDb, path.join(candidate, 'server/drizzle'));
  candidateDb.prepare('UPDATE retained SET value = ?').run(committed ? 'accepted after commit' : 'uncommitted candidate');
  candidateDb.close();
  const now = new Date().toISOString();
  const release: Release = { format: 1, sequence: 1, version: manifest.version, channel: 'stable', publishedAt: now, expiresAt: new Date(Date.now() + 86400000).toISOString(), platform: process.platform as Release['platform'], arch: process.arch as Release['arch'], minimumUpdater: 1, apiProtocol: 1, configFormat: 1, withdrawn: false, notes: '',
    migrationHistory: createHash('sha256').update(fs.readFileSync(journal)).digest('hex'), runtime: { id: manifest.id, url: 'https://publisher.example/runtime.tar.gz', sha256: 'c'.repeat(64), size: 1, unpackedSize: 1 } };
  const record: UpdateRecord = { format: 1, phase: committed ? 'committed' : 'validating', changedAt: now, priorId, release, checkpoint, ...(committed ? { committedAt: now } : {}) };
  fs.writeFileSync(path.join(getRuntimeInstallDir(), 'update.json'), JSON.stringify(record), { mode: 0o600 });
  return { record, priorId, targetId: manifest.id, checkpoint };
}

function recoveryCoordinator() {
  const backend: UpdateBackend = { activity: async () => [], stop: async () => {}, validate: async () => {}, activate: async () => {}, restart: async () => {}, assertNoLegacyWriters: async () => {} };
  return new UpdateCoordinator(backend);
}
function retainedValue() { const db = new Database(database, { readonly: true }); try { return db.prepare('SELECT value FROM retained').pluck().get(); } finally { db.close(); } }

it('allows the original controller to recover a cold crash during candidate validation', async () => {
  const { priorId } = await interruptedUpdate();
  const before = fs.readFileSync(database);
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, phase: 'recovery-pending' });
  expect(fs.readFileSync(database)).toEqual(before);
  expect(installedRuntime()?.id).toBe(priorId);
  await recoveryCoordinator().recover();
  expect(retainedValue()).toBe('before update');
  expect(installedRuntime()?.id).toBe(priorId);
});
it('retains postcommit data when cold recovery must advance the active runtime pointer', async () => {
  const { targetId, checkpoint } = await interruptedUpdate(true);
  const before = fs.readFileSync(database);
  // Forward recovery must not depend on old backup files remaining available.
  fs.rmSync(checkpoint, { recursive: true, force: true });
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, phase: 'recovery-pending' });
  expect(fs.readFileSync(database)).toEqual(before);
  await recoveryCoordinator().recover();
  expect(fs.readFileSync(database)).toEqual(before);
  expect(retainedValue()).toBe('accepted after commit');
  expect(installedRuntime()?.id).toBe(targetId);
});
it.each(['missing-release', 'wrong-prior', 'unknown-field', 'invalid-commit', 'wrong-checkpoint-root', 'tampered-runtime', 'writable-record'])('does not bypass schema safety with a malformed or unbound recovery record: %s', async kind => {
  const { record, checkpoint, targetId } = await interruptedUpdate();
  const file = path.join(getRuntimeInstallDir(), 'update.json');
  const invalid: Record<string, unknown> = { ...record };
  if (kind === 'missing-release') delete invalid.release;
  if (kind === 'wrong-prior') invalid.priorId = 'f'.repeat(64);
  if (kind === 'unknown-field') invalid.force = true;
  if (kind === 'invalid-commit') invalid.committedAt = new Date().toISOString();
  if (kind === 'wrong-checkpoint-root') {
    const manifestFile = path.join(checkpoint, 'checkpoint.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); manifest.identity.root = '/another-home';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  }
  if (kind === 'tampered-runtime') {
    const manifestFile = path.join(getRuntimeInstallDir(), 'releases', targetId, 'runtime-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); manifest.version = '9.0.0';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  }
  fs.writeFileSync(file, JSON.stringify(invalid));
  if (kind === 'writable-record') fs.chmodSync(file, 0o666);
  const before = fs.readFileSync(database);
  await expect(inspectExistingInstallation()).rejects.toThrow();
  expect(fs.readFileSync(database)).toEqual(before);
});
it('refuses a missing managed database without creating a replacement', async () => {
  stageExistingRuntime();
  await expect(inspectExistingInstallation()).rejects.toThrow();
  expect(fs.existsSync(database)).toBe(false);
});
it('refuses pending migrations without changing a stopped managed database', async () => {
  stageExistingRuntime();
  const db = new Database(database); db.close();
  const before = fs.readFileSync(database);
  expect(await inspectExistingInstallation()).toMatchObject({ phase: 'stopped', canUse: false, pendingMigrations: 1 });
  expect(fs.readFileSync(database)).toEqual(before);
});
it('refuses to adopt a stopped source installation even when its schema matches', async () => {
  const db = new Database(database); runMigrations(db, path.join(directory, 'drizzle')); db.prepare('INSERT INTO retained VALUES (?)').run('keep me'); db.close();
  const before = fs.readFileSync(database);
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: false, phase: 'stopped', reason: expect.stringContaining('existing CLI service') });
  expect(fs.readFileSync(database)).toEqual(before);
  expect(fs.existsSync(path.join(getRuntimeInstallDir(), 'active-release'))).toBe(false);
});
it('attaches to a verified live owner without opening its database', async () => {
  fs.writeFileSync(database, 'not opened by the viewer');
  mocks.status.mockResolvedValue({ phase: 'running', version: '1.2.3' });
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, phase: 'running', version: '1.2.3' });
  mocks.status.mockResolvedValue({ phase: 'failed' });
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: false });
});
it('checks the active staged runtime rather than an older shell bundle', async () => {
  const db = new Database(database); runMigrations(db, path.join(directory, 'drizzle')); db.close();
  const activeRepo = stageExistingRuntime();
  fs.appendFileSync(path.join(directory, 'drizzle/0000_test.sql'), '\n-- different bundled release');
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, pendingMigrations: 0 });
  fs.appendFileSync(path.join(activeRepo, 'drizzle/0000_test.sql'), '\n-- changed active history');
  await expect(inspectExistingInstallation()).rejects.toThrow('does not match');
});
it('refuses an older foreground launcher and missing database without bootstrapping', async () => {
  fs.writeFileSync(database, 'not opened'); mocks.legacy.mockReturnValue({ launcherPid: 123 });
  await expect(inspectExistingInstallation()).rejects.toThrow('foreground launcher');
  fs.unlinkSync(database); mocks.legacy.mockReturnValue(null);
  await expect(inspectExistingInstallation()).rejects.toThrow();
  expect(fs.existsSync(database)).toBe(false);
});

it('adopts a connected viewer without a database, work directory or schema inspection', async () => {
  fs.rmSync(path.join(directory, '.work'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.config/connection.json'), JSON.stringify({ version: 1, homeId: 'remote', homeName: 'My Ri', homeUrl: 'https://ri.example', credential: 'sign-in' }), { mode: 0o600 });
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, phase: 'viewer', appliedMigrations: 0, pendingMigrations: 0 });
  expect(fs.existsSync(database)).toBe(false);
  expect(fs.existsSync(path.join(directory, '.work'))).toBe(false);
  expect(fs.existsSync(path.join(getRuntimeInstallDir(), 'active-release'))).toBe(false);
});
it('adopts an enrolled worker without opening data or replacing its runtime', async () => {
  fs.writeFileSync(path.join(directory, '.config/connection.json'), JSON.stringify({ version: 1, homeId: 'remote', homeUrl: 'https://ri.example', credential: 'sign-in' }), { mode: 0o600 });
  fs.writeFileSync(path.join(directory, '.config/worker.json'), JSON.stringify({ version: 1, homeId: 'remote', deviceId: 'laptop', workerKey: 'worker' }), { mode: 0o600 });
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: true, phase: 'worker', pendingMigrations: 0 });
  expect(fs.existsSync(database)).toBe(false);
  mocks.status.mockResolvedValue({ phase: 'failed', role: 'worker' });
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: false, phase: 'failed' });
});
it('refuses conflicting and retired roots before opening a database', async () => {
  const connection = path.join(directory, '.config/connection.json');
  fs.writeFileSync(connection, JSON.stringify({ version: 1, homeId: 'remote', homeUrl: 'https://ri.example', credential: 'sign-in' }));
  fs.writeFileSync(database, 'preserved invalid database');
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: false, phase: 'conflict' });
  expect(fs.readFileSync(database, 'utf8')).toBe('preserved invalid database');
  fs.unlinkSync(connection); fs.unlinkSync(database);
  const retired = path.join(directory, '.retired/previous'); fs.mkdirSync(retired, { recursive: true });
  fs.writeFileSync(path.join(retired, 'retired.json'), JSON.stringify({ version: 1, homeName: 'Old Ri', retiredAt: '2026-09-30' }));
  expect(await inspectExistingInstallation()).toMatchObject({ canUse: false, phase: 'retired' });
  expect(fs.existsSync(database)).toBe(false);
});
