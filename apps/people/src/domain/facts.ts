import { AppError } from '@ri/app-kit/contract';
import { sha256, type AccessScope } from '@ri/app-kit/data';
import { iso, newId, type Ctx } from './context.js';
import type { Labels } from './coverage.js';
import { decisionsForItem, decisionsForSubject, findDecision, recordDecision } from './decisions.js';
import { longDate, organizationRef, personRef } from './projection.js';
import { canSee, sourceFilter, touch } from './scope.js';
import { fingerprintText, json } from './text.js';
import type { Fact } from '../schemas.js';

export type FactField = 'affiliation' | 'stage' | 'context';
export type FactRow = {
  id: string; created_at: string; updated_at: string; revision: number; subject_kind: string; subject_id: string; field: FactField; claim_key: string;
  value: string; detail: string | null; user_value: string | null; evidence_id: string | null; source_key: string; source_revision: string | null; passage: string | null;
  observed_at: string; effective_from: string | null; effective_to: string | null; extraction_version: string; origin: string;
  status: 'suggested' | 'active' | 'superseded' | 'withdrawn' | 'rejected'; decision_key: string; decided_at: string | null; decided_by: string | null; resolution: string | null; previous_decision: string | null;
};

/**
 * The decision key of a claim. An anchor such as the subject's email address
 * keeps the key stable when the subject record is recreated after a source is
 * deleted and synced again, so a rejection still applies.
 */
export const factKey = (anchor: string, field: string, value: string) => sha256(JSON.stringify(['fact', anchor, field, fingerprintText(value)]));
const anchorOf = (row: Pick<FactRow, 'claim_key'>) => row.claim_key.split('#')[0];

/**
 * Store a suggested claim with its exact passage. A rejected or withdrawn
 * claim is never restored by resync or a new extraction version. A different
 * value for the same field is new and carries the earlier rejection so the
 * reviewer sees why it is back.
 */
export function suggestFact(ctx: Ctx, input: {
  subjectKind: 'person' | 'organization' | 'opportunity'; subjectId: string; field: FactField; value: string; detail?: Record<string, unknown> | null;
  evidenceId: string | null; sourceKey: string; sourceRevision?: string | null; passage: string | null; observedAt: string;
  origin: 'signature' | 'extraction' | 'import'; extractionVersion: string; anchor?: string;
}): string | null {
  const anchor = input.anchor ?? `${input.subjectKind}:${input.subjectId}`;
  const key = factKey(anchor, input.field, input.value);
  const decision = findDecision(ctx, key);
  const time = iso(ctx);
  const existing = ctx.db.get<FactRow>('SELECT * FROM facts WHERE decision_key = ? AND source_key = ?', key, input.sourceKey);
  if (existing) {
    ctx.db.run('UPDATE facts SET observed_at = MAX(observed_at, ?), extraction_version = ?, updated_at = ? WHERE id = ?', input.observedAt, input.extractionVersion, time, existing.id);
    return existing.id;
  }
  if (decision && ['rejected', 'withdrawn'].includes(decision.decision)) return null;
  const status = decision?.decision === 'accepted' || decision?.decision === 'corrected' ? 'active' : 'suggested';
  let previous: string | null = null;
  if (status === 'suggested') {
    const prior = [...decisionsForItem(ctx, anchor), ...decisionsForSubject(ctx, 'fact', input.subjectKind, input.subjectId, 'rejected')].find((row) => row.decision === 'rejected' && row.fingerprint?.startsWith(`${input.field}:`));
    if (prior) previous = `You rejected "${prior.extracted_value ?? 'an earlier version'}" on ${longDate(prior.updated_at)}. A newer source says "${input.value}".`.slice(0, 400);
  }
  if (input.field !== 'context')
    for (const older of ctx.db.all<FactRow>("SELECT * FROM facts WHERE subject_kind = ? AND subject_id = ? AND field = ? AND status = 'suggested' AND decision_key != ? AND observed_at < ?", input.subjectKind, input.subjectId, input.field, key, input.observedAt))
      ctx.db.run("UPDATE facts SET status = 'superseded', resolution = ?, revision = revision + 1, updated_at = ? WHERE id = ?", `Replaced by a newer suggestion from ${longDate(input.observedAt)}`, time, older.id);
  const id = newId();
  ctx.db.run(
    `INSERT INTO facts (id, created_at, updated_at, revision, subject_kind, subject_id, field, claim_key, value, detail, user_value, evidence_id, source_key, source_revision, passage, observed_at, effective_from, effective_to, extraction_version, origin, status, decision_key, decided_at, decided_by, resolution, previous_decision)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    id, time, time, input.subjectKind, input.subjectId, input.field, `${anchor}#${input.field}:${fingerprintText(input.value).slice(0, 120)}`, input.value.slice(0, 500),
    input.detail ? JSON.stringify(input.detail) : null, decision?.user_value ?? null, input.evidenceId, input.sourceKey, input.sourceRevision ?? null, input.passage?.slice(0, 1200) ?? null,
    input.observedAt, input.extractionVersion, input.origin, status, key, previous,
  );
  return id;
}

const FIELD_LABELS: Record<FactField, string> = { affiliation: 'Role and company', stage: 'Stage change', context: 'Sourced detail' };
export function projectFact(ctx: Ctx, scope: AccessScope, row: FactRow, labels: Labels): Fact | null {
  if (!canSee(scope, row.source_key)) return null;
  const subject = row.subject_kind === 'person' ? personRef(ctx, scope, row.subject_id) : row.subject_kind === 'organization' ? organizationRef(ctx, scope, row.subject_id) : opportunityTitle(ctx, scope, row.subject_id);
  if (!subject) return null;
  return {
    id: row.id,
    revision: row.revision,
    subjectKind: row.subject_kind as Fact['subjectKind'],
    subjectId: row.subject_id,
    subjectName: subject.name,
    field: row.field,
    label: FIELD_LABELS[row.field] ?? 'Detail',
    value: row.value,
    userValue: row.user_value,
    status: row.status,
    origin: row.origin as Fact['origin'],
    evidenceId: row.evidence_id,
    passage: row.passage,
    observedAt: row.observed_at,
    sourceLabel: labels.of(row.source_key),
    previousDecision: row.previous_decision,
    resolution: row.resolution,
  };
}
function opportunityTitle(ctx: Ctx, scope: AccessScope, id: string) {
  const row = ctx.db.get<{ id: string; title: string; collection: string }>('SELECT id, title, collection FROM opportunities WHERE id = ?', id);
  return row && canSee(scope, row.collection) ? { id: row.id, name: row.title } : null;
}

export function factsFor(ctx: Ctx, scope: AccessScope, subjectKind: string, subjectId: string, labels: Labels, statuses: string[] = ['suggested', 'active']): Fact[] {
  const filter = sourceFilter(scope, 'source_key');
  return ctx.db.all<FactRow>(
    `SELECT * FROM facts WHERE subject_kind = ? AND subject_id = ? AND status IN (${statuses.map(() => '?').join(',')}) AND ${filter.sql} ORDER BY observed_at DESC LIMIT 30`,
    subjectKind, subjectId, ...statuses, ...filter.params)
    .map((row) => projectFact(ctx, scope, row, labels)).filter((fact): fact is Fact => !!fact);
}

export function getFactRow(ctx: Ctx, id: string) {
  return ctx.db.get<FactRow>('SELECT * FROM facts WHERE id = ?', id);
}
export const factDetail = (row: FactRow) => json<Record<string, string | null>>(row.detail, {});

/**
 * Record a decision on a suggested or active fact. Applying an accepted
 * affiliation or stage is done by the caller with its own revision checks.
 */
export function decideFact(ctx: Ctx, row: FactRow, actor: string, decision: 'accept' | 'reject' | 'correct' | 'withdraw', userValue?: string | null) {
  const time = iso(ctx);
  const status = decision === 'accept' || decision === 'correct' ? 'active' : decision === 'reject' ? 'rejected' : 'withdrawn';
  if (decision === 'withdraw' && row.status !== 'active') throw new AppError('invalid_input', 'Only an active fact can be removed from context');
  if ((decision === 'accept' || decision === 'reject' || decision === 'correct') && !['suggested', 'active'].includes(row.status)) throw new AppError('conflict', 'This suggestion was already resolved');
  ctx.db.run(
    'UPDATE facts SET status = ?, user_value = ?, decided_at = ?, decided_by = ?, resolution = ?, revision = revision + 1, updated_at = ? WHERE decision_key = ?',
    status, decision === 'correct' ? userValue ?? null : row.user_value, time, actor,
    decision === 'reject' ? 'Rejected by you' : decision === 'withdraw' ? 'Removed from active context by you' : decision === 'correct' ? 'Corrected by you' : 'Accepted by you',
    time, row.decision_key,
  );
  recordDecision(ctx, {
    key: row.decision_key, kind: 'fact', subjectKind: row.subject_kind, subjectId: row.subject_id,
    decision: decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : decision === 'correct' ? 'corrected' : 'withdrawn',
    extractedValue: row.value, userValue: decision === 'correct' ? userValue ?? null : null, fingerprint: `${row.field}:${fingerprintText(row.value)}`, itemKey: anchorOf(row), actor,
  });
  touch(ctx, row.source_key);
}
