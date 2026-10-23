import { pinConversation } from '@/lib/sessions/view-state';
import { getRequestKey } from '@/lib/auth/request-key';
import { executionOperationFailure } from '@/lib/workspaces/access';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Pin this session's execution to the top of the rail's "Pinned" group.
 * Pinning is a transient working-set marker ("keep this reachable while I
 * bounce between things"), not a durable priority — archiving the execution
 * clears it automatically. Idempotent: re-pinning just refreshes the stamp.
 *
 * Keyed by session id (like /archive, /read) so every rail surface, which
 * addresses rows by their primary chat, can drive it without knowing the
 * execution id. Returns the session flattened with the updated execution
 * state so the client can echo `execution.pinnedAt` into its caches.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = pinConversation(getRequestKey(request.headers), id, true);
    if (!row) {
      return reply({ error: 'Session not found or not pinnable' }, { status: 404 });
    }
    return reply(row);
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/sessions/:id/pin]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
