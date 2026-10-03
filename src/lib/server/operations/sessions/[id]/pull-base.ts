import { actorFromRequest } from '@/lib/auth/actor';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { gitOnOwner } from '@/lib/executor/owner-git';
import { reply, type OperationContext } from '@/lib/server/operation';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { openWorktreeHandle } from '@/lib/workspaces';
import { pullBaseInto } from '@/lib/workspaces/branch-sync';
import { z as rpcZ } from 'zod/v4';

/**
 * `pullBaseInto` — fetch the worktree's base branch from its remote and
 * merge (or rebase) it into this worktree. Library
 * throws `MergeConflictError` on conflict; we return 409 with code so the
 * UI can offer "ask agent to resolve."
 */
async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body: { strategy?: 'merge' | 'rebase' } = rpcInput.body;
    const strategy = body.strategy ?? 'merge';

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    const ws = session.workspaceId ? getWorkspace(session.workspaceId) : null;
    // On the device it runs on (P4.5), in order with its other work there.
    if (session.workspaceId) {
      const there = await gitOnOwner(
        id,
        { op: 'pull_base', strategy, workspaceId: session.workspaceId, baseBranch: ws?.baseBranch ?? null },
        { timeoutMs: 180_000, what: 'Bringing in the base branch', actor: actorFromRequest(request.headers) },
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
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws);
    if (!handle || handle.kind !== 'git') {
      return reply({ error: 'Not a git workspace' }, { status: 400 });
    }

    await pullBaseInto(handle, { strategy, baseBranch: ws.baseBranch });
    return reply({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.name === 'MergeConflictError') {
      return reply(
        { error: 'MergeConflictError', code: 'merge_conflict', message: err.message },
        { status: 409 },
      );
    }
    console.error('[POST /api/sessions/:id/pull-base]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: name, message }, { status: 400 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'bringing in the base branch', () => handlePOST(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "strategy": rpcZ.enum(["merge", "rebase"]).optional() }).strict() }).strict();
