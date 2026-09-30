import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcess, fork } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeConnection } from '@/lib/connection/config';
import { writeWorkerConfig } from '@/lib/worker/config';
import { ServiceWorker } from './worker';
vi.mock('./processes', () => ({ ownedProcesses: vi.fn(async () => []) }));
vi.mock('./environment', () => ({ serviceEnvironment: () => ({ RI_DESKTOP_CLIENT_SECRET: 'native-secret', RI_SERVICE_CONTROL_TOKEN: 'control-secret', PATH: '/bin' }) }));

class Child extends EventEmitter {
  pid = 1234; connected = true; stdout = null; stderr = null;
  kill = vi.fn((signal?: NodeJS.Signals) => { void signal; queueMicrotask(() => { this.connected = false; this.emit('close', 0, null); }); return true; });
  send = vi.fn((message: { id: string; action: string }, callback?: (error: Error | null) => void) => {
    callback?.(null); queueMicrotask(() => this.emit('message', { type: 'reply', id: message.id, activity: [] })); return true;
  });
}
let root: string;
let instances: ServiceWorker[];
let children: Child[];
let spawn: ReturnType<typeof vi.fn>;
const workerConfig = { homeId: 'home', deviceId: 'device', deviceName: 'MacBook', workerKey: 'worker-key', enrolledAt: 'now' };
function controller(stopMs?: number) { const result = new ServiceWorker({ stopMs, repo: '/runtime/server', node: '/runtime/node/bin/node', spawn: spawn as unknown as typeof fork, retryMs: 5 }); instances.push(result); return result; }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-service-worker-'));
  vi.stubEnv('RI_ROOT', root); for (const name of ['RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_DB_PATH']) vi.stubEnv(name, undefined);
  writeConnection({ homeId: 'home', homeName: 'My Ri', homeHostName: 'Mini', homeUrl: 'https://home.example', credential: 'viewer-key', connectedAt: 'now' });
  writeWorkerConfig(workerConfig);
  instances = []; children = [];
  spawn = vi.fn(() => { const child = new Child(); children.push(child); queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; });
});
afterEach(async () => { for (const instance of instances) await instance.dispose(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('starts only the owned worker and strips native Home capabilities from its environment', async () => {
  const service = controller(); await service.start();
  expect(spawn).toHaveBeenCalledWith('/runtime/server/dist/service/worker.cjs', [], expect.objectContaining({ execPath: '/runtime/node/bin/node', env: { PATH: '/bin' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }));
  expect(service.status()).toMatchObject({ state: 'starting', enabled: true, pid: 1234 });
  expect(fs.existsSync(path.join(root, 'data.db'))).toBe(false);
});
it('persists a deliberate stop across controllers until the person explicitly resumes', async () => {
  const first = controller(); await first.start(); await first.stop(true); await first.dispose();
  const second = controller(); await second.start();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(second.status()).toMatchObject({ state: 'stopped', enabled: false });
  await second.resume(); expect(spawn).toHaveBeenCalledTimes(2);
  expect(second.status().enabled).toBe(true);
});
it('keeps sleep/network reconnect and protocol-paused children alive', async () => {
  const service = controller(); await service.start();
  children[0].emit('message', { type: 'state', state: { state: 'disconnected', error: 'Offline', retryInMs: 30000 } });
  expect(service.status()).toMatchObject({ state: 'disconnected', enabled: true });
  children[0].emit('message', { type: 'state', state: { state: 'update-required', error: 'Update Home', retryInMs: 30000 } });
  expect(service.status()).toMatchObject({ state: 'update-required', enabled: true });
  expect(spawn).toHaveBeenCalledTimes(1); expect(children[0].kill).not.toHaveBeenCalled();
});
it.each(['revoked', 'wrong_home', 'already_running'])('never automatically restarts a %s authority failure', async reason => {
  const service = controller(); await service.start();
  children[0].emit('message', { type: 'exit', exit: { reason, message: 'Needs attention' } });
  children[0].emit('close', 1, null);
  expect(service.status()).toMatchObject({ state: 'blocked', enabled: false, reason });
  const next = controller(); await next.start(); expect(spawn).toHaveBeenCalledTimes(1);
});
it('restarts an unexpectedly crashed child without rotating enrollment or losing journals', async () => {
  const service = controller(); await service.start();
  children[0].emit('close', 9, null);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
  expect(service.status()).toMatchObject({ enabled: true, state: 'starting' });
});
it('routes drain and activity requests to the owned child', async () => {
  const service = controller(); await service.start();
  await service.prepareIdle(); expect(children[0].send).toHaveBeenCalledWith(expect.objectContaining({ action: 'prepare' }), expect.any(Function));
  expect(await service.activity()).toEqual([]);
  await service.resumeAdmission(); expect(children[0].send).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'resume' }), expect.any(Function));
});
it('only a new enrollment resets an old deliberate stop', async () => {
  const service = controller(); await service.start(); await service.stop(true); await service.dispose();
  writeWorkerConfig({ ...workerConfig, workerKey: 'new-key' });
  const next = controller(); await next.start(); expect(spawn).toHaveBeenCalledTimes(2);
});
it('fails closed on damaged or permissive local stop preferences', () => {
  const file = path.join(root, '.config/worker-service.json');
  fs.writeFileSync(file, '{}', { mode: 0o600 }); expect(controller).toThrow('Unsupported');
  fs.chmodSync(file, 0o644); expect(controller).toThrow('Unsafe');
});

it('retains a cleanup warning and blocks updates when graceful stop needs a forced kill', async () => {
  const service = controller(5); await service.start();
  children[0].kill.mockImplementation(signal => {
    if (signal === 'SIGKILL') queueMicrotask(() => { children[0].connected = false; children[0].emit('close', null, 'SIGKILL'); });
    return true;
  });
  await service.stop(true);
  expect(service.status()).toMatchObject({ state: 'blocked', enabled: false, reason: 'cleanup' });
  expect(await service.activity()).toEqual(['Local worker cleanup requires attention']);
  const next = controller(); await next.start();
  expect(next.status()).toMatchObject({ state: 'blocked', enabled: false, reason: 'cleanup' });
  expect(spawn).toHaveBeenCalledTimes(1);
});

it('resumes idempotently while its enabled child is connected or retrying the network', async () => {
  const service = controller(); await service.start();
  for (const state of ['connected', 'disconnected', 'update-required'] as const) {
    children[0].emit('message', { type: 'state', state: { state, error: state === 'connected' ? undefined : 'Retrying' } });
    const status = service.status();
    await service.resume();
    expect(service.status()).toEqual(status);
  }
  expect(spawn).toHaveBeenCalledTimes(1); expect(children[0].kill).not.toHaveBeenCalled();
});
