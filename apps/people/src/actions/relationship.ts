import { AppError } from '@ri/app-kit/contract';
import { z } from 'zod/v4';
import { actor, ctx, granted, readScope, writeScope } from '../runtime.js';
import { coverageFor, Labels } from '../domain/coverage.js';
import { dataRevision } from '../domain/scope.js';
import { getNote, saveNote } from '../domain/notes.js';
import { listFollowUps, projectCommitment, reviewCommitment, saveCommitment, type CommitmentRow } from '../domain/commitments.js';
import { decideFact, factDetail, getFactRow, projectFact } from '../domain/facts.js';
import { getBriefing, requestBriefing } from '../domain/briefings.js';
import { relationshipContext } from '../domain/context-packets.js';
import { checkFollowUps, completeFollowUp, prepareFollowUp } from '../domain/followups.js';
import { getToday } from '../domain/today.js';
import { listReviews } from '../domain/reviews.js';
import { getEvidence } from '../domain/records.js';
import { saveAffiliation } from '../domain/affiliations.js';
import { moveOpportunity } from '../domain/pipelines.js';
import { personRef, organizationRef } from '../domain/projection.js';
import { resolvePersonId } from '../domain/people.js';
import { organizationVisible } from '../domain/projection.js';
import {
  briefingSchema, collectionKeySchema, commitmentSchema, coverageSchema, evidenceSchema, factSchema, idSchema, localDateSchema, noteSchema, taskLinkSchema, writeResult, refSchema,
} from '../schemas.js';
import { BRIEFING, COMMITMENT, COVERAGE, FACT, ID, NOTE, PERSON, T, TASK } from './examples.js';
import { READ_ERRORS, WRITE_ERRORS, action, listInput, listOutput } from './shared.js';

const followUpItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commitment'), commitment: commitmentSchema }).strict(),
  z.object({ kind: z.literal('task'), task: taskLinkSchema, subject: z.object({ kind: z.string().max(20), id: idSchema, name: z.string().max(300) }).strict().nullable() }).strict(),
]);
const reviewItem = z.object({
  id: idSchema, revision: z.number().int(), kind: z.enum(['person', 'organization', 'alias', 'sender']), reason: z.string().max(60), summary: z.string().max(600), passage: z.string().max(1200).nullable(), evidenceIds: z.array(idSchema).max(5),
  left: z.object({ id: idSchema, name: z.string().max(320), detail: z.string().max(400).nullable() }).strict(),
  right: z.object({ id: idSchema, name: z.string().max(320), detail: z.string().max(400).nullable() }).strict().nullable(),
  identifier: z.string().max(320).nullable(), createdAt: z.string(),
}).strict();
const subjectInput = { subjectKind: z.enum(['person', 'organization']), subjectId: idSchema, meetingId: idSchema.optional() };
const contextItem = z.object({ kind: z.enum(['affiliation', 'commitment', 'fact', 'note', 'opportunity', 'stage']), text: z.string().max(1200), date: z.string().nullable(), state: z.string().max(40).nullable(), evidenceId: idSchema.nullable(), excerpt: z.string().max(400).nullable() }).strict();
const contextInteraction = z.object({ id: idSchema, kind: z.string().max(20), label: z.string().max(120), at: z.string(), title: z.string().max(400), sourceLabel: z.string().max(300), participants: z.array(z.string().max(320)).max(6), excerpt: z.string().max(400).nullable(), evidenceId: idSchema.nullable() }).strict();

export const relationshipActions = [
  action({
    name: 'get_today',
    description: 'Today: upcoming meetings in the next seven days, chosen follow-ups, waiting-on items, chosen keep-in-touch reminders and a short sourced review queue. Nothing is invented to fill the page.',
    input: z.object({}).strict(),
    output: z.object({
      meetings: z.array(z.object({ id: idSchema, at: z.string(), title: z.string().max(300), people: z.array(refSchema).max(8), declined: z.boolean() }).strict()).max(10),
      iOwe: z.array(followUpItem).max(10), waitingOn: z.array(followUpItem).max(10),
      keepInTouch: z.array(z.object({ id: idSchema, name: z.string().max(200), lastExchangeAt: z.string().nullable(), intervalDays: z.number().int() }).strict()).max(5),
      review: z.object({ suggestions: z.array(followUpItem).max(3), suggestionCount: z.number().int(), facts: z.array(factSchema).max(3), factCount: z.number().int(), identities: z.array(reviewItem).max(3), identityCount: z.number().int() }).strict(),
      focusPersonId: idSchema.nullable(), empty: z.boolean(), coverage: coverageSchema, revision: z.string().max(80),
    }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: {}, output: { meetings: [{ id: ID.meeting, at: T.meeting, title: 'Portfolio discussion', people: [{ id: ID.maya, name: 'Maya Chen' }], declined: false }], iOwe: [{ kind: 'commitment', commitment: { ...COMMITMENT, state: 'accepted' } }], waitingOn: [], keepInTouch: [], review: { suggestions: [], suggestionCount: 0, facts: [], factCount: 0, identities: [], identityCount: 0 }, focusPersonId: ID.maya, empty: false, coverage: COVERAGE, revision: 'o12' } }],
    handler(_input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return getToday(c, scope, granted(invocation));
    },
  }),
  action({
    name: 'save_note',
    description: 'Write or edit a private note about a person, company or opportunity. A note keeps its own collection, so linking it to a company never shares it. Edits need the expected revision and a conflict keeps your text.',
    input: z.object({
      id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(),
      subjectKind: z.enum(['person', 'organization', 'opportunity']).optional(), subjectId: idSchema.optional(),
      title: z.string().max(200).nullable().optional(), body: z.string().max(20000).optional(), collection: collectionKeySchema.optional(), archived: z.boolean().optional(),
    }).strict(),
    output: writeResult(noteSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { subjectKind: 'person', subjectId: ID.maya, title: 'Remember for next time', body: 'Ask how the design and research teams work together.' }, output: { status: 'saved', record: NOTE } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_note', input, () => {
        const subjectId = input.subjectKind === 'person' && input.subjectId ? resolvePersonId(c, input.subjectId) : input.subjectId;
        const result = saveNote(c, scope, { ...input, subjectId });
        const record = getNote(c, scope, result.id, new Labels(c));
        if (!record) throw new AppError('not_found', 'This note is no longer available');
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'list_commitments',
    description: 'Follow-ups: I owe (accepted commitments and chosen Ri follow-ups), Waiting on (what others offered you), Suggestions (inferred from messages, not yet reviewed) or Completed. Each item names its evidence. Partial coverage is reported, never an all-clear.',
    input: z.object({ filter: z.enum(['i_owe', 'waiting_on', 'suggestions', 'completed']), personId: idSchema.optional(), organizationId: idSchema.optional(), includeSnoozed: z.boolean().optional(), ...listInput }).strict(),
    output: listOutput(followUpItem),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { filter: 'suggestions', limit: 50 }, output: { items: [{ kind: 'commitment', commitment: COMMITMENT }], nextCursor: null, coverage: COVERAGE, revision: 'o12' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      const result = listFollowUps(c, scope, { ...input, personId: input.personId ? resolvePersonId(c, input.personId) : undefined }, new Labels(c));
      return { ...result, coverage: coverageFor(c, scope, granted(invocation)), revision: dataRevision(c, scope) };
    },
  }),
  action({
    name: 'review_commitment',
    description: 'Accept, edit, dismiss, snooze, complete or reopen a commitment, or keep it open after a later message suggested it was done. Your decision is stored separately from the extracted text and survives resync. Completing never completes its Ri task.',
    input: z.object({
      id: idSchema, expectedRevision: z.number().int().min(0),
      decision: z.enum(['accept', 'dismiss', 'complete', 'reopen', 'snooze', 'unsnooze', 'keep_open']),
      snoozedUntil: localDateSchema.nullable().optional(), action: z.string().max(500).optional(), dueDate: localDateSchema.nullable().optional(),
    }).strict(),
    output: writeResult(commitmentSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { id: ID.commitment, expectedRevision: 2, decision: 'accept' }, output: { status: 'saved', record: { ...COMMITMENT, revision: 3, state: 'accepted' } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'review_commitment', input, () => {
        const result = reviewCommitment(c, scope, actor(invocation), input);
        const row = c.db.get<CommitmentRow>('SELECT * FROM commitments WHERE id = ?', result.id)!;
        const record = projectCommitment(c, scope, row, new Labels(c))!;
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'save_commitment',
    description: 'Record a commitment yourself (something you owe or are waiting on) for a person or company, or edit its wording or date. Extracted wording is kept beside your edit.',
    input: z.object({
      id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(), direction: z.enum(['i_owe', 'waiting_on']).optional(),
      personId: idSchema.nullable().optional(), organizationId: idSchema.nullable().optional(), action: z.string().max(500).optional(), dueDate: localDateSchema.nullable().optional(), collection: collectionKeySchema.optional(),
    }).strict(),
    output: writeResult(commitmentSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { direction: 'waiting_on', personId: ID.jordan, action: 'Send the signed scope', dueDate: '2026-10-20' }, output: { status: 'saved', record: { ...COMMITMENT, direction: 'waiting_on', person: { id: ID.jordan, name: 'Jordan Bell' }, actorLabel: 'Jordan Bell', recipientLabel: 'You', action: 'Send the signed scope', dueDate: '2026-10-20', state: 'accepted', origin: 'manual', evidenceId: null, passage: null, sourceLabel: 'Your records', occurredAt: null, confirmation: 'Added by you', history: [] } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_commitment', input, () => {
        const personId = input.personId ? resolvePersonId(c, input.personId) : input.personId;
        const person = personId ? personRef(c, scope, personId) : null;
        if (personId && !person) throw new AppError('not_found', 'This person is no longer available');
        const organization = input.organizationId ? organizationRef(c, scope, input.organizationId) : null;
        if (input.organizationId && !organization) throw new AppError('not_found', 'This company is no longer available');
        const result = saveCommitment(c, scope, actor(invocation), { ...input, personId }, { person: person?.name, organization: organization?.name });
        const row = c.db.get<CommitmentRow>('SELECT * FROM commitments WHERE id = ?', result.id)!;
        const record = projectCommitment(c, scope, row, new Labels(c))!;
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'review_fact',
    description: 'Accept, correct, reject or withdraw a sourced fact or suggestion. Accepting a role and company records your confirmed affiliation, and accepting a stage suggestion moves the opportunity in app records only. Rejections and withdrawals survive resync and new extraction versions.',
    input: z.object({
      id: idSchema, expectedRevision: z.number().int().min(0), decision: z.enum(['accept', 'reject', 'correct', 'withdraw']),
      value: z.string().max(500).optional(), organizationId: idSchema.optional(), organizationName: z.string().max(200).optional(), role: z.string().max(200).nullable().optional(),
      collection: collectionKeySchema.optional(), opportunityRevision: z.number().int().min(0).optional(),
    }).strict(),
    output: writeResult(factSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { id: ID.fact, expectedRevision: 1, decision: 'accept', organizationId: ID.northstar, role: 'Design lead' }, output: { status: 'saved', record: { ...FACT, revision: 2, status: 'active', resolution: 'Accepted by you' } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'review_fact', input, () => {
        const labels = new Labels(c);
        const row = getFactRow(c, input.id);
        if (!row) throw new AppError('not_found', 'This fact is no longer available');
        const current = projectFact(c, scope, row, labels);
        if (!current) throw new AppError('not_found', 'This fact is no longer available');
        if (row.revision !== input.expectedRevision) return { status: 'conflict' as const, current, message: 'This suggestion changed since you opened it' };
        if ((input.decision === 'accept' || input.decision === 'correct') && row.field === 'affiliation' && row.subject_kind === 'person') {
          const detail = factDetail(row);
          const organizationId = input.organizationId;
          if (organizationId && !organizationVisible(c, scope, organizationId)) throw new AppError('not_found', 'That company is no longer available');
          const name = input.organizationName ?? (organizationId ? undefined : detail.organization ?? undefined);
          if (!organizationId && !name) throw new AppError('invalid_input', 'Choose or name the company');
          const result = saveAffiliation(c, scope, actor(invocation), { personId: row.subject_id, organizationId, organizationName: organizationId ? undefined : name, role: input.role !== undefined ? input.role : detail.role ?? null, status: 'current', collection: input.collection });
          c.db.run('UPDATE affiliations SET evidence_id = ? WHERE id = ?', row.evidence_id, result.id);
        }
        if (input.decision === 'accept' && row.field === 'stage' && row.subject_kind === 'opportunity') {
          const stageId = factDetail(row).stageId;
          if (!stageId) throw new AppError('invalid_input', 'This suggestion has no stage');
          const opportunity = c.db.get<{ revision: number }>('SELECT revision FROM opportunities WHERE id = ?', row.subject_id);
          if (!opportunity) throw new AppError('not_found', 'This opportunity is no longer available');
          const moved = moveOpportunity(c, scope, actor(invocation), invocation.id, { id: row.subject_id, expectedRevision: input.opportunityRevision ?? opportunity.revision, stageId, suggestionId: row.id, evidenceId: row.evidence_id });
          if (moved.status === 'conflict') return { status: 'conflict' as const, current, message: moved.message ?? 'The opportunity changed' };
        }
        decideFact(c, row, actor(invocation), input.decision, input.value ?? null);
        return { status: 'saved' as const, record: projectFact(c, scope, getFactRow(c, row.id)!, labels)! };
      });
    },
  }),
  action({
    name: 'get_briefing',
    description: 'Read the briefing for a person or company, optionally for one meeting. A saved generated briefing is returned only when its scope and evidence revisions match exactly. Otherwise a summary of permitted meetings, notes and commitments is returned. Never starts sync or AI.',
    input: z.object(subjectInput).strict(),
    output: briefingSchema,
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { subjectKind: 'person', subjectId: ID.maya }, output: BRIEFING }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      const id = input.subjectKind === 'person' ? resolvePersonId(c, input.subjectId) : input.subjectId;
      return getBriefing(c, scope, { kind: input.subjectKind, id }, input.meetingId ?? null, granted(invocation));
    },
  }),
  action({
    name: 'request_briefing',
    description: 'Queue a deduplicated job to generate a briefing for this exact scope. Returns the job ID, coverage and availability. With extraction off it queues nothing and reports unavailable.',
    input: z.object(subjectInput).strict(),
    output: z.object({ jobId: idSchema.nullable(), availability: z.enum(['queued', 'ready', 'unavailable']), coverage: coverageSchema }).strict(),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { subjectKind: 'person', subjectId: ID.maya, meetingId: ID.meeting }, output: { jobId: null, availability: 'unavailable', coverage: COVERAGE } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      const id = input.subjectKind === 'person' ? resolvePersonId(c, input.subjectId) : input.subjectId;
      const result = c.db.tx(() => requestBriefing(c, scope, { kind: input.subjectKind, id }, input.meetingId ?? null));
      return { ...result, coverage: coverageFor(c, scope, granted(invocation)) };
    },
  }),
  action({
    name: 'get_relationship_context',
    description: 'A small cited context packet for chat about a person, company or opportunity: at most 20 facts or commitments and 20 interaction references with short excerpts, the as-of time, checked accounts and ranges, missing evidence and pending extraction. Larger histories return a next cursor.',
    input: z.object({ subjectKind: z.enum(['person', 'organization', 'opportunity']), subjectId: idSchema, meetingId: idSchema.optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional(), cursor: z.string().max(2048).optional() }).strict(),
    output: z.object({
      subject: z.object({ kind: z.enum(['person', 'organization', 'opportunity']), id: idSchema, name: z.string().max(300) }).strict(),
      asOf: z.string(), items: z.array(contextItem).max(20), interactions: z.array(contextInteraction).max(20),
      coverage: z.object({ summary: z.string().max(500), accounts: z.array(z.object({ label: z.string().max(300), kind: z.string().max(20), from: z.string().nullable(), to: z.string().nullable(), partial: z.boolean() }).strict()).max(40), partial: z.boolean() }).strict(),
      missingEvidence: z.array(z.string().max(300)).max(10), pendingExtraction: z.number().int().min(0), truncated: z.boolean(), nextCursor: z.string().max(2048).nullable(),
    }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { subjectKind: 'person', subjectId: ID.maya }, output: {
      subject: { kind: 'person', id: ID.maya, name: 'Maya Chen' }, asOf: T.now,
      items: [{ kind: 'commitment', text: 'The owner owes: Introduce Maya to a research lead, no deadline stated. Suggested from a message, not reviewed. No confirming message found in the indexed history.', date: T.mail, state: 'suggested', evidenceId: ID.evidence, excerpt: 'I would be happy to introduce you to the research lead I mentioned.' }],
      interactions: [{ id: ID.interaction, kind: 'email', label: 'Email sent', at: T.mail, title: 'Portfolio discussion and introduction', sourceLabel: 'Personal Gmail', participants: ['Maya Chen'], excerpt: null, evidenceId: ID.evidence }],
      coverage: { summary: COVERAGE.summary, accounts: [{ label: 'Personal Gmail', kind: 'mail', from: '2026-07-17T15:12:00.000Z', to: T.now, partial: false }], partial: false },
      missingEvidence: ['Relationship extraction is off, so commitments come only from the owner\'s records.'], pendingExtraction: 0, truncated: false, nextCursor: null,
    } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return relationshipContext(c, scope, input, granted(invocation));
    },
  }),
  action({
    name: 'create_follow_up',
    description: 'Create one Ri task for a commitment, person, company or opportunity, with an optional due date, or link an existing Ri task. The app stores a durable operation ID first, so a retry or a second click returns the same task. Shows Allow tasks in Sources when Ri has not allowed it.',
    input: z.object({
      subject: z.object({ kind: z.enum(['commitment', 'person', 'organization', 'opportunity']), id: idSchema }).strict(),
      title: z.string().min(1).max(500), dueAt: z.string().max(40).nullable().optional(), description: z.string().max(4000).nullable().optional(),
      operationId: z.string().uuid().optional(), existingTaskId: z.string().min(1).max(128).optional(), collection: collectionKeySchema.optional(),
    }).strict(),
    output: z.object({ link: taskLinkSchema, created: z.boolean() }).strict(),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS, 'unsupported', 'busy'], timeoutMs: 45000,
    examples: [{ input: { subject: { kind: 'commitment', id: ID.commitment }, title: 'Send Jordan the revised proposal', dueAt: '2026-10-16', operationId: ID.operation }, output: { link: TASK, created: true } }],
    async handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      if (input.existingTaskId && invocation.principal.kind !== 'fixture') {
        try { await invocation.capability('get_task', { id: input.existingTaskId }); }
        catch (error) { if ((error as AppError)?.code === 'not_found') throw new AppError('not_found', 'That Ri task is not available'); throw error; }
      }
      const prepared = c.mutate(invocation, 'create_follow_up', input, () => prepareFollowUp(c, scope, { ...input, subject: input.subject.kind === 'person' ? { kind: 'person', id: resolvePersonId(c, input.subject.id) } : input.subject }, actor(invocation)));
      if (input.existingTaskId || prepared.link.status === 'linked' || prepared.link.status === 'unavailable') return prepared;
      const link = await completeFollowUp(c, invocation, prepared.link.id, input.description ?? null);
      return { link, created: prepared.created };
    },
  }),
  action({
    name: 'check_follow_ups',
    description: 'Refresh what Ri says about linked tasks (at most 50). Ri owns task status. A deleted task is shown as unavailable and is never recreated.',
    input: z.object({ ids: z.array(idSchema).max(50) }).strict(),
    output: z.object({ items: z.array(taskLinkSchema).max(50) }).strict(),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...READ_ERRORS, 'unsupported', 'busy'], timeoutMs: 45000,
    examples: [{ input: { ids: [ID.task] }, output: { items: [TASK] } }],
    async handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return { items: await checkFollowUps(c, invocation, scope, input.ids) };
    },
  }),
  action({
    name: 'list_reviews',
    description: 'Open identity reviews: possible duplicate people or companies, addresses seen in signatures, and incoming-only senders. Each shows both records, shared identifiers and evidence. Nothing is merged automatically.',
    input: z.object({ kind: z.enum(['person', 'organization', 'alias', 'sender']).optional(), recordId: idSchema.optional(), ...listInput }).strict(),
    output: z.object({ items: z.array(reviewItem).max(100), nextCursor: z.string().nullable() }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { limit: 20 }, output: { items: [{ id: ID.review, revision: 1, kind: 'alias', reason: 'signature_alias', summary: 'A signature from maya@northstar.example lists maya.chen@northstar.example. Add it as another address for this person?', passage: 'Maya Chen\nmaya.chen@northstar.example', evidenceIds: [ID.evidence], left: { id: ID.maya, name: 'Maya Chen', detail: 'maya@northstar.example' }, right: null, identifier: 'maya.chen@northstar.example', createdAt: T.mail }], nextCursor: null } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return listReviews(c, scope, input);
    },
  }),
  action({
    name: 'get_evidence',
    description: 'Open the source behind a fact, commitment or timeline row: account, participants, source date, the exact passage with nearby text, and the original link when available. Never returns another account\'s source.',
    input: z.object({ id: idSchema, passage: z.string().max(1200).optional() }).strict(),
    output: evidenceSchema,
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { id: ID.evidence, passage: 'I would be happy to introduce you to the research lead I mentioned.' }, output: { id: ID.evidence, kind: 'email', title: 'Portfolio discussion and introduction', sourceLabel: 'Personal Gmail', sourceDate: T.mail, participants: ['Maya Chen <maya@northstar.example>'], passage: 'I would be happy to introduce you to the research lead I mentioned.', excerpt: 'Hi Maya, I would be happy to introduce you to the research lead I mentioned.', link: 'https://mail.google.com/mail/#all/fictional', status: 'available', statusLabel: 'Exact passage retained from the source' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return getEvidence(c, scope, input, invocation.principal.kind === 'owner-ui' || invocation.principal.kind === 'fixture');
    },
  }),
];
export { PERSON };
