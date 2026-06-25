import type { NextRequest } from 'next/server';
import * as executor from '@/lib/executor/adapter';

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
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  try {
    const { id, taskId } = await params;
    const result = await executor.stopTask(id, taskId);
    return Response.json(result);
  } catch (err) {
    console.error('[POST /api/sessions/:id/tasks/:taskId/stop]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
