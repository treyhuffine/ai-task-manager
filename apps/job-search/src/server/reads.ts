/**
 * Paged reads. Sorting and filtering use values projected under the caller's
 * scope, so a chat's order, counts and stages never reflect sources it was
 * not given. Cursors are opaque keys over that projected order.
 */
import { AppError, type InvocationAccess } from '@ri/app-kit/contract';
import { allows, decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import { MANUAL_SOURCE, MATERIALS_SOURCE, STAGE_ORDER, type MaterialFamily, type OpportunitySummary, type Outcome, type Stage } from '../domain/model.js';
import { app, dataRevision, nowAt } from './state.js';
import { correspondenceFor, correspondenceRecord } from './correspondence.js';
import { coverageFor, interviewsFor, loadBundles, opportunityRecord, openReviewRows, reviewRecord, stageHistory, summarize } from './project.js';
import { postingSummary, snapshotRows, latestSnapshot, snapshotExtract } from './postings.js';
import { submissionRecords } from './submissions.js';
import { followUpRecord, followUpRows } from './followups.js';
import { familyRecords, listFamilyRows } from './materials.js';
import { likePattern, str, opt, json, type Row } from './util.js';

const cursorSchema = z.object({ key: z.string().max(400) }).strict();

function invert(iso: string) {
  return iso.replace(/\d/g, (digit) => String(9 - Number(digit)));
}
function sortKey(summary: OpportunitySummary): string {
  const next = summary.next?.kind === 'interview' && summary.next.startAt ? summary.next.startAt
    : summary.next?.kind === 'deadline' ? `${summary.next.date}T23:59:59.999Z`
      : summary.next?.kind === 'action' && summary.next.due ? `${summary.next.due}T23:59:59.999Z` : '9999-12-31T00:00:00.000Z';
  return [STAGE_ORDER[summary.stage], next, invert(summary.lastActivity?.at ?? summary.updatedAt), summary.company.toLowerCase().slice(0, 60), summary.id].join('|');
}

export interface OpportunityFilter {
  cursor?: string;
  limit: number;
  search?: string;
  stage?: Stage;
  outcome?: Outcome;
  view: 'active' | 'closed' | 'archived' | 'all';
}

export function listOpportunities(scope: AccessScope, access: InvocationAccess | null, filter: OpportunityFilter) {
  const empty = { items: [] as OpportunitySummary[], nextCursor: null as string | null, total: 0, counts: { saved: 0, applied: 0, interviewing: 0, offer: 0, closed: 0, archived: 0 }, coverage: coverageFor(scope, access), revision: dataRevision() };
  if (!allows(scope, MANUAL_SOURCE)) return empty;
  const where: string[] = [], params: string[] = [];
  const search = filter.search?.trim();
  if (search) {
    where.push("(company LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\')");
    params.push(likePattern(search), likePattern(search));
  }
  const rows = app().db.prepare(`SELECT * FROM opportunities ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at LIMIT 5000`).all(...params);
  const summaries = loadBundles(rows, scope).map((bundle) => summarize(bundle, scope));
  const counts = { saved: 0, applied: 0, interviewing: 0, offer: 0, closed: 0, archived: 0 };
  for (const summary of summaries) {
    if (summary.archivedAt) counts.archived++;
    else counts[summary.stage]++;
  }
  const visible = summaries.filter((summary) => {
    if (filter.view === 'archived' && !summary.archivedAt) return false;
    if (filter.view !== 'archived' && filter.view !== 'all' && summary.archivedAt) return false;
    if (filter.view === 'active' && summary.stage === 'closed') return false;
    if (filter.view === 'closed' && summary.stage !== 'closed') return false;
    if (filter.stage && summary.stage !== filter.stage) return false;
    if (filter.outcome && summary.outcome !== filter.outcome) return false;
    return true;
  });
  const keyed = visible.map((summary) => ({ summary, key: sortKey(summary) })).sort((a, b) => a.key.localeCompare(b.key));
  const after = decodeCursor(cursorSchema, filter.cursor)?.key ?? null;
  const start = after ? keyed.findIndex((item) => item.key > after) : 0;
  const page = start < 0 ? [] : keyed.slice(start, start + filter.limit + 1);
  const items = page.slice(0, filter.limit);
  return {
    items: items.map((item) => item.summary),
    nextCursor: page.length > filter.limit ? encodeCursor({ key: items.at(-1)!.key }) : null,
    total: visible.length,
    counts,
    coverage: coverageFor(scope, access),
    revision: dataRevision(),
  };
}

export function opportunityRowFor(scope: AccessScope, id: string): Row {
  if (!allows(scope, MANUAL_SOURCE)) throw new AppError('forbidden', 'This caller was not given your saved jobs');
  const row = app().db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  if (!row) throw new AppError('not_found', 'This opportunity is not available. It may have been removed');
  return row;
}

export function getOpportunity(scope: AccessScope, access: InvocationAccess | null, id: string) {
  const row = opportunityRowFor(scope, id);
  const [bundle] = loadBundles([row], scope);
  const latest = latestSnapshot(id);
  const latestId = latest ? str(latest.id) : null;
  const reviews = openReviewRows(scope).filter((review) => opt(review.opportunity_id) === id || json<{ opportunityId: string }[]>(review.candidates, []).some((candidate) => candidate.opportunityId === id));
  return {
    opportunity: opportunityRecord(bundle, scope),
    requirements: latest ? snapshotExtract(latest).requirements : [],
    postings: snapshotRows(id).map((snapshot) => postingSummary(snapshot, latestId)),
    stageHistory: stageHistory(id, scope),
    correspondence: (correspondenceFor([id], scope, 60).get(id) ?? []).map(correspondenceRecord),
    interviews: interviewsFor(row, scope),
    submissions: submissionRecords([id], scope).get(id) ?? [],
    followUps: followUpRows(scope, { opportunityId: id }).map(followUpRecord),
    reviews: reviews.map((review) => reviewRecord(review, scope)),
    preparations: app().db.prepare('SELECT id, interview_id, revision, updated_at FROM preparations WHERE opportunity_id = ? ORDER BY updated_at DESC').all(id)
      .map((prep) => ({ id: str(prep.id), interviewId: opt(prep.interview_id), revision: Number(prep.revision), updatedAt: str(prep.updated_at) })),
    coverage: coverageFor(scope, access),
    revision: dataRevision(),
  };
}

export function listInterviews(scope: AccessScope, access: InvocationAccess | null, filter: { cursor?: string; limit: number; opportunityId?: string; status?: string; upcoming?: boolean }) {
  if (!allows(scope, MANUAL_SOURCE)) return { items: [], nextCursor: null, coverage: coverageFor(scope, access), revision: dataRevision() };
  const db = app().db;
  const rows = filter.opportunityId
    ? db.prepare('SELECT * FROM interviews WHERE opportunity_id = ? ORDER BY COALESCE(start_at, created_at), id').all(filter.opportunityId)
    : db.prepare('SELECT * FROM interviews ORDER BY COALESCE(start_at, created_at), id LIMIT 5000').all();
  const now = nowAt();
  const byOpportunity = new Map<string, Map<string, ReturnType<typeof interviewsFor>[number]>>();
  const recordFor = (row: Row) => {
    const id = str(row.opportunity_id);
    if (!byOpportunity.has(id)) {
      const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
      byOpportunity.set(id, new Map(opportunity ? interviewsFor(opportunity, scope).map((record) => [record.id, record]) : []));
    }
    return byOpportunity.get(id)!.get(str(row.id));
  };
  const records = rows.filter((row) => allows(scope, str(row.source_key)) && (!filter.status || row.status === filter.status) && (!filter.upcoming || (row.status === 'scheduled' && str(row.end_at ?? row.start_at) >= now)))
    .map(recordFor).filter((record): record is NonNullable<typeof record> => !!record);
  const key = (record: (typeof records)[number]) => `${record.startAt ?? record.createdAt}|${record.id}`;
  const after = decodeCursor(cursorSchema, filter.cursor)?.key ?? null;
  const start = after ? records.findIndex((record) => key(record) > after) : 0;
  const page = start < 0 ? [] : records.slice(start, start + filter.limit + 1);
  const items = page.slice(0, filter.limit);
  return { items, nextCursor: page.length > filter.limit ? encodeCursor({ key: key(items.at(-1)!) }) : null, coverage: coverageFor(scope, access), revision: dataRevision() };
}

export function listMaterials(scope: AccessScope, access: InvocationAccess | null, filter: { cursor?: string; limit: number; search?: string; kind?: MaterialFamily['kind']; archived?: boolean }) {
  if (!allows(scope, MATERIALS_SOURCE)) return { items: [] as MaterialFamily[], nextCursor: null, coverage: coverageFor(scope, access), revision: dataRevision() };
  const rows = listFamilyRows(filter);
  const after = decodeCursor(cursorSchema, filter.cursor)?.key ?? null;
  const key = (row: Row) => `${invert(str(row.updated_at))}|${str(row.id)}`;
  const sorted = rows.sort((a, b) => key(a).localeCompare(key(b)));
  const start = after ? sorted.findIndex((row) => key(row) > after) : 0;
  const page = start < 0 ? [] : sorted.slice(start, start + filter.limit + 1);
  const items = page.slice(0, filter.limit);
  return { items: familyRecords(items, scope), nextCursor: page.length > filter.limit ? encodeCursor({ key: key(items.at(-1)!) }) : null, coverage: coverageFor(scope, access), revision: dataRevision() };
}

export function listReview(scope: AccessScope, access: InvocationAccess | null, filter: { cursor?: string; limit: number }) {
  const rows = openReviewRows(scope);
  const after = decodeCursor(cursorSchema, filter.cursor)?.key ?? null;
  const key = (row: Row) => `${invert(str(row.updated_at))}|${str(row.id)}`;
  const start = after ? rows.findIndex((row) => key(row) > after) : 0;
  const page = start < 0 ? [] : rows.slice(start, start + filter.limit + 1);
  const items = page.slice(0, filter.limit);
  return { items: items.map((row) => reviewRecord(row, scope)), nextCursor: page.length > filter.limit ? encodeCursor({ key: key(items.at(-1)!) }) : null, coverage: coverageFor(scope, access), revision: dataRevision() };
}

export function correspondenceDetail(scope: AccessScope, id: string) {
  const row = app().db.prepare('SELECT * FROM correspondence WHERE id = ?').get(id);
  if (!row || !allows(scope, str(row.source_key))) throw new AppError('not_found', 'This email is not available to this caller');
  const record = correspondenceRecord(row);
  const body = record.unavailable ? null : (row.body_digest ? app().blobs.readText(str(row.body_digest)) : null);
  return { message: record, body: body ? body.slice(0, 20000) : null, passage: opt(row.classification_passage) };
}

export { followUpRows };
