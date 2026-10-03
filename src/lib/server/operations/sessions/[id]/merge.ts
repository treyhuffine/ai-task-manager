import { getChatSessionWithExecution, touchSessionActivity } from '@/lib/db/queries';
import { githubAnswerOnOwner } from '@/lib/executor/owner-git';
import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { mergeResponseSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { z as rpcZ } from 'zod/v4';

/**
 * Merge the PR for this session via `@agentex/github`. The caller has
 * already confirmed the user wants to merge (the action bar pops a
 * confirm dialog before POSTing). Body accepts an optional method
 * override; defaults to `squash` because that's by far the most
 * common merge style for short-lived feature branches and produces
 * the cleanest history.
 */
export interface MergeRequestBody {
  method?: 'merge' | 'squash' | 'rebase';
  deleteBranch?: boolean;
}

async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as MergeRequestBody;

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (!session.workspaceId || !session.branchName) {
      return reply(
        { error: 'noWorktree', message: 'No branch on this session.' },
        { status: 400 },
      );
    }

    // In a clone of its repository: the agent's folder here, or on the
    // device the agent lives on (P4.5).
    const res = answerResult(await githubAnswerOnOwner(id, {
      op: 'merge',
      prNumber: session.prNumber,
      branchName: session.branchName,
      method: body.method ?? 'squash',
      deleteBranch: body.deleteBranch ?? true,
    }), mergeResponseSchema);
    if (res.ok) touchSessionActivity(id, 'git');
    return res;
  } catch (err) {
    console.error('[POST /api/sessions/:id/merge]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'merging its pull request', () => handlePOST(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "method": rpcZ.enum(["merge", "squash", "rebase"]).optional(), "deleteBranch": rpcZ.boolean().optional() }).strict().default({}) }).strict();
