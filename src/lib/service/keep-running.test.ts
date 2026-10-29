import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeAuthConfig } from '@/lib/auth/config-file';
import { writeRuntimeFixture } from './runtime-fixture';
import { stageRelease } from './store';
import { installedRuntime, stageRuntime } from './runtime';
import { servicePaths } from './paths';
import { markStopped, readStopped } from './stopped';
import type { ServiceStatus } from './client';
import { AddressError, ensureHomeRelease, keepRunning, portHolder, readHomeAddress, recordHomeAddress, type KeepRunningDeps } from './keep-running';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-keep-running-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  vi.stubEnv('RI_RUNTIME_REPO', path.join(root, 'checkout'));
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  fs.mkdirSync(path.join(root, 'checkout'), { recursive: true });
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function release(name: string) {
  const directory = path.join(root, 'resources', name);
  writeRuntimeFixture(directory, { version: '0.1.0', files: { [`server/${name}`]: name } });
  return directory;
}

it('keeps the address a Home had in a terminal: plain HTTP on its last port', () => {
  writeAuthConfig({ lastPort: 4300 });
  expect(recordHomeAddress()).toEqual({ address: { version: 1, port: 4300, scheme: 'http', host: '0.0.0.0' }, recorded: true });
  // Recorded once. The service's own record wins from then on.
  expect(recordHomeAddress()).toMatchObject({ recorded: false, address: { port: 4300 } });
  expect(() => recordHomeAddress({ port: 5000 })).toThrow(AddressError);
  expect(recordHomeAddress({ port: 4300 }).recorded).toBe(false);
});

it('gives a new Home http://localhost:4224, or the port it was asked for', () => {
  expect(recordHomeAddress().address).toMatchObject({ port: 4224, scheme: 'http' });
  fs.rmSync(servicePaths().settings);
  expect(recordHomeAddress({ port: 4400 }).address.port).toBe(4400);
  fs.rmSync(servicePaths().settings);
  expect(() => recordHomeAddress({ port: 80 })).toThrow(AddressError);
});

it('keeps a service Home on the HTTPS address it already has', () => {
  fs.mkdirSync(path.dirname(servicePaths().settings), { recursive: true });
  fs.writeFileSync(servicePaths().settings, JSON.stringify({ version: 1, port: 42242, privatePort: 42243 }));
  expect(recordHomeAddress()).toEqual({ address: { version: 1, port: 42242, privatePort: 42243 }, recorded: false });
});

it('says what holds a port', async () => {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen({ port: 0, host: '0.0.0.0' }, resolve));
  const port = (server.address() as net.AddressInfo).port;
  try { expect(await portHolder(port)).toMatch(new RegExp(`\\(pid ${process.pid}\\)$`)); }
  finally { await new Promise(resolve => server.close(resolve)); }
  expect(await portHolder(port)).toBeNull();
});

it('gives a Home the newest release on this computer, and keeps the one it runs', () => {
  expect(ensureHomeRelease()).toBeNull();
  const first = stageRelease(release('first')).id;
  expect(ensureHomeRelease()).toEqual({ id: first, how: 'adopted' });
  expect(installedRuntime()?.id).toBe(first);
  expect(fs.existsSync(path.join(installedRuntime()!.launcher))).toBe(true);
  stageRelease(release('second'));
  // Moving to the newer release is an update, not a start.
  expect(ensureHomeRelease()).toEqual({ id: first, how: 'running' });
});

it('installs the release a packaged CLI came from when the computer has none', () => {
  const resources = release('packaged');
  vi.stubEnv('RI_RUNTIME_REPO', path.join(resources, 'server'));
  const id = ensureHomeRelease()!.id;
  expect(ensureHomeRelease()).toEqual({ id, how: 'running' });
});

function fakeService(overrides: Partial<KeepRunningDeps> = {}) {
  const calls: string[] = [];
  let status: ServiceStatus | null = null;
  let now = 0;
  const deps: KeepRunningDeps = {
    status: async () => status,
    install: async () => {
      calls.push('install');
      status = { runId: 'supervised', phase: 'running', origin: 'http://localhost:4224' } as ServiceStatus;
    },
    holder: async () => null,
    sleep: async ms => { now += ms; },
    now: () => now,
    ...overrides,
  };
  return { deps, calls, set: (next: ServiceStatus | null) => { status = next; } };
}

it('supervises a Home and waits until it serves, clearing a recorded stop', async () => {
  stageRuntime(release('first'));
  markStopped();
  const { deps, calls } = fakeService();
  const result = await keepRunning({}, deps);
  expect(result).toMatchObject({ result: 'running', origin: 'http://localhost:4224', recorded: true });
  expect(calls).toEqual(['install']);
  expect(readStopped()).toBeNull();
  expect(readHomeAddress()).toMatchObject({ port: 4224, scheme: 'http' });
});

it("stops and says what holds the Home's port instead of moving it", async () => {
  stageRuntime(release('first'));
  const { deps, calls } = fakeService({ holder: async () => 'node (pid 42)' });
  const result = await keepRunning({}, deps);
  expect(result).toEqual({ result: 'failed', reason: 'Port 4224 is in use by node (pid 42). This Home keeps http://localhost:4224, so stop that first, then run this again.' });
  expect(calls).toEqual([]);
});

it('takes over a running unsupervised service without checking its own port', async () => {
  stageRuntime(release('first'));
  const holder = vi.fn(async () => 'ri (pid 7)');
  const { deps, set } = fakeService({ holder });
  set({ runId: 'unsupervised', phase: 'running', origin: 'https://localhost:42242' } as ServiceStatus);
  fs.mkdirSync(path.dirname(servicePaths().settings), { recursive: true });
  fs.writeFileSync(servicePaths().settings, JSON.stringify({ version: 1, port: 42242, privatePort: 42243 }));
  await expect(keepRunning({}, deps)).resolves.toMatchObject({ result: 'running', recorded: false });
  expect(holder).not.toHaveBeenCalled();
});

it('reports a Home that fails to start, with its error', async () => {
  stageRuntime(release('first'));
  const crashing = { runId: 'new', phase: 'restarting', error: 'The server exited (exit 1)', restarts: { count: 5, crashLoop: true, last: { at: '', reason: '' } } } as ServiceStatus;
  const service = fakeService({ install: async () => service.set(crashing) });
  await expect(keepRunning({}, service.deps)).resolves.toEqual({ result: 'failed', reason: 'The server exited (exit 1)' });
});

it('needs a release, and runs nothing without one', async () => {
  const { deps, calls } = fakeService();
  await expect(keepRunning({}, deps)).resolves.toEqual({ result: 'no-release' });
  expect(calls).toEqual([]);
  expect(readHomeAddress()).toBeNull();
});

it("leaves a new team's address to the service, which picks its own as it always has", async () => {
  stageRuntime(release('first'));
  const holder = vi.fn(async () => null);
  const { deps, calls } = fakeService({ holder });
  await expect(keepRunning({ address: 'service' }, deps)).resolves.toMatchObject({ result: 'running', recorded: false });
  expect(calls).toEqual(['install']);
  expect(readHomeAddress()).toBeNull();
  expect(holder).not.toHaveBeenCalled();
});
