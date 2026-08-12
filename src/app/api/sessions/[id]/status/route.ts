import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { withCompression } from '@/lib/api/compression';

/**
 * Worktree status from `@agentex/workspace`'s `ws.git.status()` —
 * untracked / modified / staged file lists plus ahead/behind counts.
 * Returns null for non-git workspaces or when the worktree is missing.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
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
