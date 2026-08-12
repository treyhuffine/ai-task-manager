import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { readWorktreeDiffStats } from '@/lib/workspaces/diff-stats';
import { withCompression } from '@/lib/api/compression';

/**
 * On-demand diff stats for one execution session. Returns null when the
 * worktree is missing on disk or the session isn't in a git workspace —
 * the row UI uses null to render the "missing" indicator.
 *
 * The rail fetches these in bulk through `POST /api/sessions/diff-stats`;
 * this route stays for single-session callers and keeps the same shape.
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
    if (!ws?.isGit) return Response.json(null);

    const stats = await readWorktreeDiffStats({
      worktreePath: session.worktreePath,
      baseBranch: ws.baseBranch,
      baseSha: session.baseSha,
      inPlace: session.worktreePath === ws.cwd,
    });
    return Response.json(stats);
  } catch (err) {
    console.error('[GET /api/sessions/:id/diff-stats]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
