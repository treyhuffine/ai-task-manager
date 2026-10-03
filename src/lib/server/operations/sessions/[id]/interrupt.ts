import { actorFromRequest } from '@/lib/auth/actor';
import * as executor from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * POST /api/sessions/[id]/interrupt
 *
 * Cancels the in-flight agent turn for this chat_session, if any. The
 * underlying provider gets `interrupt()` called on it (typically SIGTERM
 * to the CLI subprocess), which causes the in-flight `send()` to
 * resolve and the dispatcher to clear `runningSessions`. The runtime
 * flip publishes through the realtime bus, so the UI's "stop" button
 * reverts to "send" without a client-driven refetch.
 *
 * Any messages the user had sent before clicking Stop are still in the
 * harness's internal queue and will run as a follow-up turn — Stop
 * kills the current turn only, not the queue. We don't try to hide
 * this; the user-facing behavior matches Conductor and the Claude
 * VS Code extension.
 *
 * Idempotent: a no-op when no turn is running. Returns 200 either way
 * so the client doesn't have to special-case the race where the agent
 * finished naturally between "show stop button" and "click stop."
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    await executor.abort(id, actorFromRequest(request.headers));
    return reply({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/interrupt]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
