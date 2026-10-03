import { pathBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { createPathSchema } from '@/lib/server/remote-contracts';
import { agentFolderWriteAnswer } from '@/lib/workspaces/agent-folder-operations';
import { mapFileError } from '@/lib/workspaces/file-http';
import { z as rpcZ } from 'zod/v4';

/**
 * Create an empty file in the agent's folder, refusing to overwrite (409),
 * so the tree's "New File" can report a name collision. Mirrors
 * `/api/sessions/:id/file/create`. POST body: `{ path: string }`.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { path?: unknown } | null;
    if (!body || typeof body.path !== 'string') {
      return reply({ error: 'Body must be { path: string }' }, { status: 400 });
    }
    return answerResult(await agentFolderWriteAnswer(id, { kind: 'create_file', path: body.path }), createPathSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/workspaces/:id/file/create]'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: pathBody }).strict();
