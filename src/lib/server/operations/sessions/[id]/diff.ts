import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { readAnswerOnOwner } from '@/lib/executor/owner-files';
import { answerResult, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { structuredDiffSchema } from '@/lib/server/remote-contracts';
import { openWorktreeHandle } from '@/lib/workspaces';
import { z as rpcZ } from 'zod/v4';

/**
 * Structured diff from `@agentex/workspace`'s `ws.git.diff('base')` —
 * file-level + hunks + lines, ready for the slideout to render.
 *
 * Optional `?file=...` filters to a single file's hunks (cheaper for the
 * slideout when the user clicks a single file).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const fileFilter = searchParams(rpcInput.query).get('file');

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    // An execution on a connected device: its worker answers.
    const remote = await readAnswerOnOwner(id, { kind: 'diff', file: fileFilter });
    if (remote) return answerResult(remote, structuredDiffSchema.nullable());
    if (!session.worktreePath || !session.workspaceId) return reply(null);

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return reply(null);

    const handle = await openWorktreeHandle(session, ws);
    if (!handle || handle.kind !== 'git') return reply(null);

    const diff = await handle.git.diff('base');
    if (fileFilter) {
      return reply({
        files: diff.files.filter((f) => f.path === fileFilter),
      });
    }
    return reply(diff);
  } catch (err) {
    console.error('[GET /api/sessions/:id/diff]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "file": rpcZ.string().optional() }).strict().optional() }).strict();
