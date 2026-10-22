import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ device: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({
  getDevice: mocks.device, getWorkspaceSetup: vi.fn(), getWorkerKeyId: () => 'worker-key',
}));
vi.mock('@/lib/harness/runtime', () => ({ getHarnessRuntime: vi.fn() }));
import { harnessCapabilitiesOn } from './devices';

beforeEach(() => mocks.device.mockReset());
describe('speed on connected devices', () => {
  it('requires an explicit capability report, so an older worker cannot silently ignore speed', async () => {
    const capabilities: Record<string, { supported: boolean }> = { sessions: { supported: true } };
    mocks.device.mockReturnValue({ name: 'Test worker', harnesses: [{ harness: 'codex', binary: { status: 'supported' }, capabilities }] });
    const placement = { deviceId: 'worker', isHome: false };
    expect((await harnessCapabilitiesOn(placement, 'codex')).serviceTiers).toBe(false);
    capabilities.serviceTiers = { supported: true };
    expect((await harnessCapabilitiesOn(placement, 'codex')).serviceTiers).toBe(true);
    capabilities.serviceTiers = { supported: false };
    expect((await harnessCapabilitiesOn(placement, 'codex')).serviceTiers).toBe(false);
  });
});
