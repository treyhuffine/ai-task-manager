import { markConversationRead } from '@/lib/sessions/view-state';
import { getRequestKey } from '@/lib/auth/request-key';
import { executionOperationFailure } from '@/lib/workspaces/access';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Mark the session as read. Bumps `lastViewedAt = now()` and clears
 * any prior `unreadMarkerAt` (which the "Mark as unread" affordance
 * may have set). Fired by the client on actual interaction with the
 * chat — textarea focus, send, or explicit Mark read.
 *
 * Opening the session no longer hits this endpoint on its own; the
 * change is intentional so a chat that flips into the agent-finished
 * state while the user is looking at it still surfaces as Unread until
 * the user engages.
 *
 * `dismiss` is the person saying they've dealt with it (an explicit Mark as
 * read): it also clears the chat's status line, which otherwise keeps a chat
 * that waits on them unread after a look (docs/chat-status-lines.md). Read
 * receipts from looking never send it.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = markConversationRead(getRequestKey(request.headers), id, true, { dismiss: rpcInput.body.dismiss === true });
    if (!row) return reply({ error: 'Session not found' }, { status: 404 });
    return reply(row);
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/sessions/:id/read]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "dismiss": rpcZ.boolean().optional() }).strict().default({}) }).strict();
