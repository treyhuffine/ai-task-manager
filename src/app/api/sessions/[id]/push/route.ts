import type { NextRequest } from 'next/server';
import { getChatSession, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * `ws.git.push()` — pushes the current branch to its upstream, setting
 * upstream on first push. The workspace lib throws the raw `execFile`
 * error on rejection, so we sniff stderr for "non-fast-forward" and
 * surface a structured `code: 'non_fast_forward'` so the action bar can
 * transition to the `local_diverged` state and offer Resolve Conflicts.
 */

/** Reads the stderr blob off whatever shape the workspace lib lets through. */
function readStderr(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const raw = (err as { stderr?: unknown }).stderr;
    if (typeof raw === 'string') return raw;
    if (raw instanceof Buffer) return raw.toString();
  }
  return '';
}

function looksLikeNonFastForward(err: unknown): boolean {
  const stderr = readStderr(err).toLowerCase();
  if (stderr.length === 0) return false;
  return (
    stderr.includes('non-fast-forward') ||
    stderr.includes('updates were rejected') ||
    stderr.includes('rejected')
  );
}

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
    if (looksLikeNonFastForward(err)) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: 'NonFastForward', code: 'non_fast_forward', message },
        { status: 409 },
      );
    }
    console.error('[POST /api/sessions/:id/push]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 400 });
  }
}
