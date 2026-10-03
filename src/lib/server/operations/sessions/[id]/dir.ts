import { writeAnswerOnOwner } from '@/lib/executor/owner-files';
import { pathBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { createPathSchema, deletePathSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { mapFileError, openSessionWorktree } from "@/lib/workspaces/session-files";
import {
  createWorkspaceDir,
  deleteWorkspacePath,
} from '@/lib/workspaces/write-file';
import { z as rpcZ } from 'zod/v4';

/**
 * Directory CRUD for the file tree's "New Folder" / "Delete" affordances.
 *
 * POST body: `{ path: string }` — `mkdir -p`. Idempotent vs an existing dir.
 * DELETE `?path=...` — recursive remove (delegates to `deleteWorkspacePath`,
 *   which handles both file and dir kinds; we keep a separate route for
 *   semantic clarity at the call site).
 */
async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { path?: unknown } | null;
    if (!body || typeof body.path !== 'string') {
      return reply({ error: 'Body must be { path: string }' }, { status: 400 });
    }

    const owner = await writeAnswerOnOwner(id, { kind: 'create_dir', path: body.path });
    if (owner) return answerResult(owner, createPathSchema);

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return failureResponse(resolved.response);

    const result = await createWorkspaceDir(resolved.handle, body.path);
    return reply({ ok: true, ...result });
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/sessions/:id/dir]'));
  }
}

async function handleDELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const relPath = request.nextUrl.searchParams.get('path');
    if (!relPath) {
      return reply({ error: 'Missing path parameter' }, { status: 400 });
    }

    const owner = await writeAnswerOnOwner(id, { kind: 'delete', path: relPath });
    if (owner) return answerResult(owner, deletePathSchema);

    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return failureResponse(resolved.response);

    const result = await deleteWorkspacePath(resolved.handle, relPath);
    return reply({ ok: true, ...result });
  } catch (err) {
    return failureResponse(mapFileError(err, '[DELETE /api/sessions/:id/dir]'));
  }
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handlePOST(rpcInput, request));
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handleDELETE(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: pathBody }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ path: rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
