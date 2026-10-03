import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { readAnswerOnOwner } from '@/lib/executor/owner-files';
import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { diffStatsSchema } from '@/lib/server/remote-contracts';
import { readWorktreeDiffStats } from '@/lib/workspaces/diff-stats';
import { z as rpcZ } from 'zod/v4';

/**
 * On-demand diff stats for one execution session. Returns null when the
 * worktree is missing on disk or the session isn't in a git workspace —
 * the row UI uses null to render the "missing" indicator.
 *
 * The rail fetches these in bulk through `POST /api/sessions/diff-stats`;
 * this route stays for single-session callers and keeps the same shape.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    // An execution on a connected device: its worker answers.
    const remote = await readAnswerOnOwner(id, { kind: 'diff_stats' });
    if (remote) return answerResult(remote, diffStatsSchema.nullable());
    if (!session.worktreePath || !session.workspaceId) return reply(null);

    const ws = getWorkspace(session.workspaceId);
    if (!ws?.isGit) return reply(null);

    const stats = await readWorktreeDiffStats({
      worktreePath: session.worktreePath,
      baseBranch: ws.baseBranch,
      baseSha: session.baseSha,
      inPlace: session.worktreePath === ws.cwd,
    });
    return reply(stats);
  } catch (err) {
    console.error('[GET /api/sessions/:id/diff-stats]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
