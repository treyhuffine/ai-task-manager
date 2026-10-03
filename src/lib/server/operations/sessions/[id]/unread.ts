import { markSessionUnread } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Force the session into the Unread bucket. Sets `unreadMarkerAt = now`
 * so the rail's read derivation flags this row as unread on the next
 * render, even when no new agent outcome has landed. Cleared on the next
 * Mark read / interaction.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = markSessionUnread(id);
    if (!row) return reply({ error: 'Session not found' }, { status: 404 });
    return reply(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/unread]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
