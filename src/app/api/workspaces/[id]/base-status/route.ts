import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { getWorkspaceBaseStatus } from '@/lib/workspaces';

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
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return Response.json(null);
    return Response.json(await getWorkspaceBaseStatus(ws));
  } catch (err) {
    console.error('[GET /api/workspaces/:id/base-status]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
