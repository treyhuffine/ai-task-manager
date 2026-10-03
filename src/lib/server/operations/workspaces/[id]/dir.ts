import { pathBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { createPathSchema, deletePathSchema } from '@/lib/server/remote-contracts';
import { agentFolderWriteAnswer } from '@/lib/workspaces/agent-folder-operations';
import { mapFileError } from '@/lib/workspaces/file-http';
import { z as rpcZ } from 'zod/v4';

/**
 * Directory create and delete for the agent folder's tree. Mirrors
 * `/api/sessions/:id/dir`.
 *
 * POST `{ path: string }`: `mkdir -p`, fine if it already exists.
 * DELETE `?path=`: recursive remove.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { path?: unknown } | null;
    if (!body || typeof body.path !== 'string') {
      return reply({ error: 'Body must be { path: string }' }, { status: 400 });
    }
    return answerResult(await agentFolderWriteAnswer(id, { kind: 'create_dir', path: body.path }), createPathSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/workspaces/:id/dir]'));
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = searchParams(rpcInput.query).get('path');
    if (!relPath) return reply({ error: 'Missing path parameter' }, { status: 400 });
    return answerResult(await agentFolderWriteAnswer(id, { kind: 'delete', path: relPath }), deletePathSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[DELETE /api/workspaces/:id/dir]'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: pathBody }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "path": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
