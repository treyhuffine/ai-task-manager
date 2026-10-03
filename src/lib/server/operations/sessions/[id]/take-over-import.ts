import { takeOverImportedSession } from '@/lib/import/external-agents';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Flip an imported chat from read-only mirror to live, pointing it at the
 * provider session it was imported from so the next send resumes that thread
 * instead of forking a blank one.
 *
 * User-initiated by design. The composer stays disabled until this runs,
 * because resuming a session the user may still have open in a terminal puts
 * two writers on one transcript, and that is a decision to make knowingly
 * rather than discover afterwards.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return reply({ ok: true, ...takeOverImportedSession(id) });
  } catch (err) {
    console.error('[POST /api/sessions/:id/take-over-import]', err);
    return reply(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
