import { actorFromRequest } from '@/lib/auth/actor';
import * as executor from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * POST /api/sessions/[id]/tasks/[taskId]/stop
 *
 * Stops a single background task (a backgrounded shell/server or async
 * subagent) for this chat_session without disturbing the session or its other
 * tasks. Forwards to the live `AgentSession.stopTask` (agentex 0.0.22+), which
 * sends the CLI's `stop_task` control request — the harness owns the process
 * and performs the kill; the model is not involved.
 *
 * Returns `{ stopped }`. `stopped: false` is a normal, non-error outcome: no
 * live session, the provider lacks per-task stop, or the task already ended.
 * The task's terminal status arrives asynchronously on the event stream, so the
 * UI updates itself without this response carrying it.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id, taskId } = rpcInput.params;
    const result = await executor.stopTask(id, taskId, actorFromRequest(request.headers));
    return reply(result);
  } catch (err) {
    console.error('[POST /api/sessions/:id/tasks/:taskId/stop]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "taskId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
