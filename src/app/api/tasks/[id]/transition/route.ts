import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { transitionTask, getTask } from '@/lib/db/queries';
import { coordinateLifecycleChange, type RuntimeChoice, type ScopeChange } from '@/lib/sessions/workstream';
import { inProcessWorkstreamRuntime } from '@/lib/sessions/workstream-runtime';
import { isTaskLifecycleError, isTransitionCommand, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

/**
 * Apply a semantic lifecycle transition to a task. The only HTTP path (besides
 * /complete) that changes lifecycle status — generic PATCH cannot. Body:
 *   { command, idempotencyKey?, expectedStatusChangedCount?, reason?, runtimeChoice? }
 *
 * Task lifecycle is independent of execution lifecycle. When Archive or Return
 * to Todo would displace a genuinely running workstream (or Move to Consider is
 * attempted while one runs), the change is coordinated FIRST: an unspecified
 * `runtimeChoice` returns 409 with the running workstreams so the caller can
 * choose keep_running or stop_running_agent.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (!isTransitionCommand(body.command)) {
      return Response.json(
        { error: `Unknown lifecycle command: ${String(body.command)}`, code: 'invalid_transition' },
        { status: 422 },
      );
    }

    const command = body.command;
    const choice: RuntimeChoice | undefined =
      body.runtimeChoice === 'keep_running' || body.runtimeChoice === 'stop_running_agent'
        ? body.runtimeChoice
        : undefined;

    // Coordinate the runtime side before the durable change. Only the commands
    // that displace or uncommit current work need it.
    if (command === 'archive' || command === 'return_to_todo' || command === 'move_to_consider') {
      const task = getTask(id);
      const change: ScopeChange | undefined =
        command === 'archive'
          ? { taskId: id, taskTitle: task?.title ?? '', action: 'archived' }
          : command === 'return_to_todo'
            ? { taskId: id, taskTitle: task?.title ?? '', action: 'returned to Todo' }
            : undefined;
      await coordinateLifecycleChange({
        taskId: id,
        kind: command === 'move_to_consider' ? 'uncommit' : 'displace',
        choice,
        change,
        runtime: inProcessWorkstreamRuntime,
      });
    }

    const result = transitionTask({
      taskId: id,
      command,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : uuidv7(),
      expectedStatusChangedCount: typeof body.expectedStatusChangedCount === 'number' ? body.expectedStatusChangedCount : undefined,
      meta: { source: 'human', reason: typeof body.reason === 'string' ? body.reason : null },
    });

    return Response.json(result);
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return Response.json(
        { error: err.message, code: err.code, details: err.details },
        { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] },
      );
    }
    console.error('[POST /api/tasks/:id/transition]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
