import { setSessionPinned } from '@/lib/db/queries';
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
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = setSessionPinned(id, true);
    if (!row) {
      return reply({ error: 'Session not found or not pinnable' }, { status: 404 });
    }
    return reply(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/pin]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
