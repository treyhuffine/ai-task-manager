import type { NextRequest } from 'next/server';
import { transitionTaskForViewer } from '@/lib/tasks/viewer-lifecycle';
import { type RuntimeChoice } from '@/lib/sessions/workstream';
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
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
    const expectedStatusChangedCount = typeof body.expectedStatusChangedCount === 'number' ? body.expectedStatusChangedCount : undefined;
    const acknowledgedChildIds = Array.isArray(body.acknowledgedChildIds) ? body.acknowledgedChildIds : undefined;
    const acknowledgedExecutionIds = Array.isArray(body.acknowledgedExecutionIds) ? body.acknowledgedExecutionIds : undefined;

    const result = await transitionTaskForViewer(id, command, {
      idempotencyKey, expectedStatusChangedCount, acknowledgedChildIds,
      acknowledgedExecutionIds, runtimeChoice: choice,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
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
