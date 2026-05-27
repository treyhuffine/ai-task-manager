import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * Structured diff from `@agentex/workspace`'s `ws.git.diff('base')` —
 * file-level + hunks + lines, ready for the slideout to render.
 *
 * Optional `?file=...` filters to a single file's hunks (cheaper for the
 * slideout when the user clicks a single file).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const fileFilter = request.nextUrl.searchParams.get('file');

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.worktree_path || !session.workspace_id) return Response.json(null);

    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json(null);

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') return Response.json(null);

    const diff = await handle.git.diff('base');
    if (fileFilter) {
      return Response.json({
        files: diff.files.filter((f) => f.path === fileFilter),
      });
    }
    return Response.json(diff);
  } catch (err) {
    console.error('[GET /api/sessions/:id/diff]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
