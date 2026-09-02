import type { NextRequest } from 'next/server';
import { reviewExecutionOutput, completeTask, getExecutionReviewContext } from '@/lib/db/queries';
import { reapStoppedExecutions } from '@/lib/sessions/dispatch';
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
      // Do not complete over newer, unreviewed output: if fresh output arrived
      // after the event just accepted, the accepted event is no longer the
      // latest, so completing would silently bury an unresolved obligation.
      // Refuse and let the human review the newer output first.
      const fresh = getExecutionReviewContext(id);
      if (fresh.latestOutputEventId && fresh.latestOutputEventId !== outputEventId) {
        return Response.json(
          {
            error: 'Newer output arrived after the event you accepted. Review the latest output before completing.',
            code: 'conflict',
            review,
          },
          { status: 409 },
        );
      }
      // Accepting an agent's output ends its work, so Accept-and-complete stops
      // the owning execution as part of completing (otherwise the live owning
      // execution would block completion) and reaps its runtime after commit.
      const result = completeTask(ctx.owningTaskId, {
        idempotencyKey: `accept-and-complete:${outputEventId}`,
        stopOwningExecutions: true,
        meta: { source: 'human', executionId: id },
      });
      task = result?.task ?? null;
      if (result) await reapStoppedExecutions(result.stoppedExecutionIds);
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
