import { setSessionPinned } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Unpin this session's execution — clears `pinnedAt`, dropping it out of the
 * rail's "Pinned" group. Symmetric inverse of /pin. Idempotent: unpinning an
 * already-unpinned execution is a no-op that still returns the row.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = setSessionPinned(id, false);
    if (!row) {
      return reply({ error: 'Session not found or not pinnable' }, { status: 404 });
    }
    return reply(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/unpin]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
