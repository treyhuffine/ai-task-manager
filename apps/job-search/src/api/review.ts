import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import { defineAction } from '@ri/app-kit/sdk';
import { allows, writeResultSchema } from '@ri/app-kit/data';
import { correspondenceSchema, id, MANUAL_SOURCE, reviewItemSchema } from '../domain/model.js';
import { app } from '../server/state.js';
import { reviewRecord } from '../server/project.js';
import { correspondenceDetail, listReview } from '../server/reads.js';
import { resolveReview } from '../server/resolve.js';
import { getReviewRow } from '../server/review.js';
import { authorOf, COMMON_ERRORS, EX, exampleCoverage, exampleReview, listOutput, listShape, readScope, WRITE_ERRORS } from './common.js';
import { str } from '../server/util.js';

export const listReviewAction = defineAction({
  name: 'list_review',
  description: 'List open review items: messages or calendar events that could belong to more than one role, job mail that matches no saved role, and stage changes suggested by evidence or held back by the person\'s own stage. Each lists candidate opportunities with the evidence for each.',
  input: z.object({ ...listShape }).strict(),
  output: listOutput(reviewItemSchema),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{ input: { limit: 20 }, output: { items: [exampleReview], nextCursor: null, coverage: exampleCoverage, revision: 'r42' } }],
  handler: (input, invocation) => listReview(readScope(invocation), invocation.access, input),
});

export const resolveMatchAction = defineAction({
  name: 'resolve_match',
  description: 'Decide a review item. attach links its messages or event to one opportunity (and the whole thread from then on), create adds a new opportunity from it, ignore keeps the thread out of the pipeline, and accept_stage or keep_stage decide a suggested stage. Stage effects apply only when chosen. Nothing is sent.',
  input: z.object({
    reviewId: id,
    expectedRevision: z.number().int().min(0),
    decision: z.enum(['attach', 'create', 'ignore', 'accept_stage', 'keep_stage']),
    opportunityId: id.optional(),
    applyStage: z.boolean().optional(),
    company: z.string().max(200).optional(),
    role: z.string().max(200).optional(),
  }).strict(),
  output: writeResultSchema(z.object({ review: reviewItemSchema, opportunityId: id.nullable() }).strict()),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS],
  examples: [{ input: { reviewId: EX.review, expectedRevision: 1, decision: 'attach', opportunityId: EX.opportunity, applyStage: false }, output: { status: 'saved', record: { review: { ...exampleReview, status: 'resolved', revision: 2, decision: 'Attached' }, opportunityId: EX.opportunity } } }],
  handler: (input, invocation) => {
    const scope = app().scopes.resolve(invocation, 'write');
    const review = getReviewRow(input.reviewId);
    if (!review || !allows(scope, str(review.source_key))) throw new AppError('not_found', 'This review item is not available to this caller');
    if (!allows(scope, MANUAL_SOURCE)) throw new AppError('forbidden', 'This caller may not change your saved jobs');
    return app().store.mutate(invocation, 'resolve_match', input, () => {
      const result = resolveReview(input, authorOf(invocation));
      const current = reviewRecord(getReviewRow(input.reviewId)!, scope);
      if (result.status === 'conflict') return { status: 'conflict' as const, current: { review: current, opportunityId: null }, message: 'New evidence joined this item while you looked. Review it again' };
      return { status: 'saved' as const, record: { review: current, opportunityId: result.opportunityId } };
    });
  },
});

export const getCorrespondenceAction = defineAction({
  name: 'get_correspondence',
  description: 'Read one imported email: participants, date, how it was classified and matched, and its text as imported (quoted replies removed, bounded). A message deleted at the source is labeled unavailable.',
  input: z.object({ id }).strict(),
  output: z.object({ message: correspondenceSchema, body: z.string().nullable(), passage: z.string().nullable() }).strict(),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{
    input: { id: EX.message },
    output: {
      message: { id: EX.message, source: 'account:conn-mail-1', account: 'conn-mail-1', threadId: 'thread-7', subject: 'Portfolio discussion confirmed', from: { email: 'maya.chen@northstar.example', name: 'Maya Chen' }, to: [{ email: 'you@example.test', name: null }], sent: false, receivedAt: '2026-10-12T15:04:00.000Z', evidence: 'We look forward to discussing your portfolio on Friday, October 16 at 10:00 MDT.', classification: 'interview_confirmed', opportunityId: EX.opportunity, matchStatus: 'matched', matchLevel: 'exact', matchBasis: [{ kind: 'thread', detail: 'Same email thread as a message already linked to this role' }], matchedBy: 'automatic', aiLabel: null, unavailable: false },
      body: 'We look forward to discussing your portfolio on Friday, October 16 at 10:00 MDT. Please bring an example of a complex product decision.',
      passage: 'We look forward to discussing your portfolio on Friday, October 16 at 10:00 MDT.',
    },
  }],
  handler: (input, invocation) => correspondenceDetail(readScope(invocation), input.id),
});

export const reviewActions = [listReviewAction, resolveMatchAction, getCorrespondenceAction];
