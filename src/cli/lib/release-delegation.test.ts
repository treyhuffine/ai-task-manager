import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeRuntimeFixture } from '@/lib/service/runtime-fixture';
import { stageRelease, storeDirectory } from '@/lib/service/store';
import { stageRuntime } from '@/lib/service/runtime';
import { delegationTarget, selectDefaultHome, selectExplicitRoot } from './release-delegation';

let root: string;
const realRoot = () => fs.realpathSync(root);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-delegation-test-'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  vi.stubEnv('HOME', path.join(root, 'user'));
  for (const key of ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_RUNTIME_REPO', 'RI_CLI_DELEGATED']) vi.stubEnv(key, '');
  for (const key of ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_RUNTIME_REPO', 'RI_CLI_DELEGATED']) delete process.env[key];
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function homeOn(name: string, version: string) {
  const resources = path.join(root, 'resources', version);
  writeRuntimeFixture(resources, { version });
  process.env.RI_ROOT = path.join(root, name);
  fs.mkdirSync(process.env.RI_ROOT, { recursive: true });
  const installed = stageRuntime(resources);
  delete process.env.RI_ROOT;
  return installed.id;
}

it('finds the only Home wherever its folder is, unless a command names its own', () => {
  const env: Record<string, string | undefined> = {};
  expect(selectDefaultHome('status', undefined, env)).toBeNull();
  homeOn('elsewhere/my-ri', '0.1.0');
  expect(selectDefaultHome('status', undefined, env)).toBe(`${realRoot()}/elsewhere/my-ri`);
  expect(env.RI_DB_PATH).toBe(`${realRoot()}/elsewhere/my-ri/data.db`);
  // start and team create name a folder, update covers every Home, and an explicit root wins.
  for (const [command, sub] of [['start'], ['update'], ['team', 'create']] as const) expect(selectDefaultHome(command, sub, {})).toBeNull();
  expect(selectDefaultHome('status', undefined, { RI_ROOT: '/somewhere/else' })).toBeNull();
});

it('picks the personal Home in ~/ri when this computer runs several', () => {
  homeOn('team-home', '0.1.0');
  fs.mkdirSync(path.join(root, 'user'), { recursive: true });
  homeOn('user/ri', '0.1.0');
  const env: Record<string, string | undefined> = {};
  expect(selectDefaultHome('agent', 'list_tasks', env)).toBe(`${realRoot()}/user/ri`);
});

it('hands a Home command to the release that Home runs, and keeps installation commands on the newest', () => {
  const older = homeOn('user/ri', '0.1.0');
  const newer = stageRelease(writeRuntimeFixture(path.join(root, 'resources', 'newer'), { version: '0.2.0' }) && path.join(root, 'resources', 'newer')).id;
  // This CLI is the newest release, the one `~/.local/bin/ri` runs.
  process.env.RI_RUNTIME_REPO = path.join(storeDirectory(), newer, 'server');
  selectDefaultHome('agent', 'list_tasks');
  expect(delegationTarget('agent', 'list_tasks')).toMatchObject({ id: older, cli: path.join(storeDirectory(), older, 'server/dist/cli/index.mjs') });
  expect(delegationTarget('update')).toBeNull();
  expect(delegationTarget('team', 'create')).toBeNull();
  expect(delegationTarget('agent', 'list_tasks', { ...process.env, RI_CLI_DELEGATED: '1' })).toBeNull();
  // Already on the Home's release: run here.
  process.env.RI_RUNTIME_REPO = path.join(storeDirectory(), older, 'server');
  expect(delegationTarget('agent', 'list_tasks')).toBeNull();
});

it('keeps what a release says about itself on that release, whatever a Home here runs', () => {
  homeOn('home', '0.1.0');
  stageRuntime(path.join(root, 'resources', '0.1.0'));
  const resources = path.join(root, 'resources', '0.2.0');
  writeRuntimeFixture(resources, { version: '0.2.0' });
  const newest = stageRelease(resources);
  vi.stubEnv('RI_RUNTIME_REPO', path.join(storeDirectory(), newest.id, 'server'));
  expect(delegationTarget('service', 'status')).not.toBeNull();
  for (const own of ['install-release', 'compatibility', 'manifest', 'verify', 'add-to-terminal']) expect(delegationTarget('service', own)).toBeNull();
});

it('never delegates from a checkout', () => {
  homeOn('user/ri', '0.1.0');
  process.env.RI_RUNTIME_REPO = path.join(root, 'checkout');
  fs.mkdirSync(process.env.RI_RUNTIME_REPO, { recursive: true });
  selectDefaultHome('agent', 'list_tasks');
  expect(delegationTarget('agent', 'list_tasks')).toBeNull();
});

it('keeps meaning the personal Home while a team moves to the installation first', () => {
  homeOn('team-home', '0.1.0');
  const env: Record<string, string | undefined> = {};
  expect(selectDefaultHome('agent', 'list_tasks', env)).toBe(`${realRoot()}/team-home`);
  // ~/ri holds a Home still running in a terminal: not recorded yet, and still what a command means.
  fs.mkdirSync(path.join(root, 'user/ri'), { recursive: true });
  fs.writeFileSync(path.join(root, 'user/ri/data.db'), '');
  const during: Record<string, string | undefined> = {};
  expect(selectDefaultHome('agent', 'list_tasks', during)).toBeNull();
  expect(during.RI_ROOT).toBeUndefined();
});

it('keeps meaning the Home a connected device reaches, too', () => {
  homeOn('team-home', '0.1.0');
  fs.mkdirSync(path.join(root, 'user/ri/.config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'user/ri/.config/connection.json'), '{}');
  expect(selectDefaultHome('status', undefined, {})).toBeNull();
});

it('takes a command\'s own --root before anything picks a Home or a release', () => {
  const env: Record<string, string | undefined> = {};
  selectExplicitRoot('service', '/homes/team', undefined, env);
  expect(env.RI_ROOT).toBe('/homes/team');
  selectExplicitRoot('restart', undefined, '/homes/other', env);
  expect(env.RI_ROOT).toBe('/homes/other');
  const untouched: Record<string, string | undefined> = {};
  selectExplicitRoot('update', undefined, '/homes/rollback-target', untouched);
  selectExplicitRoot('team', undefined, '/homes/new-team', untouched);
  expect(untouched.RI_ROOT).toBeUndefined();
});
