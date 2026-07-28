import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { pullWorkspaceBase } from '@/lib/workspaces';

/**
 * Bring the workspace's own checkout up to date with its base branch.
 *
 * Live mode runs the agent in this directory, so "is my code current" is a
 * question about the checkout itself rather than any worktree. Worktree
 * executions get the equivalent via `/sessions/:id/pull-base`.
 *
 * Refuses on a dirty tree rather than merging over uncommitted work — the
 * whole premise of Live is that it's YOUR working directory, and silently
 * merging into it is exactly the kind of thing that loses someone's afternoon.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: { strategy?: 'merge' | 'rebase' } = await request.json().catch(() => ({}));
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return Response.json({ error: 'Not a git workspace' }, { status: 400 });

    const result = await pullWorkspaceBase(ws, { strategy: body.strategy ?? 'merge' });
    if (!result.ok) {
      return Response.json(
        { error: result.code, message: result.message },
        { status: result.code === 'dirty_worktree' ? 409 : 500 },
      );
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'MergeConflictError') {
      return Response.json({ error: 'merge_conflict', message }, { status: 409 });
    }
    console.error('[POST /api/workspaces/:id/pull-base]', err);
    return Response.json({ error: 'error', message }, { status: 500 });
  }
}
