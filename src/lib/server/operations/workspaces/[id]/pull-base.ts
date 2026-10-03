import { getWorkspace } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { pullWorkspaceBase } from '@/lib/workspaces';
import { z as rpcZ } from 'zod/v4';

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
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body: { strategy?: 'merge' | 'rebase' } = rpcInput.body;
    const ws = getWorkspace(id);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return reply({ error: 'Not a git workspace' }, { status: 400 });

    const result = await pullWorkspaceBase(ws, { strategy: body.strategy ?? 'merge' });
    if (!result.ok) {
      return reply(
        { error: result.code, message: result.message },
        { status: result.code === 'dirty_worktree' ? 409 : 500 },
      );
    }
    return reply(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'MergeConflictError') {
      return reply({ error: 'merge_conflict', message }, { status: 409 });
    }
    console.error('[POST /api/workspaces/:id/pull-base]', err);
    return reply({ error: 'error', message }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "strategy": rpcZ.enum(["merge", "rebase"]).optional() }).strict().default({}) }).strict();
