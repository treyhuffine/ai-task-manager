import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Saving the harness in the first run: the default model and effort. Ri's
 * skills aren't part of it (they go in as the conversation opens, for every
 * harness: `agent-skill-install.test.ts`).
 */

const calls: string[] = [];
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { harness: {
  harnessesGet: { query: vi.fn(async () => ({ harnesses: [{ id: 'claude', settings: { enabledModels: ['opus', 'sonnet'], defaultModel: 'opus' } }] })) },
  skillsGlobalGet: { query: vi.fn(async () => { calls.push('skillsGlobalGet'); return {}; }) },
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
    const saved = await saveHarnessSetup({ harness: 'claude' });
    expect(saved.model).toBe('opus');
    expect(calls).toContain(
      `defaultPut ${JSON.stringify({ harness: 'claude', model: 'opus', variant: null, effort: 'medium' })}`,
    );
    // The harness's own default is a separate setting and isn't written.
    expect(calls.some((c) => c.startsWith('modelsEnabledPut'))).toBe(false);
  });

  it('saves the model and effort picked', async () => {
    await saveHarnessSetup({ harness: 'claude', model: 'sonnet', effort: 'high' });
    expect(calls).toContain(
      `defaultPut ${JSON.stringify({ harness: 'claude', model: 'sonnet', variant: null, effort: 'high' })}`,
    );
  });

  it('leaves the skills alone, whichever harness is picked', async () => {
    await saveHarnessSetup({ harness: 'claude' });
    expect(calls.some((c) => c.startsWith('skillsGlobal'))).toBe(false);
  });
});
