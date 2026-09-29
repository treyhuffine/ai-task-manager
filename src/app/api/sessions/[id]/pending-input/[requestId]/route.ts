import type { NextRequest } from 'next/server';
import { actorFromRequest } from '@/lib/auth/actor';
import { answerPrompt, type PromptAnswer } from '@/lib/executor/answer-prompt';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  try {
    const { id, requestId } = await params;
    const body: Partial<PromptAnswer> = await request.json().catch(() => ({}));
    const outcome = answerPrompt(
      id,
      requestId,
      { allow: body.allow ?? false, message: body.message, answers: body.answers },
      actorFromRequest(request.headers),
    );
    if (outcome.ok) return Response.json({ ok: true });
    return Response.json({ error: outcome.error, message: outcome.message }, { status: STATUS[outcome.error] });
  } catch (err) {
    console.error('[POST /api/sessions/:id/pending-input/:requestId]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
