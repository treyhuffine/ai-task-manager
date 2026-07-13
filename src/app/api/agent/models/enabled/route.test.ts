import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentModelCatalog: vi.fn(),
  ensureAgentHarnessSettings: vi.fn(),
  getUserState: vi.fn(),
  setActiveHarness: vi.fn(),
  setEnabledHarnessModels: vi.fn(),
  setHarnessDefaultSelection: vi.fn(),
}));

vi.mock('@/lib/agent-model-discovery', () => ({
  getAgentModelCatalog: mocks.getAgentModelCatalog,
}));

vi.mock('@/lib/db/queries', () => ({
  ensureAgentHarnessSettings: mocks.ensureAgentHarnessSettings,
  getUserState: mocks.getUserState,
  setActiveHarness: mocks.setActiveHarness,
  setEnabledHarnessModels: mocks.setEnabledHarnessModels,
  setHarnessDefaultSelection: mocks.setHarnessDefaultSelection,
}));

vi.mock('@/lib/config/paths', () => ({ getAppRoot: () => '/app' }));

import { PUT } from './route';

function settings(harness: 'claude' | 'codex' | 'cursor' | 'opencode', patch: Record<string, unknown> = {}) {
  return {
    harness,
    enabledModels: [],
    defaultModel: null,
    defaultVariant: null,
    defaultEffort: null,
    isActive: false,
    catalogRefreshedAt: null,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    ...patch,
  };
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/agent/models/enabled', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureAgentHarnessSettings.mockImplementation((harness: string) => settings(harness as 'cursor'));
  mocks.getUserState.mockReturnValue({ defaultAgentHarness: 'claude' });
  mocks.setEnabledHarnessModels.mockImplementation((harness: string, enabledModels: string[], defaultModel: string | null) => (
    settings(harness as 'cursor', { enabledModels, defaultModel })
  ));
  mocks.setHarnessDefaultSelection.mockImplementation((harness: string, selection: Record<string, unknown>) => (
    settings(harness as 'cursor', {
      enabledModels: [selection.model],
      defaultModel: selection.model,
      defaultVariant: selection.variant,
      defaultEffort: selection.effort,
    })
  ));
  mocks.setActiveHarness.mockImplementation((harness: string) => settings(harness as 'cursor', { isActive: true }));
});

describe('PUT /api/agent/models/enabled', () => {
  it('accepts a Cursor-discovered Grok model without inventing a Grok harness', async () => {
    mocks.getAgentModelCatalog.mockResolvedValue([{ id: 'grok-4.5', label: 'Grok 4.5' }]);
    const response = await PUT(request({
      harness: 'cursor',
      enabledModelIds: ['grok-4.5'],
      defaultModel: 'grok-4.5',
      makeActive: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.setEnabledHarnessModels).toHaveBeenCalledWith('cursor', ['grok-4.5'], 'grok-4.5');
    expect(mocks.setActiveHarness).toHaveBeenCalledWith('cursor');
  });

  it('stores OpenCode variants separately from reasoning effort', async () => {
    mocks.getAgentModelCatalog.mockResolvedValue([{
      id: 'xai/grok-4.5',
      label: 'Grok 4.5',
      variants: [{ id: 'fast', name: 'Fast' }],
    }]);
    const response = await PUT(request({
      harness: 'opencode',
      enabledModelIds: ['xai/grok-4.5'],
      defaultModel: 'xai/grok-4.5',
      defaultVariant: 'fast',
      defaultEffort: null,
    }));

    expect(response.status).toBe(200);
    expect(mocks.setHarnessDefaultSelection).toHaveBeenCalledWith('opencode', {
      model: 'xai/grok-4.5',
      variant: 'fast',
      effort: null,
    });
  });

  it('does not activate a harness whose retained default disappeared from discovery', async () => {
    mocks.ensureAgentHarnessSettings.mockReturnValue(settings('cursor', {
      enabledModels: ['old-model'],
      defaultModel: 'old-model',
    }));
    mocks.getAgentModelCatalog.mockResolvedValue([{ id: 'new-model', label: 'New model' }]);
    const response = await PUT(request({
      harness: 'cursor',
      enabledModelIds: ['old-model'],
      defaultModel: 'old-model',
      makeActive: true,
    }));

    expect(response.status).toBe(409);
    expect(mocks.setEnabledHarnessModels).not.toHaveBeenCalled();
    expect(mocks.setActiveHarness).not.toHaveBeenCalled();
  });

  it('rejects unknown model IDs instead of silently falling back', async () => {
    mocks.getAgentModelCatalog.mockResolvedValue([{ id: 'known', label: 'Known' }]);
    const response = await PUT(request({
      harness: 'opencode',
      enabledModelIds: ['made-up'],
      defaultModel: 'made-up',
    }));

    expect(response.status).toBe(400);
    expect(mocks.setEnabledHarnessModels).not.toHaveBeenCalled();
  });
});
