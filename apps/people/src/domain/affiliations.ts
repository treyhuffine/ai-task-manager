import { AppError } from '@ri/app-kit/contract';
import { sha256, type AccessScope } from '@ri/app-kit/data';
import { iso, newId, type Ctx, type Param } from './context.js';
import type { Labels } from './coverage.js';
import { getOrganizationRow, refreshOrganization, createOrganizationRecord, resolveOrganizationId } from './organizations.js';
import { getPersonRow, refreshPerson, resolvePersonId } from './people.js';
import { longDate, monthYear, organizationRef, personName, personVisible, organizationVisible } from './projection.js';
import { assertWritable, canSee, sourceFilter, touch, writableCollection } from './scope.js';
import { cleanName, isLocalDate, sortKey } from './text.js';
import type { Affiliation } from '../schemas.js';

export type AffiliationRow = {
  id: string; created_at: string; updated_at: string; revision: number; person_id: string; organization_id: string; role: string | null;
  valid_from: string | null; valid_to: string | null; observed_at: string; status: 'current' | 'former' | 'unknown';
  confidence: 'confirmed' | 'observed' | 'suggested'; source_key: string; origin: string; evidence_id: string | null;
  decision: 'confirmed' | 'rejected' | null; decision_key: string | null;
};

/** The same claim (person, organization, role) has one decision key across sources and re-imports. */
export function affiliationKey(personId: string, organizationId: string, role: string | null) {
  return sha256(JSON.stringify(['affiliation', personId, organizationId, sortKey(role ?? '')]));
}

/**
 * Record an affiliation observed in a source. An old imported role keeps its
 * observation date and never becomes confirmed current employment. A claim the
 * user rejected stays rejected when it is observed again.
 */
export function observeAffiliation(ctx: Ctx, input: { personId: string; organizationId: string; role: string | null; sourceKey: string; origin: 'import' | 'domain'; observedAt: string; evidenceId?: string | null; confidence: 'observed' | 'suggested' }) {
  const key = affiliationKey(input.personId, input.organizationId, input.role);
  const prior = ctx.db.get<{ decision: string }>("SELECT decision FROM decisions WHERE decision_key = ? AND kind = 'affiliation'", key);
  const existing = ctx.db.get<AffiliationRow>('SELECT * FROM affiliations WHERE decision_key = ? AND source_key = ?', key, input.sourceKey);
  const time = iso(ctx);
  if (existing) {
    ctx.db.run('UPDATE affiliations SET observed_at = MAX(observed_at, ?), updated_at = ? WHERE id = ?', input.observedAt, time, existing.id);
    return existing.id;
  }
  const id = newId();
  ctx.db.run(
    `INSERT INTO affiliations (id, created_at, updated_at, revision, person_id, organization_id, role, valid_from, valid_to, observed_at, status, confidence, source_key, origin, evidence_id, decision, decision_key)
     VALUES (?, ?, ?, 1, ?, ?, ?, NULL, NULL, ?, 'unknown', ?, ?, ?, ?, ?, ?)`,
    id, time, time, input.personId, input.organizationId, cleanName(input.role), input.observedAt, input.confidence, input.sourceKey, input.origin, input.evidenceId ?? null,
    prior?.decision === 'rejected' ? 'rejected' : null, key,
  );
  return id;
}

function recordDecision(ctx: Ctx, key: string, decision: 'confirmed' | 'rejected', subjectId: string, actor: string, value: string | null) {
  const time = iso(ctx);
  ctx.db.run(
    `INSERT INTO decisions (id, created_at, updated_at, revision, decision_key, kind, subject_kind, subject_id, decision, extracted_value, user_value, fingerprint, actor)
     VALUES (?, ?, ?, 1, ?, 'affiliation', 'person', ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(decision_key) DO UPDATE SET decision = excluded.decision, revision = decisions.revision + 1, updated_at = excluded.updated_at, actor = excluded.actor`,
    newId(), time, time, key, subjectId, decision, value, actor,
  );
}

export interface SaveAffiliationInput {
  id?: string;
  expectedRevision?: number;
  personId?: string;
  organizationId?: string;
  organizationName?: string;
  role?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  status?: 'current' | 'former' | 'unknown';
  decision?: 'confirm' | 'reject';
  collection?: string;
}

/**
 * Create a dated affiliation, edit your own, or decide on an observed one.
 * Confirming an observed affiliation records your version beside the
 * original evidence. Rejecting it is durable. Ending a job sets a valid-to
 * date and never moves old conversations.
 */
export function saveAffiliation(ctx: Ctx, scope: AccessScope, actor: string, input: SaveAffiliationInput): { status: 'saved'; id: string } | { status: 'conflict'; id: string; message: string } {
  for (const value of [input.validFrom, input.validTo]) if (value && !isLocalDate(value)) throw new AppError('invalid_input', 'Use a real calendar date');
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) throw new AppError('invalid_input', 'The end date is before the start date');
  const time = iso(ctx);
  if (!input.id) {
    if (!input.personId) throw new AppError('invalid_input', 'Choose a person');
    const personId = resolvePersonId(ctx, input.personId);
    if (!getPersonRow(ctx, personId) || !personVisible(ctx, scope, personId)) throw new AppError('not_found', 'This person is no longer available');
    const collection = writableCollection(ctx, scope, input.collection);
    let organizationId: string;
    if (input.organizationId) {
      organizationId = resolveOrganizationId(ctx, input.organizationId);
      if (!getOrganizationRow(ctx, organizationId) || !organizationVisible(ctx, scope, organizationId)) throw new AppError('not_found', 'This company is no longer available');
    } else {
      const name = cleanName(input.organizationName);
      if (!name) throw new AppError('invalid_input', 'Choose or name a company');
      organizationId = createOrganizationRecord(ctx, { origin: 'manual', collection, state: 'confirmed', nameOverride: name });
    }
    const role = cleanName(input.role ?? null);
    const status = input.status ?? (input.validTo ? 'former' : 'current');
    const id = newId();
    ctx.db.run(
      `INSERT INTO affiliations (id, created_at, updated_at, revision, person_id, organization_id, role, valid_from, valid_to, observed_at, status, confidence, source_key, origin, evidence_id, decision, decision_key)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'manual', NULL, NULL, ?)`,
      id, time, time, personId, organizationId, role, input.validFrom ?? null, input.validTo ?? null, time, status, collection, affiliationKey(personId, organizationId, role),
    );
    refreshOrganization(ctx, organizationId);
    refreshPerson(ctx, personId);
    touch(ctx, collection);
    return { status: 'saved', id };
  }
  const row = ctx.db.get<AffiliationRow>('SELECT * FROM affiliations WHERE id = ?', input.id);
  if (!row || !canSee(scope, row.source_key)) throw new AppError('not_found', 'This affiliation is no longer available');
  if (input.expectedRevision !== undefined && row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This affiliation changed since you opened it. Compare and try again' };
  if (row.confidence === 'confirmed' && row.origin === 'manual') {
    assertWritable(scope, row.source_key);
    if (input.decision === 'reject') {
      ctx.db.run("UPDATE affiliations SET decision = 'rejected', revision = revision + 1, updated_at = ? WHERE id = ?", time, row.id);
    } else {
      const changes: string[] = [], params: Param[] = [];
      if (input.role !== undefined) { changes.push('role = ?'); params.push(cleanName(input.role)); }
      if (input.validFrom !== undefined) { changes.push('valid_from = ?'); params.push(input.validFrom); }
      if (input.validTo !== undefined) { changes.push('valid_to = ?'); params.push(input.validTo); if (input.validTo && !input.status) { changes.push("status = 'former'"); } }
      if (input.status !== undefined) { changes.push('status = ?'); params.push(input.status); }
      ctx.db.run(`UPDATE affiliations SET ${[...changes, 'revision = revision + 1', 'updated_at = ?'].join(', ')} WHERE id = ?`, ...params, time, row.id);
    }
    refreshPerson(ctx, row.person_id);
    refreshOrganization(ctx, row.organization_id);
    touch(ctx, row.source_key);
    return { status: 'saved', id: row.id };
  }
  // An observed or suggested affiliation: keep it as evidence and record the decision separately.
  const key = row.decision_key ?? affiliationKey(row.person_id, row.organization_id, row.role);
  if (input.decision === 'reject') {
    if (scope.kind !== 'owner' && !scope.operations.has('write')) throw new AppError('forbidden', 'This chat may not change that record');
    ctx.db.run("UPDATE affiliations SET decision = 'rejected', revision = revision + 1, updated_at = ? WHERE decision_key = ?", time, key);
    recordDecision(ctx, key, 'rejected', row.person_id, actor, row.role);
    refreshPerson(ctx, row.person_id);
    refreshOrganization(ctx, row.organization_id);
    touch(ctx, row.source_key);
    return { status: 'saved', id: row.id };
  }
  const collection = writableCollection(ctx, scope, input.collection);
  const role = input.role !== undefined ? cleanName(input.role) : row.role;
  const status = input.status ?? (input.validTo ? 'former' : row.status === 'unknown' ? 'current' : row.status);
  const id = newId();
  ctx.db.run(
    `INSERT INTO affiliations (id, created_at, updated_at, revision, person_id, organization_id, role, valid_from, valid_to, observed_at, status, confidence, source_key, origin, evidence_id, decision, decision_key)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'manual', ?, NULL, ?)`,
    id, time, time, row.person_id, row.organization_id, role, input.validFrom ?? row.valid_from, input.validTo ?? row.valid_to, row.observed_at, status, collection, row.evidence_id, key,
  );
  ctx.db.run("UPDATE affiliations SET decision = 'confirmed', revision = revision + 1, updated_at = ? WHERE decision_key = ? AND id != ? AND confidence != 'confirmed'", time, key, id);
  recordDecision(ctx, key, 'confirmed', row.person_id, actor, row.role);
  const organization = getOrganizationRow(ctx, row.organization_id);
  if (organization?.state === 'provisional') ctx.db.run("UPDATE organizations SET state = 'confirmed', collection = ?, revision = revision + 1, updated_at = ? WHERE id = ?", collection, time, row.organization_id);
  refreshPerson(ctx, row.person_id);
  refreshOrganization(ctx, row.organization_id);
  touch(ctx, collection, row.source_key);
  return { status: 'saved', id };
}

function describe(row: AffiliationRow, labels: Labels, today: string): string {
  const former = row.status === 'former' || (!!row.valid_to && row.valid_to < today);
  if (row.confidence === 'suggested') return `Suggested from a shared email domain. Review before relying on it`;
  if (row.confidence === 'confirmed') {
    if (former) return row.valid_to ? `Former, until ${longDate(`${row.valid_to}T12:00:00Z`)}. Confirmed by you` : 'Former. Confirmed by you';
    if (row.status === 'current') return row.valid_from ? `Current since ${longDate(`${row.valid_from}T12:00:00Z`)}. Confirmed by you` : 'Current. Confirmed by you';
    return 'Dates unknown. Recorded by you';
  }
  return `Observed in ${labels.of(row.source_key)} in ${monthYear(row.observed_at)}. Not confirmed as current`;
}

export function projectAffiliation(ctx: Ctx, scope: AccessScope, row: AffiliationRow, labels: Labels, today: string): Affiliation | null {
  const organization = organizationRef(ctx, scope, row.organization_id);
  const person = getPersonRow(ctx, row.person_id);
  if (!organization || !person || person.merged_into) return null;
  return {
    id: row.id,
    revision: row.revision,
    personId: row.person_id,
    personName: personName(ctx, scope, person),
    organizationId: row.organization_id,
    organizationName: organization.name,
    role: row.role,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    observedAt: row.observed_at,
    status: row.status === 'former' || (!!row.valid_to && row.valid_to < today) ? 'former' : row.status,
    confidence: row.confidence,
    origin: row.origin as Affiliation['origin'],
    sourceLabel: labels.of(row.source_key),
    evidenceId: row.evidence_id,
    description: describe(row, labels, today),
  };
}

/** Visible, unrejected affiliations. An observed row superseded by your visible confirmation is folded into it. */
export function visibleAffiliations(ctx: Ctx, scope: AccessScope, column: 'person_id' | 'organization_id', id: string, labels: Labels, options: { includeSuggested?: boolean; limit?: number } = {}): Affiliation[] {
  const today = ctx.now().toISOString().slice(0, 10);
  const filter = sourceFilter(scope, 'source_key');
  const rows = ctx.db.all<AffiliationRow>(
    `SELECT * FROM affiliations WHERE ${column} = ? AND (decision IS NULL OR decision != 'rejected') ${options.includeSuggested ? '' : "AND confidence != 'suggested'"} AND ${filter.sql}
     ORDER BY confidence = 'confirmed' DESC, observed_at DESC LIMIT ?`, id, ...filter.params, options.limit ?? 300);
  const confirmedKeys = new Set(rows.filter((row) => row.confidence === 'confirmed').map((row) => row.decision_key));
  return rows
    .filter((row) => !(row.confidence !== 'confirmed' && row.decision === 'confirmed' && confirmedKeys.has(row.decision_key)))
    .map((row) => projectAffiliation(ctx, scope, row, labels, today))
    .filter((value): value is Affiliation => !!value);
}
