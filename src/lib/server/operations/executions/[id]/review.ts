import { acceptOutputAndCompleteTask, getExecutionTasks, reviewExecutionOutput } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isTaskLifecycleError, isTerminal, LIFECYCLE_ERROR_HTTP_STATUS, normalizeTaskStatus } from '@/lib/tasks/lifecycle';
import { z as rpcZ } from 'zod/v4';

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
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = rpcInput.body;

    if (!DISPOSITIONS.has(body.disposition)) {
      return reply({ error: `Unknown disposition: ${String(body.disposition)}`, code: 'invalid_params' }, { status: 422 });
    }

    // The exact output event is required — never silently defaulted to "latest",
    // so a review always disposes the event the caller actually saw.
    const outputEventId = typeof body.outputEventId === 'string' ? body.outputEventId : null;
    if (!outputEventId) {
      return reply({ error: 'outputEventId is required (the exact output being reviewed).', code: 'invalid_params' }, { status: 422 });
    }

    const wantsComplete = body.completeTask === true && body.disposition === 'accepted';

    // Accept-and-complete: record the acceptance AND complete one named task in
    // ONE transaction. Resolve the single target task first; the atomic call
    // then re-checks the event is still the latest reviewable output and the
    // task is still eligible, so a conflict records neither half.
    if (wantsComplete) {
      const eligible = getExecutionTasks(id).filter((t) => !isTerminal(normalizeTaskStatus(t.status)));
      const explicit = typeof body.taskId === 'string' ? body.taskId : null;
      let targetTaskId: string;
      if (explicit) {
        if (!eligible.some((t) => t.id === explicit)) {
          return reply({ error: 'That task is not an eligible associated task of this execution.', code: 'invalid_params' }, { status: 422 });
        }
        targetTaskId = explicit;
      } else if (eligible.length === 1) {
        targetTaskId = eligible[0].id;
      } else {
        return reply(
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

      const { review, task } = acceptOutputAndCompleteTask({
        executionId: id,
        outputEventId,
        taskId: targetTaskId,
        note: typeof body.note === 'string' ? body.note : null,
        idempotencyKey: `accept-and-complete:${outputEventId}:${targetTaskId}`,
        actorSource: 'human',
      });
      return reply({ review, task });
    }

    // Plain review disposition (accept / request changes / dismiss) — never
    // changes any task by itself.
    const review = reviewExecutionOutput({
      executionId: id,
      outputEventId,
      disposition: body.disposition,
      note: typeof body.note === 'string' ? body.note : null,
      actorSource: 'human',
    });

    return reply({ review, task: null });
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return reply({ error: err.message, code: err.code, details: err.details }, { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] });
    }
    console.error('[POST /api/executions/:id/review]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "outputEventId": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "disposition": rpcZ.enum(["dismissed", "accepted", "changes_requested"]), "completeTask": rpcZ.boolean().optional(), note: rpcZ.string().optional(), "taskId": rpcZ.string().optional() }).strict() }).strict();
