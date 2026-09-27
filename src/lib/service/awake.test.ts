import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceAwake, readAwakePreferences, writeAwakePreferences } from './awake';
import type { AwakeLease } from './awake-lease';
import type { PowerSource } from './awake-power';

const leases: { alive: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
let controller: ServiceAwake;
let now = 0;
let enabled = false;
let source: PowerSource;
const read = vi.fn();
const write = vi.fn();
const power = vi.fn();
const acquire = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  leases.length = 0;
  now = 0;
  enabled = false;
  source = { power: 'external', detail: 'External power' };
  read.mockImplementation(() => ({ enabled }));
  write.mockImplementation(value => ({ ...value }));
  power.mockImplementation(async () => source);
  acquire.mockImplementation(async () => {
    const lease = { alive: vi.fn(() => true), stop: vi.fn(async () => { lease.alive.mockReturnValue(false); }) };
    leases.push(lease);
    return lease;
  });
  controller = new ServiceAwake({ platform: 'darwin', read, write, power, acquire, now: () => now });
});
afterEach(async () => { await controller.stop(); vi.useRealTimers(); });

it('defaults off without reading hardware or taking an assertion', async () => {
  await controller.start();
  expect(controller.status()).toMatchObject({ enabled: false, phase: 'off' });
  expect(power).not.toHaveBeenCalled();
  expect(acquire).not.toHaveBeenCalled();
});
it('restores the persisted preference and renews a bounded lease before it expires', async () => {
  enabled = true;
  await controller.start();
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'active', power: 'external' });
  now = 10_000;
  await controller.refresh();
  expect(acquire).toHaveBeenCalledTimes(1);
  now = 30_000;
  await controller.refresh();
  expect(acquire).toHaveBeenCalledTimes(2);
  expect(leases[0].stop).toHaveBeenCalledOnce();
  expect(leases[1].stop).not.toHaveBeenCalled();
});
it('persists before enabling and releases on battery, unknown power, and disable', async () => {
  await controller.start();
  await controller.configure({ enabled: true });
  expect(write).toHaveBeenCalledWith({ enabled: true });
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(acquire.mock.invocationCallOrder[0]);
  source = { power: 'battery', detail: 'Waiting for external power' };
  await controller.refresh();
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'on-battery' });
  expect(leases[0].stop).toHaveBeenCalledOnce();
  source = { power: 'external', detail: 'External power' };
  await controller.refresh();
  source = { power: 'unknown', detail: 'Power read failed' };
  await controller.refresh();
  expect(leases[1].stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ phase: 'unavailable', power: 'unknown' });
  source = { power: 'external', detail: 'External power' };
  await controller.refresh();
  await controller.configure({ enabled: false });
  expect(leases[2].stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ enabled: false, phase: 'off' });
});
it('does not claim a dead or expired lease is active before the next poll', async () => {
  enabled = true;
  await controller.start();
  leases[0].alive.mockReturnValue(false);
  expect(controller.status().phase).toBe('unavailable');
  await controller.refresh();
  expect(controller.status().phase).toBe('active');
  now = 60_000;
  expect(controller.status().phase).toBe('unavailable');
});
it('releases idle inhibition on the first battery poll, at most ten seconds after unplugging', async () => {
  vi.useFakeTimers();
  enabled = true;
  await controller.start();
  source = { power: 'battery', detail: 'Waiting for external power' };
  await vi.advanceTimersByTimeAsync(9999);
  expect(leases[0].stop).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(leases[0].stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'on-battery' });
});
it('releases the prior assertion if renewal fails and reports the failure', async () => {
  enabled = true;
  await controller.start();
  acquire.mockRejectedValueOnce(new Error('No logind permission'));
  now = 30_000;
  await controller.refresh();
  expect(leases[0].stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ phase: 'unavailable', detail: 'No logind permission' });
});
it('fails closed if an external-power read becomes stale before it returns', async () => {
  enabled = true;
  await controller.start();
  power.mockImplementationOnce(async () => { now = 6000; return source; });
  await controller.refresh();
  expect(leases[0].stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ phase: 'unavailable', power: 'unknown' });
  expect(acquire).toHaveBeenCalledTimes(1);
});
it('bounds a never-finishing power read and does not accumulate hung polls or assertion renewals', async () => {
  vi.useFakeTimers();
  enabled = true;
  await controller.start();
  let finish!: (source: PowerSource) => void;
  power.mockImplementationOnce(() => new Promise<PowerSource>(resolve => { finish = resolve; }));
  const checking = controller.refresh();
  await vi.advanceTimersByTimeAsync(5000);
  await checking;
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'unavailable', power: 'unknown' });
  expect(leases[0].stop).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(power).toHaveBeenCalledTimes(2);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1); // Only the periodic poll, no leaked deadlines.
  finish(source);
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.status().phase).toBe('unavailable');
  await controller.refresh();
  expect(power).toHaveBeenCalledTimes(3);
  expect(controller.status().phase).toBe('active');
});
it('finishes disable within five seconds even if the in-flight power read never returns', async () => {
  vi.useFakeTimers();
  enabled = true;
  await controller.start();
  power.mockImplementationOnce(() => new Promise<PowerSource>(() => {}));
  const checking = controller.refresh();
  const disabling = controller.configure({ enabled: false });
  await vi.advanceTimersByTimeAsync(5000);
  await Promise.all([checking, disabling]);
  expect(leases[0].stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ enabled: false, phase: 'off' });
  expect(vi.getTimerCount()).toBe(1);
});
it('finishes shutdown within five seconds and ignores a late power response', async () => {
  vi.useFakeTimers();
  enabled = true;
  await controller.start();
  let finish!: (source: PowerSource) => void;
  power.mockImplementationOnce(() => new Promise<PowerSource>(resolve => { finish = resolve; }));
  const checking = controller.refresh();
  const stopping = controller.stop();
  await vi.advanceTimersByTimeAsync(5000);
  await Promise.all([checking, stopping]);
  expect(leases[0].stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'stopped' });
  expect(vi.getTimerCount()).toBe(0);
  finish(source);
  await vi.advanceTimersByTimeAsync(0);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(controller.status().phase).toBe('stopped');
});
it('coalesces overlapping power polls and lets disable win over a slow acquisition', async () => {
  await controller.start();
  let finish!: (lease: AwakeLease) => void;
  acquire.mockImplementationOnce(() => new Promise<AwakeLease>(resolve => { finish = resolve; }));
  const enabling = controller.configure({ enabled: true });
  await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  const polling = controller.refresh();
  const disabling = controller.configure({ enabled: false });
  const stale = { alive: () => true, stop: vi.fn(async () => {}) };
  finish(stale);
  await Promise.all([enabling, polling, disabling]);
  expect(stale.stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ enabled: false, phase: 'off' });
  expect(acquire).toHaveBeenCalledOnce();
});
it('shutdown wins over a pending power read and does not persist a disabled preference', async () => {
  let finish!: (source: PowerSource) => void;
  power.mockImplementationOnce(() => new Promise<PowerSource>(resolve => { finish = resolve; }));
  enabled = true;
  const starting = controller.start();
  await Promise.resolve(); // The bounded reader has begun the OS operation.
  const stopping = controller.stop();
  finish(source);
  await Promise.all([starting, stopping]);
  expect(acquire).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'stopped' });
});
it('shutdown cleans a just-acquired stale lease and preserves the choice for next boot', async () => {
  let finish!: (lease: AwakeLease) => void;
  enabled = true;
  acquire.mockImplementationOnce(() => new Promise<AwakeLease>(resolve => { finish = resolve; }));
  const starting = controller.start();
  await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  const stopping = controller.stop();
  const stale = { alive: () => true, stop: vi.fn(async () => {}) };
  finish(stale);
  await Promise.all([starting, stopping]);
  expect(stale.stop).toHaveBeenCalledOnce();
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'stopped' });
});
it('does not disturb the current assertion when saving preferences fails', async () => {
  enabled = true;
  await controller.start();
  write.mockImplementationOnce(() => { throw new Error('Read-only configuration'); });
  await expect(controller.configure({ enabled: false })).rejects.toThrow('Read-only');
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'active' });
  expect(leases[0].stop).not.toHaveBeenCalled();
});
it('reports unsupported platforms truthfully and never spawns an inhibitor', async () => {
  controller = new ServiceAwake({ platform: 'win32', read: () => ({ enabled: true }), acquire, power });
  await controller.start();
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'unsupported' });
  expect(acquire).not.toHaveBeenCalled();
  expect(power).not.toHaveBeenCalled();
});
it('keeps malformed policy off and allows an explicit save to repair it', async () => {
  read.mockImplementationOnce(() => { throw new Error('Malformed preference'); });
  await controller.start();
  expect(controller.status()).toMatchObject({ enabled: false, phase: 'unavailable' });
  await controller.configure({ enabled: true });
  expect(controller.status()).toMatchObject({ enabled: true, phase: 'active' });
});
it('keeps preferences private and refuses unknown versions and coercible booleans', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-awake-prefs-'));
  const file = path.join(directory, 'awake.json');
  try {
    expect(readAwakePreferences(file)).toEqual({ enabled: false });
    writeAwakePreferences({ enabled: true }, file);
    expect(readAwakePreferences(file)).toEqual({ enabled: true });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    for (const invalid of [{ enabled: 'false' }, { enabled: true, command: 'anything' }, {}, null]) {
      expect(() => writeAwakePreferences(invalid, file)).toThrow();
    }
    for (const invalid of [{ version: 2, enabled: true }, { version: 1, enabled: 'false' }, { version: 1, enabled: true, args: [] }]) {
      fs.writeFileSync(file, JSON.stringify(invalid));
      expect(() => readAwakePreferences(file)).toThrow('could not be read');
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
it('isolates preferences for distinct service identities sharing the same config directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-awake-identities-'));
  try {
    vi.stubEnv('RI_ROOT', path.join(directory, 'first-home'));
    vi.stubEnv('RI_CONFIG_DIR', path.join(directory, 'shared-config'));
    vi.stubEnv('RI_DB_PATH', undefined);
    vi.stubEnv('RI_WORK_DIR', undefined);
    writeAwakePreferences({ enabled: true });
    vi.stubEnv('RI_ROOT', path.join(directory, 'second-home'));
    expect(readAwakePreferences()).toEqual({ enabled: false });
    writeAwakePreferences({ enabled: false });
    vi.stubEnv('RI_ROOT', path.join(directory, 'first-home'));
    expect(readAwakePreferences()).toEqual({ enabled: true });
    expect(fs.readdirSync(path.join(directory, 'shared-config'))).toHaveLength(2);
  } finally { vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); }
});
