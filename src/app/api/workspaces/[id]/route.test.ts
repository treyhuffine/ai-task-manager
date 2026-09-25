import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PATCH /api/workspaces/:id for the agent scope fields
 * (docs/agents-view-spec.md Phase 3). The real query layer validates, so a
 * bad value surfaces as a readable 400. Session config is read at spawn, so
 * a change recycles the live sessions that receive it: instructions, browser
 * and folder reach every session, name and purpose only the agent's main
 * chat (Phase 6).
 */

const recycleWorkspaceSessions = vi.fn<(id: string) => Promise<void>>(async () => {});
const recycleAgentMainChats = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock('@/lib/executor/adapter', () => ({
  recycleWorkspaceSessions: (id: string) => recycleWorkspaceSessions(id),
  recycleAgentMainChats: (id: string) => recycleAgentMainChats(id),
}));

const updateWorkspace = vi.fn();
vi.mock('@/lib/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/queries')>();
  return {
    WorkspaceFieldError: actual.WorkspaceFieldError,
    validateWorkspaceUpdate: actual.validateWorkspaceUpdate,
    getWorkspace: vi.fn(() => ({ id: 'ws-1' })),
    updateWorkspace: (id: string, input: unknown) => updateWorkspace(id, input),
  };
});

// A folder change sets up the new folder first (src/lib/setups/home-context.ts,
// covered on a real home in src/test/regressions/homes-review.test.ts).
// Like the real one, runs the caller's `finish` as the last step of the change.
const setHomeFolder = vi.fn(async (_id: string, _folder: string, opts?: { finish?: () => unknown }) => {
  await opts?.finish?.();
  return {};
});
vi.mock('@/lib/setups/home-context', () => ({
  setHomeFolder: (...args: Parameters<typeof setHomeFolder>) => setHomeFolder(...args),
}));

const { PATCH } = await import('./route');
const { WorkspaceFieldError } = await import('@/lib/db/queries');

function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/workspaces/ws-1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'ws-1' }) },
  );
}

beforeEach(() => {
  recycleWorkspaceSessions.mockClear();
  recycleAgentMainChats.mockClear();
  updateWorkspace.mockReset().mockImplementation((id: string, input: object) => ({ id, ...input }));
});

describe('PATCH /api/workspaces/:id scope fields', () => {
  it('saves purpose and instructions', async () => {
    const res = await patch({ purpose: 'Ship Ri', instructions: 'Be terse.' });
    expect(res.status).toBe(200);
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { purpose: 'Ship Ri', instructions: 'Be terse.' });
  });

  it('recycles every live session when instructions, the browser or the folder change', async () => {
    for (const body of [{ instructions: 'Be terse.' }, { browserEnabled: false }, { cwd: '/elsewhere' }]) {
      recycleWorkspaceSessions.mockClear();
      await patch(body);
      expect(recycleWorkspaceSessions).toHaveBeenCalledWith('ws-1');
    }
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });

  it("recycles only the agent's main chat for name and purpose, which executions never receive", async () => {
    await patch({ purpose: 'Ship Ri' });
    await patch({ name: 'ri2' });
    expect(recycleAgentMainChats).toHaveBeenCalledTimes(2);
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
  });

  it('recycles nothing for fields no session receives', async () => {
    await patch({ emoji: '🚀' });
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });

  it('turns a validation failure into a 400 with the plain message', async () => {
    updateWorkspace.mockImplementation(() => {
      throw new WorkspaceFieldError('Purpose is 501 characters. The limit is 500.');
    });
    const res = await patch({ purpose: 'p'.repeat(501) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Purpose is 501 characters. The limit is 500.' });
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
  });

  it('still refuses to write connector scopes through the generic PATCH', async () => {
    await patch({ connectorScopes: [{ toolkitId: 'github' }], purpose: 'x' });
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { purpose: 'x' });
  });
});
