/** Result shapes the view reads. They mirror the action contract. */
import type { Compensation, CorrespondenceItem, Coverage, FollowUp, Interview, MaterialFamily, MaterialVersion, OpportunityRecord, OpportunitySummary, Preparation, Requirement, ReviewItem, StageEvent, Submission, PostingExtract } from '../domain/model.js';
import type { Stage, Outcome } from '../domain/labels.js';

export type { Compensation, CorrespondenceItem, Coverage, FollowUp, Interview, MaterialFamily, MaterialVersion, OpportunityRecord, OpportunitySummary, Preparation, Requirement, ReviewItem, StageEvent, Submission, PostingExtract, Stage, Outcome };

export type Section = 'today' | 'opportunities' | 'opportunity' | 'preparation' | 'materials' | 'sources';
export type ViewData =
  | { mode: 'access'; actorId: string; sources: { key: string; label: string; kind: 'collection' | 'mail' | 'calendar'; description: string }[] }
  | { mode: 'app'; path: string; query: Record<string, string>; section: Section; id: string | null; landing: 'today' | 'opportunities'; revision: string; owner: boolean; fictional: boolean; setup: { opportunities: number; materials: number; mailConnected: boolean; calendarConnected: boolean; review: number } };

export interface ListResult<T> { items: T[]; nextCursor: string | null; coverage: Coverage; revision: string }
export interface OpportunityList extends ListResult<OpportunitySummary> { total: number; counts: Record<Stage | 'archived', number> }

export interface PostingSummary { id: string; opportunityId: string; capturedAt: string; origin: 'paste' | 'file' | 'import'; sourceUrl: string | null; fileName: string | null; contentDigest: string; characters: number; truncated: boolean; requirements: number; latest: boolean; usedByPreparations: number }
export interface PostingDetail extends PostingSummary { text: string; textAvailable: boolean; extracted: PostingExtract }

export interface OpportunityDetail {
  opportunity: OpportunityRecord;
  requirements: Requirement[];
  postings: PostingSummary[];
  stageHistory: StageEvent[];
  correspondence: CorrespondenceItem[];
  interviews: Interview[];
  submissions: Submission[];
  followUps: FollowUp[];
  reviews: ReviewItem[];
  preparations: { id: string; interviewId: string | null; revision: number; updatedAt: string }[];
  coverage: Coverage;
  revision: string;
}

export interface TodayData {
  date: string;
  zone: string;
  interviews: { interviewId: string; opportunityId: string; company: string; role: string; title: string; startAt: string; endAt: string | null; zone: string | null; format: string; meetingLink: string | null; participants: string[]; prepared: boolean }[];
  scheduling: { interviewId: string; opportunityId: string; company: string; role: string; title: string; since: string }[];
  deadlines: { opportunityId: string; company: string; role: string; date: string; label: string; kind: 'deadline' | 'action'; overdue: boolean }[];
  responses: ReviewItem[];
  followUps: FollowUp[];
  suggestions: { opportunityId: string; company: string; role: string; appliedOn: string; quietDays: number }[];
  counts: { opportunities: number; review: number };
}

export interface SourceSummary {
  key: string; account: string | null; kind: 'mail' | 'calendar' | 'collection'; label: string; granted: boolean; automatic: boolean; paused: boolean; status: string;
  historyDays: number | null; calendars: string[]; coverage: { from: string | null; to: string | null; partial: boolean }; lastSuccessAt: string | null; pending: number; failed: number; lastError: string | null; records: number;
}
export interface StepSummary { ran: string | null; source: string | null; read: number; skipped: number; removed: number; more: boolean; message: string }
export interface ScopeRecord { id: string; actorId: string; label: string; sources: string[]; operations: ('read' | 'write')[]; revokedAt: string | null; createdAt: string }

export interface WriteResult<T> { status: 'saved'; record: T }
export interface WriteConflict<T> { status: 'conflict'; current: T; message: string }
export type Write<T> = WriteResult<T> | WriteConflict<T>;

export interface MaterialDetail { material: MaterialFamily; version: MaterialVersion; text: string; textAvailable: boolean }
export interface CompareResult { from: { id: string; number: number }; to: { id: string; number: number }; lines: { type: 'same' | 'added' | 'removed'; text: string }[]; truncated: boolean; added: number; removed: number }
export interface PreviewResult {
  previewId: string; digest: string; kind: 'posting' | 'material' | 'opportunities'; expiresAt: string;
  posting?: { company: string | null; role: string | null; location: string | null; workArrangement: 'onsite' | 'hybrid' | 'remote' | null; sourceUrl: string | null; requisitionId: string | null; requirements: Requirement[]; requirementCount: number; compensation: Compensation[]; characters: number; hasText: boolean; excerpt: string; fileName: string | null };
  material?: { title: string; kind: MaterialFamily['kind']; characters: number; excerpt: string; fileName: string | null };
  rows?: { index: number; company: string; role: string; sourceUrl: string | null; location: string | null; stage: Stage; outcome: Outcome | null; appliedOn: string | null; notes: string | null; duplicate: boolean }[];
  rowCount?: number;
  duplicates: { id: string; company: string; role: string; stage: Stage }[];
  warnings: string[];
}
export interface ApplyResult { status: 'applied'; kind: 'posting' | 'material' | 'opportunities'; opportunityIds: string[]; materialId: string | null; snapshotId: string | null; created: number; skipped: number }
export interface FollowUpItem { followUp: FollowUp; task: { available: boolean; status: string | null; title: string | null; reason: string | null } | null }
export interface CorrespondenceDetail { message: CorrespondenceItem; body: string | null; passage: string | null }
