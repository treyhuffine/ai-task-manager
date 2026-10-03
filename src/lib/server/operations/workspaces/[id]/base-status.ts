import { getWorkspace } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { getWorkspaceBaseStatus } from '@/lib/workspaces';
import { z as rpcZ } from 'zod/v4';

/**
 * How far the workspace's own checkout is behind its base branch.
 *
 * Distinct from `/sessions/:id/status`, which reports a worktree. This is the
 * *source* checkout — the thing Live mode runs in — and there is no session to
 * hang it off when the launcher asks.
 *
 * Fetches before counting. Git's ahead/behind is measured against the local
 * remote-tracking ref, so without a fetch a stale clone cheerfully reports
 * "0 behind" while upstream has moved. An unfetched answer here would be worse
 * than none, since the whole point is telling the user whether they're current.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const ws = getWorkspace(id);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return reply(null);
    return reply(await getWorkspaceBaseStatus(ws));
  } catch (err) {
    console.error('[GET /api/workspaces/:id/base-status]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
