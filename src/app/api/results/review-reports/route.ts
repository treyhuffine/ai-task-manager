import { z } from 'zod';
import { reportWorkResultAiReview, getWorkResultAiReview } from '@/lib/db/queries';
import { ActionError } from '@/lib/orchestrator/types';
import { workResultActorFromRequest, workResultRoute } from '@/lib/work-results/http';
import { reviewContentSchema } from '@/lib/work-results/validation';

export function POST(request: Request) {
  return workResultRoute(async () => {
    const actor = workResultActorFromRequest(request, { allowMissing: true });
    if (actor.source !== 'ai' || !actor.sessionId) throw new ActionError('unsupported', 'AI review reports require a signed Ri session.');
    const input = reviewContentSchema.extend({
      requestId: z.string().min(1).max(200), reviewId: z.string().optional(), resultId: z.string().optional(),
      scope: reviewContentSchema.shape.scope.optional(), provenance: reviewContentSchema.shape.provenance.optional(),
    }).strict().parse(await request.json());
    const assigned = input.reviewId ? getWorkResultAiReview(input.reviewId, actor.userId) : null;
    let observation;
    if (assigned?.status === 'running' && assigned.reviewerSessionId === actor.sessionId && !assigned.reportResultId) {
      const runtime = await import('@/lib/work-results/runtime');
      observation = await runtime.observeWorkResultReviewScope(assigned);
      runtime.observeWorkResultReviewProvenance(assigned);
    }
    const saved = reportWorkResultAiReview(actor, input, observation);
    return { review_id: saved.review.id, report_result_id: saved.report.id, url: `/results/${saved.review.resultId}`, idempotent_replay: saved.idempotentReplay };
  });
}
