/**
 * Domain vocabulary and record schemas. Action inputs and outputs, entity
 * descriptors and the view all derive their types from these schemas.
 */
import { z } from 'zod/v4';
import { CHANNELS, CLASSIFICATIONS, COMP_KINDS, COMP_PERIODS, INTERVIEW_FORMATS, INTERVIEW_STATUSES, MATERIAL_KINDS, OUTCOMES, STAGES, WORK_ARRANGEMENTS } from './labels.js';
export * from './labels.js';

export const stageSchema = z.enum(STAGES);
export const outcomeSchema = z.enum(OUTCOMES);
export const workArrangementSchema = z.enum(WORK_ARRANGEMENTS);

export const id = z.string().min(1).max(128);
export const isoInstant = z.string().min(10).max(40);
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-10-19');
export const revision = z.number().int().min(0);

// ─── Compensation ────────────────────────────────────────────────────────────
export const compensationSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(COMP_KINDS),
  /** Exact amounts in the currency's minor unit (cents). Null when not stated. */
  minMinor: z.number().int().min(0).max(1e13).nullable(),
  maxMinor: z.number().int().min(0).max(1e13).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  period: z.enum(COMP_PERIODS),
  qualifiers: z.array(z.string().max(80)).max(8),
  source: z.enum(['posting', 'offer', 'user']),
  /** The exact passage the amount came from, when parsed. */
  passage: z.string().max(400).nullable(),
}).strict();
export type Compensation = z.infer<typeof compensationSchema>;

// ─── Opportunities ───────────────────────────────────────────────────────────
export const contactSchema = z.object({ email: z.string().max(320), name: z.string().max(200).nullable() }).strict();
export const stageLockSchema = z.object({ stage: stageSchema, outcome: outcomeSchema.nullable(), at: isoInstant, by: z.string().max(200), eventId: id }).strict();

export const nextItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interview'), interviewId: id, title: z.string(), startAt: isoInstant.nullable(), zone: z.string().nullable() }).strict(),
  z.object({ kind: z.literal('scheduling'), interviewId: id, title: z.string() }).strict(),
  z.object({ kind: z.literal('deadline'), date: localDate, label: z.string() }).strict(),
  z.object({ kind: z.literal('action'), text: z.string(), due: localDate.nullable() }).strict(),
  /** A local date, or an instant the view shows in the viewer's own zone. */
  z.object({ kind: z.literal('applied'), date: isoInstant }).strict(),
  z.object({ kind: z.literal('saved'), date: isoInstant, hasDescription: z.boolean() }).strict(),
  z.object({ kind: z.literal('closed'), outcome: outcomeSchema.nullable(), date: isoInstant }).strict(),
]);
export type NextItem = z.infer<typeof nextItemSchema>;

export const opportunitySummarySchema = z.object({
  id,
  revision,
  company: z.string(),
  role: z.string(),
  location: z.string().nullable(),
  workArrangement: workArrangementSchema.nullable(),
  sourceUrl: z.string().nullable(),
  stage: stageSchema,
  outcome: outcomeSchema.nullable(),
  stageLocked: z.boolean(),
  archivedAt: isoInstant.nullable(),
  listingClosedAt: isoInstant.nullable(),
  hasPosting: z.boolean(),
  schedulingNeeded: z.boolean(),
  next: nextItemSchema.nullable(),
  /** A short second line: the next action, interview title or latest activity. */
  note: z.string().nullable(),
  lastActivity: z.object({ at: isoInstant, label: z.string() }).strict().nullable(),
  openReviews: z.number().int().min(0),
  createdAt: isoInstant,
  updatedAt: isoInstant,
}).strict();
export type OpportunitySummary = z.infer<typeof opportunitySummarySchema>;

export const opportunityRecordSchema = opportunitySummarySchema.extend({
  requisitionId: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionDue: localDate.nullable(),
  deadline: localDate.nullable(),
  deadlineLabel: z.string().nullable(),
  compensation: z.array(compensationSchema),
  contacts: z.array(contactSchema),
  notes: z.string().nullable(),
  stageLock: stageLockSchema.nullable(),
}).strict();
export type OpportunityRecord = z.infer<typeof opportunityRecordSchema>;

export const stageEventSchema = z.object({
  id,
  opportunityId: id,
  fromStage: stageSchema.nullable(),
  fromOutcome: outcomeSchema.nullable(),
  toStage: stageSchema,
  toOutcome: outcomeSchema.nullable(),
  occurredAt: isoInstant,
  author: z.string(),
  source: z.string(),
  confidence: z.enum(['user', 'exact', 'strong', 'probable', 'ai']),
  decision: z.enum(['applied', 'suggested', 'suppressed', 'dismissed', 'accepted']),
  evidence: z.object({ kind: z.enum(['correspondence', 'interview', 'submission', 'review', 'posting']), id }).strict().nullable(),
  revision,
  note: z.string().nullable(),
  createdAt: isoInstant,
}).strict();
export type StageEvent = z.infer<typeof stageEventSchema>;

// ─── Postings ────────────────────────────────────────────────────────────────
export const requirementSchema = z.object({
  id: z.string().max(64),
  text: z.string().max(400),
  /** Exact source passage from the posting snapshot. */
  passage: z.string().max(600),
  section: z.string().max(120).nullable(),
}).strict();
export type Requirement = z.infer<typeof requirementSchema>;
export const extractedFieldSchema = z.object({ value: z.string().max(300), passage: z.string().max(400) }).strict();
export const postingExtractSchema = z.object({
  company: extractedFieldSchema.nullable(),
  role: extractedFieldSchema.nullable(),
  location: extractedFieldSchema.nullable(),
  workArrangement: z.object({ value: workArrangementSchema, passage: z.string().max(400) }).strict().nullable(),
  requisitionId: extractedFieldSchema.nullable(),
  compensation: z.array(compensationSchema).max(8),
  requirements: z.array(requirementSchema).max(40),
}).strict();
export type PostingExtract = z.infer<typeof postingExtractSchema>;
export const postingSummarySchema = z.object({
  id,
  opportunityId: id,
  capturedAt: isoInstant,
  origin: z.enum(['paste', 'file', 'import']),
  sourceUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  contentDigest: z.string(),
  characters: z.number().int().min(0),
  truncated: z.boolean(),
  requirements: z.number().int().min(0),
  latest: z.boolean(),
  /** Preparations that cite this exact snapshot. */
  usedByPreparations: z.number().int().min(0),
}).strict();
export const postingDetailSchema = postingSummarySchema.extend({
  text: z.string(),
  textAvailable: z.boolean(),
  extracted: postingExtractSchema,
}).strict();

// ─── Correspondence ──────────────────────────────────────────────────────────
export const evidenceItemSchema = z.object({
  kind: z.enum(['thread', 'reply', 'invite', 'requisition', 'posting_url', 'role_title', 'contact', 'company_domain', 'company_name', 'user']),
  detail: z.string().max(300),
}).strict();
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export const matchLevelSchema = z.enum(['exact', 'strong', 'probable', 'ambiguous', 'none']);
export type MatchLevel = z.infer<typeof matchLevelSchema>;
export const correspondenceSchema = z.object({
  id,
  source: z.string(),
  account: z.string(),
  threadId: z.string(),
  subject: z.string(),
  from: contactSchema.nullable(),
  to: z.array(contactSchema),
  sent: z.boolean(),
  receivedAt: isoInstant,
  evidence: z.string(),
  classification: z.enum(CLASSIFICATIONS),
  opportunityId: id.nullable(),
  matchStatus: z.enum(['matched', 'review', 'unmatched', 'ignored']),
  matchLevel: matchLevelSchema.nullable(),
  matchBasis: z.array(evidenceItemSchema),
  matchedBy: z.string().nullable(),
  aiLabel: z.string().nullable(),
  unavailable: z.boolean(),
}).strict();
export type CorrespondenceItem = z.infer<typeof correspondenceSchema>;

// ─── Interviews ──────────────────────────────────────────────────────────────
export const participantSchema = z.object({
  email: z.string().max(320).nullable(),
  name: z.string().max(200).nullable(),
  role: z.enum(['organizer', 'attendee', 'self']),
  response: z.string().max(40).nullable(),
}).strict();
export const interviewEventSchema = z.object({
  id,
  occurredAt: isoInstant,
  kind: z.enum(['created', 'scheduling_needed', 'scheduled', 'rescheduled', 'canceled', 'restored', 'updated', 'source_removed', 'completed', 'corrected']),
  summary: z.string(),
  source: z.string(),
  author: z.string(),
}).strict();
export const interviewSchema = z.object({
  id,
  revision,
  opportunityId: id,
  company: z.string(),
  role: z.string(),
  source: z.string(),
  origin: z.enum(['manual', 'calendar', 'mail']),
  title: z.string(),
  status: z.enum(INTERVIEW_STATUSES),
  startAt: isoInstant.nullable(),
  endAt: isoInstant.nullable(),
  /** The zone the event was created in, shown with its times. */
  zone: z.string().nullable(),
  allDay: z.boolean(),
  format: z.enum(INTERVIEW_FORMATS),
  location: z.string().nullable(),
  meetingLink: z.string().nullable(),
  participants: z.array(participantSchema),
  sourceState: z.enum(['current', 'removed', 'none']),
  matchBasis: z.array(evidenceItemSchema),
  notes: z.string().nullable(),
  corrected: z.array(z.string()),
  preparationId: id.nullable(),
  history: z.array(interviewEventSchema),
  createdAt: isoInstant,
  updatedAt: isoInstant,
}).strict();
export type Interview = z.infer<typeof interviewSchema>;

// ─── Materials ───────────────────────────────────────────────────────────────
export const materialUseSchema = z.object({ submissionId: id, opportunityId: id, company: z.string(), role: z.string(), appliedOn: localDate }).strict();
export const materialVersionSchema = z.object({
  id,
  familyId: id,
  number: z.number().int().min(1),
  parentId: id.nullable(),
  title: z.string(),
  /** original is the first imported or written text, edited came from editing a parent. Submitted is derived from uses. */
  origin: z.enum(['original', 'edited']),
  submitted: z.boolean(),
  contentDigest: z.string(),
  characters: z.number().int().min(0),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  author: z.string(),
  note: z.string().nullable(),
  createdAt: isoInstant,
  usedBy: z.array(materialUseSchema),
}).strict();
export type MaterialVersion = z.infer<typeof materialVersionSchema>;
export const materialFamilySchema = z.object({
  id,
  revision,
  kind: z.enum(MATERIAL_KINDS),
  title: z.string(),
  archivedAt: isoInstant.nullable(),
  latestVersionId: id,
  latestNumber: z.number().int().min(1),
  versions: z.array(materialVersionSchema),
  createdAt: isoInstant,
  updatedAt: isoInstant,
}).strict();
export type MaterialFamily = z.infer<typeof materialFamilySchema>;

// ─── Submissions ─────────────────────────────────────────────────────────────
export const submissionSchema = z.object({
  id,
  opportunityId: id,
  appliedOn: localDate,
  channel: z.enum(CHANNELS),
  materials: z.array(z.object({ versionId: id, familyId: id.nullable(), title: z.string(), number: z.number().int().nullable(), kind: z.enum(MATERIAL_KINDS).nullable(), shared: z.boolean() }).strict()),
  evidenceId: id.nullable(),
  confirmedByUser: z.boolean(),
  note: z.string().nullable(),
  author: z.string(),
  createdAt: isoInstant,
}).strict();
export type Submission = z.infer<typeof submissionSchema>;

// ─── Preparation ─────────────────────────────────────────────────────────────
export const prepItemSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(2000),
  /** Requirement IDs this example or question speaks to. */
  requirementIds: z.array(z.string().max(64)).max(20),
}).strict();
export const prepRequirementSchema = requirementSchema.extend({
  origin: z.enum(['posting', 'user']),
  snapshotId: id.nullable(),
}).strict();
export const suggestionEvidenceSchema = z.object({
  source: z.enum(['posting', 'material', 'example', 'correspondence']),
  ref: z.string().max(128),
  label: z.string().max(200),
  quote: z.string().max(600),
  sourceKey: z.string().max(200),
}).strict();
export const suggestionSchema = z.object({
  id: z.string().max(64),
  kind: z.enum(['talking_point', 'question', 'gap']),
  text: z.string().max(1200),
  evidence: z.array(suggestionEvidenceSchema).max(6),
  status: z.enum(['proposed', 'accepted', 'dismissed']),
}).strict();
export type Suggestion = z.infer<typeof suggestionSchema>;
export const preparationSchema = z.object({
  id: id.nullable(),
  revision,
  opportunityId: id,
  interviewId: id.nullable(),
  postingSnapshotId: id.nullable(),
  /** A newer posting snapshot exists than the one this preparation cites. */
  newerSnapshotId: id.nullable(),
  requirements: z.array(prepRequirementSchema),
  examples: z.array(prepItemSchema),
  questions: z.array(prepItemSchema),
  notes: z.string(),
  suggestions: z.array(suggestionSchema),
  suggestionsState: z.object({ status: z.enum(['none', 'ready', 'unavailable', 'invalid']), at: isoInstant.nullable(), message: z.string().nullable(), rejected: z.number().int().min(0) }).strict(),
  revisions: z.array(z.object({ revision, at: isoInstant, author: z.string() }).strict()),
  updatedAt: isoInstant.nullable(),
}).strict();
export type Preparation = z.infer<typeof preparationSchema>;

// ─── Review ──────────────────────────────────────────────────────────────────
export const reviewCandidateSchema = z.object({
  opportunityId: id,
  company: z.string(),
  role: z.string(),
  stage: stageSchema,
  level: matchLevelSchema,
  evidence: z.array(evidenceItemSchema),
}).strict();
export const reviewItemSchema = z.object({
  id,
  revision,
  kind: z.enum(['match', 'new_opportunity', 'stage']),
  status: z.enum(['open', 'resolved', 'ignored']),
  title: z.string(),
  summary: z.string(),
  source: z.string(),
  candidates: z.array(reviewCandidateSchema),
  evidence: z.array(z.object({ id, subject: z.string(), from: z.string().nullable(), receivedAt: isoInstant, excerpt: z.string(), classification: z.enum(CLASSIFICATIONS), unavailable: z.boolean() }).strict()),
  proposal: z.object({
    stage: stageSchema.nullable(),
    outcome: outcomeSchema.nullable(),
    company: z.string().nullable(),
    role: z.string().nullable(),
    classification: z.enum(CLASSIFICATIONS).nullable(),
    interviewId: id.nullable(),
  }).strict(),
  opportunityId: id.nullable(),
  decision: z.string().nullable(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
}).strict();
export type ReviewItem = z.infer<typeof reviewItemSchema>;

// ─── Follow-ups ──────────────────────────────────────────────────────────────
export const followUpSchema = z.object({
  id,
  operationId: z.string(),
  opportunityId: id.nullable(),
  interviewId: id.nullable(),
  title: z.string(),
  dueAt: z.string().nullable(),
  taskId: z.string().nullable(),
  state: z.enum(['pending', 'created', 'failed']),
  lastError: z.string().nullable(),
  createdAt: isoInstant,
}).strict();
export type FollowUp = z.infer<typeof followUpSchema>;

// ─── Coverage ────────────────────────────────────────────────────────────────
export const coverageSchema = z.object({
  partial: z.boolean(),
  sources: z.array(z.object({
    key: z.string(),
    label: z.string(),
    kind: z.enum(['mail', 'calendar', 'collection']),
    status: z.string(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    partial: z.boolean(),
  }).strict()),
}).strict();
export type Coverage = z.infer<typeof coverageSchema>;
