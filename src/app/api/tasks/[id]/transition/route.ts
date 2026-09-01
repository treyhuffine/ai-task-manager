import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { transitionTask } from '@/lib/db/queries';
import { isTaskLifecycleError, isTransitionCommand, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

/**
 * Apply a semantic lifecycle transition to a task. The only HTTP path (besides
 * /complete) that changes lifecycle status — generic PATCH cannot. Body:
 *   { command, idempotencyKey?, expectedStatusChangedCount?, reason? }
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

    const result = transitionTask({
      taskId: id,
      command: body.command,
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
