/**
 * Shared pieces for action definitions: scope resolution, list shapes and the
 * fictional examples every action carries in the generated contract.
 */
import { z } from 'zod/v4';
import { listInputShape, type AccessScope } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { AppError } from '@ri/app-kit/contract';
import { allows } from '@ri/app-kit/data';
import { app } from '../server/state.js';
import { coverageSchema, MANUAL_SOURCE, type Coverage, type Interview, type MaterialFamily, type OpportunityRecord, type OpportunitySummary, type Preparation, type ReviewItem } from '../domain/model.js';

export const listShape = listInputShape;
export const listOutput = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable(), coverage: coverageSchema, revision: z.string() }).strict();

export function readScope(invocation: AppInvocation): AccessScope {
  return app().scopes.resolve(invocation, 'read');
}
export function writeScope(invocation: AppInvocation, source = MANUAL_SOURCE, what = 'your saved jobs'): AccessScope {
  const scope = app().scopes.resolve(invocation, 'write');
  if (!allows(scope, source)) throw new AppError('forbidden', `This caller may not change ${what}`);
  return scope;
}

/** The person or caller recorded with a change. */
export function authorOf(invocation: Pick<AppInvocation, 'principal'>): string {
  return `${invocation.principal.kind}:${invocation.principal.id}`;
}

// ─── Fictional examples ─────────────────────────────────────────────────────

export const EX = {
  opportunity: '0192f0aa-0000-7000-8000-000000000101',
  opportunity2: '0192f0aa-0000-7000-8000-000000000102',
  interview: '0192f0aa-0000-7000-8000-000000000201',
  material: '0192f0aa-0000-7000-8000-000000000301',
  version3: '0192f0aa-0000-7000-8000-000000000303',
  version4: '0192f0aa-0000-7000-8000-000000000304',
  submission: '0192f0aa-0000-7000-8000-000000000401',
  preparation: '0192f0aa-0000-7000-8000-000000000501',
  review: '0192f0aa-0000-7000-8000-000000000601',
  message: '0192f0aa-0000-7000-8000-000000000701',
  snapshot: '0192f0aa-0000-7000-8000-000000000801',
  followUp: '0192f0aa-0000-7000-8000-000000000901',
  operation: '0192f0aa-0000-7000-8000-000000000a01',
  scope: '0192f0aa-0000-7000-8000-000000000b01',
  preview: '0192f0aa-0000-7000-8000-000000000c01',
  instance: '0192f0aa-0000-7000-8000-000000000d01',
  digest: 'a3f1c2d4e5b6978877665544332211aabbccddeeff00112233445566778899aa',
};

export const exampleCoverage: Coverage = {
  partial: false,
  sources: [
    { key: 'manual', label: 'Saved jobs, interviews and preparation', kind: 'collection', status: 'ready', from: null, to: null, partial: false },
    { key: 'account:conn-mail-1', label: 'you@example.test', kind: 'mail', status: 'ready', from: '2026-07-17T12:00:00.000Z', to: '2026-10-15T12:00:00.000Z', partial: false },
  ],
};

export const exampleSummary: OpportunitySummary = {
  id: EX.opportunity, revision: 4, company: 'Northstar', role: 'Product designer', location: 'Denver, CO', workArrangement: 'hybrid',
  sourceUrl: 'https://jobs.northstar.example/product-designer', stage: 'interviewing', outcome: null, stageLocked: false, archivedAt: null, listingClosedAt: null,
  hasPosting: true, schedulingNeeded: false, next: { kind: 'interview', interviewId: EX.interview, title: 'Portfolio discussion', startAt: '2026-10-16T16:00:00.000Z', zone: 'America/Denver' },
  note: 'Portfolio discussion', lastActivity: { at: '2026-10-12T15:04:00.000Z', label: 'Interview confirmed' }, openReviews: 0, createdAt: '2026-10-08T17:00:00.000Z', updatedAt: '2026-10-12T15:04:00.000Z',
};

export const exampleRecord: OpportunityRecord = {
  ...exampleSummary,
  requisitionId: 'R-4821', nextAction: 'Prepare portfolio walkthrough', nextActionDue: '2026-10-15', deadline: null, deadlineLabel: null,
  compensation: [{ id: 'c1', kind: 'base', minMinor: 14000000, maxMinor: 16500000, currency: 'USD', period: 'year', qualifiers: ['base salary', 'plus equity'], source: 'posting', passage: 'Base salary: $140,000 to $165,000 per year, plus equity.' }],
  contacts: [{ email: 'maya.chen@northstar.example', name: 'Maya Chen' }], notes: null, stageLock: null,
};

export const exampleInterview: Interview = {
  id: EX.interview, revision: 2, opportunityId: EX.opportunity, company: 'Northstar', role: 'Product designer', source: 'account:conn-cal-1', origin: 'calendar',
  title: 'Portfolio discussion', status: 'scheduled', startAt: '2026-10-16T16:00:00.000Z', endAt: '2026-10-16T16:45:00.000Z', zone: 'America/Denver', allDay: false,
  format: 'video', location: null, meetingLink: 'https://meet.example.test/northstar-portfolio',
  participants: [{ email: 'maya.chen@northstar.example', name: 'Maya Chen', role: 'organizer', response: 'accepted' }],
  sourceState: 'current', matchBasis: [{ kind: 'role_title', detail: 'Names the role “Product designer”' }], notes: null, corrected: [], preparationId: EX.preparation,
  history: [{ id: 'h1', occurredAt: '2026-10-12T15:04:00.000Z', kind: 'scheduled', summary: 'Found on your calendar for Fri, Oct 16, 10:00 MDT', source: 'account:conn-cal-1', author: 'automatic' }],
  createdAt: '2026-10-10T16:00:00.000Z', updatedAt: '2026-10-12T15:04:00.000Z',
};

export const exampleMaterial: MaterialFamily = {
  id: EX.material, revision: 4, kind: 'resume', title: 'Product design résumé', archivedAt: null, latestVersionId: EX.version4, latestNumber: 4,
  versions: [
    { id: EX.version4, familyId: EX.material, number: 4, parentId: EX.version3, title: 'Product design résumé', origin: 'edited', submitted: false, contentDigest: EX.digest, characters: 2400, fileName: null, mimeType: null, author: 'owner-ui:owner', note: 'Shorter summary', createdAt: '2026-10-14T18:00:00.000Z', usedBy: [] },
    { id: EX.version3, familyId: EX.material, number: 3, parentId: null, title: 'Product design résumé', origin: 'edited', submitted: true, contentDigest: EX.digest, characters: 2480, fileName: null, mimeType: null, author: 'owner-ui:owner', note: null, createdAt: '2026-10-08T18:00:00.000Z', usedBy: [{ submissionId: EX.submission, opportunityId: EX.opportunity, company: 'Northstar', role: 'Product designer', appliedOn: '2026-10-09' }] },
  ],
  createdAt: '2026-09-30T18:00:00.000Z', updatedAt: '2026-10-14T18:00:00.000Z',
};

export const examplePreparation: Preparation = {
  id: EX.preparation, revision: 3, opportunityId: EX.opportunity, interviewId: EX.interview, postingSnapshotId: EX.snapshot, newerSnapshotId: null,
  requirements: [{ id: 'r1', text: 'Turn complex workflows into clear product experiences.', passage: '- Turn complex workflows into clear product experiences.', section: 'What you will do', origin: 'posting', snapshotId: EX.snapshot }],
  examples: [{ id: 'e1', text: 'The onboarding redesign in my portfolio, and what changed after usability testing.', requirementIds: ['r1'] }],
  questions: [{ id: 'q1', text: 'How does the team decide which customer problems to prioritize?', requirementIds: [] }],
  notes: 'Bring the decision log from the onboarding project.', suggestions: [], suggestionsState: { status: 'none', at: null, message: null, rejected: 0 },
  revisions: [{ revision: 3, at: '2026-10-15T09:00:00.000Z', author: 'owner-ui:owner' }], updatedAt: '2026-10-15T09:00:00.000Z',
};

export const exampleReview: ReviewItem = {
  id: EX.review, revision: 1, kind: 'match', status: 'open', title: 'Two design roles', summary: 'Recruiter message. It names more than one of your roles. Choose which one it belongs to, or ignore it.',
  source: 'account:conn-mail-1',
  candidates: [
    { opportunityId: EX.opportunity, company: 'Fieldwork', role: 'Product lead', stage: 'saved', level: 'strong', evidence: [{ kind: 'role_title', detail: 'Names the role “Product lead”' }, { kind: 'company_name', detail: 'Names Fieldwork' }] },
    { opportunityId: EX.opportunity2, company: 'Lumen', role: 'Staff designer', stage: 'applied', level: 'strong', evidence: [{ kind: 'role_title', detail: 'Names the role “Staff designer”' }, { kind: 'company_name', detail: 'Names Lumen' }] },
  ],
  evidence: [{ id: EX.message, subject: 'Two design roles', from: 'Jordan Bell', receivedAt: '2026-10-14T16:00:00.000Z', excerpt: 'I am reaching out about the Product lead role at Fieldwork and the Staff designer role at Lumen.', classification: 'recruiter', unavailable: false }],
  proposal: { stage: null, outcome: null, company: null, role: null, classification: 'recruiter', interviewId: null },
  opportunityId: null, decision: null, createdAt: '2026-10-14T16:00:00.000Z', updatedAt: '2026-10-14T16:00:00.000Z',
};

export const stepSummarySchema = z.object({
  ran: z.enum(['sync_mail', 'sync_calendar', 'enrich_mail']).nullable(),
  source: z.string().nullable(),
  read: z.number().int().min(0),
  skipped: z.number().int().min(0),
  removed: z.number().int().min(0),
  more: z.boolean(),
  message: z.string(),
}).strict();
export const exampleStep = { ran: 'sync_mail' as const, source: 'account:conn-mail-1', read: 8, skipped: 2, removed: 0, more: true, message: '8 messages read, 6 kept as job correspondence. More to read' };

export const COMMON_ERRORS = ['invalid_input', 'forbidden', 'revoked', 'not_found'] as const;
export const WRITE_ERRORS = ['invalid_input', 'forbidden', 'revoked', 'not_found', 'conflict'] as const;
