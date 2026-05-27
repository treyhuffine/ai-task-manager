import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * On-demand diff stats for an execution session. Returns null when the
 * worktree is missing on disk or the session isn't in a git workspace —
 * the row UI uses null to render the "missing" indicator.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.worktree_path || !session.workspace_id) {
      return Response.json(null);
    }
    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json(null);

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') return Response.json(null);

    const stats = await handle.git.shortstat('base');
    return Response.json(stats);
  } catch (err) {
    console.error('[GET /api/sessions/:id/diff-stats]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
