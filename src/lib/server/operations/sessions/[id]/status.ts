import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { readAnswerOnOwner } from '@/lib/executor/owner-files';
import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { worktreeStatusSchema } from '@/lib/server/remote-contracts';
import { openWorktreeHandle } from '@/lib/workspaces';
import { readGitStatus } from '@/lib/workspaces/execution-reads';
import { z as rpcZ } from 'zod/v4';

/**
 * Worktree status from `@agentex/workspace`'s `ws.git.status()` —
 * untracked / modified / staged file lists plus ahead/behind counts against
 * the upstream — with `sync` saying what that upstream is and how far behind
 * the base the branch is (`readBranchSync`).
 * Returns null for non-git workspaces or when the worktree is missing.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    // An execution on a connected device: its worker answers.
    const remote = await readAnswerOnOwner(id, { kind: 'status' });
    if (remote) return answerResult(remote, worktreeStatusSchema.nullable());
    if (!session.worktreePath || !session.workspaceId) return reply(null);

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return reply(null);

    const handle = await openWorktreeHandle(session, ws);
    if (!handle || handle.kind !== 'git') return reply(null);

    return reply(await readGitStatus(handle, session.worktreePath, ws));
  } catch (err) {
    console.error('[GET /api/sessions/:id/status]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
