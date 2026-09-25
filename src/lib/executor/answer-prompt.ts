/**
 * Answer a pending prompt, as the app's answer route and the
 * `answer_pending_input` action both do (P2.6). The harness gets the shape
 * its kind needs, and the actor, from the caller's credentials, decides what
 * may be answered: only a person approves a permission.
 */

import type { UserInputResponse } from '@agentex/agent';
import type { WorkerCommandActor } from '@/db/types';
import { describeSender } from '@/lib/sessions/sender';
import { answerPendingInput } from './adapter';
import { getPending } from './live-state';

export interface PromptAnswer {
  /** True for a permission allow or a question answered, false to deny or decline. */
  allow: boolean;
  /** The reason the agent is shown for a deny. */
  message?: string;
  /** A question's answers, keyed by question text. Ignored for a permission. */
  answers?: Record<string, string>;
}

export type PromptOutcome =
  | { ok: true }
  | { ok: false; error: 'gone' | 'mismatch' | 'human_only'; message: string };

const GONE = { ok: false, error: 'gone', message: 'Request is no longer pending.' } as const;

export function answerPrompt(
  chatSessionId: string,
  requestId: string,
  answer: PromptAnswer,
  actor: WorkerCommandActor,
): PromptOutcome {
  const pending = getPending(requestId);
  if (!pending) return GONE;
  if (pending.sessionId !== chatSessionId) {
    return { ok: false, error: 'mismatch', message: 'Request does not belong to this session.' };
  }

  // Claude's PermissionAllowResultSchema requires `updatedInput` (`record`)
  // on every allow, and PermissionDenyResultSchema requires a non-empty
  // `message` on every deny. Defaulting both here is load-bearing: a missing
  // field gets reported back to the agent as a Zod error, and the agent
  // retries forever. See
  // claude-code/src/utils/permissions/PermissionPromptToolResultSchema.ts.
  const denied: UserInputResponse = {
    allow: false,
    message: answer.message?.trim() || (actor.sessionId ? `Denied by ${describeSender(actor.sessionId)}.` : 'Denied by user.'),
  };
  // A question's answers go back wrapped as `updatedInput.answers`, per the
  // agentex contract. A permission allow passes the original input through
  // (Claude treats an empty record as "use original", but sending it lets a
  // host that logs approvals see the actual call).
  const response: UserInputResponse = !answer.allow
    ? denied
    : pending.kind === 'question'
      ? { allow: true, updatedInput: { ...pending.originalInput, answers: answer.answers ?? {} } }
      : { allow: true, updatedInput: pending.input };

  const result = answerPendingInput(chatSessionId, requestId, response, actor);
  if (result.ok) return { ok: true };
  if (result.refused) return { ok: false, error: 'human_only', message: result.refused };
  return GONE;
}
