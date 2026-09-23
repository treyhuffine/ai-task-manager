import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PATCH /api/workspaces/:id for the agent scope fields
 * (docs/agents-view-spec.md Phase 3). The real query layer validates, so a
 * bad value surfaces as a readable 400. Editing instructions recycles the
 * workspace's live sessions, because instructions are delivered at spawn.
 */

const recycleWorkspaceSessions = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock('@/lib/executor/adapter', () => ({
  recycleWorkspaceSessions: (id: string) => recycleWorkspaceSessions(id),
}));

const updateWorkspace = vi.fn();
vi.mock('@/lib/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/queries')>();
  return {
    WorkspaceFieldError: actual.WorkspaceFieldError,
    getWorkspace: vi.fn(),
    updateWorkspace: (id: string, input: unknown) => updateWorkspace(id, input),
  };
});

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
  updateWorkspace.mockReset().mockImplementation((id: string, input: object) => ({ id, ...input }));
});

describe('PATCH /api/workspaces/:id scope fields', () => {
  it('saves purpose and instructions', async () => {
    const res = await patch({ purpose: 'Ship Ri', instructions: 'Be terse.' });
    expect(res.status).toBe(200);
    expect(updateWorkspace).toHaveBeenCalledWith('ws-1', { purpose: 'Ship Ri', instructions: 'Be terse.' });
  });

  it('recycles live sessions when instructions change, and not for purpose alone', async () => {
    await patch({ purpose: 'Ship Ri' });
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();

    await patch({ instructions: 'Be terse.' });
    expect(recycleWorkspaceSessions).toHaveBeenCalledWith('ws-1');
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
