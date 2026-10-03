import { actorFromRequest } from '@/lib/auth/actor';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { gitOnOwner } from '@/lib/executor/owner-git';
import { reply, type OperationContext } from '@/lib/server/operation';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { openWorktreeHandle } from '@/lib/workspaces';
import { pullUpstreamInto } from '@/lib/workspaces/branch-sync';
import { z as rpcZ } from 'zod/v4';

/**
 * `pullUpstreamInto` — bring in commits pushed to this branch's own remote
 * copy from elsewhere (GitHub's "Update branch", a committed review
 * suggestion, another clone). The git chip offers it when the branch is
 * behind its remote copy with nothing of its own to push. A conflict returns
 * 409 `merge_conflict`, the same as pull-base, so the UI can hand it to the
 * agent.
 */
async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body: { strategy?: 'merge' | 'rebase' } = rpcInput.body;
    const strategy = body.strategy ?? 'merge';

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (session.workspaceId) {
      const there = await gitOnOwner(
        id,
        { op: 'pull_upstream', strategy, workspaceId: session.workspaceId },
        { timeoutMs: 180_000, what: 'Pulling the branch', actor: actorFromRequest(request.headers) },
      );
      if (there) {
        if (there.ok) return reply({ ok: true });
        const failed = (await there.response.json()) as { error: string; message: string };
        if (failed.error === 'merge_conflict') {
          return reply({ error: 'MergeConflictError', code: 'merge_conflict', message: failed.message }, { status: 409 });
        }
        return reply(failed, { status: 409 });
      }
    }
    if (!session.worktreePath || !session.workspaceId) {
      return reply({ error: 'Session has no worktree' }, { status: 400 });
    }
    const ws = getWorkspace(session.workspaceId);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws);
    if (!handle || handle.kind !== 'git') {
      return reply({ error: 'Not a git workspace' }, { status: 400 });
    }

    await pullUpstreamInto(handle, { strategy });
    return reply({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.name === 'MergeConflictError') {
      return reply(
        { error: 'MergeConflictError', code: 'merge_conflict', message: err.message },
        { status: 409 },
      );
    }
    console.error('[POST /api/sessions/:id/pull-upstream]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: name, message }, { status: 400 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'pulling the branch', () => handlePOST(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "strategy": rpcZ.enum(["merge", "rebase"]) }).strict() }).strict();
