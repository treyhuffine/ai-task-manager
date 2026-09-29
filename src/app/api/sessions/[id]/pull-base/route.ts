import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { gitOnOwner } from '@/lib/executor/owner-git';
import { pullBaseInto } from '@/lib/workspaces/branch-sync';
import { actorFromRequest } from '@/lib/auth/actor';
import { whileAdmitted } from '@/lib/transfer/moving';

/**
 * `pullBaseInto` — fetch the worktree's base branch from its remote and
 * merge (or rebase) it into this worktree. Library
 * throws `MergeConflictError` on conflict; we return 409 with code so the
 * UI can offer "ask agent to resolve."
 */
async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: { strategy?: 'merge' | 'rebase' } = await request.json().catch(() => ({}));
    const strategy = body.strategy ?? 'merge';

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    const ws = session.workspaceId ? getWorkspace(session.workspaceId) : null;
    // On the computer it runs on (P4.5), in order with its other work there.
    if (session.workspaceId) {
      const there = await gitOnOwner(
        id,
        { op: 'pull_base', strategy, workspaceId: session.workspaceId, baseBranch: ws?.baseBranch ?? null },
        { timeoutMs: 180_000, what: 'Bringing in the base branch', actor: actorFromRequest(request.headers) },
      );
      if (there) {
        if (there.ok) return Response.json({ ok: true });
        const failed = (await there.response.json()) as { error: string; message: string };
        if (failed.error === 'merge_conflict') {
          return Response.json({ error: 'MergeConflictError', code: 'merge_conflict', message: failed.message }, { status: 409 });
        }
        return Response.json(failed, { status: 409 });
      }
    }
    if (!session.worktreePath || !session.workspaceId) {
      return Response.json({ error: 'Session has no worktree' }, { status: 400 });
    }
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'Not a git workspace' }, { status: 400 });
    }

    await pullBaseInto(handle, { strategy, baseBranch: ws.baseBranch });
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

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return whileAdmitted(id, 'bringing in the base branch', () => handlePOST(request, context));
}
