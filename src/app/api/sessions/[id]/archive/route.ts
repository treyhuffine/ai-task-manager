import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { archiveExecutionSession, RemoteDirtyWorktreeError } from '@/lib/sessions/dispatch';
import { uncommittedFilesOf, type DirtyWorktreeBody } from '@/lib/workspaces/uncommitted-files';

/**
 * Archive an execution session, including its worktree on disk for git
 * workspaces.
 *
 * Two-step UX:
 *   1. Client POSTs without `force`. A clean worktree is archived on the
 *      spot (commits that aren't pushed count as clean: the branch keeps
 *      them). If it has untracked or changed files, `@agentex/workspace`
 *      throws DirtyWorktreeError and we return 409 with
 *      `code: 'dirty_worktree'` and the files that would be lost.
 *   2. The client shows those files. If the person goes ahead, it POSTs
 *      again with `?force=true` (or body `{force:true}`) and the worktree
 *      is force-removed, files and all.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const queryForce = request.nextUrl.searchParams.get('force') === 'true';
    const body = await request.json().catch(() => ({})) as { force?: boolean };
    const force = queryForce || body.force === true;

    const row = await archiveExecutionSession({ sessionId: id, force });
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    if (err instanceof Error && err.name === 'ExecutionMovingError') {
      return Response.json({ error: 'moving', code: 'moving', message: err.message }, { status: 409 });
    }
    if (err instanceof Error && err.name === 'DirtyWorktreeError') {
      const session = getChatSessionWithExecution(id);
      const list = err instanceof RemoteDirtyWorktreeError ? err.list : uncommittedFilesOf(err);
      const dirty: DirtyWorktreeBody = {
        error: 'DirtyWorktreeError',
        code: 'dirty_worktree',
        message: err.message,
        label: session?.execution?.label ?? session?.label ?? null,
        files: list?.files ?? null,
        omitted: list?.omitted ?? 0,
      };
      return Response.json(dirty, { status: 409 });
    }
    console.error('[POST /api/sessions/:id/archive]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
