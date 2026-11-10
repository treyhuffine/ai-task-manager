import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { getRequestKey } from '@/lib/auth/request-key';
import { getChatSession, getWorkspace } from '@/lib/db/queries';
import { notOnGithub } from '@/lib/github/execution-github';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * GitHub issues for the chat composer's `@#` menu, which lists them with
 * the pull requests (`prs.ts`), as GitHub's own `#` does. Just what the menu
 * and the chip need: number, title, state, link and last activity.
 *
 * Returns `{ issues: [] }` (never an error) when gh is missing or not signed
 * in, the agent's folder isn't a git repository or isn't on GitHub, or the
 * repository has issues turned off. The menu's empty state reads cleanly and
 * the composer shouldn't be noisy about missing infra.
 */

export interface IssueListItem {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
  updatedAt: string;
}

export interface IssueListResponse {
  issues: IssueListItem[];
  ghStatus?: 'not_installed' | 'not_authenticated';
}

/** gh's refusal for a repository whose Issues tab is turned off. */
function issuesDisabled(err: unknown): boolean {
  return err instanceof Error && err.name === 'GhCommandError' && /disabled issues/i.test(err.message);
}

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    sessionAuthority(getRequestKey(request.headers), id, 'read');
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (!session.workspaceId) return reply({ issues: [] } satisfies IssueListResponse);

    const ws = getWorkspace(session.workspaceId);
    if (!ws || ws.isGit !== true) return reply({ issues: [] } satisfies IssueListResponse);

    // ESM-only, imported when used like the PR routes do.
    const { github, NotInstalledError, NotAuthenticatedError, RepoNotFoundError } = await import('@agentex/github');
    try {
      // Closed ones too, as with PRs: "this came back after #412" is a
      // normal thing to say. The row's icon shows which are still open.
      const all = await github.repo(ws.cwd).listIssues({ state: 'all' });
      const issues: IssueListItem[] = all
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          url: issue.url,
          updatedAt: issue.updatedAt,
        }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return reply({ issues } satisfies IssueListResponse);
    } catch (err) {
      if (err instanceof NotInstalledError) return reply({ issues: [], ghStatus: 'not_installed' } satisfies IssueListResponse);
      if (err instanceof NotAuthenticatedError) return reply({ issues: [], ghStatus: 'not_authenticated' } satisfies IssueListResponse);
      if (err instanceof RepoNotFoundError || notOnGithub(err) || issuesDisabled(err)) {
        return reply({ issues: [] } satisfies IssueListResponse);
      }
      throw err;
    }
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[sessions.issuesGet]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
