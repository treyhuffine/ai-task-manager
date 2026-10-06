import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PUT /api/workspaces/:id/integration-scopes (docs/integrations-workspace-scoping-spec.md §6e/§6f): the
 * single write path for an agent's integration access, from the UI and from update_workspace. Account
 * identifiers resolve to stored pins, a legacy single `account` is rewritten into `accounts`, a bad
 * account is a readable 400, and a save recycles the agent's live sessions.
 */

const recycleWorkspaceSessions = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock('@/lib/executor/adapter', () => ({
  recycleWorkspaceSessions: (id: string) => recycleWorkspaceSessions(id),
}));

const setWorkspaceIntegrationScopes = vi.fn();
const stored = vi.hoisted(() => ({ scopes: [] as unknown[] }));
vi.mock('@/lib/db/queries', () => ({
  getWorkspace: (id: string) => (id === 'ws-1' ? { id, integrationScopes: stored.scopes } : undefined),
  setWorkspaceIntegrationScopes: (id: string, scopes: unknown) => setWorkspaceIntegrationScopes(id, scopes),
}));

vi.mock('@/lib/integrations/runtime', () => {
  const connections = [
    { id: 'c-personal', providerId: 'google', accountId: 'sub-personal', email: 'personal@gmail.com' },
    { id: 'c-work', providerId: 'google', accountId: 'sub-work', email: 'work@gmail.com' },
    { id: 'c-side', providerId: 'google', accountId: 'sub-side', email: 'side@gmail.com' },
  ];
  return {
    getIntegrationOwnerId: () => 'local',
    getIntegrationRuntime: async () => ({
      getToolkits: () => [{ id: 'gmail', providerId: 'google', displayName: 'Gmail' }],
      listConnections: async () => connections,
      listAccountChoices: async () => connections.map((c) => ({ connectionId: c.id, email: c.email })),
    }),
  };
});

const { PUT } = await import('./route');

function put(id: string, body: unknown) {
  return PUT(
    new NextRequest(`http://localhost/api/workspaces/${id}/integration-scopes`, { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  stored.scopes = [];
  recycleWorkspaceSessions.mockClear();
  setWorkspaceIntegrationScopes.mockReset().mockImplementation((id: string, scopes: unknown) => ({ id, integrationScopes: scopes }));
});

describe('PUT /api/workspaces/:id/integration-scopes', () => {
  it('stores a subset of accounts named by email as exact pins, then recycles live sessions', async () => {
    const res = await put('ws-1', { scopes: [{ toolkitId: 'gmail', accounts: ['work@gmail.com', 'side@gmail.com'] }] });
    expect(res.status).toBe(200);
    expect(setWorkspaceIntegrationScopes).toHaveBeenCalledWith('ws-1', [
      { toolkitId: 'gmail', accounts: [{ accountId: 'sub-work' }, { accountId: 'sub-side' }] },
    ]);
    expect(recycleWorkspaceSessions).toHaveBeenCalledWith('ws-1');
  });

  it('accepts the legacy single `account` (pin or string) and stores the new shape', async () => {
    await put('ws-1', { scopes: [{ toolkitId: 'gmail', account: 'personal@gmail.com' }] });
    expect(setWorkspaceIntegrationScopes).toHaveBeenLastCalledWith('ws-1', [
      { toolkitId: 'gmail', accounts: [{ accountId: 'sub-personal' }] },
    ]);
    await put('ws-1', { scopes: [{ toolkitId: 'gmail', account: { accountId: 'sub-work' } }] });
    expect(setWorkspaceIntegrationScopes).toHaveBeenLastCalledWith('ws-1', [{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-work' }] }]);
  });

  it('answers 400 with a readable message for an account that is not connected, and saves nothing', async () => {
    const res = await put('ws-1', { scopes: [{ toolkitId: 'gmail', accounts: ['nobody@gmail.com'] }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('no connected Gmail account matches "nobody@gmail.com"');
    expect(setWorkspaceIntegrationScopes).not.toHaveBeenCalled();
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
  });

  it('answers 400 for a malformed account instead of widening to every account', async () => {
    const res = await put('ws-1', { scopes: [{ toolkitId: 'gmail', accounts: [{ authConfigId: 'x' }] }] });
    expect(res.status).toBe(400);
    expect(setWorkspaceIntegrationScopes).not.toHaveBeenCalled();
  });

  it('keeps a stored account that has since been disconnected', async () => {
    stored.scopes = [{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }, { accountId: 'sub-work' }] }];
    const res = await put('ws-1', { scopes: stored.scopes });
    expect(res.status).toBe(200);
    expect(setWorkspaceIntegrationScopes).toHaveBeenCalledWith('ws-1', stored.scopes);
  });

  it('404s an unknown workspace', async () => {
    expect((await put('ws-nope', { scopes: [] })).status).toBe(404);
  });
});
