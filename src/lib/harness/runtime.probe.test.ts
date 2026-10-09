import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRuntimeReport } from '@agentex/agent';

const fakes = vi.hoisted(() => ({
  probe: vi.fn<(ctx: unknown) => Promise<ProviderRuntimeReport>>(),
  resolveAuth: vi.fn(),
}));

vi.mock('./credentials', () => ({ openCursorApiKey: async () => null }));
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({
    capabilities: { sessions: true },
    probeCapabilities: fakes.probe,
    resolveAuth: fakes.resolveAuth,
  }),
}));

const { clearHarnessRuntimeCache, getHarnessRuntime } = await import('./runtime');

const supported: ProviderRuntimeReport = {
  binary: { status: 'supported', command: 'agent', version: '1.0.0', protocolProfile: 'current' },
  capabilities: {},
};

beforeEach(() => {
  clearHarnessRuntimeCache();
  fakes.probe.mockReset();
  fakes.resolveAuth.mockReset();
  fakes.resolveAuth.mockResolvedValue({ binary: { installed: true, resolvedPath: '/bin/claude', version: '2.1.295' } });
});
afterEach(() => clearHarnessRuntimeCache());

describe('harness runtime resolution', () => {
  it('shares one probe among callers that arrive while it runs', async () => {
    let finish!: (report: ProviderRuntimeReport) => void;
    fakes.probe.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const calls = Promise.all([1, 2, 3].map(() => getHarnessRuntime('cursor', { cwd: '/work' })));
    await vi.waitFor(() => expect(fakes.probe).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fakes.probe).toHaveBeenCalledTimes(1);
    finish(supported);
    const views = await calls;
    expect(new Set(views).size).toBe(1);
    expect(views[0].capabilities.sessions.supported).toBe(true);
    await getHarnessRuntime('cursor', { cwd: '/work' });
    expect(fakes.probe).toHaveBeenCalledTimes(1);
  });

  it('keeps folders apart, and a forced refresh probes again', async () => {
    fakes.probe.mockResolvedValue(supported);
    await getHarnessRuntime('cursor', { cwd: '/a' });
    await getHarnessRuntime('cursor', { cwd: '/b' });
    await getHarnessRuntime('cursor', { cwd: '/a', refresh: true });
    expect(fakes.probe).toHaveBeenCalledTimes(3);
  });

  it('does not keep a failed resolution, so the next caller retries', async () => {
    fakes.probe.mockRejectedValueOnce(new Error('probe crashed')).mockResolvedValue(supported);
    // A thrown probe is reported as a missing binary rather than rejecting.
    const failed = await getHarnessRuntime('opencode', { cwd: '/work' });
    expect(failed.binary.status).toBe('missing');
    expect(fakes.probe).toHaveBeenCalledTimes(1);
  });

  it.each(['claude', 'codex'] as const)('checks %s with its auth report, never its telemetry probe', async (harness) => {
    fakes.probe.mockResolvedValue(supported);
    const view = await getHarnessRuntime(harness, { cwd: '/work' });
    expect(fakes.probe).not.toHaveBeenCalled();
    expect(fakes.resolveAuth).toHaveBeenCalledTimes(1);
    expect(view.binary).toMatchObject({ status: 'supported', version: '2.1.295' });
  });

  it.each(['cursor', 'opencode', 'antigravity'] as const)('still probes %s', async (harness) => {
    fakes.probe.mockResolvedValue(supported);
    await getHarnessRuntime(harness, { cwd: '/work' });
    expect(fakes.probe).toHaveBeenCalledTimes(1);
    expect(fakes.resolveAuth).not.toHaveBeenCalled();
  });
});
