import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeRuntimeFixture } from './runtime-fixture';
import { stageRelease } from './store';
import { installedRuntime, stageRuntime } from './runtime';
import { beginActivation, readActivation } from './activation';
import { getRuntimeInstallDir } from './paths';

// The Home's launcher is a shell script the OS runs. These tests run it for
// real, with fake releases whose `node` is a shell program acting a controller.
let root: string;
let log: string;
let install: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-launcher-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  log = path.join(root, 'runs.log');
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

/** A release whose controller logs its name, then does `then`. */
function controller(name: string, then: string) {
  const directory = path.join(root, 'resources', name);
  writeRuntimeFixture(directory, { version: '0.1.0', node: `echo "${name} $*" >> "$RI_TEST_LOG"\n${then}`, files: { [`server/${name}`]: name } });
  return stageRelease(directory).id;
}
/** Removing the activation record is what a real controller does just before it starts work. */
const startWork = 'rm -rf "$RI_TEST_HOME/activation"';

function first(id: string) {
  const directory = path.join(root, 'resources', 'first');
  fs.cpSync(path.join(root, 'installed/releases', id), directory, { recursive: true });
  stageRuntime(directory);
  install = getRuntimeInstallDir();
  expect(installedRuntime()?.id).toBe(id);
}

function launch(env: Record<string, string> = {}) {
  const child = spawn('/bin/sh', [path.join(install, 'launch')], { env: { ...process.env, RI_TEST_LOG: log, RI_TEST_HOME: install, RI_ACTIVATION_DEADLINE_SECONDS: '2', ...env }, stdio: 'ignore' });
  const exit = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  return { child, exit };
}
const runs = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => line.split(' ')[0]) : [];
const select = (id: string) => fs.writeFileSync(path.join(install, 'active-release'), `${id}\n`);

it('starts the next release at once when a controller hands over with 75', async () => {
  const next = controller('next', `${startWork}; exit 0`);
  // The controller learns from the launcher that 75 hands over, OS job or not.
  const old = controller('old', `echo "launcher $RI_SERVICE_LAUNCHER" >> "$RI_TEST_LOG"; printf '%s\\n' ${next} > "$RI_TEST_HOME/active-release"; exit 75`);
  first(old);
  expect(await launch().exit).toBe(0);
  expect(runs()).toEqual(['old', 'launcher', 'next']);
  expect(fs.readFileSync(log, 'utf8')).toContain('launcher 2\n');
});

it('passes any other exit code to the OS, which decides whether to restart', async () => {
  const crashing = controller('crashing', 'exit 3');
  first(crashing);
  expect(await launch().exit).toBe(3);
  expect(runs()).toEqual(['crashing']);
});

it('puts the previous release back when a new one exits twice before it starts work', async () => {
  const previous = controller('previous', `[ -f "$RI_TEST_HOME/activation/restore" ] && echo restore >> "$RI_TEST_LOG"; ${startWork}; exit 0`);
  const broken = controller('broken', 'exit 1');
  first(previous);
  beginActivation(broken, previous, install);
  select(broken);
  expect(await launch().exit).toBe(0);
  expect(runs()).toEqual(['broken', 'broken', 'previous', 'restore']);
  expect(installedRuntime()?.id).toBe(previous);
});

it('treats a new release that hangs before starting work like one that exits', async () => {
  const previous = controller('previous', `${startWork}; exit 0`);
  const hanging = controller('hanging', 'trap "exit 0" TERM; while :; do sleep 0.1; done');
  first(previous);
  beginActivation(hanging, previous, install);
  select(hanging);
  const started = Date.now();
  expect(await launch({ RI_ACTIVATION_DEADLINE_SECONDS: '1' }).exit).toBe(0);
  expect(runs()).toEqual(['hanging', 'hanging', 'previous']);
  expect(Date.now() - started).toBeLessThan(20_000);
  expect(installedRuntime()?.id).toBe(previous);
}, 25_000);

it('leaves a new release in place once it has started work, whatever happens after', async () => {
  const previous = controller('previous', 'exit 0');
  const started = controller('started', `${startWork}; exit 4`);
  first(previous);
  beginActivation(started, previous, install);
  select(started);
  expect(await launch().exit).toBe(4);
  expect(runs()).toEqual(['started']);
  expect(installedRuntime()?.id).toBe(started);
  expect(readActivation(install)).toMatchObject({ candidate: null, restore: false });
});

it('forwards a stop from the OS to the controller and exits with it', async () => {
  // `trapped` is written once the controller handles TERM, so a loaded machine can't stop it first.
  const waiting = controller('waiting', `${startWork}; trap "exit 0" TERM; echo trapped >> "$RI_TEST_LOG"; while :; do sleep 0.1; done`);
  first(waiting);
  const { child, exit } = launch();
  const deadline = Date.now() + 5000;
  while (!runs().includes('trapped') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  child.kill('SIGTERM');
  expect(await exit).toBe(0);
  expect(runs()).toEqual(['waiting', 'trapped']);
});

it('runs the CLI of the release the Home points at', async () => {
  const cli = controller('cli', 'exit 0');
  first(cli);
  const child = spawn('/bin/sh', [path.join(install, 'launch'), 'cli', 'status', '--json'], { env: { ...process.env, RI_TEST_LOG: log }, stdio: 'ignore' });
  expect(await new Promise(resolve => child.once('exit', resolve))).toBe(0);
  expect(fs.readFileSync(log, 'utf8').trim()).toBe('cli dist/cli/index.mjs status --json');
});

it('force-stops a new release that ignores its stop, instead of waiting on it forever', async () => {
  const previous = controller('previous', `${startWork}; exit 0`);
  const frozen = controller('frozen', 'trap "" TERM; while :; do sleep 0.1; done');
  first(previous);
  beginActivation(frozen, previous, install);
  select(frozen);
  const { exit } = launch({ RI_ACTIVATION_DEADLINE_SECONDS: '1', RI_ACTIVATION_KILL_SECONDS: '1' });
  expect(await exit).toBe(0);
  expect(runs()).toEqual(['frozen', 'frozen', 'previous']);
  expect(installedRuntime()?.id).toBe(previous);
}, 20_000);

it('does not mistake a handover for a failed try, however many switches one launcher sees', async () => {
  // Each started as a candidate, clears its record and works, then updates to
  // the next. The launcher lives through all of them, as under the OS.
  const hand = (next: string) => `${startWork}; mkdir -p "$RI_TEST_HOME/activation"; printf '%s\\n' ${next} > "$RI_TEST_HOME/activation/candidate"; printf '%s\\n' $(cat "$RI_TEST_HOME/active-release") > "$RI_TEST_HOME/activation/previous"; printf '%s\\n' ${next} > "$RI_TEST_HOME/active-release"; exit 75`;
  const last = controller('last', `${startWork}; exit 0`);
  const third = controller('third', hand(last));
  const second = controller('second', hand(third));
  const one = controller('one', hand(second));
  first(one);
  expect(await launch().exit).toBe(0);
  expect(runs()).toEqual(['one', 'second', 'third', 'last']);
  expect(readActivation().restore).toBe(false);
  expect(installedRuntime()?.id).toBe(last);
});
