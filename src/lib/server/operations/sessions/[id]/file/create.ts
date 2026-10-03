import { writeAnswerOnOwner } from '@/lib/executor/owner-files';
import { pathBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { createPathSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { mapFileError, openSessionWorktree } from "@/lib/workspaces/session-files";
import { createWorkspaceFile } from '@/lib/workspaces/write-file';
import { z as rpcZ } from 'zod/v4';

/**
 * Create an empty file at the given path. Distinct from PUT (upsert):
 * this one refuses to overwrite, so the tree's "New File" affordance
 * can surface a name-collision error instead of silently clobbering an
 * existing file the user forgot about.
 *
 * POST body: `{ path: string }`.
 */
async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { path?: unknown } | null;
    if (!body || typeof body.path !== 'string') {
      return reply({ error: 'Body must be { path: string }' }, { status: 400 });
    }

    const owner = await writeAnswerOnOwner(id, { kind: 'create_file', path: body.path });
    if (owner) return answerResult(owner, createPathSchema);
    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return failureResponse(resolved.response);

    const result = await createWorkspaceFile(resolved.handle, body.path);
    return reply({ ok: true, ...result });
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/sessions/:id/file/create]'));
  }
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handlePOST(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: pathBody }).strict();
