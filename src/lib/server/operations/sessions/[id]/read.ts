import { markSessionRead } from '@/lib/db/queries';
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
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = markSessionRead(id);
    if (!row) return reply({ error: 'Session not found' }, { status: 404 });
    return reply(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/read]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
