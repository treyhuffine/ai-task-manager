import { reply, type OperationContext } from '@/lib/server/operation';
import { retryProvisionWorktree } from '@/lib/sessions/dispatch';
import { z as rpcZ } from 'zod/v4';

/**
 * Retry worktree provisioning for a session that failed setup. Triggered
 * from "Try again" on the setup card or the git chip after the user fixes
 * the cause (auth, network, missing remote, etc.). Clears `setupError` up
 * front so the UI flips out of the failed chip immediately; the column is
 * repopulated if the retry itself fails.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = await retryProvisionWorktree(id);
    if (!session) {
      return reply({ error: 'Session not found' }, { status: 404 });
    }
    return reply(session);
  } catch (err) {
    console.error('[POST /api/sessions/:id/retry-setup]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: name, message }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
