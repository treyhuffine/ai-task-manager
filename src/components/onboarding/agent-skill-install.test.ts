import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ri's skills as a new home's first run opens. The point under test is the
 * shared, machine-wide install: made for a home that never chose, never taken
 * over by a home seeded not to make it (an isolated test home).
 */

let skillStatus: { enabled: boolean; configured: boolean; appOnly?: boolean } = { enabled: false, configured: false };
let failPut = false;
const calls: string[] = [];
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { harness: {
  skillsGlobalGet: { query: vi.fn(async () => skillStatus) },
  skillsGlobalPut: { mutate: vi.fn(async ({ body }: { body: unknown }) => {
    calls.push(`skillsGlobalPut ${JSON.stringify(body)}`);
    if (failPut) throw new Error('Another skill is already at ~/.claude/skills/agent-work-tasks-notes_ri');
    return {};
  }) },
} } }));

const { installAgentSkill } = await import('./agent-skill-install');

beforeEach(() => {
  calls.length = 0;
  failPut = false;
});

describe('installAgentSkill', () => {
  it('installs for a home that never chose', async () => {
    skillStatus = { enabled: false, configured: false };
    await installAgentSkill();
    expect(calls).toEqual(['skillsGlobalPut {"enabled":true}']);
  });

  it('leaves the machine-wide skills alone for a home that chose, or was seeded not to install them', async () => {
    for (const enabled of [true, false]) {
      skillStatus = { enabled, configured: true };
      await installAgentSkill();
    }
    expect(calls).toEqual([]);
  });

  it("installs the desktop app's own copy", async () => {
    skillStatus = { enabled: false, configured: true, appOnly: true };
    await installAgentSkill();
    expect(calls).toEqual(['skillsGlobalPut {"enabled":true}']);
  });

  it("doesn't hold up setup when the install can't happen", async () => {
    skillStatus = { enabled: false, configured: false };
    failPut = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(installAgentSkill()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
