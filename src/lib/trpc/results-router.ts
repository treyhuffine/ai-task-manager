import { z } from 'zod/v4';
import { viewerProcedure as p, router } from './init';
import { operationContext, unwrapOperation } from '@/lib/server/operation';
import * as operations from '@/lib/server/operations/results';

export const resultsRouter = router({
  capabilities: p.query(({ ctx }) => operations.capabilities({}, operationContext(ctx.request, {}, '/results/capabilities')).then(unwrapOperation)),
  setCapabilities: p.input(operations.capabilitiesInput).mutation(({ ctx, input }) => operations.setCapabilities(input, operationContext(ctx.request, {}, '/results/capabilities')).then(unwrapOperation)),
  list: p.input(operations.listInput.default({})).query(({ ctx, input }) => operations.list(input, operationContext(ctx.request, {}, '/results')).then(unwrapOperation)),
  get: p.input(operations.resultIdInput).query(({ ctx, input }) => operations.get(input, operationContext(ctx.request, { params: input }, '/results/[id]')).then(unwrapOperation)),
  save: p.input(operations.saveInput).mutation(({ ctx, input }) => operations.save(input, operationContext(ctx.request, {}, '/results')).then(unwrapOperation)),
  prepare: p.input(operations.prepareInput).mutation(({ ctx, input }) => operations.prepare(input, operationContext(ctx.request, {}, '/results/prepare')).then(unwrapOperation)),
  cancelPreparation: p.input(operations.cancelPreparationInput).mutation(({ ctx, input }) => operations.cancelPreparation(input, operationContext(ctx.request, { params: input }, '/results/prepare/[messageId]/cancel')).then(unwrapOperation)),
  decide: p.input(operations.decisionInput).mutation(({ ctx, input }) => operations.decide(input, operationContext(ctx.request, { params: { id: input.id } }, '/results/[id]/decisions')).then(unwrapOperation)),
  complete: p.input(operations.completeInput).mutation(({ ctx, input }) => operations.complete(input, operationContext(ctx.request, { params: { id: input.id } }, '/results/[id]/complete')).then(unwrapOperation)),
  retryFeedback: p.input(operations.retryFeedbackInput).mutation(({ ctx, input }) => operations.retryFeedback(input, operationContext(ctx.request, { params: input }, '/results/[id]/decisions/[reviewId]/retry')).then(unwrapOperation)),
  requestReview: p.input(operations.requestReviewInput).mutation(({ ctx, input }) => operations.requestReview(input, operationContext(ctx.request, { params: { id: input.id } }, '/results/[id]/reviews')).then(unwrapOperation)),
  review: p.input(operations.reviewIdInput).query(({ ctx, input }) => operations.review(input, operationContext(ctx.request, { params: input }, '/results/reviews/[reviewId]')).then(unwrapOperation)),
  cancelReview: p.input(operations.reviewIdInput).mutation(({ ctx, input }) => operations.cancelReview(input, operationContext(ctx.request, { params: input }, '/results/reviews/[reviewId]/cancel')).then(unwrapOperation)),
  preview: p.input(operations.previewInput).query(({ ctx, input }) => operations.preview(input, operationContext(ctx.request, { params: input }, '/results/[id]/previews/[targetId]')).then(unwrapOperation)),
  openPreview: p.input(operations.openPreviewInput).mutation(({ ctx, input }) => operations.openPreview(input, operationContext(ctx.request, { params: { id: input.id, targetId: input.targetId } }, '/results/[id]/previews/[targetId]')).then(unwrapOperation)),
});
