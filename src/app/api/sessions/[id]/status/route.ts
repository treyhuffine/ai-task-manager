import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * Worktree status from `@agentex/workspace`'s `ws.git.status()` —
 * untracked / modified / staged file lists plus ahead/behind counts.
 * Returns null for non-git workspaces or when the worktree is missing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.worktreePath || !session.workspaceId) return Response.json(null);

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json(null);

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') return Response.json(null);

    const status = await handle.git.status();
    return Response.json(status);
  } catch (err) {
    console.error('[GET /api/sessions/:id/status]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
