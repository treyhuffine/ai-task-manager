import { AppError } from '@ri/app-kit/contract';
import { z } from 'zod/v4';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { actor, ctx, requireOwner, writeScope } from '../runtime.js';
import { closeReview, decideIdentity, getReviewRow } from '../domain/reviews.js';
import { merge, undoMerge, undoPreview } from '../domain/merge.js';
import { saveAffiliation } from '../domain/affiliations.js';
import { deleteRecord } from '../domain/records.js';
import { touch } from '../domain/scope.js';
import { idSchema } from '../schemas.js';
import { DIGEST, ID } from './examples.js';
import { WRITE_ERRORS, action } from './shared.js';

const mergeInput = z.object({ survivorId: idSchema, mergedId: idSchema, survivorRevision: z.number().int().min(0), mergedRevision: z.number().int().min(0), reviewId: idSchema.optional() }).strict();
const mergeOutput = z.object({ status: z.enum(['saved', 'conflict']), mergeId: idSchema.nullable(), message: z.string().max(300).nullable() }).strict();

function mergeHandler(kind: 'person' | 'organization', name: string) {
  return (input: z.infer<typeof mergeInput>, invocation: AppInvocation) => {
    const c = ctx(), scope = writeScope(invocation);
    requireOwner(scope);
    return c.mutate(invocation, name, input, () => {
      const result = merge(c, kind, actor(invocation), input);
      if (result.status === 'saved' && input.reviewId) {
        const review = getReviewRow(c, input.reviewId);
        if (review?.state === 'open') closeReview(c, review.id, 'merged', actor(invocation), result.mergeId);
      }
      return result;
    });
  };
}

export const identityActions = [
  action({
    name: 'resolve_identity',
    description: 'Decide an identity review: keep two records separate (remembered, never proposed again), accept or reject an address seen in a signature, or include or keep out an incoming-only sender. Accepting can record a company and role in the same step. Merges use merge_people or merge_organizations.',
    input: z.object({
      reviewId: idSchema, expectedRevision: z.number().int().min(0), decision: z.enum(['keep_separate', 'accept', 'reject', 'include', 'exclude']),
      affiliation: z.object({ organizationId: idSchema.optional(), organizationName: z.string().max(200).optional(), role: z.string().max(200).nullable().optional() }).strict().optional(),
    }).strict(),
    output: z.object({ status: z.enum(['saved', 'conflict']), personId: idSchema.nullable(), message: z.string().max(300).nullable() }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { reviewId: ID.review, expectedRevision: 1, decision: 'accept' }, output: { status: 'saved', personId: ID.maya, message: null } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.mutate(invocation, 'resolve_identity', input, () => {
        const review = getReviewRow(c, input.reviewId);
        if (!review) throw new AppError('not_found', 'This review is no longer available');
        if (review.revision !== input.expectedRevision) return { status: 'conflict' as const, personId: null, message: 'This review changed. Reload it' };
        const result = decideIdentity(c, actor(invocation), review, input.decision);
        if (input.affiliation && result.personId && (input.decision === 'accept' || input.decision === 'include'))
          saveAffiliation(c, scope, actor(invocation), { personId: result.personId, organizationId: input.affiliation.organizationId, organizationName: input.affiliation.organizationName, role: input.affiliation.role ?? null, status: 'current' });
        touch(c);
        return { status: 'saved' as const, personId: result.personId, message: null };
      });
    },
  }),
  action({
    name: 'merge_people',
    description: 'Merge two people after review. Every moved reference is recorded so undo can restore it, and the merged record and its evidence are retained. If either record changed since review, nothing is merged.',
    input: mergeInput, output: mergeOutput,
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { survivorId: ID.maya, mergedId: ID.jordan, survivorRevision: 3, mergedRevision: 1 }, output: { status: 'saved', mergeId: ID.merge, message: null } }],
    handler: mergeHandler('person', 'merge_people'),
  }),
  action({
    name: 'merge_organizations',
    description: 'Merge two companies after review, with the same recorded reference moves and undo as people. A shared name or domain alone is never treated as proof.',
    input: mergeInput, output: mergeOutput,
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { survivorId: ID.fieldwork, mergedId: ID.northstar, survivorRevision: 2, mergedRevision: 1 }, output: { status: 'conflict', mergeId: null, message: 'One of these records changed since you reviewed it. Nothing was merged. Review again' } }],
    handler: mergeHandler('organization', 'merge_organizations'),
  }),
  action({
    name: 'undo_merge',
    description: 'Preview or apply an undo. The preview lists the references to restore and any added after the merge, which you attribute to one record or the other. Applying restores exactly the recorded references, or fails without changes if anything moved since the preview.',
    input: z.union([
      z.object({ mergeId: idSchema, preview: z.literal(true) }).strict(),
      z.object({ mergeId: idSchema, expectedRevision: z.number().int().min(0), digest: z.string().length(64), attributions: z.array(z.object({ ref: z.string().max(200), to: z.enum(['survivor', 'restored']) }).strict()).max(400) }).strict(),
    ]),
    output: z.union([
      z.object({ mergeId: idSchema, revision: z.number().int(), kind: z.enum(['person', 'organization']), survivorId: idSchema, mergedId: idSchema, restores: z.number().int(), laterReferences: z.array(z.object({ ref: z.string().max(200), label: z.string().max(200), createdAt: z.string() }).strict()).max(400), digest: z.string().length(64) }).strict(),
      z.object({ status: z.literal('saved'), mergeId: idSchema, restored: idSchema, skipped: z.array(z.string().max(200)).max(400) }).strict(),
    ]),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [
      { input: { mergeId: ID.merge, preview: true }, output: { mergeId: ID.merge, revision: 1, kind: 'person', survivorId: ID.maya, mergedId: ID.jordan, restores: 4, laterReferences: [{ ref: `notes:${ID.note}`, label: 'Note: Ask how the design and research teams work together.', createdAt: '2026-10-15T15:12:00.000Z' }], digest: DIGEST } },
      { input: { mergeId: ID.merge, expectedRevision: 1, digest: DIGEST, attributions: [{ ref: `notes:${ID.note}`, to: 'survivor' }] }, output: { status: 'saved', mergeId: ID.merge, restored: ID.jordan, skipped: [] } },
    ],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      if ('preview' in input) return undoPreview(c, input.mergeId);
      return c.mutate(invocation, 'undo_merge', input, () => undoMerge(c, actor(invocation), input));
    },
  }),
  action({
    name: 'delete_record',
    description: 'Archive or remove a person or company. Remove deletes imported details and links, keeps conversations in their sources, and either keeps your notes on an archived record or deletes them. Suppress stops rediscovery of its addresses until you clear it in Sources. Ri tasks and a company\'s people are never deleted.',
    input: z.object({ kind: z.enum(['person', 'organization']), id: idSchema, expectedRevision: z.number().int().min(0), mode: z.enum(['archive', 'remove']), notes: z.enum(['keep', 'delete']), suppress: z.boolean() }).strict(),
    output: z.object({ status: z.enum(['saved', 'conflict']), message: z.string().max(300) }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { kind: 'person', id: ID.jordan, expectedRevision: 1, mode: 'archive', notes: 'keep', suppress: false }, output: { status: 'saved', message: 'Archived' } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.mutate(invocation, 'delete_record', input, () => deleteRecord(c, input));
    },
  }),
];
