import { getChatSessionWithExecution } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { retrySetupScript } from '@/lib/sessions/dispatch';
import { z as rpcZ } from 'zod/v4';

/**
 * Re-run the workspace's setup script for a session whose background setup
 * failed (the SetupCard "Retry" button). Fires in the background — the status
 * flips to 'running' immediately and the returned session reflects that.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSessionWithExecution(id);
    if (!session?.executionId) {
      return reply({ error: 'Session not found' }, { status: 404 });
    }
    const ok = retrySetupScript(session.executionId);
    if (!ok) {
      return reply({ error: 'No setup script to run' }, { status: 400 });
    }
    const current = getChatSessionWithExecution(id);
    return current ? reply(current) : reply({ error: 'Session not found' }, { status: 404 });
  } catch (err) {
    console.error('[POST /api/sessions/:id/retry-setup-script]', err);
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: 'retry_failed', message }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
