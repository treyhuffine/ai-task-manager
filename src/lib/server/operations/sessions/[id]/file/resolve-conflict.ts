import { writeAnswerOnOwner } from '@/lib/executor/owner-files';
import { resolveConflictBody } from '@/lib/server/inputs';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { writeFileSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { mapFileError, openSessionWorktree } from "@/lib/workspaces/session-files";
import { resolveWorkspaceConflict } from '@/lib/workspaces/write-file';
import { z as rpcZ } from 'zod/v4';

/**
 * Resolve a merge conflict for a single file from the execution view's
 * conflict resolver. Body: `{ path: string, content: string }` where
 * `content` is the fully-resolved file (no conflict markers). Writes the
 * content and `git add`s the path so git records the conflict as resolved.
 *
 * Separate from `PUT /file` (a bare write, no staging) because staging is
 * exactly what turns "unmerged" into "resolved" — a plain Save must not
 * silently mark a conflict done.
 */
async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as
      | { path?: unknown; content?: unknown }
      | null;

    if (!body || typeof body.path !== 'string' || !body.path) {
      return reply({ error: 'Body must include a path string' }, { status: 400 });
    }
    if (typeof body.content !== 'string') {
      return reply({ error: 'Body must include content string' }, { status: 400 });
    }

    const owner = await writeAnswerOnOwner(id, { kind: 'resolve_conflict', path: body.path, content: body.content });
    if (owner) return answerResult(owner, writeFileSchema);
    const resolved = await openSessionWorktree(id);
    if (!resolved.ok) return failureResponse(resolved.response);

    const result = await resolveWorkspaceConflict(resolved.handle, body.path, body.content);
    return reply({ ok: true, ...result });
  } catch (err) {
    return failureResponse(mapFileError(err, '[POST /api/sessions/:id/file/resolve-conflict]'));
  }
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handlePOST(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: resolveConflictBody }).strict();
