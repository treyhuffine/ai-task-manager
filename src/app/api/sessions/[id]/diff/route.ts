import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { withCompression } from '@/lib/api/compression';

/**
 * Structured diff from `@agentex/workspace`'s `ws.git.diff('base')` —
 * file-level + hunks + lines, ready for the slideout to render.
 *
 * Optional `?file=...` filters to a single file's hunks (cheaper for the
 * slideout when the user clicks a single file).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const fileFilter = request.nextUrl.searchParams.get('file');

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.worktreePath || !session.workspaceId) return Response.json(null);

    const ws = getWorkspace(session.workspaceId);
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
