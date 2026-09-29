import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fork, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { establishRuntimeJobOwner } from './runtime-job-owner';

const require = createRequire(import.meta.url);
const project = process.cwd();
const lifecycle = path.join(project, 'src/lib/service/runtime-job-owner.ts');
const manager = path.join(project, 'src/lib/service/runtime-job.ts');
const tsxCjs = require.resolve('tsx/cjs');
let directory: string;
let database: string;
let environment: NodeJS.ProcessEnv;
let controller: ChildProcess | undefined;
let helperPid: number | undefined;

async function until<T>(read: () => T | undefined, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture did not reach its expected lifecycle state');
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function received(child: ChildProcess, kind: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let diagnostics = '';
    const onData = (chunk: Buffer) => { diagnostics += chunk.toString(); };
    child.stderr?.on('data', onData);
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Missing child message: ${kind}`)); }, 5000);
    const onExit = () => { cleanup(); reject(new Error(`Fixture exited before ${kind}: ${diagnostics}`)); };
    const listener = (message: Record<string, unknown>) => {
      if (message.type === 'failure') { cleanup(); reject(new Error(String(message.error))); }
      else if (message.type === kind) { cleanup(); resolve(message); }
    };
    const cleanup = () => { clearTimeout(timeout); child.off('message', listener); child.off('exit', onExit); child.stderr?.off('data', onData); };
    child.on('message', listener);
    child.once('exit', onExit);
  });
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-runtime-job-lifetime-'));
  database = path.join(directory, 'home/data.db');
  environment = { ...process.env, RI_ROOT: path.dirname(database), RI_DB_PATH: database, RI_CONFIG_DIR: '', RI_WORK_DIR: '', TSX_TSCONFIG_PATH: path.join(project, 'tsconfig.json') };
  fs.mkdirSync(path.join(directory, 'dist/service'), { recursive: true });
  // Exercise the actual manager and OS lease with a helper that cannot service
  // its IPC disconnect callback while it is synchronously replacing a file.
  fs.writeFileSync(path.join(directory, 'dist/service/runtime-job.cjs'), `
require(${JSON.stringify(tsxCjs)});
const fs = require('node:fs');
const { acquireRuntimeJobLease } = require(${JSON.stringify(lifecycle)});
process.on('SIGTERM', () => {});
process.once('disconnect', () => process.exit(1));
process.once('message', message => {
  let release;
  try {
    release = acquireRuntimeJobLease(message.owner);
    process.send({ type: 'progress', bytes: 1 }, () => {
      fs.writeFileSync(message.value.started, String(process.pid));
      const wait = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 20000;
      while (!fs.existsSync(message.value.proceed) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 10);
      if (fs.existsSync(message.value.proceed)) fs.writeFileSync(message.value.output, 'old helper write');
      release();
      if (process.connected) process.send({ type: 'result', value: 'complete' }, () => process.exit(0));
      else process.exit(1);
    });
  } catch (error) {
    release?.();
    process.send({ type: 'error', error: error.message }, () => process.exit(1));
  }
});
`);
  fs.writeFileSync(path.join(directory, 'controller.cjs'), `
require(${JSON.stringify(tsxCjs)});
const { initializeRuntimeJobs, runtimeJob, stopRuntimeJobs } = require(${JSON.stringify(manager)});
void (async () => {
await initializeRuntimeJobs();
const value = ${JSON.stringify({ started: path.join(directory, 'started'), proceed: path.join(directory, 'proceed'), output: path.join(directory, 'output') })};
let stopping = false;
const pending = runtimeJob(${JSON.stringify(directory)}, 'restore', value, () => process.send({ type: 'ready' })).then(value => ({ value }), error => { if (!stopping) process.send({ type: 'failure', error: error.message }); return { error: error.message }; });
process.once('message', async () => {
  stopping = true;
  await stopRuntimeJobs(100);
  process.send({ type: 'stopped', result: await pending });
  process.exit(0);
});
})().catch(error => process.send({ type: 'failure', error: error.message }));
`);
});

afterEach(async () => {
  if (controller && controller.exitCode === null && controller.signalCode === null) controller.kill('SIGKILL');
  if (helperPid && alive(helperPid)) { try { process.kill(helperPid, 'SIGKILL'); } catch {} }
  if (controller) await until(() => controller!.exitCode !== null || controller!.signalCode !== null ? true : undefined);
  controller = undefined; helperPid = undefined;
  fs.rmSync(directory, { recursive: true, force: true });
});

async function runningController() {
  controller = fork(path.join(directory, 'controller.cjs'), [], { cwd: project, env: environment, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  controller.stderr?.resume();
  await received(controller, 'ready');
  helperPid = await until(() => fs.existsSync(path.join(directory, 'started')) ? Number(fs.readFileSync(path.join(directory, 'started'), 'utf8')) : undefined);
  return controller;
}

it('reaps an unresponsive helper before graceful controller shutdown completes', async () => {
  const child = await runningController();
  const stopped = received(child, 'stopped');
  child.send('stop');
  expect(await stopped).toMatchObject({ result: { error: 'The service stopped this runtime job' } });
  expect(alive(helperPid!)).toBe(false);
  expect(() => establishRuntimeJobOwner(database)).not.toThrow();
  expect(fs.existsSync(path.join(directory, 'output'))).toBe(false);
});

it('blocks replacement startup throughout a synchronous orphaned restore after controller SIGKILL', async () => {
  const child = await runningController();
  child.kill('SIGKILL');
  await until(() => child.signalCode ? true : undefined);
  expect(alive(helperPid!)).toBe(true);
  expect(() => establishRuntimeJobOwner(database)).toThrow(/locked/);
  fs.writeFileSync(path.join(directory, 'proceed'), '');
  await until(() => {
    try { return establishRuntimeJobOwner(database); }
    catch (error) { if ((error as { code?: string }).code === 'SQLITE_BUSY') return undefined; throw error; }
  });
  expect(fs.readFileSync(path.join(directory, 'output'), 'utf8')).toBe('old helper write');
  fs.writeFileSync(path.join(directory, 'output'), 'new controller write');
  await until(() => !alive(helperPid!) ? true : undefined);
  expect(fs.readFileSync(path.join(directory, 'output'), 'utf8')).toBe('new controller write');
});

it('rejects a delayed helper after its initiating controller epoch was replaced', async () => {
  const original = establishRuntimeJobOwner(database);
  establishRuntimeJobOwner(database);
  controller = fork(path.join(directory, 'dist/service/runtime-job.cjs'), [], { cwd: project, env: environment, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  controller.stderr?.resume();
  const rejected = received(controller, 'error');
  controller.send({ owner: original, value: { started: path.join(directory, 'started') } });
  expect(await rejected).toMatchObject({ error: 'The initiating service no longer owns this runtime job' });
  expect(fs.existsSync(path.join(directory, 'started'))).toBe(false);
});
