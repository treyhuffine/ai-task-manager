'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, ExternalLink, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { MessageFileChip } from '@/components/chat/message-file-chip';
import type { WorkResultRecord, WorkResultDecisionRecord } from '@/db/types';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { usePrepareHandoff, useRequestResultReview, useResult, useResultCapabilities, useResultDecision, useRetryResultFeedback } from '@/hooks/use-results';
import { apiErrorText } from '@/lib/api/client';
import type { WorkResultDetailResponse, WorkResultFeedbackContext, ReviewerOverrides, WorkResultReviewInput } from '@/lib/api/results';
import { dispositionLabel, orderedNewest } from './presentation';
import { ResultArtifacts } from './result-artifacts';
import { ResultFeedback } from './result-feedback';
import { ResultAiReview } from './result-ai-review';
import { ReviewerSelection } from './reviewer-selection';
import { clearResultRequestKey, resultRequestKey } from './request-key';
import { ResultBody } from './result-body';
import { useAuthoringDestination } from './use-authoring-destination';
import { useHandoffPreparation } from './use-handoff-preparation';
import { PreparationStatus } from './preparation-status';
import { useSessionStream } from '@/hooks/use-session-stream';
import { ResultCompletionAction } from './result-completion-action';
import { ResultGithubChecks } from './result-github-checks';

export function ResultRenderer({ resultId, exact = false }: { resultId: string; exact?: boolean }) {
  const query = useResult(resultId);
  if (query.isLoading) return <div className="flex items-center gap-2 rounded-lg border p-4 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Loading handoff...</div>;
  if (query.error || !query.data) return <div className="space-y-2 rounded-lg border p-4 text-xs"><p role="alert">{query.error ? apiErrorText(query.error) : 'This handoff is unavailable.'}</p><Button variant="outline" size="xs" onClick={() => void query.refetch()}>Retry loading</Button><Link href={`/results/${resultId}`} className="ml-2 text-primary hover:underline">Exact handoff link</Link></div>;
  return <SavedResult key={query.data.result.id} detail={query.data} exact={exact} />;
}

function SavedResult({ detail, exact }: { detail: WorkResultDetailResponse; exact: boolean }) {
  const { result } = detail;
  useSessionStream(exact ? result.sourceChatSessionId : null);
  const { data: capabilities } = useResultCapabilities();
  const enabled = capabilities?.handoffsEnabled === true;
  const aiEnabled = enabled && capabilities?.aiReviewEnabled === true;
  const decision = useResultDecision(result.id);
  const prepare = usePrepareHandoff();
  const reviewRequest = useRequestResultReview(result.id);
  const [feedback, setFeedback] = useState<WorkResultFeedbackContext | null>(null);
  const [focus, setFocus] = useState('');
  const [reviewer, setReviewer] = useState<ReviewerOverrides>({});
  const reviews = orderedNewest(detail.reviews);
  const aiReviews = orderedNewest(detail.aiReviews);
  const activeReview = aiReviews.some((review) => review.status === 'queued' || review.status === 'running');
  const destination = useAuthoringDestination(result.sourceChatSessionId, enabled);
  const sourceAvailable = destination.available;
  const canFeedback = enabled;
  const reportTargetId = detail.reviewTargetId;
  const primary = !reportTargetId;
  const previousPreparation = useHandoffPreparation(result.sourceChatSessionId, { resultId: result.id });
  const preparationStatus = previousPreparation?.status ?? prepare.data?.status;
  const activePreparation = preparationStatus === 'queued' || preparationStatus === 'running';
  const retryPreparation = preparationStatus === 'failed' || preparationStatus === 'cancelled';

  const decide = async (disposition: 'accepted' | 'dismissed') => {
    const intent = { resultId: result.id, disposition };
    try {
      await decision.mutateAsync({ requestId: resultRequestKey('decision', intent), disposition });
      clearResultRequestKey('decision', intent);
    } catch { /* The hook shows the error and keeps retry identity. */ }
  };
  const requestReview = async (overrides?: Omit<WorkResultReviewInput, 'requestId'>) => {
    const input = { focus: focus.trim() || undefined, ...reviewer, rerun: aiReviews.some((review) => !!review.report), ...overrides };
    const intent = { resultId: result.id, ...input };
    try {
      await reviewRequest.mutateAsync({ requestId: resultRequestKey('ai-review', intent), ...input });
      clearResultRequestKey('ai-review', intent);
    } catch { /* Keep focus and reviewer choices for adjustment or retry. */ }
  };
  const update = () => {
    if (!result.sourceChatSessionId) return;
    prepare.mutate({ requestId: retryPreparation ? resultRequestKey('retry-update', { resultId: result.id, previousMessageId: previousPreparation?.event.id ?? prepare.data?.messageId }) : `update-handoff:${result.id}`, sourceChatSessionId: result.sourceChatSessionId, resultId: result.id });
  };

  return (
    <article className={exact ? 'space-y-5' : 'space-y-4 rounded-xl border bg-muted/10 p-4'} aria-label={reportTargetId ? 'Saved AI review' : 'Saved handoff'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{reportTargetId ? 'AI review' : 'Handoff'}</p>
          {result.title && <h2 className="mt-1 text-base font-semibold leading-snug">{result.title}</h2>}
          <p className="mt-1 text-[11px] text-muted-foreground">Saved {result.createdAt}{result.actorSource === 'human' ? ' by you' : result.actorSource === 'ai' ? ' by the agent' : ' by Ri'}</p>
        </div>
        {!exact && <Link href={`/results/${result.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted"><ExternalLink size={12} />View handoff</Link>}
      </div>
      {reportTargetId && <Link href={`/results/${reportTargetId}`} className="block text-xs text-primary hover:underline">View the reviewed handoff</Link>}
      {detail.successorId && <Link href={`/results/${detail.successorId}`} className="block rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">Newer result available. Open the newer handoff.</Link>}
      <ResultBody result={result} />
      <ResultArtifacts result={result} onFeedback={canFeedback && primary ? setFeedback : undefined} />
      {primary && <ResultGithubChecks result={result} />}
      {result.attention && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"><p className="mb-2 text-xs font-medium">Needs your attention</p><MessageResponse className="text-xs">{result.attention}</MessageResponse></div>}
      {primary && (
        <div className="space-y-3">
          {aiReviews.length === 0 && <p className="text-xs text-muted-foreground">No AI review recorded</p>}
          {aiReviews.map((review) => <ResultAiReview key={review.id} review={review} result={result} hasSuccessor={!!detail.successorId} canFeedback={canFeedback} onFeedback={setFeedback} onRetry={aiEnabled && !activeReview ? () => { void requestReview({ rerun: true, focus: review.focus ?? undefined, ...(review.selection.harness ? { harness: review.selection.harness } : {}), ...(review.selection.model ? { model: review.selection.model } : {}), ...(review.selection.variant ? { variant: review.selection.variant } : {}), ...(review.selection.effort ? { effort: review.selection.effort } : {}) }); } : undefined} />)}
          {aiEnabled && !activeReview && <div className="space-y-2">
            <ReviewerSelection value={reviewer} onChange={setReviewer} associatedWorkspace={detail.associatedWorkspace} />
            <details><summary className="cursor-pointer text-xs text-muted-foreground">Add a review focus</summary><label className="mt-2 block space-y-1 text-xs text-muted-foreground"><span>Optional focus</span><input value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Any concern the reviewer should investigate?" className="w-full rounded-md border bg-background px-3 py-2 text-foreground" /></label></details>
            {!!reviewRequest.error && <p className="text-xs text-destructive" role="alert">{apiErrorText(reviewRequest.error)}</p>}
            <Button size="xs" variant="outline" onClick={() => void requestReview()} disabled={reviewRequest.isPending}>{reviewRequest.isPending && <Loader2 className="animate-spin" />}{aiReviews.some((review) => !!review.report) ? 'Review again' : 'Review with AI'}</Button>
          </div>}
        </div>
      )}
      {reviews.length > 0 && <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium">{dispositionLabel(reviews[0])}</p>
        <DecisionNote review={reviews[0]} result={result} />
        {reviews[0].disposition === 'changes_requested' && <FeedbackDelivery reviewId={reviews[0].id} resultId={result.id} />}
        {reviews.length > 1 && <details><summary className="cursor-pointer text-[11px] text-muted-foreground">Earlier decisions</summary><div className="mt-2 space-y-2">{reviews.slice(1).map((review) => <div key={review.id} className="text-xs"><p>{dispositionLabel(review)} · {review.createdAt}</p><DecisionNote review={review} result={result} />{review.disposition === 'changes_requested' && <FeedbackDelivery reviewId={review.id} resultId={result.id} />}</div>)}</div></details>}
      </div>}
      {enabled && primary && <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button variant="outline" size="xs" disabled={decision.isPending} onClick={() => void decide('accepted')}><Check />Accept</Button>
        <Tip label={destination.reason}><Button variant="outline" size="xs" onClick={() => setFeedback({})}><MessageSquare />Request changes</Button></Tip>
        <Button variant="ghost" size="xs" disabled={decision.isPending} onClick={() => void decide('dismissed')}>Dismiss</Button>
        {sourceAvailable && !detail.successorId && <Button variant="ghost" size="xs" disabled={prepare.isPending || activePreparation} onClick={update}><RefreshCw />{prepare.isPending || activePreparation ? 'Preparing handoff' : retryPreparation ? 'Retry update handoff' : 'Update handoff'}</Button>}
        <ResultCompletionAction resultId={result.id} options={detail.completionOptions} />
      </div>}
      {previousPreparation ? <PreparationStatus event={previousPreparation.event} /> : prepare.data && <p className="text-xs text-muted-foreground">Preparing handoff: {prepare.data.status}{prepare.data.statusReason ? ` (${prepare.data.statusReason.replaceAll('_', ' ')})` : ''}. It will appear in the authoring conversation when saved.</p>}
      {feedback && canFeedback && <ResultFeedback key={JSON.stringify(feedback)} result={result} context={feedback} destinationReason={destination.reason} onClose={() => setFeedback(null)} />}
      {enabled && primary && destination.reason && <p className="text-[11px] text-muted-foreground">{destination.reason}</p>}
      <details className="text-xs text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-1"><ChevronRight size={11} />Handoff provenance</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>Exact snapshot</dt><dd className="break-all">{result.id}</dd>
          <dt>Saved by</dt><dd>{result.actorSource === 'ai' ? 'Agent' : result.actorSource === 'human' ? 'Human' : 'System'} · {result.actorUserId}</dd>
          <dt>Authoring conversation</dt><dd>{result.sourceChatSessionId ? <Link href={`/?session=${encodeURIComponent(result.sourceChatSessionId)}`} className="text-primary hover:underline">Return to the authoring conversation</Link> : 'Unavailable or pruned'}</dd>
          <dt>Code identity</dt><dd className="break-all">{result.codeRevision?.commitSha ?? 'Unknown'}{result.codeRevision ? ` (${result.codeRevision.workingTreeState})` : ''}</dd>
          <dt>Captured</dt><dd>{result.codeRevision?.capturedAt ?? 'No code capture recorded'}</dd>
          <dt>Working copy checkpoint</dt><dd>{result.codeRevision?.checkpointRef ?? 'No exact checkpoint recorded'}</dd>
          {result.supersedesId && <><dt>Previous snapshot</dt><dd><Link href={`/results/${result.supersedesId}`} className="text-primary hover:underline">View earlier handoff</Link></dd></>}
        </dl>
      </details>
    </article>
  );
}

function DecisionNote({ review, result }: { review: WorkResultDecisionRecord; result: WorkResultRecord }) {
  const galleryFiles = (review.attachments ?? []).filter((attachment) => !review.note?.includes(`[[file:${attachment.fileName}]]`));
  const context = review.context;
  const selectedFile = (result.attachments ?? []).find((attachment) => attachment.fileName === context?.attachmentFileName);
  const selectedPreview = result.links?.find((link) => link.kind === 'preview' && link.previewTargetId === context?.previewTargetId);
  return <div className="space-y-2">
    {context && <div className="space-y-1 text-[11px] text-muted-foreground">
      {context.reviewId && <Link href={`/results/${result.id}#ai-review-${context.reviewId}`} className="block text-primary hover:underline">Feedback on this AI review</Link>}
      {context.attachmentFileName && <div><p className="mb-1">Selected file</p>{selectedFile ? <MessageFileChip attachment={selectedFile} /> : <p>The selected file is unavailable.</p>}</div>}
      {context.previewTargetId && (selectedPreview ? <Link href={`/results/${result.id}#preview-${context.previewTargetId}`} className="block text-primary hover:underline">Selected preview: {selectedPreview.label}</Link> : <p>The selected preview is unavailable.</p>)}
    </div>}
    {review.note && <div className="text-muted-foreground"><ResultBody result={{ body: review.note, attachments: review.attachments }} /></div>}
    {!!galleryFiles.length && <div className="flex flex-wrap gap-2" aria-label="Saved feedback files">{galleryFiles.map((attachment) => <MessageFileChip key={attachment.fileName} attachment={attachment} />)}</div>}
  </div>;
}

function FeedbackDelivery({ resultId, reviewId }: { resultId: string; reviewId: string }) {
  const { data } = useResult(resultId);
  const retry = useRetryResultFeedback(resultId);
  const delivery = data?.feedbackDelivery?.[reviewId];
  return <div className="space-y-1 text-[11px] text-muted-foreground">
    <p>Feedback saved. {delivery ? `Delivery: ${delivery.status.replaceAll('_', ' ')}${delivery.statusReason ? ` (${delivery.statusReason.replaceAll('_', ' ')})` : ''}` : 'Delivery details are available in the authoring conversation.'}</p>
    {delivery && 'errorMessage' in delivery && !!delivery.errorMessage && <p className="whitespace-pre-wrap break-words text-destructive">{delivery.errorMessage}</p>}
    {delivery?.statusReason === 'delivery_uncertain' && <p>Ri cannot confirm whether this feedback reached the author. Check its conversation before sending it again.</p>}
    {delivery?.canRetry && <Button variant="outline" size="xs" disabled={retry.isPending} onClick={() => retry.mutate(reviewId)}>{retry.isPending && <Loader2 className="animate-spin" />}Retry delivery</Button>}
  </div>;
}
