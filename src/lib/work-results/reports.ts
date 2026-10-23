import { createWorkResult, getWorkResult, workResultRequestScopedId, reportWorkResultAiReview, getWorkResultAiReview } from '@/lib/db/queries';
import { ActionError } from '@/lib/orchestrator/types';
import { independentReviewSchema } from '@/lib/orchestrator/result-actions';
import { saveWorkResultSchema } from '@/lib/work-results/validation';
import { observeWorkResultCodeRevision } from '@/lib/work-results/observe';
import { prepareAutomaticWorkResultReview, dispatchAutomaticWorkResultReviews } from '@/lib/work-results/automatic';

import type { WorkResultActor } from '@/db/types';
import { reviewContentSchema } from './validation';
import { z } from 'zod';
import { validateWorkResultActor } from './home-policy';

export const agentReportSchema = saveWorkResultSchema.omit({ sourceChatSessionId: true, sourceEventId: true }).extend({ independentReview: independentReviewSchema.optional() }).strict();
export const reviewReportSchema = reviewContentSchema.extend({ requestId: z.string().min(1).max(200), reviewId: z.string().optional(), resultId: z.string().optional(), scope: reviewContentSchema.shape.scope.optional(), provenance: reviewContentSchema.shape.provenance.optional() }).strict();

export async function saveAgentReport(actor: WorkResultActor, input: z.infer<typeof agentReportSchema>) {
  validateWorkResultActor(actor, actor.sessionId);
  if (actor.source !== 'ai' || !actor.sessionId) throw new ActionError('unsupported', 'Reports require an authenticated producing chat.');
  const previous = getWorkResult(workResultRequestScopedId('report_result', actor, input.requestId), actor.userId);
  const codeRevision = previous ? undefined : await observeWorkResultCodeRevision(actor.sessionId, actor.userId);
  const automaticReview = previous ? undefined : await prepareAutomaticWorkResultReview(actor, actor.sessionId);
  const created = createWorkResult(actor, input, { codeRevision, automaticReview });
  if (!created.idempotentReplay) void dispatchAutomaticWorkResultReviews(actor.sessionId).catch(() => {});
  return { result_id: created.result.id, url: `/results/${created.result.id}`, idempotent_replay: created.idempotentReplay };
}

export async function saveReviewReport(actor: WorkResultActor, input: z.infer<typeof reviewReportSchema>) {
  validateWorkResultActor(actor, actor.sessionId);
  if (actor.source !== 'ai' || !actor.sessionId) throw new ActionError('unsupported', 'Reviews require an authenticated chat.');
  const assigned = input.reviewId ? getWorkResultAiReview(input.reviewId, actor.userId) : null;
  let observation;
  if (assigned?.status === 'running' && assigned.reviewerSessionId === actor.sessionId && !assigned.reportResultId) {
    const runtime = await import('@/lib/work-results/runtime');
    observation = await runtime.observeWorkResultReviewScope(assigned);
    runtime.observeWorkResultReviewProvenance(assigned);
  }
  const saved = reportWorkResultAiReview(actor, input, observation);
  return { review_id: saved.review.id, report_result_id: saved.report.id, url: `/results/${saved.review.resultId}`, idempotent_replay: saved.idempotentReplay };
}
