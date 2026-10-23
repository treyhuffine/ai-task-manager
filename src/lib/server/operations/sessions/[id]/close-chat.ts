import { closeExecutionChat } from '@/lib/sessions/close-chat';

import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';


/**
 * Close (archive) ONE chat of an execution — the X on the chat tab strip.
 * The chat's harness process is torn down and the row flips to archived.
 * The execution, its worktree, and every sibling chat stay untouched:
 * this is "close the conversation", not "archive the execution" (that's
 * `POST /api/sessions/:id/archive`).
 *
 * Refuses to close the execution's last open chat (409 `last_chat`) — an
 * execution with zero open chats has no surface left to talk to it
 * through, and the rail's one-row-per-execution read keys off the most
 * recently active open chat. The tab strip mirrors this by hiding the X
 * on a lone tab.
 *
 * Idempotent: closing an already-archived chat is a no-op success, so a
 * double-click or a raced retry can't error.
 *
 * A closed chat isn't gone — it moves to the strip's "older" chip and the
 * history dropdown. Navigating back to it reactivates it (the view's
 * auto-resume + `continueExecutionSession`'s sibling-resume path).
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    sessionAuthority(getRequestKey(request.headers), id, 'archive');
    const outcome = await closeExecutionChat(id);
    return 'error' in outcome ? reply({ error: outcome.error, message: outcome.message }, { status: outcome.status }) : reply(outcome);
  } catch (error) {
    const denied = executionOperationFailure(error);
    if (denied) return denied;
    throw error;
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
