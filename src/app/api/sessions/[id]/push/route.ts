import type { NextRequest } from 'next/server';
import { getChatSession, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * `ws.git.push()` — pushes the current branch to its upstream, setting
 * upstream on first push. Library throws on rejected push (non-fast-forward,
 * branch protection, etc.); we surface that to the UI so the user can
 * "ask agent to resolve" if we expose that affordance.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
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

    await handle.git.push();
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/push]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 400 });
  }
}
