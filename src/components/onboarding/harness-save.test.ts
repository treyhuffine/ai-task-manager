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
  defaultPut: { mutate: vi.fn(async ({ body }: { body: Record<string, unknown> }) => { calls.push(`defaultPut ${JSON.stringify(body)}`); return body; }) },
  skillsGlobalPut: { mutate: vi.fn(async ({ body }: { body: unknown }) => { calls.push(`skillsGlobalPut ${JSON.stringify(body)}`); return {}; }) },
} } }));

const { saveHarnessSetup } = await import('./harness-save');

beforeEach(() => {
  calls.length = 0;
});

describe('saveHarnessSetup', () => {
  it("makes the harness's own default model the global default model", async () => {
    skillStatus = { enabled: true, configured: true };
    const saved = await saveHarnessSetup({ harness: 'claude' });
    expect(saved.model).toBe('opus');
    expect(calls).toContain(
      `defaultPut ${JSON.stringify({ harness: 'claude', model: 'opus', variant: null, effort: 'medium' })}`,
    );
    // The harness's own default is a separate setting and isn't written.
    expect(calls.some((c) => c.startsWith('modelsEnabledPut'))).toBe(false);
  });

  it('saves the model and effort picked', async () => {
    skillStatus = { enabled: true, configured: true };
    await saveHarnessSetup({ harness: 'claude', model: 'sonnet', effort: 'high' });
    expect(calls).toContain(
      `defaultPut ${JSON.stringify({ harness: 'claude', model: 'sonnet', variant: null, effort: 'high' })}`,
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
