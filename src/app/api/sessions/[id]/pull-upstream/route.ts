import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { gitOnOwner } from '@/lib/executor/owner-git';
import { pullUpstreamInto } from '@/lib/workspaces/branch-sync';
import { actorFromRequest } from '@/lib/auth/actor';
import { whileAdmitted } from '@/lib/transfer/moving';

/**
 * `pullUpstreamInto` — bring in commits pushed to this branch's own remote
 * copy from elsewhere (GitHub's "Update branch", a committed review
 * suggestion, another clone). The git chip offers it when the branch is
 * behind its remote copy with nothing of its own to push. A conflict returns
 * 409 `merge_conflict`, the same as pull-base, so the UI can hand it to the
 * agent.
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
    if (session.workspaceId) {
      const there = await gitOnOwner(
        id,
        { op: 'pull_upstream', strategy, workspaceId: session.workspaceId },
        { timeoutMs: 180_000, what: 'Pulling the branch', actor: actorFromRequest(request.headers) },
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
    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'Not a git workspace' }, { status: 400 });
    }

    await pullUpstreamInto(handle, { strategy });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.name === 'MergeConflictError') {
      return Response.json(
        { error: 'MergeConflictError', code: 'merge_conflict', message: err.message },
        { status: 409 },
      );
    }
    console.error('[POST /api/sessions/:id/pull-upstream]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 400 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return whileAdmitted(id, 'pulling the branch', () => handlePOST(request, context));
}
