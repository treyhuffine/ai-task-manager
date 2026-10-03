import { getChatSessionWithExecution } from '@/lib/db/queries';
import { githubAnswerOnOwner } from '@/lib/executor/owner-git';
import type { MergeMethod } from '@/lib/github/auto-merge';
import { MERGE_METHODS } from '@/lib/github/execution-github';
import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { autoMergeResponseSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { z as rpcZ } from 'zod/v4';

/**
 * Enable or disable GitHub auto-merge ("merge when ready") for this
 * session's PR. Enabling runs a GraphQL preflight first so we return a
 * precise reason (409) instead of a raw gh error when the repo or PR
 * doesn't allow it.
 */
export interface AutoMergeRequestBody {
  enable: boolean;
  method?: MergeMethod;
}

async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { enable?: unknown; method?: unknown };
    // Reject malformed input rather than silently coercing it: `{enable:"true"}`
    // must not disable, and a bogus `method` must not fall through to squash.
    if (typeof body.enable !== 'boolean') {
      return reply(
        { error: 'invalid_request', message: 'enable must be a boolean' },
        { status: 400 },
      );
    }
    if (
      body.method !== undefined &&
      !(typeof body.method === 'string' && MERGE_METHODS.includes(body.method as MergeMethod))
    ) {
      return reply(
        { error: 'invalid_request', message: 'method must be one of: squash, merge, rebase' },
        { status: 400 },
      );
    }
    const enable = body.enable;
    const requestedMethod = body.method as MergeMethod | undefined;

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
    return answerResult(await githubAnswerOnOwner(id, {
      op: 'auto_merge',
      prNumber: session.prNumber,
      branchName: session.branchName,
      enable,
      method: requestedMethod,
    }), autoMergeResponseSchema);
  } catch (err) {
    console.error('[POST /api/sessions/:id/auto-merge]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing auto-merge', () => handlePOST(rpcInput, request));
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "enable": rpcZ.boolean(), "method": rpcZ.enum(["merge", "squash", "rebase"]).optional() }).strict() }).strict();
