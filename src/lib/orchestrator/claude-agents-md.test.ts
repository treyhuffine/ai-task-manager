import { beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
  runtime: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('@/lib/harness/runtime', () => ({ getHarnessRuntime: probe.runtime }));
vi.mock('@/lib/auth/claude', () => ({ getClaudeAuthStatus: probe.auth }));

function installed(version: string | null) {
  return { binary: { status: 'supported', command: 'claude', version, protocolProfile: null } };
}

async function freshModule() {
  vi.resetModules();
  return import('./claude-agents-md');
}

describe('claudeNeedsClaudeMd', () => {
  it('needs no pointer on a first-party Claude Code that reads AGENTS.md', async () => {
    const { claudeNeedsClaudeMd } = await freshModule();
    expect(claudeNeedsClaudeMd({ installed: true, version: '2.1.277', apiProvider: 'firstParty' })).toBe(false);
    expect(claudeNeedsClaudeMd({ installed: true, version: '2.2.0', apiProvider: 'firstParty' })).toBe(false);
  });

  it('needs the pointer on a build older than AGENTS.md support', async () => {
    const { claudeNeedsClaudeMd } = await freshModule();
    expect(claudeNeedsClaudeMd({ installed: true, version: '2.1.276', apiProvider: 'firstParty' })).toBe(true);
    expect(claudeNeedsClaudeMd({ installed: true, version: '1.9.999', apiProvider: 'firstParty' })).toBe(true);
  });

  it('needs the pointer on a third-party API provider', async () => {
    const { claudeNeedsClaudeMd } = await freshModule();
    for (const apiProvider of ['bedrock', 'vertex', 'foundry']) {
      expect(claudeNeedsClaudeMd({ installed: true, version: '2.1.281', apiProvider })).toBe(true);
    }
  });

  it('treats an unknown version or provider as needing the pointer', async () => {
    const { claudeNeedsClaudeMd } = await freshModule();
    expect(claudeNeedsClaudeMd({ installed: true, version: null, apiProvider: 'firstParty' })).toBe(true);
    expect(claudeNeedsClaudeMd({ installed: true, version: '2.1.281', apiProvider: null })).toBe(true);
  });

  it('needs nothing when Claude Code is not installed', async () => {
    const { claudeNeedsClaudeMd } = await freshModule();
    expect(claudeNeedsClaudeMd({ installed: false, version: null, apiProvider: null })).toBe(false);
  });
});

describe('shouldWriteClaudeMdPointer', () => {
  beforeEach(() => {
    probe.runtime.mockReset();
    probe.auth.mockReset();
  });

  it('reads the installed version and API provider', async () => {
    probe.runtime.mockResolvedValue(installed('2.1.281'));
    probe.auth.mockResolvedValue({ loggedIn: true, apiProvider: 'firstParty' });
    const { shouldWriteClaudeMdPointer } = await freshModule();
    expect(await shouldWriteClaudeMdPointer()).toBe(false);

    probe.runtime.mockResolvedValue(installed('2.1.200'));
    const again = await freshModule();
    expect(await again.shouldWriteClaudeMdPointer()).toBe(true);
  });

  it('skips the auth probe when Claude Code is missing', async () => {
    probe.runtime.mockResolvedValue({ binary: { status: 'missing', command: null, version: null, protocolProfile: null } });
    const { shouldWriteClaudeMdPointer } = await freshModule();
    expect(await shouldWriteClaudeMdPointer()).toBe(false);
    expect(probe.auth).not.toHaveBeenCalled();
  });

  it('memoizes the answer across spawns', async () => {
    probe.runtime.mockResolvedValue(installed('2.1.281'));
    probe.auth.mockResolvedValue({ loggedIn: true, apiProvider: 'firstParty' });
    const { shouldWriteClaudeMdPointer } = await freshModule();
    await shouldWriteClaudeMdPointer();
    await shouldWriteClaudeMdPointer();
    expect(probe.runtime).toHaveBeenCalledTimes(1);
    expect(probe.auth).toHaveBeenCalledTimes(1);
  });

  it('writes the pointer when the probe itself fails', async () => {
    probe.runtime.mockRejectedValue(new Error('spawn failed'));
    const { shouldWriteClaudeMdPointer } = await freshModule();
    expect(await shouldWriteClaudeMdPointer()).toBe(true);
  });
});
