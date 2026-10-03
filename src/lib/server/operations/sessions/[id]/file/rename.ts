import { writeAnswerOnOwner } from '@/lib/executor/owner-files';
import { renameBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { renamePathSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { mapFileError, openSessionWorktree } from "@/lib/workspaces/session-files";
import { renameWorkspacePath } from '@/lib/workspaces/write-file';
import { z as rpcZ } from 'zod/v4';

/**
 * Move/rename a file or directory inside the worktree.
 * POST body: `{ from: string, to: string }`. Refuses to overwrite an
 * existing target — `write-file.ts` raises `exists` (409) so the UI
 * can prompt the user to pick a different name.
 */
async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as
      | { from?: unknown; to?: unknown }
      | null;
    if (!body || typeof body.from !== 'string' || typeof body.to !== 'string') {
      return reply(
        { error: 'Body must be { from: string, to: string }' },
        { status: 400 },
      );
    }

    const owner = await writeAnswerOnOwner(id, { kind: 'rename', from: body.from, to: body.to });
    if (owner) return answerResult(owner, renamePathSchema);
    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return failureResponse(resolved.response);

    const result = await renameWorkspacePath(resolved.handle, body.from, body.to);
    return reply({ ok: true, ...result });
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/sessions/:id/file/rename]'));
  }
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handlePOST(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: renameBody }).strict();
