import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { readAnswerOnOwner } from '@/lib/executor/owner-files';
import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { treeResponseSchema } from '@/lib/server/remote-contracts';
import { openWorktreeHandle } from '@/lib/workspaces';
import { listTree, type TreeEntry } from '@/lib/workspaces/list-tree';
import { z as rpcZ } from 'zod/v4';

/**
 * Flat list of the worktree's tracked + untracked files for the file
 * tree in the execution workbench's Files view. Status flags are layered in for
 * changed files; everything else is bare path + name.
 *
 * Non-git workspaces fall back to a `ws.tree()` walk with the common
 * heavyweight directories (`node_modules`, `.next`, …) trimmed out.
 *
 * Returns `{ entries: [] }` when there's no worktree (settings-up or
 * non-git workspace without a path) so the client can render an empty
 * state instead of error.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    // An execution on a connected device: its worker reads its worktree.
    const remote = await readAnswerOnOwner(id, { kind: 'tree' });
    if (remote) return answerResult(remote, treeResponseSchema);
    if (!session.workspaceId) return reply({ entries: [] satisfies TreeEntry[] });

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return reply({ entries: [] satisfies TreeEntry[] });

    // No worktree yet (worktree provisioning in flight) — return empty.
    if (!session.worktreePath) return reply({ entries: [] satisfies TreeEntry[] });

    const handle = await openWorktreeHandle(session, ws);
    if (!handle) return reply({ entries: [] satisfies TreeEntry[] });

    // Surface the workspace's copied-in ignored files (e.g. `.env*`) alongside
    // the tracked tree — they're hidden by `.gitignore` but put there on purpose.
    const entries = await listTree(handle, ws.filesToCopy ?? []);
    return reply({ entries });
  } catch (err) {
    console.error('[GET /api/sessions/:id/tree]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
