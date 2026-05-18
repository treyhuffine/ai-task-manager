import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Verify the bundled-skills resolver:
 *   - Invokes `listInstalledSkills` once across multiple resolves (caching)
 *   - Collects every channel's symlink target into a unique set
 *   - Survives an error from agentex by returning an empty array
 *   - Skips entries whose `sourcePath` is null (broken symlinks)
 *
 * The cache lives at module scope, so each test resets it via the
 * `_resetSkillDirsCache` test seam before mutating the mock.
 */

const listInstalledSkills = vi.fn();

// `getProvider` and `commandInventoryFromEvent` are also imported by
// adapter.ts; stub them so the module loads in a node-only test env.
vi.mock('@agentex/agent', () => ({
  listInstalledSkills: (...args: unknown[]) => listInstalledSkills(...args),
  commandInventoryFromEvent: () => null,
  getProvider: () => ({ createSession: () => ({}) }),
}));

vi.mock('@/lib/config/paths', () => ({
  getAppRoot: () => '/tmp/test-app-root',
}));

// Keep the executor's incidental DB / pub-sub deps inert. They're not
// exercised by the resolver but the module imports them eagerly.
vi.mock('@/lib/db/queries', () => ({
  getChatSession: () => undefined,
  getAgent: () => undefined,
  getWorkspace: () => undefined,
  updateChatSession: () => undefined,
}));
vi.mock('@/lib/realtime/bus', () => ({
  publishRuntime: () => undefined,
}));

import { _resolveBundledSkillDirs, _resetSkillDirsCache } from './adapter';

describe('executor adapter — bundled skillDirs resolver', () => {
  beforeEach(() => {
    _resetSkillDirsCache();
    listInstalledSkills.mockReset();
  });

  it('returns the union of sourcePaths across channels', async () => {
    listInstalledSkills.mockResolvedValue({
      agents: [
        { name: 'orchestrator', sourcePath: '/repo/skills/orchestrator', isSymlink: true },
      ],
      claude: [
        { name: 'orchestrator', sourcePath: '/repo/skills/orchestrator', isSymlink: true },
        { name: 'triage', sourcePath: '/repo/skills/triage', isSymlink: true },
      ],
    });

    const dirs = await _resolveBundledSkillDirs();

    expect(dirs).toHaveLength(2);
    expect(dirs).toContain('/repo/skills/orchestrator');
    expect(dirs).toContain('/repo/skills/triage');
  });

  it('caches the result across multiple resolves', async () => {
    listInstalledSkills.mockResolvedValue({
      claude: [{ name: 'orchestrator', sourcePath: '/repo/skills/orchestrator', isSymlink: true }],
    });

    await _resolveBundledSkillDirs();
    await _resolveBundledSkillDirs();
    await _resolveBundledSkillDirs();

    expect(listInstalledSkills).toHaveBeenCalledTimes(1);
  });

  it('cache is invalidated by _resetSkillDirsCache', async () => {
    listInstalledSkills.mockResolvedValue({
      claude: [{ name: 'a', sourcePath: '/a', isSymlink: true }],
    });

    await _resolveBundledSkillDirs();
    _resetSkillDirsCache();
    await _resolveBundledSkillDirs();

    expect(listInstalledSkills).toHaveBeenCalledTimes(2);
  });

  it('returns [] when listInstalledSkills throws', async () => {
    listInstalledSkills.mockRejectedValue(new Error('disk not mounted'));
    // Silence the warn we expect — clutters the test output.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const dirs = await _resolveBundledSkillDirs();

    expect(dirs).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('skips entries with a null sourcePath', async () => {
    // Broken symlinks surface as `sourcePath: null` per the agentex
    // contract on `InstalledSkill`. They shouldn't blow up the resolve.
    listInstalledSkills.mockResolvedValue({
      claude: [
        { name: 'orchestrator', sourcePath: '/repo/skills/orchestrator', isSymlink: true },
        { name: 'broken', sourcePath: null, isSymlink: true },
      ],
    });

    const dirs = await _resolveBundledSkillDirs();

    expect(dirs).toEqual(['/repo/skills/orchestrator']);
  });

  it('returns [] when no channels report any skills', async () => {
    listInstalledSkills.mockResolvedValue({});
    expect(await _resolveBundledSkillDirs()).toEqual([]);
  });
});
