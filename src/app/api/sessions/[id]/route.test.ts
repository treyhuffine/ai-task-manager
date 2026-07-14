import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const getChatSessionWithExecution = vi.fn();
const getAgent = vi.fn();
const updateChatSession = vi.fn();
const updateUserState = vi.fn();
const setExecutionPR = vi.fn();
const setExecutionLabel = vi.fn();
const isRunning = vi.fn();
const resolveCwd = vi.fn();
const recycleForModeChange = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
const getAgentModelCatalog = vi.fn();
const getHarnessRuntime = vi.fn();

vi.mock('@/lib/db/queries', () => ({
  getChatSessionWithExecution: (id: string) => getChatSessionWithExecution(id),
  getAgent: (id: string) => getAgent(id),
  updateChatSession: (id: string, input: unknown) => updateChatSession(id, input),
  updateUserState: (input: unknown) => updateUserState(input),
  setExecutionPR: (id: string, value: number | null) => setExecutionPR(id, value),
  setExecutionLabel: (id: string, value: string | null) => setExecutionLabel(id, value),
}));

vi.mock('@/lib/executor/adapter', () => ({
  isRunning: (id: string) => isRunning(id),
  resolveCwd: (session: unknown) => resolveCwd(session),
  recycleForModeChange: (id: string) => recycleForModeChange(id),
}));

vi.mock('@/lib/agent-model-discovery', () => ({
  getAgentModelCatalog: (providerId: string, options: unknown) =>
    getAgentModelCatalog(providerId, options),
}));

vi.mock('@/lib/agents/runtime', () => ({
  getHarnessRuntime: (providerId: string, options: unknown) =>
    getHarnessRuntime(providerId, options),
}));

vi.mock('@/lib/config/paths', () => ({
  getAppRoot: () => '/tmp/flow-test',
}));

import { PATCH } from './route';

const SESSION_ID = 'session-1';
const existing = {
  id: SESSION_ID,
  agentId: 'agent-1',
  executionId: null,
  execution: null,
  label: 'Chat',
  permissionMode: 'bypass',
  prePlanMode: null,
  model: 'opus',
  modelVariant: null,
  effort: 'medium',
  prNumber: null,
};

function request(body: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost/api/sessions/${SESSION_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: SESSION_ID }) };
}

beforeEach(() => {
  getChatSessionWithExecution.mockReset().mockReturnValue(existing);
  getAgent.mockReset().mockReturnValue({ id: 'agent-1', harness: 'claude_code' });
  updateChatSession.mockReset().mockImplementation((_id, input) => ({ ...existing, ...input }));
  updateUserState.mockReset();
  setExecutionPR.mockReset();
  setExecutionLabel.mockReset();
  isRunning.mockReset().mockReturnValue(false);
  resolveCwd.mockReset().mockReturnValue('/tmp/workspace');
  recycleForModeChange.mockClear();
  getAgentModelCatalog.mockReset().mockResolvedValue([
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
  ]);
  getHarnessRuntime.mockReset().mockResolvedValue({
    capabilities: {
      planMode: { supported: true, status: 'supported' },
      permissionRequests: { supported: true, status: 'supported' },
      sessionModelChange: { supported: true, status: 'supported' },
      sessionVariantChange: { supported: false, status: 'missing' },
      sessionEffortChange: { supported: true, status: 'supported' },
    },
  });
});

describe('PATCH /api/sessions/[id] selection changes', () => {
  it.each([
    ['effort', { effort: 'xhigh' }],
    ['model', { model: 'sonnet' }],
    ['mode', { permissionMode: 'plan' }],
  ])('rejects a %s change while a turn is active', async (_label, body) => {
    isRunning.mockReturnValue(true);

    const response = await PATCH(request(body), params());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'selection_change_while_running',
      reason: 'Wait for the active turn to finish before changing its model, variant, effort, or mode.',
    });
    expect(updateChatSession).not.toHaveBeenCalled();
    expect(updateUserState).not.toHaveBeenCalled();
    expect(recycleForModeChange).not.toHaveBeenCalled();
  });

  it('persists and recycles an effort change after the active turn finishes', async () => {
    const response = await PATCH(request({ effort: 'xhigh' }), params());

    expect(response.status).toBe(200);
    expect(updateChatSession).toHaveBeenCalledWith(SESSION_ID, { effort: 'xhigh' });
    expect(updateUserState).toHaveBeenCalledWith({
      defaultAgentHarness: 'claude',
      defaultAgentModel: 'opus',
      defaultAgentEffort: 'xhigh',
    });
    expect(recycleForModeChange).toHaveBeenCalledWith(SESSION_ID);
  });

  it('requires a new chat when the runtime cannot change effort in place', async () => {
    getHarnessRuntime.mockResolvedValue({
      capabilities: {
        sessionModelChange: { supported: true, status: 'supported' },
        sessionVariantChange: { supported: false, status: 'missing' },
        sessionEffortChange: {
          supported: false,
          status: 'missing',
          reason: 'Effort changes require a new chat',
        },
      },
    });

    const response = await PATCH(request({ effort: 'xhigh' }), params());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'selection_requires_new_chat',
      reason: 'Effort changes require a new chat',
    });
    expect(updateChatSession).not.toHaveBeenCalled();
    expect(recycleForModeChange).not.toHaveBeenCalled();
  });

  it('still allows metadata-only updates while a turn is active', async () => {
    isRunning.mockReturnValue(true);

    const response = await PATCH(request({ label: 'Renamed' }), params());

    expect(response.status).toBe(200);
    expect(updateChatSession).toHaveBeenCalledWith(SESSION_ID, { label: 'Renamed' });
    expect(recycleForModeChange).not.toHaveBeenCalled();
  });
});
