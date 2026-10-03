import { renameBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { renamePathSchema } from '@/lib/server/remote-contracts';
import { agentFolderWriteAnswer } from '@/lib/workspaces/agent-folder-operations';
import { mapFileError } from '@/lib/workspaces/file-http';
import { z as rpcZ } from 'zod/v4';

/**
 * Move or rename a file or directory in the agent's folder, refusing to
 * overwrite an existing target (409). Mirrors
 * `/api/sessions/:id/file/rename`. POST body: `{ from: string, to: string }`.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { from?: unknown; to?: unknown } | null;
    if (!body || typeof body.from !== 'string' || typeof body.to !== 'string') {
      return reply({ error: 'Body must be { from: string, to: string }' }, { status: 400 });
    }
    return answerResult(await agentFolderWriteAnswer(id, { kind: 'rename', from: body.from, to: body.to }), renamePathSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/workspaces/:id/file/rename]'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: renameBody }).strict();
