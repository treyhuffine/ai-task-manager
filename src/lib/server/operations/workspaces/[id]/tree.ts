import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { treeResponseSchema } from '@/lib/server/remote-contracts';
import { agentFolderAnswer } from '@/lib/workspaces/agent-folder-operations';
import { z as rpcZ } from 'zod/v4';

/**
 * Flat file list of the agent's own folder, for the agent view's Files tab,
 * from the device the agent lives on (P3.5). Same shape as
 * `/api/sessions/:id/tree`: git folders list tracked and untracked files
 * with status flags, bare folders walk the tree with the heavyweight
 * directories trimmed. Files the agent copies into worktrees (`filesToCopy`,
 * e.g. `.env*`) are surfaced even though git ignores them. A detached HEAD
 * lists without status flags (see `agent-folder-reads.ts`).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return answerResult(await agentFolderAnswer(id, { kind: 'tree' }), treeResponseSchema);
  } catch (err) {
    console.error('[GET /api/workspaces/:id/tree]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
