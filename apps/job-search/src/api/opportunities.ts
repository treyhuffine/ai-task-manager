import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import { defineAction, type AppInvocation } from '@ri/app-kit/sdk';
import { writeResultSchema, type AccessScope } from '@ri/app-kit/data';
import {
  CHANNELS, compensationSchema, coverageSchema, correspondenceSchema, followUpSchema, id, interviewSchema, localDate, MANUAL_SOURCE, opportunityRecordSchema, opportunitySummarySchema,
  outcomeSchema, postingDetailSchema, postingSummarySchema, requirementSchema, reviewItemSchema, stageEventSchema, stageSchema, submissionSchema, workArrangementSchema,
} from '../domain/model.js';
import { app } from '../server/state.js';
import { changeStageFor, createOpportunity, requireOpportunityRow, setStageTracking, updateOpportunityFields } from '../server/opportunities.js';
import { loadBundles, opportunityRecord } from '../server/project.js';
import { getOpportunity, listOpportunities, opportunityRowFor } from '../server/reads.js';
import { latestSnapshot, postingDetail, saveSnapshot } from '../server/postings.js';
import { recordSubmission, submissionRecords } from '../server/submissions.js';
import { authorOf, COMMON_ERRORS, EX, exampleCoverage, exampleRecord, exampleReview, exampleSummary, exampleInterview, listShape, readScope, WRITE_ERRORS, writeScope } from './common.js';
import { str } from '../server/util.js';

function recordFor(id: string, scope: AccessScope) {
  const row = requireOpportunityRow(id);
  return opportunityRecord(loadBundles([row], scope)[0], scope);
}

const countsSchema = z.object({ saved: z.number().int(), applied: z.number().int(), interviewing: z.number().int(), offer: z.number().int(), closed: z.number().int(), archived: z.number().int() }).strict();

export const listOpportunitiesAction = defineAction({
  name: 'list_opportunities',
  description: 'List saved job opportunities with their current stage, next interview, deadline or chosen action and last activity. Search by company or role, filter by stage, and choose active, closed (rejected, withdrawn or accepted), archived or all. Results and counts include only records this caller may see.',
  input: z.object({
    ...listShape,
    search: z.string().max(200).optional(),
    stage: stageSchema.optional(),
    outcome: outcomeSchema.optional(),
    view: z.enum(['active', 'closed', 'archived', 'all']).default('active'),
  }).strict(),
  output: z.object({ items: z.array(opportunitySummarySchema), nextCursor: z.string().nullable(), total: z.number().int().min(0), counts: countsSchema, coverage: coverageSchema, revision: z.string() }).strict(),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{ input: { limit: 50, view: 'active' }, output: { items: [exampleSummary], nextCursor: null, total: 1, counts: { saved: 0, applied: 0, interviewing: 1, offer: 0, closed: 0, archived: 0 }, coverage: exampleCoverage, revision: 'r42' } }],
  handler: (input, invocation) => listOpportunities(readScope(invocation), invocation.access, input),
});

const detailSchema = z.object({
  opportunity: opportunityRecordSchema,
  requirements: z.array(requirementSchema),
  postings: z.array(postingSummarySchema),
  stageHistory: z.array(stageEventSchema),
  correspondence: z.array(correspondenceSchema),
  interviews: z.array(interviewSchema),
  submissions: z.array(submissionSchema),
  followUps: z.array(followUpSchema),
  reviews: z.array(reviewItemSchema),
  preparations: z.array(z.object({ id, interviewId: id.nullable(), revision: z.number().int(), updatedAt: z.string() }).strict()),
  coverage: coverageSchema,
  revision: z.string(),
}).strict();

export const getOpportunityAction = defineAction({
  name: 'get_opportunity',
  description: 'Read one opportunity with its posting snapshots and stated requirements, stage history (who or what changed it, with confidence), linked correspondence, interviews, recorded submissions with exact material versions, follow-ups and open review items. Only sources this caller may see are included.',
  input: z.object({ id }).strict(),
  output: detailSchema,
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{
    input: { id: EX.opportunity },
    output: {
      opportunity: exampleRecord, requirements: [{ id: 'r1', text: 'Turn complex workflows into clear product experiences.', passage: '- Turn complex workflows into clear product experiences.', section: 'What you will do' }],
      postings: [{ id: EX.snapshot, opportunityId: EX.opportunity, capturedAt: '2026-10-08T17:00:00.000Z', origin: 'paste', sourceUrl: 'https://jobs.northstar.example/product-designer', fileName: null, contentDigest: EX.digest, characters: 3200, truncated: false, requirements: 6, latest: true, usedByPreparations: 1 }],
      stageHistory: [{ id: 'e1', opportunityId: EX.opportunity, fromStage: 'applied', fromOutcome: null, toStage: 'interviewing', toOutcome: null, occurredAt: '2026-10-12T15:04:00.000Z', author: 'automatic', source: 'account:conn-mail-1', confidence: 'exact', decision: 'applied', evidence: { kind: 'correspondence', id: EX.message }, revision: 4, note: 'Interview confirmed email', createdAt: '2026-10-12T15:04:00.000Z' }],
      correspondence: [], interviews: [exampleInterview], submissions: [], followUps: [], reviews: [], preparations: [{ id: EX.preparation, interviewId: EX.interview, revision: 3, updatedAt: '2026-10-15T09:00:00.000Z' }],
      coverage: exampleCoverage, revision: 'r42',
    },
  }],
  handler: (input, invocation) => getOpportunity(readScope(invocation), invocation.access, input.id),
});

const contactInput = z.object({ email: z.string().email().max(320), name: z.string().max(200).nullable() }).strict();
const compensationInput = compensationSchema.extend({ id: z.string().min(1).max(64), source: z.enum(['posting', 'offer', 'user']) }).strict();

export const saveOpportunityAction = defineAction({
  name: 'save_opportunity',
  description: 'Create an opportunity (company and role required, other fields may stay unknown) or update one with the revision you read. A description, when given, is kept as an immutable posting snapshot. Compensation is stored exactly as stated, in minor units with currency, period and qualifiers, and is never converted. This never contacts an employer.',
  input: z.object({
    id: id.optional(),
    expectedRevision: z.number().int().min(0).optional(),
    company: z.string().max(200).optional(),
    role: z.string().max(200).optional(),
    location: z.string().max(200).nullable().optional(),
    workArrangement: workArrangementSchema.nullable().optional(),
    sourceUrl: z.string().max(2000).nullable().optional(),
    requisitionId: z.string().max(60).nullable().optional(),
    nextAction: z.string().max(300).nullable().optional(),
    nextActionDue: localDate.nullable().optional(),
    deadline: localDate.nullable().optional(),
    deadlineLabel: z.string().max(120).nullable().optional(),
    compensation: z.array(compensationInput).max(8).optional(),
    notes: z.string().max(20000).nullable().optional(),
    contacts: z.array(contactInput).max(20).optional(),
    archived: z.boolean().optional(),
    listingClosed: z.boolean().optional(),
    description: z.string().max(200_000).optional(),
  }).strict(),
  output: writeResultSchema(opportunityRecordSchema),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS],
  examples: [
    { input: { company: 'Northstar', role: 'Product designer', sourceUrl: 'https://jobs.northstar.example/product-designer' }, output: { status: 'saved', record: exampleRecord } },
    { input: { id: EX.opportunity, expectedRevision: 3, nextAction: 'Prepare portfolio walkthrough', nextActionDue: '2026-10-15' }, output: { status: 'conflict', current: exampleRecord, message: 'This opportunity changed since you opened it. Compare and try again' } },
  ],
  handler: (input, invocation) => {
    const scope = writeScope(invocation);
    const author = authorOf(invocation);
    return app().store.mutate(invocation, 'save_opportunity', input, () => {
      const { id: target, expectedRevision, description, archived, listingClosed, ...fields } = input;
      if (!target) {
        if (!fields.company?.trim() || !fields.role?.trim()) throw new AppError('invalid_input', 'Add the company and the role');
        const row = createOpportunity({ ...fields, company: fields.company, role: fields.role }, author);
        if (description?.trim()) saveSnapshot({ opportunityId: str(row.id), text: description, origin: 'paste', sourceUrl: fields.sourceUrl ?? null }, author);
        if (archived || listingClosed) updateOpportunityFields(str(row.id), Number(requireOpportunityRow(str(row.id)).revision), { archived, listingClosed }, author, scope);
        return { status: 'saved' as const, record: recordFor(str(row.id), scope) };
      }
      if (expectedRevision === undefined) throw new AppError('invalid_input', 'Include the revision you edited, so a newer change is not overwritten');
      const updated = updateOpportunityFields(target, expectedRevision, { ...fields, archived, listingClosed }, author, scope);
      if (!updated) return { status: 'conflict' as const, current: recordFor(target, scope), message: 'This opportunity changed since you opened it. Compare and try again' };
      if (description?.trim()) saveSnapshot({ opportunityId: target, text: description, origin: 'paste' }, author);
      return { status: 'saved' as const, record: recordFor(target, scope) };
    });
  },
});

export const changeStageAction = defineAction({
  name: 'change_stage',
  description: 'Move an opportunity to Saved, Applied, Interviewing, Offer or Closed (with outcome rejected, withdrawn or accepted). This is the person\'s correction: it is recorded in the stage history and stays in force, and later automatic changes from email or calendar that disagree are held for review instead of applied. Nothing is sent to the employer.',
  input: z.object({ id, expectedRevision: z.number().int().min(0), stage: stageSchema, outcome: outcomeSchema.nullable().optional(), occurredOn: localDate.optional(), note: z.string().max(500).optional() }).strict(),
  output: writeResultSchema(opportunityRecordSchema),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS],
  examples: [{ input: { id: EX.opportunity, expectedRevision: 3, stage: 'interviewing' }, output: { status: 'saved', record: { ...exampleRecord, stageLocked: true, stageLock: { stage: 'interviewing', outcome: null, at: '2026-10-15T09:00:00.000Z', by: 'owner-ui:owner', eventId: 'e2' } } } }],
  handler: (input, invocation) => {
    const scope = writeScope(invocation);
    const author = authorOf(invocation);
    return app().store.mutate(invocation, 'change_stage', input, () => {
      const row = requireOpportunityRow(input.id);
      if (Number(row.revision) !== input.expectedRevision) return { status: 'conflict' as const, current: recordFor(input.id, scope), message: 'This opportunity changed since you opened it. Check its stage and try again' };
      changeStageFor({ opportunityId: input.id, target: { stage: input.stage, outcome: input.outcome ?? null }, kind: 'user', author, source: MANUAL_SOURCE, confidence: 'user', at: input.occurredOn ? `${input.occurredOn}T12:00:00.000Z` : undefined, note: input.note ?? null });
      return { status: 'saved' as const, record: recordFor(input.id, scope) };
    });
  },
});

export const setStageTrackingAction = defineAction({
  name: 'set_stage_tracking',
  description: 'Choose whether email and calendar evidence may update this opportunity\'s stage again, or keep the stage the person set.',
  input: z.object({ id, expectedRevision: z.number().int().min(0), automatic: z.boolean() }).strict(),
  output: writeResultSchema(opportunityRecordSchema),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app', errors: [...WRITE_ERRORS],
  examples: [{ input: { id: EX.opportunity, expectedRevision: 4, automatic: true }, output: { status: 'saved', record: exampleRecord } }],
  handler: (input, invocation) => {
    const scope = writeScope(invocation);
    return app().store.mutate(invocation, 'set_stage_tracking', input, () => {
      const row = setStageTracking(input.id, input.expectedRevision, input.automatic, authorOf(invocation));
      if (!row) return { status: 'conflict' as const, current: recordFor(input.id, scope), message: 'This opportunity changed since you opened it' };
      return { status: 'saved' as const, record: recordFor(input.id, scope) };
    });
  },
});

export const getPostingAction = defineAction({
  name: 'get_posting',
  description: 'Read one saved posting snapshot exactly as captured, with its digest, extracted fields and the passages they came from. Earlier snapshots stay readable after the listing changes or closes.',
  input: z.object({ id }).strict(),
  output: postingDetailSchema,
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{
    input: { id: EX.snapshot },
    output: {
      id: EX.snapshot, opportunityId: EX.opportunity, capturedAt: '2026-10-08T17:00:00.000Z', origin: 'paste', sourceUrl: null, fileName: null, contentDigest: EX.digest, characters: 64, truncated: false, requirements: 1, latest: true, usedByPreparations: 1,
      text: 'Product designer at Northstar\n\nWhat you will do\n- Turn complex workflows into clear product experiences.', textAvailable: true,
      extracted: { company: { value: 'Northstar', passage: 'Product designer at Northstar' }, role: { value: 'Product designer', passage: 'Product designer at Northstar' }, location: null, workArrangement: null, requisitionId: null, compensation: [], requirements: [{ id: 'r1', text: 'Turn complex workflows into clear product experiences.', passage: '- Turn complex workflows into clear product experiences.', section: 'What you will do' }] },
    },
  }],
  handler: (input, invocation) => {
    const scope = readScope(invocation);
    const row = app().db.prepare('SELECT * FROM posting_snapshots WHERE id = ?').get(input.id);
    if (!row) throw new AppError('not_found', 'This posting snapshot is not available');
    opportunityRowFor(scope, str(row.opportunity_id));
    const latest = latestSnapshot(str(row.opportunity_id));
    return postingDetail(row, latest ? str(latest.id) : null);
  },
});

export const recordSubmissionAction = defineAction({
  name: 'record_submission',
  description: 'Record that the person applied: the date, the channel and the exact material versions they used. Without a receipt the person must confirm it. A Saved opportunity moves to Applied. This only records what happened and never sends an application.',
  input: z.object({
    opportunityId: id,
    expectedRevision: z.number().int().min(0),
    appliedOn: localDate,
    channel: z.enum(CHANNELS),
    materialVersionIds: z.array(id).max(10),
    evidenceId: id.nullable().optional(),
    confirmed: z.boolean(),
    note: z.string().max(1000).optional(),
  }).strict(),
  output: writeResultSchema(z.object({ submission: submissionSchema.nullable(), opportunity: opportunityRecordSchema }).strict()),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS],
  examples: [{
    input: { opportunityId: EX.opportunity, expectedRevision: 2, appliedOn: '2026-10-09', channel: 'company_site', materialVersionIds: [EX.version3], confirmed: true },
    output: { status: 'saved', record: { submission: { id: EX.submission, opportunityId: EX.opportunity, appliedOn: '2026-10-09', channel: 'company_site', materials: [{ versionId: EX.version3, familyId: EX.material, title: 'Product design résumé', number: 3, kind: 'resume', shared: true }], evidenceId: null, confirmedByUser: true, note: null, author: 'owner-ui:owner', createdAt: '2026-10-09T18:00:00.000Z' }, opportunity: { ...exampleRecord, stage: 'applied', next: { kind: 'applied', date: '2026-10-09' } } } },
  }],
  handler: (input, invocation) => {
    const scope = writeScope(invocation);
    const author = authorOf(invocation);
    return app().store.mutate(invocation, 'record_submission', input, () => {
      const result = recordSubmission(input, author);
      if (result.status === 'conflict') return { status: 'conflict' as const, current: { submission: null, opportunity: recordFor(input.opportunityId, scope) }, message: 'This opportunity changed since you opened it. Check it and record the application again' };
      const submission = (submissionRecords([input.opportunityId], scope).get(input.opportunityId) ?? []).find((item) => item.id === str(result.submission.id)) ?? null;
      return { status: 'saved' as const, record: { submission, opportunity: recordFor(input.opportunityId, scope) } };
    });
  },
});

export const opportunityActions = [listOpportunitiesAction, getOpportunityAction, saveOpportunityAction, changeStageAction, setStageTrackingAction, getPostingAction, recordSubmissionAction];
export { exampleReview, EX };
export type { AppInvocation };
