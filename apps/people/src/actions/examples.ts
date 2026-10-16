/** Fictional example records for the contract. Every value is invented. */
import type {
  Affiliation, Briefing, Commitment, Coverage, Fact, ListRecord, Note, OpportunitySummary, OrganizationSummary, Pipeline, PersonSummary, SavedView, TaskLink, TimelineItem,
} from '../schemas.js';

export const ID = {
  maya: '0194d7a0-0000-7000-8000-00000000a001',
  jordan: '0194d7a0-0000-7000-8000-00000000a002',
  fieldwork: '0194d7a0-0000-7000-8000-00000000b001',
  northstar: '0194d7a0-0000-7000-8000-00000000b002',
  note: '0194d7a0-0000-7000-8000-00000000c001',
  commitment: '0194d7a0-0000-7000-8000-00000000d001',
  task: '0194d7a0-0000-7000-8000-00000000e001',
  operation: '0194d7a0-0000-4000-8000-00000000e002',
  evidence: '0194d7a0-0000-7000-8000-00000000f001',
  interaction: '0194d7a0-0000-7000-8000-00000000f002',
  meeting: '0194d7a0-0000-7000-8000-00000000f003',
  list: '0194d7a0-0000-7000-8000-000000001001',
  view: '0194d7a0-0000-7000-8000-000000002001',
  pipeline: '0194d7a0-0000-7000-8000-000000003001',
  stageExploring: '0194d7a0-0000-7000-8000-000000003101',
  stageProposal: '0194d7a0-0000-7000-8000-000000003102',
  stageWon: '0194d7a0-0000-7000-8000-000000003103',
  opportunity: '0194d7a0-0000-7000-8000-000000004001',
  affiliation: '0194d7a0-0000-7000-8000-000000005001',
  fact: '0194d7a0-0000-7000-8000-000000006001',
  review: '0194d7a0-0000-7000-8000-000000007001',
  merge: '0194d7a0-0000-7000-8000-000000008001',
  preview: '0194d7a0-0000-7000-8000-000000009001',
  scope: '0194d7a0-0000-7000-8000-00000000aa01',
  rule: '0194d7a0-0000-7000-8000-00000000ab01',
};
export const DIGEST = 'a'.repeat(64);
export const T = { now: '2026-10-15T15:12:00.000Z', meeting: '2026-10-16T16:00:00.000Z', mail: '2026-10-12T17:00:00.000Z' };

export const COVERAGE: Coverage = {
  accounts: [{ source: 'account:fixture-personal', label: 'Personal Gmail', kind: 'mail', from: '2026-07-17T15:12:00.000Z', to: T.now, partial: false, status: 'ready', lastSuccessAt: T.now }],
  imports: 0, partial: false, pendingExtraction: 0, failed: 0, extraction: 'off',
  summary: 'Checked Personal Gmail (mail, 2026-07-17 to 2026-10-15). Relationship extraction is off.',
};
export const TASK: TaskLink = { id: ID.task, revision: 2, subjectKind: 'commitment', subjectId: ID.commitment, operationId: ID.operation, title: 'Send Jordan the revised proposal', dueAt: '2026-10-16', taskId: 'task-fictional-1', status: 'linked', taskStatus: 'open', lastError: null, lastCheckedAt: T.now };
export const PERSON: PersonSummary = {
  id: ID.maya, name: 'Maya Chen', revision: 3, pinned: true, archived: false, company: { id: ID.northstar, name: 'Northstar' }, role: 'Design lead', affiliationStatus: 'observed',
  lastExchangeAt: T.mail, nextAction: { label: 'Introduce Maya to a research lead', dueDate: null, kind: 'commitment', overdue: false }, nextMeeting: { id: ID.meeting, at: T.meeting, title: 'Portfolio discussion' },
  primaryEmail: 'maya@northstar.example', lists: [{ id: ID.list, name: 'Collaborators' }], sourceLabels: ['Personal Gmail', 'Your records'], addedAt: '2026-09-02T10:00:00.000Z',
};
export const ORGANIZATION: OrganizationSummary = {
  id: ID.fieldwork, name: 'Fieldwork', revision: 2, state: 'confirmed', archived: false, domain: 'fieldwork.example', peopleCount: 2, lastExchangeAt: '2026-10-11T17:00:00.000Z',
  nextAction: { label: 'Send revised proposal', dueDate: '2026-10-16', kind: 'task', overdue: false }, lists: [], sourceLabels: ['Work Gmail', 'Your records'], addedAt: '2026-09-10T10:00:00.000Z',
};
export const AFFILIATION: Affiliation = {
  id: ID.affiliation, revision: 1, personId: ID.jordan, personName: 'Jordan Bell', organizationId: ID.fieldwork, organizationName: 'Fieldwork', role: 'Founder', validFrom: null, validTo: null,
  observedAt: '2026-10-11T17:00:00.000Z', status: 'current', confidence: 'confirmed', origin: 'manual', sourceLabel: 'Your records', evidenceId: null, description: 'Current. Confirmed by you',
};
export const NOTE: Note = { id: ID.note, revision: 1, subjectKind: 'person', subjectId: ID.maya, title: 'Remember for next time', body: 'Ask how the design and research teams work together.', collection: 'manual', collectionLabel: 'Your records', createdAt: T.now, updatedAt: T.now };
export const COMMITMENT: Commitment = {
  id: ID.commitment, revision: 2, direction: 'i_owe', person: { id: ID.maya, name: 'Maya Chen' }, organization: null, opportunity: null, actorLabel: 'You', recipientLabel: 'Maya Chen',
  action: 'Introduce Maya to a research lead', dueDate: null, state: 'suggested', origin: 'extracted', snoozedUntil: null, evidenceId: ID.evidence,
  passage: 'I would be happy to introduce you to the research lead I mentioned.', sourceLabel: 'Personal Gmail', occurredAt: T.mail, completionEvidenceId: null, resolution: null, previousDecision: null,
  confirmation: 'No confirming message found in the indexed history', taskLink: null, history: [{ at: T.mail, from: null, to: 'suggested', actor: 'From a message', note: 'Suggested from a message' }], createdAt: T.mail,
};
export const FACT: Fact = {
  id: ID.fact, revision: 1, subjectKind: 'person', subjectId: ID.maya, subjectName: 'Maya Chen', field: 'affiliation', label: 'Role and company', value: 'Design lead at Northstar', userValue: null,
  status: 'suggested', origin: 'signature', evidenceId: ID.evidence, passage: 'Maya Chen\nDesign lead, Northstar', observedAt: T.mail, sourceLabel: 'Personal Gmail', previousDecision: null, resolution: null,
};
export const TIMELINE: TimelineItem = {
  id: ID.interaction, type: 'email', occurredAt: T.mail, label: 'Email sent', title: 'Portfolio discussion and introduction', detail: 'I would be happy to introduce you to the research lead I mentioned.',
  sourceLabel: 'Personal Gmail', participants: [{ personId: ID.maya, name: 'Maya Chen' }], moreParticipants: 0, evidenceId: ID.evidence, link: 'https://mail.google.com/mail/#all/fictional', status: 'active', attendance: null, links: [], revision: 1,
};
export const LIST: ListRecord = { id: ID.list, revision: 2, name: 'Clients', recordKind: 'person', collection: 'manual', memberCount: 3, archived: false };
export const VIEW: SavedView = {
  id: ID.view, revision: 1, label: 'Clients not spoken to in a month', recordKind: 'person', filters: { listIds: [ID.list], lastExchange: { olderThanDays: 30, includeNone: true } },
  sort: { key: 'last_exchange', direction: 'asc' }, columns: ['company', 'last_exchange', 'next_action'], listId: null, pipelineId: null, navigation: 'picker', collection: 'manual', unavailableFilters: [], archived: false,
};
export const PIPELINE: Pipeline = {
  id: ID.pipeline, revision: 1, name: 'Client work', template: 'client_work', collection: 'manual', archived: false, opportunityCount: 1,
  stages: [{ id: ID.stageExploring, label: 'Exploring', kind: 'open', position: 0, count: 0 }, { id: ID.stageProposal, label: 'Proposal', kind: 'open', position: 1, count: 1 }, { id: ID.stageWon, label: 'Won', kind: 'succeeded', position: 2, count: 0 }],
};
export const OPPORTUNITY: OpportunitySummary = {
  id: ID.opportunity, revision: 3, title: 'Onboarding project', pipelineId: ID.pipeline, stageId: ID.stageProposal, stageLabel: 'Proposal', stageKind: 'open',
  organization: { id: ID.fieldwork, name: 'Fieldwork' }, people: [{ id: ID.jordan, name: 'Jordan Bell' }], nextAction: 'Send revised proposal', nextActionDate: '2026-10-16', targetDate: '2026-11-01',
  value: { minor: 800000, currency: 'USD' }, taskLink: null, archived: false, closed: false, updatedAt: T.now,
};
export const BRIEFING: Briefing = {
  subjectKind: 'person', subjectId: ID.maya, meetingId: ID.meeting, title: 'Before you meet', origin: 'saved_records', generatedAt: null,
  items: [
    { kind: 'meeting', text: 'Meeting scheduled for October 16, 2026: Portfolio discussion. A calendar entry does not confirm attendance.', evidenceIds: [], noteId: null },
    { kind: 'i_owe', text: 'You offered to introduce Maya to a research lead. Suggested, not yet reviewed. No confirming message found in the indexed history.', evidenceIds: [ID.evidence], noteId: null },
  ],
  unknowns: [], status: 'unavailable', statusLabel: 'Briefings cite saved records. Relationship extraction is off', coverage: COVERAGE,
};
