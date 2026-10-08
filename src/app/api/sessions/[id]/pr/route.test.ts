import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ session: vi.fn(), workspace: vi.fn(), getPR: vi.fn(), listPRs: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ getChatSessionWithExecution: mocks.session, getWorkspace: mocks.workspace, insertChatEvent: vi.fn() }));
vi.mock('@/lib/workspaces', () => ({ openWorktreeHandle: vi.fn() }));
vi.mock('@/lib/executor/adapter', () => ({ dispatch: vi.fn() }));
vi.mock('@/lib/executor/prompts/open-pr', () => ({ buildOpenPrPrompt: vi.fn() }));
vi.mock('@/lib/executor/owner-git', () => ({ githubAnswerOnOwner: async (_id: string, request: import('@/lib/github/execution-github').GithubRequest) =>
  (await import('@/lib/github/execution-github')).runGithub('/repo', request) }));
vi.mock('@/lib/github/pr-mergeable', () => ({ getPrStatus: mocks.status }));
vi.mock('@/lib/api/compression', () => ({ withCompression: (handler: unknown) => handler }));
vi.mock('@agentex/github', () => ({
  github: { repo: () => ({ getPR: mocks.getPR, listPRs: mocks.listPRs }) },
  NotInstalledError: class extends Error {}, NotAuthenticatedError: class extends Error {},
  RepoNotFoundError: class extends Error {}, GhCommandError: class extends Error {},
}));

import { GET } from './route';

const sha = 'a'.repeat(40);
const pr = { number: 17, url: 'https://github.com/team/repo/pull/17', state: 'OPEN',
  isDraft: false, headRefName: 'work', baseRefName: 'main', title: 'Work', updatedAt: 'today' };
async function read() {
  const response = await GET(new Request('http://localhost/api/sessions/author/pr') as NextRequest,
    { params: Promise.resolve({ id: 'author' }) });
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ workspaceId: 'workspace', worktreePath: '/repo/work', branchName: 'work', prNumber: 17 });
  mocks.workspace.mockReturnValue({ cwd: '/repo' });
  mocks.getPR.mockResolvedValue(pr);
  mocks.listPRs.mockResolvedValue([pr]);
  mocks.status.mockResolvedValue({ headSha: sha, mergeable: 'MERGEABLE',
    checks: { state: 'passing', total: 1, passed: 1, failed: 0, pending: 0 },
    reviewDecision: null, autoMergeEnabled: false });
});

describe('PR check revision API', () => {
  it('returns the head from the same live status observation as the checks', async () => {
    const body = await read();
    expect(body.pr).toMatchObject({ number: 17, headSha: sha, checks: { state: 'passing' } });
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith('/repo', 17);
  });

  it('returns a null head and check state when the status observation is unavailable', async () => {
    mocks.status.mockResolvedValue({ headSha: null, mergeable: 'UNKNOWN', checks: null,
      reviewDecision: null, autoMergeEnabled: false });
    expect((await read()).pr).toMatchObject({ number: 17, headSha: null, checks: null });
  });

  it('does not claim current check evidence for a closed PR', async () => {
    mocks.getPR.mockResolvedValue({ ...pr, state: 'MERGED' });
    expect((await read()).pr).toMatchObject({ state: 'MERGED', headSha: null, checks: null });
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('keeps branch-discovered PR checks bound to their own observed head', async () => {
    mocks.session.mockReturnValue({ workspaceId: 'workspace', worktreePath: '/repo/work', branchName: 'work', prNumber: null });
    expect((await read()).pr).toMatchObject({ number: 17, headSha: sha, checks: { state: 'passing' } });
    expect(mocks.getPR).not.toHaveBeenCalled();
  });
});
