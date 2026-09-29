import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const getChatSessionWithExecution = vi.fn();
const getWorkspace = vi.fn();
const linkedPullUrl = vi.fn<(cwd: string, prNumber: number) => Promise<string | null>>();

vi.mock('@/lib/db/queries', () => ({
  getChatSessionWithExecution: (id: string) => getChatSessionWithExecution(id),
  getWorkspace: (id: string) => getWorkspace(id),
}));

vi.mock('@/lib/github/remote', () => ({
  linkedPullUrl: (cwd: string, prNumber: number) => linkedPullUrl(cwd, prNumber),
}));

import { GET } from './route';

const call = async (id = 'session-1') => {
  const res = await GET({} as NextRequest, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
};

describe('GET /api/sessions/:id/pr-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockReturnValue({ id: 'ws-1', cwd: '/repos/ri' });
    linkedPullUrl.mockResolvedValue('https://github.com/treyhuffine/ai-task-manager/pull/42');
  });

  it('builds the link from the workspace checkout, with no worktree needed', async () => {
    // Archived or setup-failed: the worktree is gone, the PR is still linked.
    getChatSessionWithExecution.mockReturnValue({ id: 'session-1', workspaceId: 'ws-1', worktreePath: null, prNumber: 42 });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ linked: { number: 42, url: 'https://github.com/treyhuffine/ai-task-manager/pull/42' } });
    expect(linkedPullUrl).toHaveBeenCalledWith('/repos/ri', 42);
  });

  it('is null when no PR is linked, without touching git', async () => {
    getChatSessionWithExecution.mockReturnValue({ id: 'session-1', workspaceId: 'ws-1', prNumber: null });
    expect((await call()).body).toEqual({ linked: null });
    expect(linkedPullUrl).not.toHaveBeenCalled();
  });

  it('is null when origin is not on GitHub', async () => {
    getChatSessionWithExecution.mockReturnValue({ id: 'session-1', workspaceId: 'ws-1', prNumber: 7 });
    linkedPullUrl.mockResolvedValue(null);
    expect((await call()).body).toEqual({ linked: null });
  });

  it('is null without a workspace, and 404s an unknown session', async () => {
    getChatSessionWithExecution.mockReturnValue({ id: 'session-1', workspaceId: null, prNumber: 7 });
    expect((await call()).body).toEqual({ linked: null });
    getChatSessionWithExecution.mockReturnValue(undefined);
    expect((await call('missing')).status).toBe(404);
  });
});
