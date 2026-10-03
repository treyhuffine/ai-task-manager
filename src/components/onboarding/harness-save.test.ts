import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Saving the harness in the first run. The point under test is the shared,
 * machine-wide agent skill: installed for a home that never chose, never
 * taken over by a home seeded not to install it (an isolated test home).
 */

let skillStatus: { enabled: boolean; configured: boolean; appOnly?: boolean } = { enabled: false, configured: false };
const calls: string[] = [];
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { harness: {
  harnessesGet: { query: vi.fn(async () => ({ harnesses: [{ id: 'claude', settings: { enabledModels: ['opus', 'sonnet'], defaultModel: 'opus' } }] })) },
  skillsGlobalGet: { query: vi.fn(async () => skillStatus) },
  modelsEnabledPut: { mutate: vi.fn(async ({ body }: { body: unknown }) => { calls.push(`modelsEnabledPut ${JSON.stringify(body)}`); return {}; }) },
  skillsGlobalPut: { mutate: vi.fn(async ({ body }: { body: unknown }) => { calls.push(`skillsGlobalPut ${JSON.stringify(body)}`); return {}; }) },
} } }));

const { saveHarnessSetup } = await import('./harness-save');

beforeEach(() => {
  calls.length = 0;
});

describe('saveHarnessSetup', () => {
  it('makes the harness active and keeps the models already enabled', async () => {
    skillStatus = { enabled: true, configured: true };
    const saved = await saveHarnessSetup({ harness: 'claude' });
    expect(saved.model).toBe('opus');
    expect(calls).toContain(
      `modelsEnabledPut ${JSON.stringify({ harness: 'claude', enabledModelIds: ['opus', 'sonnet'], defaultModel: 'opus', defaultVariant: null, defaultEffort: 'medium', makeActive: true })}`,
    );
  });

  it('installs the agent skill for a home that never chose', async () => {
    skillStatus = { enabled: false, configured: false };
    await saveHarnessSetup({ harness: 'claude' });
    expect(calls).toContain('skillsGlobalPut {"enabled":true}');
  });

  it("leaves the machine-wide skill alone for a home seeded not to install it", async () => {
    skillStatus = { enabled: false, configured: true };
    await saveHarnessSetup({ harness: 'claude' });
    expect(calls.some((c) => c.startsWith('skillsGlobalPut'))).toBe(false);
  });

  it("installs the desktop app's own copy", async () => {
    skillStatus = { enabled: false, configured: true, appOnly: true };
    await saveHarnessSetup({ harness: 'claude' });
    expect(calls).toContain('skillsGlobalPut {"enabled":true}');
  });
});
