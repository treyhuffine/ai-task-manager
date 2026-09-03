import type { NextRequest } from 'next/server';
import { completeTask, getTask, lifecyclePreflight } from '@/lib/db/queries';
import { coordinateLifecycleChange, type RuntimeChoice } from '@/lib/sessions/workstream';
import { inProcessWorkstreamRuntime } from '@/lib/sessions/workstream-runtime';
import { isTaskLifecycleError, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const choice: RuntimeChoice | undefined =
      body.runtimeChoice === 'keep_running' || body.runtimeChoice === 'stop_running_agent'
        ? body.runtimeChoice
        : undefined;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
    const expectedStatusChangedCount = typeof body.expectedStatusChangedCount === 'number' ? body.expectedStatusChangedCount : undefined;
    const acknowledgedChildIds = Array.isArray(body.acknowledgedChildIds) ? body.acknowledgedChildIds : undefined;
    const acknowledgedExecutionIds = Array.isArray(body.acknowledgedExecutionIds) ? body.acknowledgedExecutionIds : undefined;

    const task = getTask(id);
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    // Validate completion CAN apply (revision, replay, open children) BEFORE
    // coordinating a genuinely running workstream, so a rejected completion
    // never stops an agent. A replay skips coordination.
    const pre = lifecyclePreflight({ taskId: id, command: 'complete', idempotencyKey, expectedStatusChangedCount, acknowledgedChildIds });
    if (!pre.replay) {
      await coordinateLifecycleChange({
        taskId: id,
        kind: 'displace',
        choice,
        change: { taskId: id, taskTitle: task.title ?? '', action: 'completed' },
        acknowledgedExecutionIds,
        runtime: inProcessWorkstreamRuntime,
      });
    }

    const result = completeTask(id, {
      note: body.note,
      idempotencyKey,
      expectedStatusChangedCount,
      acknowledgedChildIds,
      meta: { source: 'human' },
    });

    if (!result) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    return Response.json(result);
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return Response.json({ error: err.message, code: err.code, details: err.details }, { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] });
    }
    console.error('[POST /api/tasks/:id/complete]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
