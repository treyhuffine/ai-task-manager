import { acceptWorkResultAndCompleteTask, getChatSession, getWorkResult, preflightWorkResultCompletion } from '@/lib/db/queries';
import type { AcceptWorkResultAndCompleteInput } from './completion-queries';
import type { WorkResultActor } from '@/db/types';
import { observeWorkResultCodeRevision, observeWorkResultExecutionCodeRevision } from './observe';
import { coordinateLifecycleChange } from '@/lib/sessions/workstream';
import { inProcessWorkstreamRuntime } from '@/lib/sessions/workstream-runtime';

async function currentRevision(actor: WorkResultActor, resultId: string) {
  const result = getWorkResult(resultId, actor.userId)?.result;
  const source = result?.sourceChatSessionId;
  // Pruned provenance means unknown code identity, not a substitute execution.
  return source && getChatSession(source) ? observeWorkResultCodeRevision(source, actor.userId)
    : result?.sourceExecutionId ? observeWorkResultExecutionCodeRevision(result.sourceExecutionId, actor.userId) : null;
}

export async function acceptAndCompleteWorkResult(actor: WorkResultActor, input: AcceptWorkResultAndCompleteInput) {
  // Committed replay precedes observation, feature gates, and runtime effects.
  const initial = preflightWorkResultCompletion(actor, input);
  if (initial.replayed) return initial.outcome;
  const observed = await currentRevision(actor, input.resultId);
  const preflight = preflightWorkResultCompletion(actor, input, observed);
  if (preflight.replayed) return preflight.outcome;
  await coordinateLifecycleChange({ taskId: preflight.task.id, kind: 'displace', choice: input.runtimeChoice,
    change: { taskId: preflight.task.id, taskTitle: preflight.task.title, action: 'completed' },
    acknowledgedExecutionIds: input.acknowledgedExecutionIds, runtime: inProcessWorkstreamRuntime });
  // Runtime coordination can yield. Recheck source revision and every database
  // guard before the one transaction that accepts and completes.
  return acceptWorkResultAndCompleteTask(actor, input, await currentRevision(actor, input.resultId));
}
