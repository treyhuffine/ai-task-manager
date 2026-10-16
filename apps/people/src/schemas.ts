import { z } from 'zod/v4';

/**
 * Record and filter schemas shared by the actions (strict contract) and the
 * view (types only). Every list is bounded. Times are ISO instants, dates are
 * YYYY-MM-DD.
 */
export const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9:_.@+-]+$/);
export const instantSchema = z.string().min(10).max(40);
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const sourceKeySchema = z.string().min(1).max(200).regex(/^(manual|collection:[A-Za-z0-9-]{1,64}|import:[A-Za-z0-9-]{1,64}|account:[^\s]{1,128})$/);
export const collectionKeySchema = z.string().regex(/^(manual|collection:[A-Za-z0-9-]{1,64})$/);
export const revisionSchema = z.number().int().min(0);
const name = z.string().min(1).max(200);
const label = z.string().max(300);

// ─── Coverage ────────────────────────────────────────────────────────────────

export const accountCoverageSchema = z.object({
  source: sourceKeySchema,
  label: label,
  kind: z.enum(['mail', 'calendar']),
  from: instantSchema.nullable(),
  to: instantSchema.nullable(),
  partial: z.boolean(),
  status: z.enum(['not_started', 'importing', 'ready', 'paused', 'reconnect', 'error', 'disconnected']),
  lastSuccessAt: instantSchema.nullable(),
}).strict();
export const coverageSchema = z.object({
  accounts: z.array(accountCoverageSchema).max(40),
  imports: z.number().int().min(0),
  partial: z.boolean(),
  pendingExtraction: z.number().int().min(0),
  failed: z.number().int().min(0),
  extraction: z.enum(['off', 'on', 'paused', 'unavailable']),
  summary: z.string().max(500),
}).strict();
export type Coverage = z.infer<typeof coverageSchema>;

// ─── Filters, sort and columns (saved views store only these) ────────────────

export const dateFilterSchema = z.object({
  from: z.union([localDateSchema, instantSchema]).optional(),
  to: z.union([localDateSchema, instantSchema]).optional(),
  withinDays: z.number().int().min(0).max(3650).optional(),
  olderThanDays: z.number().int().min(0).max(3650).optional(),
  nextDays: z.number().int().min(0).max(3650).optional(),
  includeNone: z.boolean().optional(),
}).strict();
export const peopleFiltersSchema = z.object({
  text: z.string().max(200).optional(),
  organizationIds: z.array(idSchema).max(20).optional(),
  listIds: z.array(idSchema).max(20).optional(),
  pinned: z.boolean().optional(),
  hasFollowUp: z.boolean().optional(),
  nextMeeting: dateFilterSchema.optional(),
  lastExchange: dateFilterSchema.optional(),
  archived: z.enum(['active', 'archived', 'all']).optional(),
  sources: z.array(sourceKeySchema).max(20).optional(),
}).strict();
export type PeopleFilters = z.infer<typeof peopleFiltersSchema>;
export const organizationFiltersSchema = z.object({
  text: z.string().max(200).optional(),
  listIds: z.array(idSchema).max(20).optional(),
  hasFollowUp: z.boolean().optional(),
  lastExchange: dateFilterSchema.optional(),
  archived: z.enum(['active', 'archived', 'all']).optional(),
  sources: z.array(sourceKeySchema).max(20).optional(),
}).strict();
export type OrganizationFilters = z.infer<typeof organizationFiltersSchema>;
export const opportunityFiltersSchema = z.object({
  text: z.string().max(200).optional(),
  pipelineId: idSchema.optional(),
  stageIds: z.array(idSchema).max(30).optional(),
  organizationIds: z.array(idSchema).max(20).optional(),
  personIds: z.array(idSchema).max(20).optional(),
  archived: z.enum(['active', 'archived', 'all']).optional(),
}).strict();
export type OpportunityFilters = z.infer<typeof opportunityFiltersSchema>;

export const PEOPLE_SORTS = ['name', 'last_exchange', 'next_action', 'next_meeting', 'added'] as const;
export const ORGANIZATION_SORTS = ['name', 'last_exchange', 'next_action', 'added'] as const;
export const OPPORTUNITY_SORTS = ['stage', 'title', 'next_action', 'target_date', 'added'] as const;
export const sortSchema = z.object({
  key: z.enum(['name', 'last_exchange', 'next_action', 'next_meeting', 'added', 'stage', 'title', 'target_date']),
  direction: z.enum(['asc', 'desc']),
}).strict();
export type Sort = z.infer<typeof sortSchema>;
export const PEOPLE_COLUMNS = ['company', 'last_exchange', 'next_action', 'next_meeting', 'primary_email', 'lists', 'coverage', 'added'] as const;
export const ORGANIZATION_COLUMNS = ['people', 'last_exchange', 'next_action', 'domain', 'lists', 'coverage', 'added'] as const;
export const OPPORTUNITY_COLUMNS = ['organization', 'stage', 'next_action', 'target_date', 'value', 'people'] as const;
export const columnSchema = z.enum(['company', 'last_exchange', 'next_action', 'next_meeting', 'primary_email', 'lists', 'coverage', 'added', 'people', 'domain', 'organization', 'stage', 'target_date', 'value']);

// ─── Shared fragments ────────────────────────────────────────────────────────

export const refSchema = z.object({ id: idSchema, name: name }).strict();
export const nextActionSchema = z.object({
  label: z.string().max(300),
  dueDate: localDateSchema.nullable(),
  kind: z.enum(['task', 'commitment', 'opportunity', 'waiting', 'meeting']),
  overdue: z.boolean(),
}).strict();
export type NextAction = z.infer<typeof nextActionSchema>;
export const nextMeetingSchema = z.object({ id: idSchema, at: instantSchema, title: z.string().max(300) }).strict();

// ─── People ──────────────────────────────────────────────────────────────────

export const personSummarySchema = z.object({
  id: idSchema,
  name: name,
  revision: revisionSchema,
  pinned: z.boolean(),
  archived: z.boolean(),
  company: refSchema.nullable(),
  role: z.string().max(200).nullable(),
  affiliationStatus: z.enum(['current', 'observed', 'former', 'uncertain']).nullable(),
  lastExchangeAt: instantSchema.nullable(),
  nextAction: nextActionSchema.nullable(),
  nextMeeting: nextMeetingSchema.nullable(),
  primaryEmail: z.string().max(320).nullable(),
  lists: z.array(refSchema).max(20),
  sourceLabels: z.array(label).max(20),
  addedAt: instantSchema,
}).strict();
export type PersonSummary = z.infer<typeof personSummarySchema>;

export const identitySchema = z.object({
  keyId: idSchema,
  kind: z.enum(['email', 'domain', 'phone', 'linkedin', 'website']),
  value: z.string().max(400),
  shared: z.boolean(),
  confirmation: z.enum(['confirmed', 'observed']),
  sources: z.array(label).max(20),
  observedAt: instantSchema,
}).strict();
export type Identity = z.infer<typeof identitySchema>;

export const affiliationSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  personId: idSchema,
  personName: name,
  organizationId: idSchema,
  organizationName: name,
  role: z.string().max(200).nullable(),
  validFrom: localDateSchema.nullable(),
  validTo: localDateSchema.nullable(),
  observedAt: instantSchema,
  status: z.enum(['current', 'former', 'unknown']),
  confidence: z.enum(['confirmed', 'observed', 'suggested']),
  origin: z.enum(['manual', 'import', 'signature', 'extraction', 'domain']),
  sourceLabel: label,
  evidenceId: idSchema.nullable(),
  description: z.string().max(300),
}).strict();
export type Affiliation = z.infer<typeof affiliationSchema>;

export const noteSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  subjectKind: z.enum(['person', 'organization', 'opportunity']),
  subjectId: idSchema,
  title: z.string().max(200).nullable(),
  body: z.string().max(20000),
  collection: collectionKeySchema,
  collectionLabel: label,
  createdAt: instantSchema,
  updatedAt: instantSchema,
}).strict();
export type Note = z.infer<typeof noteSchema>;

export const taskLinkSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  subjectKind: z.enum(['commitment', 'person', 'organization', 'opportunity']),
  subjectId: idSchema,
  operationId: z.string().uuid(),
  title: z.string().max(500),
  dueAt: z.string().max(40).nullable(),
  taskId: z.string().max(128).nullable(),
  status: z.enum(['pending', 'linked', 'unavailable', 'failed']),
  taskStatus: z.string().max(60).nullable(),
  lastError: z.string().max(300).nullable(),
  lastCheckedAt: instantSchema.nullable(),
}).strict();
export type TaskLink = z.infer<typeof taskLinkSchema>;

export const commitmentStateSchema = z.enum(['suggested', 'accepted', 'dismissed', 'completed', 'withdrawn']);
export const commitmentSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  direction: z.enum(['i_owe', 'waiting_on']),
  person: refSchema.nullable(),
  organization: refSchema.nullable(),
  opportunity: refSchema.nullable(),
  actorLabel: z.string().max(200),
  recipientLabel: z.string().max(200),
  action: z.string().max(500),
  dueDate: localDateSchema.nullable(),
  state: commitmentStateSchema,
  origin: z.enum(['extracted', 'manual']),
  snoozedUntil: localDateSchema.nullable(),
  evidenceId: idSchema.nullable(),
  passage: z.string().max(1200).nullable(),
  sourceLabel: label,
  occurredAt: instantSchema.nullable(),
  completionEvidenceId: idSchema.nullable(),
  resolution: z.string().max(300).nullable(),
  previousDecision: z.string().max(400).nullable(),
  confirmation: z.string().max(200),
  taskLink: taskLinkSchema.nullable(),
  history: z.array(z.object({ at: instantSchema, from: z.string().nullable(), to: z.string(), actor: z.string().max(60), note: z.string().max(300).nullable() }).strict()).max(20),
  createdAt: instantSchema,
}).strict();
export type Commitment = z.infer<typeof commitmentSchema>;

export const factSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  subjectKind: z.enum(['person', 'organization', 'opportunity']),
  subjectId: idSchema,
  subjectName: name,
  field: z.string().max(60),
  label: z.string().max(200),
  value: z.string().max(500),
  userValue: z.string().max(500).nullable(),
  status: z.enum(['suggested', 'active', 'superseded', 'withdrawn', 'rejected']),
  origin: z.enum(['signature', 'extraction', 'import']),
  evidenceId: idSchema.nullable(),
  passage: z.string().max(1200).nullable(),
  observedAt: instantSchema,
  sourceLabel: label,
  previousDecision: z.string().max(400).nullable(),
  resolution: z.string().max(300).nullable(),
}).strict();
export type Fact = z.infer<typeof factSchema>;

export const opportunityRefSchema = z.object({
  id: idSchema,
  title: z.string().max(300),
  pipelineId: idSchema,
  pipelineName: name,
  stageId: idSchema,
  stageLabel: z.string().max(80),
  stageKind: z.enum(['open', 'succeeded', 'closed']),
}).strict();

export const timelineItemSchema = z.object({
  id: idSchema,
  type: z.enum(['email', 'meeting', 'note', 'change']),
  occurredAt: instantSchema,
  label: z.string().max(120),
  title: z.string().max(400),
  detail: z.string().max(600).nullable(),
  sourceLabel: label,
  participants: z.array(z.object({ personId: idSchema.nullable(), name: z.string().max(320) }).strict()).max(20),
  moreParticipants: z.number().int().min(0),
  evidenceId: idSchema.nullable(),
  link: z.string().max(2000).nullable(),
  status: z.enum(['active', 'cancelled', 'unavailable', 'upcoming']),
  attendance: z.enum(['unknown', 'confirmed', 'not_attended']).nullable(),
  links: z.array(z.object({ kind: z.enum(['organization', 'opportunity']), id: idSchema, name: z.string().max(300), origin: z.enum(['manual', 'rule']) }).strict()).max(10),
  revision: revisionSchema,
  threadCount: z.number().int().min(1).optional(),
}).strict();
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const personSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  name: name,
  nameOverride: z.string().max(200).nullable(),
  headline: z.string().max(120).nullable(),
  observedNames: z.array(z.object({ name: name, sourceLabel: label }).strict()).max(10),
  collection: collectionKeySchema,
  origin: z.string().max(40),
  originLabel: z.string().max(200),
  pinned: z.boolean(),
  archived: z.boolean(),
  keepInTouchDays: z.number().int().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
}).strict();
export const personDetailSchema = z.object({
  person: personSchema,
  header: z.object({
    role: z.string().max(200).nullable(),
    company: refSchema.nullable(),
    affiliationNote: z.string().max(300),
    lastExchangeAt: instantSchema.nullable(),
    nextMeeting: nextMeetingSchema.nullable(),
    nextAction: nextActionSchema.nullable(),
  }).strict(),
  identities: z.array(identitySchema).max(50),
  affiliations: z.array(affiliationSchema).max(50),
  notes: z.array(noteSchema).max(30),
  commitments: z.array(commitmentSchema).max(30),
  facts: z.array(factSchema).max(30),
  taskLinks: z.array(taskLinkSchema).max(30),
  opportunities: z.array(opportunityRefSchema).max(30),
  lists: z.array(refSchema).max(30),
  reviews: z.array(z.object({ id: idSchema, kind: z.string().max(20), summary: z.string().max(300) }).strict()).max(10),
  attribution: z.array(z.object({ id: idSchema, revision: revisionSchema, organization: refSchema, identity: z.string().max(320), account: label, from: localDateSchema.nullable(), to: localDateSchema.nullable(), state: z.enum(['active', 'disabled']) }).strict()).max(20),
  coverage: coverageSchema,
  revision: z.string().max(80),
}).strict();
export type PersonDetail = z.infer<typeof personDetailSchema>;

// ─── Organizations ───────────────────────────────────────────────────────────

export const organizationKindSchema = z.enum(['company', 'nonprofit', 'community', 'fund', 'school', 'public', 'other']);
export const organizationSummarySchema = z.object({
  id: idSchema,
  name: name,
  revision: revisionSchema,
  state: z.enum(['provisional', 'confirmed']),
  archived: z.boolean(),
  domain: z.string().max(253).nullable(),
  peopleCount: z.number().int().min(0),
  lastExchangeAt: instantSchema.nullable(),
  nextAction: nextActionSchema.nullable(),
  lists: z.array(refSchema).max(20),
  sourceLabels: z.array(label).max(20),
  addedAt: instantSchema,
}).strict();
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export const organizationSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  name: name,
  nameOverride: z.string().max(200).nullable(),
  kind: organizationKindSchema.nullable(),
  website: z.string().max(300).nullable(),
  state: z.enum(['provisional', 'confirmed']),
  stateLabel: z.string().max(200),
  collection: collectionKeySchema,
  archived: z.boolean(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
}).strict();
export const organizationDetailSchema = z.object({
  organization: organizationSchema,
  domains: z.array(identitySchema).max(30),
  people: z.object({
    current: z.array(affiliationSchema).max(100),
    former: z.array(affiliationSchema).max(100),
    uncertain: z.array(affiliationSchema).max(100),
    more: z.boolean(),
  }).strict(),
  nextAction: nextActionSchema.nullable(),
  commitments: z.array(commitmentSchema).max(30),
  opportunities: z.array(z.object({
    id: idSchema, title: z.string().max(300), stageLabel: z.string().max(80), stageKind: z.enum(['open', 'succeeded', 'closed']),
    pipelineName: name, nextAction: z.string().max(300).nullable(), nextActionDate: localDateSchema.nullable(),
    value: z.object({ minor: z.number().int(), currency: z.string().length(3) }).strict().nullable(),
  }).strict()).max(50),
  notes: z.array(noteSchema).max(30),
  taskLinks: z.array(taskLinkSchema).max(30),
  lists: z.array(refSchema).max(30),
  attributionRules: z.array(z.object({ id: idSchema, revision: revisionSchema, person: refSchema.nullable(), identity: z.string().max(320), account: label, from: localDateSchema.nullable(), to: localDateSchema.nullable(), state: z.enum(['active', 'disabled']) }).strict()).max(30),
  lastExchangeAt: instantSchema.nullable(),
  coverage: coverageSchema,
  revision: z.string().max(80),
}).strict();
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

// ─── Lists, views, pipelines ─────────────────────────────────────────────────

export const listSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  name: name,
  recordKind: z.enum(['person', 'organization']),
  collection: collectionKeySchema,
  memberCount: z.number().int().min(0),
  archived: z.boolean(),
}).strict();
export type ListRecord = z.infer<typeof listSchema>;

export const viewSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  label: z.string().min(1).max(120),
  recordKind: z.enum(['person', 'organization', 'opportunity']),
  filters: z.union([peopleFiltersSchema, organizationFiltersSchema, opportunityFiltersSchema]),
  sort: sortSchema,
  columns: z.array(columnSchema).max(10),
  listId: idSchema.nullable(),
  pipelineId: idSchema.nullable(),
  navigation: z.enum(['picker', 'pinned']),
  collection: collectionKeySchema,
  unavailableFilters: z.array(z.string().max(200)).max(20),
  archived: z.boolean(),
}).strict();
export type SavedView = z.infer<typeof viewSchema>;

export const stageSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(80),
  kind: z.enum(['open', 'succeeded', 'closed']),
  position: z.number().int().min(0),
  count: z.number().int().min(0),
}).strict();
export const pipelineSchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  name: name,
  template: z.enum(['client_work', 'introductions', 'blank']),
  collection: collectionKeySchema,
  archived: z.boolean(),
  stages: z.array(stageSchema).max(30),
  opportunityCount: z.number().int().min(0),
}).strict();
export type Pipeline = z.infer<typeof pipelineSchema>;

export const moneySchema = z.object({ minor: z.number().int().min(-1e15).max(1e15), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
export const opportunitySummarySchema = z.object({
  id: idSchema,
  revision: revisionSchema,
  title: z.string().max(300),
  pipelineId: idSchema,
  stageId: idSchema,
  stageLabel: z.string().max(80),
  stageKind: z.enum(['open', 'succeeded', 'closed']),
  organization: refSchema.nullable(),
  people: z.array(refSchema).max(20),
  nextAction: z.string().max(300).nullable(),
  nextActionDate: localDateSchema.nullable(),
  targetDate: localDateSchema.nullable(),
  value: moneySchema.nullable(),
  taskLink: taskLinkSchema.nullable(),
  archived: z.boolean(),
  closed: z.boolean(),
  updatedAt: instantSchema,
}).strict();
export type OpportunitySummary = z.infer<typeof opportunitySummarySchema>;
export const opportunityDetailSchema = z.object({
  opportunity: opportunitySummarySchema.extend({ collection: collectionKeySchema, pipelineName: name }),
  stages: z.array(stageSchema).max(30),
  history: z.array(z.object({
    id: idSchema, at: instantSchema, fromStage: z.string().max(80).nullable(), toStage: z.string().max(80),
    fromPipeline: z.string().max(200).nullable(), toPipeline: z.string().max(200), actor: z.string().max(80), reason: z.string().max(300).nullable(), evidenceId: idSchema.nullable(),
  }).strict()).max(100),
  notes: z.array(noteSchema).max(30),
  suggestions: z.array(factSchema).max(10),
  activity: z.array(timelineItemSchema).max(20),
  revision: z.string().max(80),
}).strict();
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;

// ─── Evidence and briefings ──────────────────────────────────────────────────

export const evidenceSchema = z.object({
  id: idSchema,
  kind: z.enum(['email', 'event', 'import_row', 'note']),
  title: z.string().max(400),
  sourceLabel: label,
  sourceDate: instantSchema.nullable(),
  participants: z.array(z.string().max(320)).max(30),
  passage: z.string().max(4000).nullable(),
  excerpt: z.string().max(4000).nullable(),
  link: z.string().max(2000).nullable(),
  status: z.enum(['available', 'unavailable', 'deleted']),
  statusLabel: z.string().max(200),
}).strict();
export type Evidence = z.infer<typeof evidenceSchema>;

export const briefingItemSchema = z.object({
  text: z.string().max(600),
  kind: z.enum(['discussion', 'note', 'i_owe', 'waiting_on', 'meeting', 'unknown', 'fact']),
  evidenceIds: z.array(idSchema).max(5),
  noteId: idSchema.nullable(),
}).strict();
export const briefingSchema = z.object({
  subjectKind: z.enum(['person', 'organization']),
  subjectId: idSchema,
  meetingId: idSchema.nullable(),
  title: z.string().max(200),
  origin: z.enum(['generated', 'saved_records']),
  generatedAt: instantSchema.nullable(),
  items: z.array(briefingItemSchema).max(24),
  unknowns: z.array(z.string().max(300)).max(6),
  status: z.enum(['ready', 'pending', 'unavailable', 'stale']),
  statusLabel: z.string().max(300),
  coverage: coverageSchema,
}).strict();
export type Briefing = z.infer<typeof briefingSchema>;

// ─── Sources ─────────────────────────────────────────────────────────────────

export const sourceShareSchema = z.object({
  key: sourceKeySchema,
  label: label,
  kind: z.enum(['account', 'collection', 'import']),
  detail: z.string().max(300),
}).strict();
export type SourceShare = z.infer<typeof sourceShareSchema>;

export const writeResult = <T extends z.ZodType>(record: T) =>
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), record }).strict(),
    z.object({ status: z.literal('conflict'), current: record, message: z.string().max(300) }).strict(),
  ]);
