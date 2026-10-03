import { resolveConflictBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { writeFileSchema } from '@/lib/server/remote-contracts';
import { agentFolderWriteAnswer } from '@/lib/workspaces/agent-folder-operations';
import { mapFileError } from '@/lib/workspaces/file-http';
import { z as rpcZ } from 'zod/v4';

/**
 * Resolve a merge conflict in the agent's folder, say after a merge in the
 * checkout: write the resolved file and `git add` it so git records the
 * conflict as resolved. Mirrors `/api/sessions/:id/file/resolve-conflict`.
 * POST body: `{ path: string, content: string }`.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { path?: unknown; content?: unknown } | null;
    if (!body || typeof body.path !== 'string' || !body.path) {
      return reply({ error: 'Body must include a path string' }, { status: 400 });
    }
    if (typeof body.content !== 'string') {
      return reply({ error: 'Body must include content string' }, { status: 400 });
    }
    return answerResult(await agentFolderWriteAnswer(id, { kind: 'resolve_conflict', path: body.path, content: body.content }), writeFileSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/workspaces/:id/file/resolve-conflict]'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: resolveConflictBody }).strict();
