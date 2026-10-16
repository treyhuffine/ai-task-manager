/**
 * Read models assembled under the caller's scope. Every derived value (the
 * stage a chat sees, the next event, the last activity, counts and evidence)
 * is computed only from sources that scope allows, before anything is
 * returned. The owner sees everything.
 */
import { accountSource, allows, type AccessScope } from '@ri/app-kit/data';
import { calendarCoverage, mailCoverage, calendarCheckpointSchema, mailCheckpointSchema } from '@ri/app-kit/sources';
import { formatDate } from '@ri/app-kit/time';
import type { InvocationAccess } from '@ri/app-kit/contract';
import {
  CLASSIFICATION_LABELS, MANUAL_SOURCE, MATERIALS_SOURCE, STAGE_LABELS, stageLabel,
  type Coverage, type NextItem, type OpportunityRecord, type OpportunitySummary, type Outcome, type ReviewItem, type Stage,
} from '../domain/model.js';
import { excerpt } from '../domain/text.js';
import { app, nowAt } from './state.js';
import { correspondenceFor, correspondenceRecord } from './correspondence.js';
import { interviewRecord } from './interviews.js';
import { groupBy, json, marks, num, opt, str, type Row } from './util.js';
import { visibleContacts } from './contacts.js';
import { stageEventRecord } from './opportunities.js';

const CHUNK = 400;
function inChunks(sql: (placeholders: string) => string, ids: string[]): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < ids.length; index += CHUNK) {
    const part = ids.slice(index, index + CHUNK);
    rows.push(...app().db.prepare(sql(marks(part.length))).all(...part));
  }
  return rows;
}

export interface Bundle {
  row: Row;
  events: Row[];
  interviews: Row[];
  postings: Row[];
  submissions: Row[];
  correspondence: Row[];
  openReviews: number;
  interviewActivity: { at: string; kind: string }[];
}

export function loadBundles(rows: Row[], scope: AccessScope): Bundle[] {
  const ids = rows.map((row) => str(row.id));
  if (!ids.length) return [];
  const events = groupBy(inChunks((m) => `SELECT * FROM stage_events WHERE opportunity_id IN (${m}) AND decision IN ('applied','accepted') ORDER BY created_at, rowid`, ids).filter((row) => allows(scope, str(row.source_key))), (row) => str(row.opportunity_id));
  const interviews = groupBy(inChunks((m) => `SELECT * FROM interviews WHERE opportunity_id IN (${m}) ORDER BY start_at`, ids).filter((row) => allows(scope, str(row.source_key))), (row) => str(row.opportunity_id));
  const postings = groupBy(inChunks((m) => `SELECT id, opportunity_id, captured_at FROM posting_snapshots WHERE opportunity_id IN (${m}) ORDER BY captured_at DESC`, ids), (row) => str(row.opportunity_id));
  const submissions = groupBy(inChunks((m) => `SELECT id, opportunity_id, applied_on, created_at FROM submissions WHERE opportunity_id IN (${m}) ORDER BY applied_on DESC`, ids), (row) => str(row.opportunity_id));
  const correspondence = correspondenceFor(ids, scope, 3);
  const interviewIds = [...interviews.values()].flat().map((row) => str(row.id));
  // SQLite returns the other columns of the row holding MAX(occurred_at).
  const interviewActivity = new Map(inChunks((m) => `SELECT interview_id, MAX(occurred_at) AS at, kind, source_key FROM interview_events WHERE interview_id IN (${m}) GROUP BY interview_id`, interviewIds).map((row) => [str(row.interview_id), { at: str(row.at), kind: str(row.kind), source: str(row.source_key) }]));
  const reviews = openReviewRows(scope);
  const reviewCount = new Map<string, number>();
  for (const review of reviews) {
    const targets = new Set<string>([...(opt(review.opportunity_id) ? [str(review.opportunity_id)] : []), ...json<{ opportunityId: string }[]>(review.candidates, []).map((candidate) => candidate.opportunityId)]);
    for (const target of targets) reviewCount.set(target, (reviewCount.get(target) ?? 0) + 1);
  }
  return rows.map((row) => {
    const id = str(row.id);
    return {
      row,
      events: events.get(id) ?? [],
      interviews: interviews.get(id) ?? [],
      postings: allows(scope, MANUAL_SOURCE) ? postings.get(id) ?? [] : [],
      submissions: allows(scope, MANUAL_SOURCE) ? submissions.get(id) ?? [] : [],
      correspondence: correspondence.get(id) ?? [],
      openReviews: reviewCount.get(id) ?? 0,
      interviewActivity: (interviews.get(id) ?? []).flatMap((row) => {
        const activity = interviewActivity.get(str(row.id));
        return activity && allows(scope, activity.source) ? [activity] : [];
      }),
    };
  });
}

/** The stage this reader may see: the latest applied change from an allowed source. */
export function projectedStage(bundle: Bundle, scope: AccessScope): { stage: Stage; outcome: Outcome | null } {
  if (scope.kind === 'owner') return { stage: str(bundle.row.stage) as Stage, outcome: opt(bundle.row.outcome) as Outcome | null };
  const last = bundle.events.at(-1);
  return last ? { stage: str(last.to_stage) as Stage, outcome: opt(last.to_outcome) as Outcome | null } : { stage: 'saved', outcome: null };
}

function shortDate(date: string) {
  try {
    return formatDate(date, 'short');
  } catch {
    return date;
  }
}

export function summarize(bundle: Bundle, scope: AccessScope, at = nowAt()): OpportunitySummary {
  const { row } = bundle;
  const { stage, outcome } = projectedStage(bundle, scope);
  const live = bundle.interviews.filter((interview) => interview.status === 'scheduled' && interview.start_at && str(interview.end_at ?? interview.start_at) >= at);
  const upcoming = live.sort((a, b) => str(a.start_at).localeCompare(str(b.start_at)))[0];
  const scheduling = bundle.interviews.find((interview) => interview.status === 'scheduling_needed');
  const hasPosting = bundle.postings.length > 0;
  const nextAction = opt(row.next_action), nextDue = opt(row.next_action_due);
  const deadline = opt(row.deadline);
  const appliedEvent = [...bundle.events].reverse().find((event) => event.to_stage === 'applied');
  const appliedOn = bundle.submissions[0] ? str(bundle.submissions[0].applied_on) : appliedEvent ? str(appliedEvent.occurred_at) : null;
  const lastEvent = bundle.events.at(-1);

  let next: NextItem | null;
  if (stage === 'closed') next = { kind: 'closed', outcome, date: str(lastEvent?.occurred_at ?? row.updated_at) };
  else if (upcoming) next = { kind: 'interview', interviewId: str(upcoming.id), title: str(upcoming.title), startAt: opt(upcoming.start_at), zone: opt(upcoming.zone) };
  else if (scheduling) next = { kind: 'scheduling', interviewId: str(scheduling.id), title: str(scheduling.title) };
  else if (deadline) next = { kind: 'deadline', date: deadline, label: opt(row.deadline_label) ?? 'Deadline' };
  else if (nextAction) next = { kind: 'action', text: nextAction, due: nextDue };
  else if (appliedOn && stage !== 'saved') next = { kind: 'applied', date: appliedOn };
  else next = { kind: 'saved', date: str(row.created_at), hasDescription: hasPosting };

  let note: string | null = null;
  if (next?.kind === 'interview') note = next.title;
  else if (next?.kind === 'scheduling') note = 'Choose interview times';
  else if (nextAction && next?.kind !== 'action') note = nextDue ? `${nextAction} by ${shortDate(nextDue)}` : nextAction;
  else if (!hasPosting && stage === 'saved') note = 'Add the description to prepare with this role';

  const activities: { at: string; label: string }[] = [];
  for (const message of bundle.correspondence.slice(0, 1)) {
    const classification = str(message.classification) as keyof typeof CLASSIFICATION_LABELS;
    activities.push({ at: str(message.received_at), label: classification === 'other' || classification === 'recruiter' ? excerpt(str(message.subject) || 'Email', 60) : CLASSIFICATION_LABELS[classification] ?? 'Email' });
  }
  if (lastEvent) activities.push({ at: str(lastEvent.occurred_at), label: lastEvent.to_stage === 'saved' ? 'Saved' : `Moved to ${stageLabel(str(lastEvent.to_stage) as Stage, opt(lastEvent.to_outcome) as Outcome | null)}` });
  if (bundle.postings[0]) activities.push({ at: str(bundle.postings[0].captured_at), label: 'Description saved' });
  const INTERVIEW_ACTIVITY: Record<string, string> = { created: 'Interview added', scheduling_needed: 'Asked to choose interview times', scheduled: 'Interview scheduled', rescheduled: 'Interview rescheduled', canceled: 'Interview canceled', restored: 'Interview back on', updated: 'Interview details updated', source_removed: 'Interview removed from the calendar', completed: 'Interview held', corrected: 'Interview corrected' };
  // Linking or correcting details is housekeeping, not news, unless nothing else happened.
  for (const activity of bundle.interviewActivity) if (activity.kind !== 'updated' && activity.kind !== 'corrected') activities.push({ at: activity.at, label: INTERVIEW_ACTIVITY[activity.kind] ?? 'Interview updated' });
  if (!activities.length) for (const activity of bundle.interviewActivity) activities.push({ at: activity.at, label: INTERVIEW_ACTIVITY[activity.kind] ?? 'Interview updated' });
  const lastActivity = activities.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  if (!note && lastActivity && next?.kind !== 'action') note = lastActivity.label;

  return {
    id: str(row.id),
    revision: num(row.revision),
    company: str(row.company),
    role: str(row.role),
    location: opt(row.location),
    workArrangement: opt(row.work_arrangement) as OpportunitySummary['workArrangement'],
    sourceUrl: opt(row.source_url),
    stage,
    outcome,
    stageLocked: !!row.stage_lock,
    archivedAt: opt(row.archived_at),
    listingClosedAt: opt(row.listing_closed_at),
    hasPosting,
    schedulingNeeded: !!scheduling,
    next,
    note,
    lastActivity,
    openReviews: bundle.openReviews,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function opportunityRecord(bundle: Bundle, scope: AccessScope): OpportunityRecord {
  const { row } = bundle;
  return {
    ...summarize(bundle, scope),
    requisitionId: opt(row.requisition_id),
    nextAction: opt(row.next_action),
    nextActionDue: opt(row.next_action_due),
    deadline: opt(row.deadline),
    deadlineLabel: opt(row.deadline_label),
    compensation: json(row.compensation, []),
    contacts: visibleContacts(row, scope),
    notes: opt(row.notes),
    stageLock: json(row.stage_lock, null),
  };
}

export function stageHistory(opportunityId: string, scope: AccessScope) {
  return app().db.prepare('SELECT * FROM stage_events WHERE opportunity_id = ? ORDER BY created_at, rowid LIMIT 200').all(opportunityId)
    .filter((row) => allows(scope, str(row.source_key)))
    .map(stageEventRecord);
}

export function interviewsFor(opportunity: Row, scope: AccessScope) {
  return app().db.prepare('SELECT * FROM interviews WHERE opportunity_id = ? ORDER BY COALESCE(start_at, created_at)').all(str(opportunity.id))
    .filter((row) => allows(scope, str(row.source_key)))
    .map((row) => interviewRecord(row, opportunity, (source) => allows(scope, source)));
}

// ─── Review ──────────────────────────────────────────────────────────────────

export function openReviewRows(scope: AccessScope): Row[] {
  return app().db.prepare("SELECT * FROM review_items WHERE status = 'open' ORDER BY updated_at DESC LIMIT 500").all().filter((row) => allows(scope, str(row.source_key)));
}

export function reviewRecord(row: Row, scope: AccessScope): ReviewItem {
  const db = app().db;
  const candidates = json<{ opportunityId: string; level: ReviewItem['candidates'][number]['level']; evidence: ReviewItem['candidates'][number]['evidence'] }[]>(row.candidates, []);
  const opportunityRows = candidates.length && allows(scope, MANUAL_SOURCE) ? db.prepare(`SELECT id, company, role, stage FROM opportunities WHERE id IN (${marks(candidates.length)})`).all(...candidates.map((c) => c.opportunityId)) : [];
  const byId = new Map(opportunityRows.map((item) => [str(item.id), item]));
  const evidenceIds = json<string[]>(row.evidence_ids, []);
  const evidence = evidenceIds.length ? db.prepare(`SELECT * FROM correspondence WHERE id IN (${marks(evidenceIds.length)}) ORDER BY received_at`).all(...evidenceIds).filter((item) => allows(scope, str(item.source_key))) : [];
  const stored = json<Partial<ReviewItem['proposal']>>(row.proposal, {});
  const proposal: ReviewItem['proposal'] = { stage: stored.stage ?? null, outcome: stored.outcome ?? null, company: stored.company ?? null, role: stored.role ?? null, classification: stored.classification ?? null, interviewId: stored.interviewId ?? null };
  return {
    id: str(row.id),
    revision: num(row.revision),
    kind: str(row.kind) as ReviewItem['kind'],
    status: str(row.status) as ReviewItem['status'],
    title: str(row.title),
    summary: str(row.summary),
    source: str(row.source_key),
    candidates: candidates.flatMap((candidate) => {
      const opportunity = byId.get(candidate.opportunityId);
      return opportunity ? [{ opportunityId: candidate.opportunityId, company: str(opportunity.company), role: str(opportunity.role), stage: str(opportunity.stage) as Stage, level: candidate.level, evidence: candidate.evidence }] : [];
    }),
    evidence: evidence.map((item) => {
      const record = correspondenceRecord(item);
      return { id: record.id, subject: record.subject, from: record.from?.name ?? record.from?.email ?? null, receivedAt: record.receivedAt, excerpt: record.evidence, classification: record.classification, unavailable: record.unavailable };
    }),
    proposal,
    opportunityId: opt(row.opportunity_id),
    decision: opt(row.decision),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export const COLLECTION_LABELS: Record<string, string> = {
  [MANUAL_SOURCE]: 'Saved jobs, interviews and preparation',
  [MATERIALS_SOURCE]: 'Résumés and other materials',
};

export function accountLabel(account: string, kind: 'mail' | 'calendar', access: InvocationAccess | null): string {
  const stored = app().accounts.get(account, kind)?.label;
  if (stored) return stored;
  const binding = access?.accounts.find((item) => item.account === account);
  return binding ? `${kind === 'mail' ? 'Gmail' : 'Google Calendar'} account` : `${kind === 'mail' ? 'Email' : 'Calendar'} account (no longer connected)`;
}

export function coverageFor(scope: AccessScope, access: InvocationAccess | null): Coverage {
  const sources: Coverage['sources'] = [];
  for (const key of [MANUAL_SOURCE, MATERIALS_SOURCE]) if (allows(scope, key)) sources.push({ key, label: COLLECTION_LABELS[key], kind: 'collection', status: 'ready', from: null, to: null, partial: false });
  for (const account of app().accounts.list()) {
    const key = accountSource(account.account);
    if (!allows(scope, key)) continue;
    let coverage: { from: string | null; to: string | null; partial: boolean };
    if (account.kind === 'mail') {
      const checkpoint = mailCheckpointSchema.safeParse(account.checkpoint);
      const mail = mailCoverage(checkpoint.success ? checkpoint.data : null);
      coverage = { from: mail.from, to: mail.to, partial: mail.partial };
    } else {
      const map = (account.checkpoint ?? {}) as Record<string, unknown>;
      const parts = Object.values(map).map((value) => calendarCheckpointSchema.safeParse(value)).filter((parsed) => parsed.success).map((parsed) => calendarCoverage(parsed.data!));
      coverage = parts.length
        ? { from: parts.map((part) => part.from).filter(Boolean).sort()[0] ?? null, to: parts.map((part) => part.to).filter(Boolean).sort().at(-1) ?? null, partial: parts.some((part) => part.partial) }
        : { from: null, to: null, partial: true };
    }
    const granted = !!access?.accounts.some((item) => item.account === account.account);
    sources.push({ key, label: accountLabel(account.account, account.kind, access), kind: account.kind, status: granted || scope.kind !== 'owner' ? account.status : 'disconnected', ...coverage });
  }
  return { partial: sources.some((source) => source.partial || source.status === 'reconnect' || source.status === 'disconnected'), sources };
}

export { STAGE_LABELS };
