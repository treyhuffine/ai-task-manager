import { fileBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { deletePathSchema, fileResponseSchema, writeFileSchema } from '@/lib/server/remote-contracts';
import { agentFolderAnswer, agentFolderWriteAnswer } from '@/lib/workspaces/agent-folder-operations';
import { mapFileError } from '@/lib/workspaces/file-http';
import { z as rpcZ } from 'zod/v4';

/**
 * One file in the agent's own folder, on the device the agent lives on
 * (P3.5), the same surface as `/api/sessions/:id/file`:
 *
 * GET `?path=` (optional `?base=1` for the diff "old" side).
 * PUT `?path=` with `{ content: string }`: upsert, creating parent dirs.
 * DELETE `?path=`: remove the file, or the directory recursively.
 *
 * Writes are the person's, from the Files tab. An archived agent is
 * read-only (409). See `../_folder.ts`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = searchParams(rpcInput.query).get('path');
    if (!relPath) return reply({ error: 'Missing path parameter' }, { status: 400 });
    return answerResult(await agentFolderAnswer(id, { kind: 'file', path: relPath, base: searchParams(rpcInput.query).get('base') === '1' }), fileResponseSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[GET /api/workspaces/:id/file]'));
  }
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = searchParams(rpcInput.query).get('path');
    if (!relPath) return reply({ error: 'Missing path parameter' }, { status: 400 });
    const body = (rpcInput.body) as { content?: unknown } | null;
    if (!body || typeof body.content !== 'string') {
      return reply({ error: 'Body must be { content: string }' }, { status: 400 });
    }
    return answerResult(await agentFolderWriteAnswer(id, { kind: 'write', path: relPath, content: body.content }), writeFileSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[PUT /api/workspaces/:id/file]'));
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = searchParams(rpcInput.query).get('path');
    if (!relPath) return reply({ error: 'Missing path parameter' }, { status: 400 });
    return answerResult(await agentFolderWriteAnswer(id, { kind: 'delete', path: relPath }), deletePathSchema);
  } catch (err) {
    return failureResponse(mapFileError(err, '[DELETE /api/workspaces/:id/file]'));
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "path": rpcZ.string().optional(), "base": rpcZ.string().optional() }).strict().optional() }).strict();
export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "path": rpcZ.string().optional() }).strict().optional(), body: fileBody }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "path": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
