import type { NextRequest } from 'next/server';
import { reviewExecutionOutput, completeTask, getExecutionReviewContext, getExecutionTasks } from '@/lib/db/queries';
import { isTaskLifecycleError, isTerminal, normalizeTaskStatus, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

const DISPOSITIONS = new Set(['accepted', 'changes_requested', 'dismissed']);

/**
 * Record a review disposition against an execution's exact output event. Reading
 * is NOT review — this is the explicit disposition. Body:
 *   { disposition, outputEventId?, note?, completeTask?, taskId? }
 *
 * Review is execution-level and exact-event-based: accepting output changes no
 * task by itself. Accept-and-complete is a convenience compound command — it
 * names ONE eligible associated task, records the review AND completes just that
 * task, leaves every other associated task unchanged, and keeps the execution
 * running (it never stops or detaches the workstream).
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

    const wantsComplete = body.completeTask === true && body.disposition === 'accepted';

    // Accept-and-complete: resolve and validate the single target task, and
    // guard against completing over newer output — BEFORE recording anything,
    // so a conflict records neither the acceptance nor the completion.
    let targetTaskId: string | null = null;
    if (wantsComplete) {
      const associated = getExecutionTasks(id);
      const eligible = associated.filter((t) => !isTerminal(normalizeTaskStatus(t.status)));
      const explicit = typeof body.taskId === 'string' ? body.taskId : null;
      if (explicit) {
        const match = eligible.find((t) => t.id === explicit);
        if (!match) {
          return Response.json(
            { error: 'That task is not an eligible associated task of this execution.', code: 'invalid_params' },
            { status: 422 },
          );
        }
        targetTaskId = explicit;
      } else if (eligible.length === 1) {
        targetTaskId = eligible[0].id;
      } else {
        return Response.json(
          {
            error: eligible.length === 0
              ? 'This execution has no eligible associated task to complete.'
              : 'This execution has several associated tasks. Name the taskId to complete.',
            code: 'invalid_params',
            eligibleTaskIds: eligible.map((t) => t.id),
          },
          { status: 422 },
        );
      }

      // The accepted event must still be the latest reviewable output — newer
      // output means an unresolved obligation completion would bury.
      if (ctx.latestOutputEventId && ctx.latestOutputEventId !== outputEventId) {
        return Response.json(
          {
            error: 'Newer output arrived after the event you accepted. Review the latest output before completing.',
            code: 'conflict',
          },
          { status: 409 },
        );
      }
    }

    // Complete first, then record the acceptance: a completion conflict records
    // neither half, and the benign residual (task done, acceptance not yet
    // recorded) is preferable to accepted-but-not-done. The execution is never
    // stopped or detached — task lifecycle is independent of the workstream.
    let task = null;
    if (wantsComplete && targetTaskId) {
      const result = completeTask(targetTaskId, {
        idempotencyKey: `accept-and-complete:${outputEventId}:${targetTaskId}`,
        meta: { source: 'human', executionId: id },
      });
      task = result?.task ?? null;
    }

    const review = reviewExecutionOutput({
      executionId: id,
      outputEventId,
      disposition: body.disposition,
      note: typeof body.note === 'string' ? body.note : null,
      actorSource: 'human',
    });

    return Response.json({ review, task });
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return Response.json({ error: err.message, code: err.code, details: err.details }, { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] });
    }
    console.error('[POST /api/executions/:id/review]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
