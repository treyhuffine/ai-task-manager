'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, MessageSquare, Square } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { PendingInputArea } from '@/components/executions/pending-input-overlay';
import { ExecutionEvent } from '@/components/executions/execution-event';
import { useRuntimeStatus } from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';
import { useCancelResultReview } from '@/hooks/use-results';
import { workResultsApi, type AiReviewDetail, type WorkResultFeedbackContext, type WorkResultReviewActivity } from '@/lib/api/results';
import { apiErrorText } from '@/lib/api/client';
import type { WorkResultRecord } from '@/db/types';
import { resultReviewLabel, reviewReportExcerpt } from './presentation';
import { ResultArtifacts } from './result-artifacts';
import { ResultBody } from './result-body';

export function ResultAiReview({ review, result, hasSuccessor, canFeedback, onFeedback, onRetry }: {
  review: AiReviewDetail;
  result: WorkResultRecord;
  hasSuccessor: boolean;
  canFeedback: boolean;
  onFeedback: (context: WorkResultFeedbackContext) => void;
  onRetry?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cancel = useCancelResultReview(result.id);
  const active = review.status === 'queued' || review.status === 'running';
  return (
    <div id={`ai-review-${review.id}`} className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {active && <Loader2 size={12} className="animate-spin" />}
        <span className="font-medium">{resultReviewLabel(review, result, hasSuccessor)}</span>
        <span className="text-muted-foreground">{review.selection.harness ?? 'Unknown harness'} · {review.selection.model ?? 'Unknown model'}</span>
        {active && <Button variant="ghost" size="xs" disabled={cancel.isPending} onClick={() => cancel.mutate(review.id)}><Square />Cancel</Button>}
        {!active && !review.report && onRetry && <Button variant="outline" size="xs" onClick={onRetry}>Retry</Button>}
      </div>
      {review.statusReason && <p className="text-muted-foreground">{review.statusReason.replaceAll('_', ' ')}</p>}
      {review.provenance.reusedReviewId && <a href={`#ai-review-${review.provenance.reusedReviewId}`} className="text-primary hover:underline">View reused AI review</a>}
      {review.focus && <p className="text-muted-foreground">Focus: {review.focus}</p>}
      {review.report && <p className="text-muted-foreground">{reviewReportExcerpt(review.report.body)}</p>}
      {review.report && (
        <details className="group/report" open={undefined}>
          <summary className="cursor-pointer font-medium text-foreground">AI review{review.report.title ? `: ${review.report.title}` : ''}</summary>
          <div className="mt-3 space-y-3">
            <ResultBody result={review.report} />
            <ResultArtifacts result={review.report} />
            <a href={`/results/${review.report.id}`} className="text-primary hover:underline">Open saved AI report</a>
          </div>
        </details>
      )}
      {canFeedback && review.report && <Button size="xs" variant="outline" onClick={() => onFeedback({ reviewId: review.id })}><MessageSquare />Address findings</Button>}
      {active && review.reviewerSessionId && <ReviewerAttention sessionId={review.reviewerSessionId} />}
      <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen}>
        <ChevronRight size={11} className={detailsOpen ? 'rotate-90' : ''} />Review details
      </button>
      {detailsOpen && <ReviewDetails review={review} />}
    </div>
  );
}

function ReviewerAttention({ sessionId }: { sessionId: string }) {
  useSessionStream(sessionId);
  const { data: runtime } = useRuntimeStatus(sessionId);
  return (
    <div>
      {runtime && !runtime.running && <p className="text-muted-foreground">Waiting for the review runtime. Its durable status remains above.</p>}
      <PendingInputArea sessionId={sessionId} />
    </div>
  );
}

function ReviewDetails({ review: snapshot }: { review: AiReviewDetail }) {
  const details = useQuery({ queryKey: ['results', 'review', snapshot.id], queryFn: () => workResultsApi.review(snapshot.id), retry: false, refetchInterval: snapshot.status === 'queued' || snapshot.status === 'running' ? 3_000 : false });
  const review = details.data?.review ?? snapshot;
  const [activityOpen, setActivityOpen] = useState(false);
  const scope = review.scope;
  const limitations = [...(scope.requested.limitations ?? []), ...(scope.observed?.limitations ?? []), ...(review.provenance.limitations ?? [])];
  return (
    <div className="space-y-3 border-t pt-3">
      {!!details.error && <p role="alert" className="text-destructive">{apiErrorText(details.error)}</p>}
      {details.data?.run?.errorMessage && <p className="whitespace-pre-wrap break-words text-destructive">{details.data.run.errorMessage}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Requested reviewer</dt><dd className="break-words">{review.selection.harness ?? 'Unknown'} · {review.selection.model ?? 'Unknown'} · effort {review.selection.effort ?? 'Unknown'}{review.selection.variant ? ` · ${review.selection.variant}` : ''}</dd>
        <dt>Observed reviewer</dt><dd className="break-words">{review.provenance.observedHarness ?? 'Unknown'} · {review.provenance.observedModel ?? 'Unknown'} · effort {review.provenance.observedEffort ?? 'Unknown'}</dd>
        <dt>Method</dt><dd>{review.provenance.method.replaceAll('_', ' ')}</dd>
        <dt>Independence</dt><dd>{review.provenance.independence === 'observed' ? 'Observed by Ri' : review.provenance.independence === 'reported' ? 'Reported by the agent' : 'Unknown'}</dd>
        <dt>Target</dt><dd><a href={`/results/${review.resultId}`} className="text-primary hover:underline">Exact saved handoff</a></dd>
        <dt>Requested capture</dt><dd>{scope.requested.capturedAt}</dd>
        <dt>Requested revision</dt><dd className="break-all">{scope.requested.codeRevision?.commitSha ?? 'Unknown'}{scope.requested.codeRevision ? ` (${scope.requested.codeRevision.workingTreeState})` : ''}</dd>
        <dt>Comparison base</dt><dd className="break-all">{scope.observed?.baseSha ?? scope.requested.baseSha ?? 'Unknown'}</dd>
        <dt>Observed revision</dt><dd className="break-all">{scope.observed?.codeRevision?.commitSha ?? 'Unknown'}</dd>
        <dt>Repository</dt><dd className="break-all">{scope.observed?.repository ?? scope.requested.repository ?? 'Unknown'}</dd>
        <dt>Completed outcome</dt><dd>{review.status}{review.statusReason ? ` (${review.statusReason.replaceAll('_', ' ')})` : ''}</dd>
      </dl>
      {limitations.length > 0 && <div className="space-y-1"><p className="font-medium">Limits</p>{[...new Set(limitations)].map((limit) => <p key={limit} className="text-muted-foreground">{limit}</p>)}</div>}
      <details><summary className="cursor-pointer">Original review brief</summary><div className="mt-2"><MessageResponse className="text-xs">{review.brief ?? 'The original brief was not recorded for this evidence.'}</MessageResponse></div></details>
      <button className="flex items-center gap-1 text-primary hover:underline" onClick={() => setActivityOpen(!activityOpen)} aria-expanded={activityOpen}><ChevronRight size={11} className={activityOpen ? 'rotate-90' : ''} />Available activity</button>
      {activityOpen && <ReviewerActivity activity={details.data} loading={details.isLoading} />}
    </div>
  );
}

function ReviewerActivity({ activity, loading }: { activity?: WorkResultReviewActivity; loading: boolean }) {
  if (loading) return <p className="text-muted-foreground">Loading available activity...</p>;
  if (!activity?.activityAvailable || !activity.events.length) return <p className="text-muted-foreground">{activity?.limitation ?? 'Activity is unavailable or has been pruned. The saved review remains readable.'}</p>;
  return <div className="max-h-96 space-y-3 overflow-y-auto rounded border bg-background p-3">{activity.events.map((event) => <ExecutionEvent key={event.id} event={event} sessionId={activity.session?.id} handoffActions={false} />)}</div>;
}
