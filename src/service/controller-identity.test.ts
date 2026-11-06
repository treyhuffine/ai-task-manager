/**
 * A release runs under its own controller (docs/always-on-spec.md 7.4). One
 * started from anywhere else, a checkout say, gives the Home to the selected
 * release before it touches anything, and the selected release's own never
 * hands over to itself. These run the real controller and the real relay.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fork, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { serviceStatus } from '@/lib/service/client';
import { canonical, getRuntimeInstallDir, servicePaths } from '@/lib/service/paths';
import { storeDirectory } from '@/lib/service/store';

const require = createRequire(import.meta.url);
const project = process.cwd();
const release = 'a'.repeat(64);
let root: string;
let checkout: string;
let selected: string;
let started: string;
let child: ChildProcess | undefined;
let diagnostics: string;

/** A folder that runs this code's controller and relay, as a build would. */
function controllerFolder(folder: string) {
  fs.mkdirSync(path.join(folder, 'dist/service'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), '{"version":"0.1.0"}');
  for (const name of ['main', 'handoff']) {
    fs.writeFileSync(path.join(folder, `dist/service/${name}.cjs`), `require(${JSON.stringify(require.resolve('tsx/cjs'))}); require(${JSON.stringify(path.join(project, `src/service/${name}.ts`))});`);
  }
}
/** Start a controller the way `node dist/service/main.cjs` does, and wait for it to answer or leave. */
function run(folder: string, env: Record<string, string> = {}) {
  child = fork(path.join(folder, 'dist/service/main.cjs'), [], { cwd: folder, execArgv: [],
    env: { ...process.env, ...env, RI_RUNTIME_REPO: folder, RI_TEST_STARTED: started, TSX_TSCONFIG_PATH: path.join(project, 'tsconfig.json') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', value => { diagnostics += value.toString(); });
  return child;
}
async function until(check: () => boolean | Promise<boolean>, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Controller fixture timed out: ${diagnostics}`);
}
const exited = (process: ChildProcess) => process.exitCode !== null || process.signalCode !== null;

beforeEach(() => {
  // Left as the OS names it: on macOS the temporary folder sits behind a
  // symbolic link, so the comparison must see through one.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-controller-identity-'));
  checkout = path.join(root, 'checkout');
  started = path.join(root, 'started.json');
  diagnostics = '';
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_DESKTOP', 'RI_SERVICE_LAUNCHER']) vi.stubEnv(key, undefined);
  controllerFolder(checkout);
  const directory = path.join(storeDirectory(), release);
  selected = path.join(directory, 'server');
  fs.mkdirSync(path.join(directory, 'node/bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(directory, 'node/bin/node'));
  fs.mkdirSync(path.join(selected, 'dist/service'), { recursive: true });
  fs.writeFileSync(path.join(selected, 'dist/service/main.cjs'), `require('node:fs').writeFileSync(process.env.RI_TEST_STARTED, JSON.stringify({ repo: process.env.RI_RUNTIME_REPO }));`);
  fs.mkdirSync(getRuntimeInstallDir(), { recursive: true });
  fs.writeFileSync(path.join(getRuntimeInstallDir(), 'active-release'), `${release}\n`);
  fs.mkdirSync(path.dirname(servicePaths().log), { recursive: true });
});
afterEach(async () => {
  if (child && !exited(child)) { child.kill('SIGTERM'); await until(() => exited(child!)); }
  child = undefined;
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it('gives the Home to the selected release when started from a checkout, and starts no server of its own', async () => {
  const controller = run(checkout);
  await until(() => fs.existsSync(started));
  await until(() => exited(controller));
  expect(controller.exitCode, diagnostics).toBe(0);
  expect(JSON.parse(fs.readFileSync(started, 'utf8')).repo).toBe(selected);
  expect(fs.existsSync(path.join(servicePaths().identity.work, 'service-child.json'))).toBe(false);
}, 60_000);

it('leaves the switch to the launcher when it runs under one', async () => {
  const controller = run(checkout, { RI_SERVICE_LAUNCHER: '2' });
  await until(() => exited(controller));
  expect(controller.exitCode, diagnostics).toBe(75);
  expect(fs.existsSync(started)).toBe(false);
}, 60_000);

it('keeps the Home when it is the selected release, so a handover can never loop', async () => {
  controllerFolder(selected);
  const controller = run(selected);
  await until(async () => (await serviceStatus())?.phase === 'running');
  const status = await serviceStatus();
  expect(status?.pid).toBe(controller.pid);
  expect(status?.repo).toBe(canonical(selected));
  expect(exited(controller)).toBe(false);
}, 60_000);
