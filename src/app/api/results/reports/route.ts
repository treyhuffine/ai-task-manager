import { createWorkResult, getWorkResult, workResultRequestScopedId } from '@/lib/db/queries';
import { ActionError } from '@/lib/orchestrator/types';
import { independentReviewSchema } from '@/lib/orchestrator/result-actions';
import { workResultActorFromRequest, workResultRoute } from '@/lib/work-results/http';
import { saveWorkResultSchema } from '@/lib/work-results/validation';
import { observeWorkResultCodeRevision } from '@/lib/work-results/observe';
import { prepareAutomaticWorkResultReview, dispatchAutomaticWorkResultReviews } from '@/lib/work-results/automatic';

export function POST(request: Request) {
  return workResultRoute(async () => {
    const actor = workResultActorFromRequest(request, { allowMissing: true });
    if (actor.source !== 'ai' || !actor.sessionId) throw new ActionError('unsupported', 'Agent reports require a signed Ri producing session.');
    const input = saveWorkResultSchema.omit({ sourceChatSessionId: true, sourceEventId: true })
      .extend({ independentReview: independentReviewSchema.optional() }).strict().parse(await request.json());
    const previous = getWorkResult(workResultRequestScopedId('report_result', actor, input.requestId), actor.userId);
    const codeRevision = previous ? undefined : await observeWorkResultCodeRevision(actor.sessionId, actor.userId);
    const automaticReview = previous ? undefined : await prepareAutomaticWorkResultReview(actor, actor.sessionId);
    const created = createWorkResult(actor, input, { codeRevision, automaticReview });
    if (!created.idempotentReplay) void dispatchAutomaticWorkResultReviews(actor.sessionId).catch(() => {});
    return { result_id: created.result.id, url: `/results/${created.result.id}`, idempotent_replay: created.idempotentReplay };
  });
}
