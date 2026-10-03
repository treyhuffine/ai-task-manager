import { actorFromRequest } from '@/lib/auth/actor';
import { answerPrompt, type PromptAnswer } from '@/lib/executor/answer-prompt';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Resolve a pending permission/question request.
 *
 * For permission requests, the body is `{ allow: boolean, message? }`.
 * For AskUserQuestion, the body is `{ allow, answers }`. `answerPrompt`
 * shapes either for the harness.
 *
 * Idempotency: a duplicate POST with the same requestId returns 410. The
 * UI removes the pending entry on success so a retry would only fire if
 * two clients race to answer the same prompt — fine to surface as
 * "already resolved" rather than silently double-allow.
 *
 * Who answers comes from the request's credentials. An agent (a chat's
 * session credential) can deny a permission or answer a question, but
 * approving a permission is 403: only a person can (P2.6).
 */
const STATUS = { gone: 410, mismatch: 400, human_only: 403 } as const;

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id, requestId } = rpcInput.params;
    const body: Partial<PromptAnswer> = rpcInput.body;
    const outcome = answerPrompt(
      id,
      requestId,
      { allow: body.allow ?? false, message: body.message, answers: body.answers },
      actorFromRequest(request.headers),
    );
    if (outcome.ok) return reply({ ok: true });
    return reply({ error: outcome.error, message: outcome.message }, { status: STATUS[outcome.error] });
  } catch (err) {
    console.error('[POST /api/sessions/:id/pending-input/:requestId]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "requestId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "allow": rpcZ.boolean().optional(), "message": rpcZ.string().optional(), "answers": rpcZ.record(rpcZ.string(), rpcZ.string()).optional() }).strict().default({}) }).strict();
