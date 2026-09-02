import type { NextRequest } from 'next/server';
import { reviewExecutionOutput, completeTask, getExecutionReviewContext } from '@/lib/db/queries';
import { isTaskLifecycleError, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

const DISPOSITIONS = new Set(['accepted', 'changes_requested', 'dismissed']);

/**
 * Record a review disposition against an execution's output event. Reading is
 * NOT review — this is the explicit disposition. Body:
 *   { disposition, outputEventId?, note?, completeTask? }
 * `outputEventId` defaults to the execution's latest output event. When
 * `completeTask` is true and the execution owns exactly one task, that task is
 * completed too (Accept-and-complete).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (!DISPOSITIONS.has(body.disposition)) {
      return Response.json({ error: `Unknown disposition: ${String(body.disposition)}`, code: 'invalid_params' }, { status: 422 });
    }

    const ctx = getExecutionReviewContext(id);
    const outputEventId = typeof body.outputEventId === 'string' ? body.outputEventId : ctx.latestOutputEventId;
    if (!outputEventId) {
      return Response.json({ error: 'No output event to review yet.', code: 'invalid_params' }, { status: 422 });
    }

    const review = reviewExecutionOutput({
      executionId: id,
      outputEventId,
      disposition: body.disposition,
      note: typeof body.note === 'string' ? body.note : null,
      actorSource: 'human',
    });

    let task = null;
    if (body.completeTask === true && body.disposition === 'accepted' && ctx.owningTaskId) {
      const result = completeTask(ctx.owningTaskId, {
        idempotencyKey: `accept-and-complete:${outputEventId}`,
        meta: { source: 'human', executionId: id },
      });
      task = result?.task ?? null;
    }

    return Response.json({ review, task });
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return Response.json({ error: err.message, code: err.code }, { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] });
    }
    console.error('[POST /api/executions/:id/review]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
