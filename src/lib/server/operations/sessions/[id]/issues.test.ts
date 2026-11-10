/**
 * `sessions.issuesGet`, the issues the composer's `@#` menu lists with the
 * pull requests. It answers with an empty list, never an error, wherever a
 * repository can't have issues to mention.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class NotInstalledError extends Error {}
  class NotAuthenticatedError extends Error {}
  class RepoNotFoundError extends Error {}
  class GhCommandError extends Error { override name = 'GhCommandError'; }
  return {
    session: vi.fn(), workspace: vi.fn(), listIssues: vi.fn(), authority: vi.fn(),
    NotInstalledError, NotAuthenticatedError, RepoNotFoundError, GhCommandError,
  };
});
vi.mock('@/lib/db/queries', () => ({ getChatSession: mocks.session, getWorkspace: mocks.workspace }));
vi.mock('@/lib/workspaces/access', () => ({ sessionAuthority: mocks.authority, executionOperationFailure: () => null }));
vi.mock('@agentex/github', () => ({
  github: { repo: () => ({ listIssues: mocks.listIssues }) },
  NotInstalledError: mocks.NotInstalledError,
  NotAuthenticatedError: mocks.NotAuthenticatedError,
  RepoNotFoundError: mocks.RepoNotFoundError,
  GhCommandError: mocks.GhCommandError,
}));

import { GET } from './issues';

const get = () => GET({ params: { id: 'chat' } }, { headers: new Headers() } as never);
/** The answer's data, after checking it answered rather than failed. */
async function answer() {
  const result = await get();
  expect(result).toMatchObject({ ok: true, status: 200 });
  return (result as { data: unknown }).data;
}
const issue = (number: number, updatedAt: string, state = 'OPEN') => ({
  number, title: `Issue ${number}`, state, url: `https://github.com/o/r/issues/${number}`,
  author: { login: 'someone' }, labels: [{ name: 'bug' }], assignees: [], createdAt: '2026-01-01T00:00:00Z', updatedAt,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ id: 'chat', workspaceId: 'ws' });
  mocks.workspace.mockReturnValue({ id: 'ws', cwd: '/repo', isGit: true });
});

it('lists open and closed issues, newest activity first, with only what the menu and chip need', async () => {
  mocks.listIssues.mockResolvedValue([issue(3, '2026-10-01T00:00:00Z'), issue(9, '2026-10-05T00:00:00Z', 'CLOSED')]);
  expect(await answer()).toEqual({
    issues: [
      { number: 9, title: 'Issue 9', state: 'CLOSED', url: 'https://github.com/o/r/issues/9', updatedAt: '2026-10-05T00:00:00Z' },
      { number: 3, title: 'Issue 3', state: 'OPEN', url: 'https://github.com/o/r/issues/3', updatedAt: '2026-10-01T00:00:00Z' },
    ],
  });
  expect(mocks.listIssues).toHaveBeenCalledWith({ state: 'all' });
  // Only someone who may read the chat may list its repository's issues.
  expect(mocks.authority.mock.calls[0]?.slice(1)).toEqual(['chat', 'read']);
});

it('answers empty, without asking GitHub, for a chat whose agent folder is not a git repository', async () => {
  mocks.workspace.mockReturnValue({ id: 'ws', cwd: '/notes', isGit: false });
  expect(await answer()).toEqual({ issues: [] });
  expect(mocks.listIssues).not.toHaveBeenCalled();
});

it('says when gh is missing or signed out, so the menu stays quiet rather than failing', async () => {
  mocks.listIssues.mockRejectedValue(new mocks.NotInstalledError());
  expect(await answer()).toEqual({ issues: [], ghStatus: 'not_installed' });
  mocks.listIssues.mockRejectedValue(new mocks.NotAuthenticatedError());
  expect(await answer()).toEqual({ issues: [], ghStatus: 'not_authenticated' });
});

it('answers empty for a repository with issues turned off, or one not on GitHub', async () => {
  // gh's own words for a fork whose Issues tab is off.
  mocks.listIssues.mockRejectedValue(new mocks.GhCommandError("gh issue list --state all: exit 1 — the 'o/r' repository has disabled issues"));
  expect(await answer()).toEqual({ issues: [] });
  mocks.listIssues.mockRejectedValue(new mocks.RepoNotFoundError());
  expect(await answer()).toEqual({ issues: [] });
  mocks.listIssues.mockRejectedValue(new mocks.GhCommandError('gh issue list: exit 1 — no git remotes found'));
  expect(await answer()).toEqual({ issues: [] });
});

it('fails loudly on anything else, like a rate limit', async () => {
  mocks.listIssues.mockRejectedValue(new Error('API rate limit exceeded'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await get()).toMatchObject({ ok: false, status: 500 });
});
