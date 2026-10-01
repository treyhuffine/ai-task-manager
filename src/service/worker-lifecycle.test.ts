import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fork, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { serviceRequest, serviceStatus, type ServiceStatus } from '@/lib/service/client';
import { writeConnection } from '@/lib/connection/config';
import { writeWorkerConfig } from '@/lib/worker/config';
import { getRuntimeInstallDir } from '@/lib/service/paths';

const require = createRequire(import.meta.url);
const project = process.cwd();
let root: string;
let repository: string;
let child: ChildProcess | undefined;
let home: http.Server | undefined;
let streams: Set<http.ServerResponse>;
let mode: 'online' | 'offline' | 'protocol' | 'revoked';
let diagnostics: string;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check: () => Promise<boolean>, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Worker fixture timed out: ${diagnostics}`);
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-worker-controller-')); repository = path.join(root, 'runtime');
  fs.mkdirSync(path.join(repository, 'dist/service'), { recursive: true });
  fs.writeFileSync(path.join(repository, 'package.json'), '{"version":"0.1.0"}');
  for (const name of ['main', 'worker']) {
    const entry = process.env.RI_SERVICE_TEST_COMPILED === '1' ? path.join(project, `dist/service/${name}.cjs`) : path.join(project, `src/service/${name}.ts`);
    const hook = process.env.RI_SERVICE_TEST_COMPILED === '1' ? '' : `require(${JSON.stringify(require.resolve('tsx/cjs'))});`;
    fs.writeFileSync(path.join(repository, `dist/service/${name}.cjs`), `${hook} require(${JSON.stringify(entry)});`);
  }
  vi.stubEnv('RI_ROOT', path.join(root, 'device')); vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_DESKTOP']) vi.stubEnv(key, undefined);
  streams = new Set(); mode = 'online'; diagnostics = '';
});
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await until(async () => child!.exitCode !== null || child!.signalCode !== null); }
  for (const response of streams) response.destroy();
  if (home) { home.closeAllConnections(); await new Promise<void>(resolve => home!.close(() => resolve())); }
  child = undefined; home = undefined; vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true });
});
async function start(phase: ServiceStatus['phase'] = 'running') {
  child = fork(path.join(repository, 'dist/service/main.cjs'), [], { cwd: repository, execArgv: [], env: { ...process.env, RI_RUNTIME_REPO: repository, TSX_TSCONFIG_PATH: path.join(project, 'tsconfig.json'), CLAUDE_COMMAND: '/usr/bin/false', CODEX_COMMAND: '/usr/bin/false', CURSOR_COMMAND: '/usr/bin/false', OPENCODE_COMMAND: '/usr/bin/false', ANTIGRAVITY_COMMAND: '/usr/bin/false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', value => { diagnostics += value.toString(); });
  await until(async () => (await serviceStatus())?.phase === phase);
  return (await serviceStatus())!;
}
async function connect(enroll = true) {
  home = http.createServer((request, response) => {
    if (mode !== 'online') { response.writeHead(mode === 'offline' ? 503 : mode === 'protocol' ? 426 : 401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ message: 'Fixture mismatch', update: 'worker' })); return; }
    if (request.url?.startsWith('/api/workers/me/stream')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' }); streams.add(response); response.on('close', () => streams.delete(response));
      response.write(`data: ${JSON.stringify({ type: 'hello', homeId: 'home', protocol: 4, ackedEventSeq: 0 })}\n\n`); return;
    }
    request.resume(); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, release: [] }));
  });
  await new Promise<void>(resolve => home!.listen(0, '127.0.0.1', resolve));
  const port = (home.address() as import('node:net').AddressInfo).port;
  writeConnection({ homeId: 'home', homeName: 'Mini', homeHostName: 'Mini', homeUrl: `http://127.0.0.1:${port}`, credential: 'view', connectedAt: 'now', deviceId: 'device' });
  if (enroll) writeWorkerConfig({ homeId: 'home', deviceId: 'device', deviceName: 'MacBook', workerKey: 'worker', enrolledAt: 'now' });
}
it('keeps first-run and connected viewers alive without opening a Home or issuing its session', async () => {
  expect(await start()).toMatchObject({ role: 'first-run', phase: 'running' });
  expect(fs.existsSync(path.join(root, 'device/data.db'))).toBe(false);
  await expect(serviceRequest('/session')).rejects.toThrow('unavailable');
  await connect(false);
  expect(await serviceRequest('/role/refresh', 'POST')).toMatchObject({ role: 'viewer', phase: 'running' });
  expect(fs.existsSync(path.join(root, 'device/data.db'))).toBe(false);
}, 30_000);
it('supervises an enrolled child, preserves deliberate stop across restart, and safely retries network and protocol outages', async () => {
  await connect(); await start();
  await until(async () => (await serviceStatus())?.worker?.state === 'connected');
  let status = (await serviceStatus())!; const firstPid = status.worker!.pid;
  expect(status).toMatchObject({ role: 'worker', release: { compatibility: { nativeBridge: [1] } } });
  expect((await serviceRequest<ServiceStatus>('/role/refresh', 'POST')).worker?.pid).toBe(firstPid);
  await serviceRequest('/worker/stop', 'POST', 60_000);
  expect((await serviceStatus())?.worker).toMatchObject({ state: 'stopped', enabled: false });
  expect(alive(firstPid!)).toBe(false);
  child!.kill('SIGTERM'); await until(async () => child!.exitCode !== null || child!.signalCode !== null);
  await start(); expect((await serviceStatus())?.worker).toMatchObject({ state: 'stopped', enabled: false });
  await serviceRequest('/worker/resume', 'POST'); await until(async () => (await serviceStatus())?.worker?.state === 'connected');
  status = (await serviceStatus())!; const resumedPid = status.worker!.pid;
  for (const next of ['offline', 'protocol', 'online'] as const) {
    mode = next; for (const response of streams) response.end();
    await until(async () => (await serviceStatus())?.worker?.state === (next === 'online' ? 'connected' : next === 'offline' ? 'disconnected' : 'update-required'));
    expect((await serviceStatus())?.worker?.pid).toBe(resumedPid);
  }
  mode = 'revoked'; for (const response of streams) response.end();
  await until(async () => (await serviceStatus())?.worker?.state === 'blocked');
  expect((await serviceStatus())?.worker).toMatchObject({ enabled: false, reason: 'revoked' });
  expect(fs.existsSync(path.join(root, 'device/data.db'))).toBe(false);
  expect(fs.existsSync(path.join(root, 'device/.config/worker.json'))).toBe(true);
}, 60_000);

it('reaps a worker orphan after controller failure before a replacement takes its journal lock', async () => {
  await connect(); await start();
  await until(async () => (await serviceStatus())?.worker?.state === 'connected');
  const previous = (await serviceStatus())!;
  child!.kill('SIGKILL');
  await until(async () => child!.signalCode !== null);
  await start();
  await until(async () => (await serviceStatus())?.worker?.state === 'connected');
  const current = (await serviceStatus())!;
  expect(current.runId).not.toBe(previous.runId);
  expect(current.worker?.pid).not.toBe(previous.worker?.pid);
  expect(alive(previous.worker!.pid!)).toBe(false);
  expect(fs.existsSync(path.join(root, 'device/data.db'))).toBe(false);
}, 30_000);

it('does not let role setup bypass an unresolved runtime recovery', async () => {
  await connect();
  const installed = getRuntimeInstallDir(); fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'update.json'), JSON.stringify({ format: 1, phase: 'recovery-required', error: 'Inspect the preserved runtime.', changedAt: new Date().toISOString() }));
  await start('failed');
  await expect(serviceRequest('/role/refresh', 'POST')).rejects.toThrow('Complete runtime recovery');
  expect((await serviceStatus())?.phase).toBe('failed');
  expect((await serviceStatus())?.worker?.pid).toBeUndefined();
  expect(fs.existsSync(path.join(root, 'device/data.db'))).toBe(false);
}, 30_000);
