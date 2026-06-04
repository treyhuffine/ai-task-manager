import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { resolveSessionPr } from '@/lib/github/session-pr';

/**
 * Merge the PR for this session via `@agentex/github`. The caller has
 * already confirmed the user wants to merge (the action bar pops a
 * confirm dialog before POSTing). Body accepts an optional method
 * override; defaults to `squash` because that's by far the most
 * common merge style for short-lived feature branches and produces
 * the cleanest history.
 */
export interface MergeRequestBody {
  method?: 'merge' | 'squash' | 'rebase';
  deleteBranch?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as MergeRequestBody;

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspaceId || !session.branchName) {
      return Response.json(
        { error: 'noWorktree', message: 'No branch on this session.' },
        { status: 400 },
      );
    }

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    const { github, GhCommandError, NotInstalledError, NotAuthenticatedError } =
      await import('@agentex/github');
    const repo = github.repo(ws.cwd);

    // Resolve the same PR the action bar shows — linked prNumber wins, then
    // branch/suffix match — so Merge never acts on a different PR than the one
    // the user is looking at (linked/fork/renamed/duplicate-branch sessions).
    const pr = await resolveSessionPr(repo, session);
    if (!pr || pr.state !== 'OPEN') {
      return Response.json(
        { error: 'no_open_pr', message: 'No open PR for this session.' },
        { status: 404 },
      );
    }

    try {
      await repo.merge(pr.number, {
        method: body.method ?? 'squash',
        deleteBranch: body.deleteBranch ?? true,
      });
      return Response.json({ ok: true, prNumber: pr.number, url: pr.url });
    } catch (err) {
      if (err instanceof NotInstalledError || err instanceof NotAuthenticatedError) {
        return Response.json({ error: err.message }, { status: 412 });
      }
      if (err instanceof GhCommandError) {
        return Response.json(
          { error: 'merge_failed', message: err.message },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err) {
    console.error('[POST /api/sessions/:id/merge]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
