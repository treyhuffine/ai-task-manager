import type { NextRequest } from 'next/server';
import { archiveExecutionSession } from '@/lib/sessions/dispatch';

/**
 * Archive an execution session, including its worktree on disk for git
 * workspaces.
 *
 * Two-step UX:
 *   1. Client POSTs without `force`. If the worktree has uncommitted /
 *      unpushed work, `@agentex/workspace` throws DirtyWorktreeError; we
 *      return 409 with `code: 'dirty_worktree'`.
 *   2. Client confirms with the user, POSTs again with `?force=true` (or
 *      body `{force:true}`). The worktree is force-removed even if dirty.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const queryForce = request.nextUrl.searchParams.get('force') === 'true';
    const body = await request.json().catch(() => ({})) as { force?: boolean };
    const force = queryForce || body.force === true;

    const row = await archiveExecutionSession({ sessionId: id, force });
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    if (err instanceof Error && err.name === 'DirtyWorktreeError') {
      return Response.json(
        { error: 'DirtyWorktreeError', code: 'dirty_worktree', message: err.message },
        { status: 409 },
      );
    }
    console.error('[POST /api/sessions/:id/archive]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
