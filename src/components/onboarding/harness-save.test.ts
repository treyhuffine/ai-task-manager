import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Saving the harness in the first run. The point under test is the shared,
 * machine-wide agent skill: installed for a home that never chose, never
 * taken over by a home seeded not to install it (an isolated test home).
 */

let skillStatus: { enabled: boolean; configured: boolean; appOnly?: boolean } = { enabled: false, configured: false };
const calls: string[] = [];
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      calls.push(`GET ${path}`);
      if (path === '/harness/harnesses') return { harnesses: [{ id: 'claude', settings: { enabledModels: ['opus', 'sonnet'], defaultModel: 'opus' } }] };
      if (path === '/harness/skills/global') return skillStatus;
      throw new Error(`unexpected GET ${path}`);
    }),
    put: vi.fn(async (path: string, body: unknown) => {
      calls.push(`PUT ${path} ${JSON.stringify(body)}`);
      return {};
    }),
    patch: vi.fn(async (path: string) => {
      calls.push(`PATCH ${path}`);
      return {};
    }),
  },
}));

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
      `PUT /harness/models/enabled ${JSON.stringify({ harness: 'claude', enabledModelIds: ['opus', 'sonnet'], defaultModel: 'opus', defaultEffort: 'medium', makeActive: true })}`,
    );
  });

  it('installs the agent skill for a home that never chose', async () => {
    skillStatus = { enabled: false, configured: false };
    await saveHarnessSetup({ harness: 'claude' });
    expect(calls).toContain('PUT /harness/skills/global {"enabled":true}');
  });

  it("leaves the machine-wide skill alone for a home seeded not to install it", async () => {
    skillStatus = { enabled: false, configured: true };
    await saveHarnessSetup({ harness: 'claude' });
    expect(calls.some((c) => c.startsWith('PUT /harness/skills/global'))).toBe(false);
  });

  it("installs the desktop app's own copy", async () => {
    skillStatus = { enabled: false, configured: true, appOnly: true };
    await saveHarnessSetup({ harness: 'claude' });
    expect(calls).toContain('PUT /harness/skills/global {"enabled":true}');
  });
});
