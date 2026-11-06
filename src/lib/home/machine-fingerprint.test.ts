import crypto from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

const { spawnSync, readFileSync } = vi.hoisted(() => ({ spawnSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync }));
vi.mock('node:fs', () => ({ default: { readFileSync } }));

const platform = process.platform;
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform });
  vi.resetModules();
  vi.clearAllMocks();
});

it('hashes the native Windows machine ID without trying Linux files', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  spawnSync.mockReturnValue({ status: 0, stdout: '    MachineGuid    REG_SZ    fixture-machine\r\n' });
  const { machineFingerprint } = await import('./machine-fingerprint');
  expect(machineFingerprint()).toBe(crypto.createHash('sha256').update('ri-machine:fixture-machine').digest('hex').slice(0, 32));
  expect(spawnSync).toHaveBeenCalledWith('reg.exe', expect.arrayContaining(['/reg:64']), expect.objectContaining({ windowsHide: true }));
  expect(readFileSync).not.toHaveBeenCalled();
  machineFingerprint();
  expect(spawnSync).toHaveBeenCalledTimes(1);
});

it('skips the device-copy check when Windows cannot read its machine ID', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  spawnSync.mockReturnValue({ status: 1, stdout: '' });
  const { machineFingerprint } = await import('./machine-fingerprint');
  expect(machineFingerprint()).toBeNull();
  expect(readFileSync).not.toHaveBeenCalled();
});
