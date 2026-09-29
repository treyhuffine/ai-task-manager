import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace, touchSessionActivity } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { looksLikeNonFastForward } from '@/lib/workspaces/git-errors';
import { pushExecutionBranch } from '@/lib/workspaces/branch-sync';
import { gitOnOwner } from '@/lib/executor/owner-git';
import { actorFromRequest } from '@/lib/auth/actor';
import { whileAdmitted } from '@/lib/transfer/moving';

/**
 * `pushExecutionBranch` — pushes the current branch to its upstream,
 * publishing it under its own name on first push. The workspace lib throws the raw `execFile`
 * error on rejection, so we sniff stderr for "non-fast-forward" and
 * surface a structured `code: 'non_fast_forward'` so the action bar can
 * transition to the `localDiverged` state and offer Resolve Conflicts.
 */
async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    // On the computer it runs on (P4.5), in order with its other work there.
    const there = await gitOnOwner(id, { op: 'push', ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}) }, { timeoutMs: 120_000, what: 'Pushing', actor: actorFromRequest(request.headers) });
    if (there) {
      if (!there.ok) {
        const body = (await there.response.json()) as { error: string; message: string };
        if (body.error === 'non_fast_forward') {
          return Response.json({ error: 'NonFastForward', code: 'non_fast_forward', message: body.message }, { status: 409 });
        }
        return Response.json(body, { status: 409 });
      }
      touchSessionActivity(id, 'git');
      return Response.json({ ok: true });
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

    await pushExecutionBranch(handle);
    // Pushing is work on the execution even though it writes no chat event
    // (unlike commit / open-PR / resolve-conflicts, which drive the agent and
    // therefore get their activity bump for free from `insertChatEvent`).
    touchSessionActivity(id, 'git');
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

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return whileAdmitted(id, 'pushing', () => handlePOST(request, context));
}
