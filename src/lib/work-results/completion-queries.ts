/** Exact saved-result acceptance composed with the existing task lifecycle. */
import { and, eq } from 'drizzle-orm';
import { getDb, getRawDb } from '@/lib/db';
import { workResultDecisions, taskStatusChanges } from '@/lib/db/schema';
import { hydrateRow } from '@/lib/db/hydrate';
import { completeTask, getTask, lifecyclePreflight, type LifecycleOutcome } from '@/lib/db/queries';
import type { WorkResultActor, WorkResultCodeRevision, WorkResultDecisionRecord, TaskRecord } from '@/db/types';
import { canApply, normalizeTaskStatus } from '@/lib/tasks/lifecycle';
import { ActionError } from '@/lib/orchestrator/types';
import type { RuntimeChoice } from '@/lib/sessions/workstream';
import { assertHandoffsEnabled } from './capabilities';
import { getWorkResult, workResultIntentHash, workResultRequestScopedId } from './queries';

export interface AcceptWorkResultAndCompleteInput {
  requestId: string;
  resultId: string;
  /** Omission is allowed only when exactly one linked task can be completed. */
  taskId?: string;
  expectedStatusChangedCount: TaskRecord['statusChangedCount'];
  note?: string;
  acknowledgedChildIds?: string[];
  runtimeChoice?: RuntimeChoice;
  acknowledgedExecutionIds?: string[];
}

export type WorkResultCompletionChoice = Pick<TaskRecord, 'id' | 'title' | 'status' | 'statusChangedCount' | 'recurrence'>;
export interface WorkResultCompletionOptions {
  choices: WorkResultCompletionChoice[];
  completedTaskIds: TaskRecord['id'][];
  staleReason: 'superseded' | 'revision_mismatch' | null;
  codeFreshness: 'matching' | 'mismatched' | 'unknown' | 'not_code';
}

export interface WorkResultCompletionOutcome {
  review: WorkResultDecisionRecord;
  /** Removed tasks leave the durable acceptance intact, without another completion. */
  completion: LifecycleOutcome | null;
  taskId: TaskRecord['id'] | null;
  replayed: boolean;
}

function transaction<T>(work: () => T): T {
  return getRawDb().inTransaction ? work() : getDb().transaction(work, { behavior: 'immediate' });
}

function assertHuman(actor: WorkResultActor): void {
  if (actor.userId !== 'local') throw new ActionError('not_found', 'This result is unavailable in the current authority.');
  if (actor.source !== 'human' || actor.sessionId) throw new ActionError('unsupported', 'Accept and complete requires the human owner.');
}

/** Unknown working-copy identity is never promoted to exact freshness. */
function codeFreshness(saved: WorkResultCodeRevision | null, current?: WorkResultCodeRevision | null): WorkResultCompletionOptions['codeFreshness'] {
  if (!saved) return 'not_code';
  if (!current) return 'unknown';
  if (saved.commitSha && current.commitSha && saved.commitSha !== current.commitSha) return 'mismatched';
  if (saved.checkpointRef && current.checkpointRef && saved.checkpointRef !== current.checkpointRef) return 'mismatched';
  if (saved.workingTreeState !== 'unknown' && current.workingTreeState !== 'unknown'
    && saved.workingTreeState !== current.workingTreeState) return 'mismatched';
  if (saved.checkpointRef && saved.checkpointRef === current.checkpointRef) return 'matching';
  if (saved.workingTreeState === 'clean' && current.workingTreeState === 'clean'
    && saved.commitSha && saved.commitSha === current.commitSha) return 'matching';
  return 'unknown';
}

export function getWorkResultCompletionOptions(resultId: string, userId = 'local', current?: WorkResultCodeRevision | null): WorkResultCompletionOptions {
  const detail = getWorkResult(resultId, userId);
  if (!detail) throw new ActionError('not_found', 'Result not found.');
  const freshness = codeFreshness(detail.result.codeRevision, current);
  const completedTaskIds = getDb().select({ taskId: taskStatusChanges.taskId }).from(taskStatusChanges)
    .where(and(eq(taskStatusChanges.command, 'complete'), eq(taskStatusChanges.actorSource, 'human'),
      eq(taskStatusChanges.reason, `Accepted saved result ${resultId}`))).all().map((row) => row.taskId);
  const choices = detail.reviewTargetId ? [] : detail.taskIds.flatMap((id) => {
    const task = getTask(id);
    if (!task || completedTaskIds.includes(id) || !canApply('complete', normalizeTaskStatus(task.status))) return [];
    return [{ id: task.id, title: task.title, status: task.status,
      statusChangedCount: task.statusChangedCount, recurrence: task.recurrence }];
  });
  return { choices, completedTaskIds, staleReason: detail.successor ? 'superseded' : freshness === 'mismatched' ? 'revision_mismatch' : null,
    codeFreshness: freshness };
}

function intent(input: AcceptWorkResultAndCompleteInput) {
  return { ...input,
    acknowledgedChildIds: input.acknowledgedChildIds && [...new Set(input.acknowledgedChildIds)].sort(),
    acknowledgedExecutionIds: input.acknowledgedExecutionIds && [...new Set(input.acknowledgedExecutionIds)].sort(),
  };
}

function committed(actor: WorkResultActor, input: AcceptWorkResultAndCompleteInput): WorkResultCompletionOutcome | null {
  const key = workResultRequestScopedId('result_completion', actor, input.requestId);
  const stored = getDb().select().from(workResultDecisions).where(and(eq(workResultDecisions.id, key), eq(workResultDecisions.userId, actor.userId))).get();
  if (!stored) return null;
  if (stored.requestHash !== workResultIntentHash(intent(input))) {
    throw new ActionError('conflict', 'This request_id already accepted and completed different work. Use a new request_id for a changed decision.');
  }
  const prior = getDb().select().from(taskStatusChanges).where(and(eq(taskStatusChanges.idempotencyKey, key), eq(taskStatusChanges.command, 'complete'))).get();
  const task = prior ? getTask(prior.taskId) : null;
  const completion: LifecycleOutcome | null = prior && task ? {
    task, fromStatus: normalizeTaskStatus(prior.result.fromStatus), toStatus: normalizeTaskStatus(prior.result.toStatus),
    statusChangedCount: prior.result.statusChangedCount, recurring: prior.result.recurring,
    nextRecurrenceAt: prior.result.nextRecurrenceAt ?? null, replayed: true,
  } : null;
  return { review: hydrateRow(stored), completion, taskId: prior?.taskId ?? input.taskId ?? null, replayed: true };
}

/** Reusable before runtime coordination and again inside the authoritative write. */
export function preflightWorkResultCompletion(actor: WorkResultActor, input: AcceptWorkResultAndCompleteInput, current?: WorkResultCodeRevision | null):
  { replayed: true; outcome: WorkResultCompletionOutcome } | { replayed: false; task: TaskRecord } {
  assertHuman(actor);
  const replay = committed(actor, input);
  if (replay) return { replayed: true, outcome: replay };
  assertHandoffsEnabled();
  if (!Number.isSafeInteger(input.expectedStatusChangedCount) || input.expectedStatusChangedCount < 0) {
    throw new ActionError('invalid_params', 'The current task lifecycle revision is required. Reload the task and try again.');
  }
  const options = getWorkResultCompletionOptions(input.resultId, actor.userId, current);
  if (options.staleReason) throw new ActionError('conflict', options.staleReason === 'superseded'
    ? 'A newer handoff exists. Inspect that exact result before completing the task.'
    : 'The code revision changed since this handoff was saved. Inspect an updated handoff before completing the task.', undefined,
  { staleReason: options.staleReason });
  if (!input.taskId && options.choices.length > 1) {
    throw new ActionError('invalid_params', 'Choose the linked task this handoff completes.', undefined, { requiresTaskChoice: true, tasks: options.choices });
  }
  const target = input.taskId ? options.choices.find((choice) => choice.id === input.taskId) : options.choices[0];
  if (!target) throw new ActionError('invalid_params', 'This handoff has no eligible linked task matching that choice.');
  lifecyclePreflight({ taskId: target.id, command: 'complete',
    idempotencyKey: workResultRequestScopedId('result_completion', actor, input.requestId),
    expectedStatusChangedCount: input.expectedStatusChangedCount, acknowledgedChildIds: input.acknowledgedChildIds });
  return { replayed: false, task: getTask(target.id)! };
}

/** Acceptance and the existing completeTask ledger commit or roll back together. */
export function acceptWorkResultAndCompleteTask(actor: WorkResultActor, input: AcceptWorkResultAndCompleteInput, current?: WorkResultCodeRevision | null): WorkResultCompletionOutcome {
  return transaction(() => {
    const preflight = preflightWorkResultCompletion(actor, input, current);
    if (preflight.replayed) return preflight.outcome;
    const detail = getWorkResult(input.resultId, actor.userId)!;
    const key = workResultRequestScopedId('result_completion', actor, input.requestId);
    const lastReviewTime = detail.reviews[0]?.createdAt;
    const now = new Date(Math.max(Date.now(), lastReviewTime ? Date.parse(lastReviewTime) + 1 : 0)).toISOString();
    const review = hydrateRow(getDb().insert(workResultDecisions).values({
      id: key, createdAt: now, updatedAt: now, userId: actor.userId, resultId: input.resultId,
      requestHash: workResultIntentHash(intent(input)), disposition: 'accepted', actorSource: actor.source,
      actorUserId: actor.userId, actorSessionId: null, note: input.note ?? null, attachments: [],
    }).returning().get());
    const completion = completeTask(preflight.task.id, {
      idempotencyKey: key, note: input.note, expectedStatusChangedCount: input.expectedStatusChangedCount,
      acknowledgedChildIds: input.acknowledgedChildIds,
      meta: { source: actor.source, executionId: detail.result.sourceExecutionId,
        reason: `Accepted saved result ${input.resultId}` },
    });
    if (!completion) throw new ActionError('not_found', 'The selected task is unavailable.');
    return { review, completion, taskId: preflight.task.id, replayed: false };
  });
}
