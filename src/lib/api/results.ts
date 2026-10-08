import { trpcClient } from '@/lib/trpc/client';
import type { HarnessId } from '@/lib/harness/registry';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';

export type WorkResultListInput = NonNullable<RouterInputs['results']['list']>;
export type WorkResultReviewActivity = RouterOutputs['results']['review'];
export type WorkResultDetailResponse = RouterOutputs['results']['get'];
export type WorkResultFeedbackDelivery = WorkResultDetailResponse['feedbackDelivery'][string];
export type WorkResultFeedbackRetryResponse = RouterOutputs['results']['retryFeedback'];
export type WorkResultCompleteInput = Omit<RouterInputs['results']['complete'], 'id'>;
export type WorkResultCompleteResponse = RouterOutputs['results']['complete'];
export type WorkResultCapabilities = RouterOutputs['results']['capabilities'];
export type SaveHandoffInput = RouterInputs['results']['save'];
export type PrepareHandoffInput = RouterInputs['results']['prepare'];
export type WorkResultDecisionInput = Omit<RouterInputs['results']['decide'], 'id'>;
export type WorkResultFeedbackContext = NonNullable<WorkResultDecisionInput['context']>;
export type WorkResultReviewInput = Omit<RouterInputs['results']['requestReview'], 'id'>;
export type ReviewerOverrides = Pick<WorkResultReviewInput, 'harness' | 'model' | 'variant' | 'effort'>;
export type HandoffCreated = RouterOutputs['results']['save'];
export type HandoffPreparation = RouterOutputs['results']['prepare'];
export type AiReviewDetail = WorkResultDetailResponse['aiReviews'][number];

export const workResultsApi = {
  capabilities: () => trpcClient.results.capabilities.query(),
  setCapabilities: (input: Partial<WorkResultCapabilities>) => trpcClient.results.setCapabilities.mutate(input),
  get: (id: string) => trpcClient.results.get.query({ id }),
  list: (input: WorkResultListInput = {}) => trpcClient.results.list.query(input),
  listForSource: (sourceChatSessionId: string, sourceEventId: string) => trpcClient.results.list.query({ sourceChatSessionId, sourceEventId, includeSuperseded: true, limit: 1 }),
  save: (input: SaveHandoffInput) => trpcClient.results.save.mutate(input),
  prepare: (input: PrepareHandoffInput) => trpcClient.results.prepare.mutate(input),
  cancelPreparation: (messageId: string) => trpcClient.results.cancelPreparation.mutate({ messageId }),
  decide: (id: string, input: WorkResultDecisionInput) => trpcClient.results.decide.mutate({ id, ...input }),
  complete: (id: string, input: WorkResultCompleteInput) => trpcClient.results.complete.mutate({ id, ...input }),
  retryFeedback: (id: string, reviewId: string) => trpcClient.results.retryFeedback.mutate({ id, reviewId }),
  requestReview: (id: string, input: WorkResultReviewInput) => trpcClient.results.requestReview.mutate({ id, ...input }),
  review: (reviewId: string) => trpcClient.results.review.query({ reviewId }),
  cancelReview: (reviewId: string) => trpcClient.results.cancelReview.mutate({ reviewId }),
  preview: (id: string, targetId: string) => trpcClient.results.preview.query({ id, targetId }),
  openPreview: (id: string, targetId: string, remote: boolean) => trpcClient.results.openPreview.mutate({ id, targetId, remote }),
};

/** Scope is kept here so picker changes cannot update authoring or global defaults. */
export type ReviewerChoice = ReviewerOverrides & { harness: HarnessId; model: string };
