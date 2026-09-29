import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntimeManifest, installedRuntime, stageRuntime } from './runtime';
import { getRuntimeInstallDir, serviceIdentity } from './paths';
import { consumeDesktopInitialization, pendingDesktopInitialization, stageFirstDesktopRuntime } from './initialization';

let directory: string;
let resources: string;
beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-first-init-')));
  resources = path.join(directory, 'resources');
  for (const [name, value] of Object.entries({ RI_ROOT: path.join(directory, 'home'), RI_INSTALL_ROOT: path.join(directory, 'installed'), RI_DB_PATH: '', RI_CONFIG_DIR: '', RI_WORK_DIR: '' })) vi.stubEnv(name, value);
  const identity = serviceIdentity();
  for (const folder of [identity.root, identity.config, identity.work]) fs.mkdirSync(folder, { recursive: true });
  for (const file of ['node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs']) {
    fs.mkdirSync(path.dirname(path.join(resources, file)), { recursive: true }); fs.writeFileSync(path.join(resources, file), file);
  }
  fs.writeFileSync(path.join(resources, 'server/package.json'), '{"version":"0.1.0"}');
  createRuntimeManifest(resources);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });
const file = () => path.join(getRuntimeInstallDir(), 'initialization.json');

it('retains a private pending grant across failures before the first database open', () => {
  const runtime = stageFirstDesktopRuntime(resources);
  expect(installedRuntime()?.id).toBe(runtime.id);
  expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  // A configuration failure does not consume the one-time DB bootstrap grant.
  fs.writeFileSync(path.join(serviceIdentity().config, 'local-service.json'), JSON.stringify({ version: 1, port: 0 }));
  expect(pendingDesktopInitialization(runtime.id)).toBe(true);
  expect(pendingDesktopInitialization(runtime.id)).toBe(true);
  expect(fs.existsSync(serviceIdentity().database)).toBe(false);
});

it('consumes durably before a database is opened and never reuses the grant after deletion', () => {
  const runtime = stageFirstDesktopRuntime(resources);
  consumeDesktopInitialization();
  expect(JSON.parse(fs.readFileSync(file(), 'utf8')).phase).toBe('consumed');
  expect(fs.existsSync(serviceIdentity().database)).toBe(false);
  expect(pendingDesktopInitialization(runtime.id)).toBe(false);
  // A crash after consumption but before first open is conservatively refused.
  expect(() => consumeDesktopInitialization()).toThrow('database is missing');
  const db = new Database(serviceIdentity().database); db.exec('CREATE TABLE retained (value TEXT)'); db.close();
  expect(() => consumeDesktopInitialization()).not.toThrow();
  fs.unlinkSync(serviceIdentity().database);
  expect(pendingDesktopInitialization(runtime.id)).toBe(false);
  expect(() => consumeDesktopInitialization()).toThrow('database is missing');
});

it.each(['database', 'runtime', 'prior-record'])('cannot grant first initialization to an existing installation: %s', existing => {
  if (existing === 'database') fs.writeFileSync(serviceIdentity().database, 'do not replace');
  if (existing === 'runtime') stageRuntime(resources);
  if (existing === 'prior-record') { fs.mkdirSync(getRuntimeInstallDir(), { recursive: true }); fs.writeFileSync(file(), '{}'); }
  expect(() => stageFirstDesktopRuntime(resources)).toThrow('no longer new');
  if (existing !== 'prior-record') expect(fs.existsSync(file())).toBe(false);
});

it.each(['identity', 'runtime', 'phase', 'extra', 'mode', 'directory'])('rejects malformed or mismatched pending metadata: %s', change => {
  const runtime = stageFirstDesktopRuntime(resources);
  const record = JSON.parse(fs.readFileSync(file(), 'utf8'));
  if (change === 'identity') record.identity.database = path.join(directory, 'another.db');
  if (change === 'runtime') record.runtimeId = 'f'.repeat(64);
  if (change === 'phase') record.phase = 'unknown';
  if (change === 'extra') record.force = true;
  fs.writeFileSync(file(), JSON.stringify(record));
  if (change === 'mode') fs.chmodSync(file(), 0o666);
  if (change === 'directory') fs.rmdirSync(serviceIdentity().work);
  expect(() => pendingDesktopInitialization(runtime.id)).toThrow();
  expect(fs.existsSync(serviceIdentity().database)).toBe(false);
});

it('does not grant a pending exception when a database already exists', () => {
  const runtime = stageFirstDesktopRuntime(resources);
  fs.writeFileSync(serviceIdentity().database, 'existing data must be checked');
  expect(pendingDesktopInitialization(runtime.id)).toBe(false);
  consumeDesktopInitialization();
  expect(fs.readFileSync(serviceIdentity().database, 'utf8')).toBe('existing data must be checked');
});

it('leaves legacy and headless initialization policy unchanged without a desktop record', () => {
  stageRuntime(resources);
  expect(pendingDesktopInitialization(installedRuntime()!.id)).toBe(false);
  expect(() => consumeDesktopInitialization()).not.toThrow();
  expect(fs.existsSync(file())).toBe(false);
});
