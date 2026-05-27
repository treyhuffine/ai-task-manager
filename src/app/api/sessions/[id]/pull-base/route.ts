import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * `ws.git.pullLatestBase({strategy})` — fetch the workspace's base
 * branch from origin and merge (or rebase) it into this worktree. Library
 * throws `MergeConflictError` on conflict; we return 409 with code so the
 * UI can offer "ask agent to resolve."
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: { strategy?: 'merge' | 'rebase' } = await request.json().catch(() => ({}));
    const strategy = body.strategy ?? 'merge';

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.worktree_path || !session.workspace_id) {
      return Response.json({ error: 'Session has no worktree' }, { status: 400 });
    }
    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'Not a git workspace' }, { status: 400 });
    }

    await handle.git.pullLatestBase({ strategy });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.name === 'MergeConflictError') {
      return Response.json(
        { error: 'MergeConflictError', code: 'merge_conflict', message: err.message },
        { status: 409 },
      );
    }
    console.error('[POST /api/sessions/:id/pull-base]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 400 });
  }
}
