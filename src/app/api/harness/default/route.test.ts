import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveHarnessSelection: vi.fn(),
  setHomeDefaultSelection: vi.fn(),
}));

vi.mock('@/lib/harness/model-discovery', () => ({
  resolveHarnessSelection: mocks.resolveHarnessSelection,
}));

vi.mock('@/lib/db/queries', () => ({
  setHomeDefaultSelection: mocks.setHomeDefaultSelection,
}));

vi.mock('@/lib/config/paths', () => ({ getAppRoot: () => '/app' }));

import { PUT } from './route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/harness/default', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveHarnessSelection.mockImplementation(async (providerId: string, preferred: Record<string, unknown>) => ({
    providerId,
    model: preferred.model,
    variant: preferred.variant ?? null,
    effort: preferred.effort ?? 'medium',
  }));
});

describe('PUT /api/harness/default', () => {
  it('saves the harness, model, variant and effort picked, exactly', async () => {
    const response = await PUT(request({ harness: 'claude', model: 'opus', effort: 'xhigh' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ harness: 'claude', model: 'opus', variant: null, effort: 'xhigh' });
    // Validated against the live catalog with nothing swapped in.
    expect(mocks.resolveHarnessSelection).toHaveBeenCalledWith(
      'claude',
      { model: 'opus', variant: null, effort: 'xhigh' },
      { cwd: '/app' },
    );
    expect(mocks.setHomeDefaultSelection).toHaveBeenCalledWith({
      harness: 'claude',
      model: 'opus',
      variant: null,
      effort: 'xhigh',
    });
  });

  it('refuses a model the harness does not offer', async () => {
    mocks.resolveHarnessSelection.mockRejectedValue(new Error('Model gpt-6.1-sol is unavailable for claude'));
    const response = await PUT(request({ harness: 'claude', model: 'gpt-6.1-sol' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Model gpt-6.1-sol is unavailable for claude' });
    expect(mocks.setHomeDefaultSelection).not.toHaveBeenCalled();
  });

  it('refuses an effort the model does not offer instead of picking another', async () => {
    mocks.resolveHarnessSelection.mockResolvedValue({ providerId: 'codex', model: 'gpt-6-luna', variant: null, effort: 'high' });
    const response = await PUT(request({ harness: 'codex', model: 'gpt-6-luna', effort: 'ultra' }));

    expect(response.status).toBe(400);
    expect(mocks.setHomeDefaultSelection).not.toHaveBeenCalled();
  });

  it('rejects an unknown harness', async () => {
    const response = await PUT(request({ harness: 'grok', model: 'grok-4.5' }));

    expect(response.status).toBe(400);
    expect(mocks.resolveHarnessSelection).not.toHaveBeenCalled();
  });
});
