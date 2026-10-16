import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { isPersonalMailDomain } from '@ri/app-kit/sources';
import { z } from 'zod/v4';
import { iso, newId, type Ctx, type Param } from './context.js';
import { Labels } from './coverage.js';
import { memberLists, nextActionFor, organizationName, sourceLabels, type OrganizationCore } from './projection.js';
import { dateBounds } from './people.js';
import { assertWritable, opportunityFilter, sourceFilter, touch, writableCollection } from './scope.js';
import { ftsQuery, pruneSearchRows, removeSearchForRecord, setSearchRow } from './search.js';
import { cleanName, domainOf, sortKey } from './text.js';
import type { OrganizationFilters, OrganizationSummary, Sort } from '../schemas.js';

export type OrganizationRow = OrganizationCore & { merged_into: string | null; merged_at: string | null; sort_name: string; origin: string };

export function getOrganizationRow(ctx: Ctx, id: string): OrganizationRow | undefined {
  return ctx.db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', id);
}
export function resolveOrganizationId(ctx: Ctx, id: string): string {
  let current = id;
  for (let hop = 0; hop < 10; hop++) {
    const mapping = ctx.db.get<{ to_id: string }>("SELECT to_id FROM id_mappings WHERE from_id = ? AND active = 1 AND kind = 'organization' ORDER BY created_at DESC LIMIT 1", current);
    if (!mapping) return current;
    current = mapping.to_id;
  }
  return current;
}

/** Recompute supporting sources, names, last attributed activity and search rows for an organization. */
export function refreshOrganization(ctx: Ctx, organizationId: string) {
  const organization = getOrganizationRow(ctx, organizationId);
  if (!organization || organization.merged_into) {
    ctx.db.run('DELETE FROM organization_sources WHERE organization_id = ?', organizationId);
    removeSearchForRecord(ctx, 'organization', organizationId);
    return;
  }
  type Contribution = { name: string | null; rank: number; nameAt: string | null; lastSeen: string | null; text: Set<string> };
  const rows = new Map<string, Contribution>();
  const add = (source: string, patch: { name?: string | null; rank?: number; nameAt?: string | null; lastSeen?: string | null; text?: (string | null | undefined)[] }) => {
    let row = rows.get(source);
    if (!row) rows.set(source, (row = { name: null, rank: 9, nameAt: null, lastSeen: null, text: new Set() }));
    if (patch.name && (patch.rank ?? 9) <= row.rank && ((patch.rank ?? 9) < row.rank || (patch.nameAt ?? '') >= (row.nameAt ?? ''))) {
      row.name = patch.name; row.rank = patch.rank ?? 9; row.nameAt = patch.nameAt ?? row.nameAt;
    }
    if (patch.lastSeen && (!row.lastSeen || patch.lastSeen > row.lastSeen)) row.lastSeen = patch.lastSeen;
    for (const text of patch.text ?? []) if (text) row.text.add(text);
  };
  for (const row of ctx.db.all<{ source_key: string; domain: string; updated_at: string }>('SELECT source_key, domain, updated_at FROM organization_domains WHERE organization_id = ?', organizationId))
    add(row.source_key, { name: row.domain, rank: 2, nameAt: row.updated_at, lastSeen: row.updated_at, text: [row.domain] });
  for (const row of ctx.db.all<{ source_key: string; value: string; last_seen_at: string }>(
    "SELECT o.source_key, o.value, o.last_seen_at FROM identity_observations o JOIN identity_keys k ON k.id = o.key_id WHERE k.owner_kind = 'organization' AND k.owner_id = ?", organizationId))
    add(row.source_key, { lastSeen: row.last_seen_at, text: [row.value] });
  for (const row of ctx.db.all<{ source_key: string; observed_at: string }>(
    "SELECT source_key, MAX(observed_at) AS observed_at FROM affiliations WHERE organization_id = ? AND confidence != 'suggested' AND (decision IS NULL OR decision != 'rejected') GROUP BY source_key", organizationId))
    add(row.source_key, { lastSeen: row.observed_at });
  for (const row of ctx.db.all<{ source_key: string; org_name: string | null; created_at: string }>('SELECT source_key, org_name, MAX(created_at) AS created_at FROM import_rows WHERE organization_id = ? GROUP BY source_key, org_name', organizationId))
    add(row.source_key, { name: row.org_name, rank: 1, nameAt: row.created_at, lastSeen: row.created_at, text: [row.org_name] });
  const supports: string[] = [
    "SELECT DISTINCT collection AS source FROM notes WHERE subject_kind = 'organization' AND subject_id = ? AND archived_at IS NULL",
    'SELECT DISTINCT l.collection AS source FROM list_members m JOIN lists l ON l.id = m.list_id WHERE m.member_id = ? AND l.archived_at IS NULL',
    'SELECT DISTINCT o.collection AS source FROM opportunities o JOIN pipelines p ON p.id = o.pipeline_id WHERE o.organization_id = ? AND o.archived_at IS NULL AND p.collection = o.collection',
    "SELECT DISTINCT source_key AS source FROM commitments WHERE organization_id = ? AND state IN ('suggested','accepted','completed')",
    "SELECT DISTINCT collection AS source FROM task_links WHERE subject_kind = 'organization' AND subject_id = ?",
    "SELECT DISTINCT collection AS source FROM attribution_rules WHERE organization_id = ? AND state = 'active'",
  ];
  for (const sql of supports) for (const row of ctx.db.all<{ source: string }>(sql, organizationId)) add(row.source, {});
  if (organization.origin === 'manual' || organization.name_override || organization.website || organization.state === 'confirmed')
    add(organization.collection, { name: organization.name_override, rank: 0, nameAt: organization.updated_at, text: [organization.name_override, organization.website] });

  let best: { name: string; source: string; rank: number; at: string } | null = null;
  for (const [source, row] of rows)
    if (row.name && (!best || row.rank < best.rank || (row.rank === best.rank && (row.nameAt ?? '') > best.at))) best = { name: row.name, source, rank: row.rank, at: row.nameAt ?? '' };
  const display = organization.name_override ?? best?.name ?? 'Unnamed organization';
  const nameSource = organization.name_override ? organization.collection : best?.source ?? null;
  const activity = ctx.db.get<{ at: string | null }>("SELECT MAX(occurred_at) AS at FROM interaction_links WHERE target_kind = 'organization' AND target_id = ? AND state = 'linked'", organizationId)?.at ?? null;
  const time = iso(ctx);
  ctx.db.run('DELETE FROM organization_sources WHERE organization_id = ?', organizationId);
  const keep = new Set<string>();
  for (const [source, row] of rows) {
    ctx.db.run(
      'INSERT INTO organization_sources (id, created_at, updated_at, organization_id, source_key, name, sort_name, name_rank, name_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `${organizationId}:${source}`, time, time, organizationId, source, row.name, row.name ? sortKey(row.name) : null, row.name ? row.rank : null, row.nameAt, row.lastSeen,
    );
    const ref = `organization:${organizationId}:${source}`;
    keep.add(ref);
    setSearchRow(ctx, ref, 'organization', organizationId, source, [row.name, ...row.text].filter(Boolean).join(' '));
  }
  pruneSearchRows(ctx, 'organization', organizationId, 'organization:', keep);
  if (display !== organization.display_name || nameSource !== organization.name_source || activity !== organization.last_activity_at)
    ctx.db.run('UPDATE organizations SET display_name = ?, sort_name = ?, name_source = ?, last_activity_at = ?, updated_at = ? WHERE id = ?', display, sortKey(display), nameSource, activity, time, organizationId);
}

/** People whose search rows mention this organization's name need a refresh after a rename. */
export function refreshAffiliatedPeople(ctx: Ctx, organizationId: string, refreshPerson: (ctx: Ctx, id: string) => void) {
  for (const row of ctx.db.all<{ person_id: string }>('SELECT DISTINCT person_id FROM affiliations WHERE organization_id = ? LIMIT 2000', organizationId)) refreshPerson(ctx, row.person_id);
}

export function createOrganizationRecord(ctx: Ctx, input: { origin: string; collection: string; state: 'provisional' | 'confirmed'; nameOverride?: string | null; kind?: string | null; website?: string | null }): string {
  const time = iso(ctx), id = newId();
  const name = input.nameOverride ?? 'Unnamed organization';
  ctx.db.run(
    'INSERT INTO organizations (id, created_at, updated_at, revision, collection, origin, name_override, display_name, sort_name, name_source, kind, website, state, archived_at, last_activity_at, merged_into, merged_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)',
    id, time, time, input.collection, input.origin, input.nameOverride ?? null, name, sortKey(name), input.nameOverride ? input.collection : null, input.kind ?? null, input.website ?? null, input.state,
  );
  return id;
}

export function addDomain(ctx: Ctx, organizationId: string, domain: string, sourceKey: string, confirmation: 'confirmed' | 'observed', evidenceId: string | null = null) {
  const normalized = domainOf(domain);
  if (!normalized) throw new AppError('invalid_input', 'Enter a website such as fieldwork.example');
  // A shared mail provider's domain never identifies an organization.
  if (isPersonalMailDomain(normalized)) throw new AppError('invalid_input', `${normalized} is a shared mail provider, not an organization website`);
  const time = iso(ctx);
  ctx.db.run(
    'INSERT INTO organization_domains (id, created_at, updated_at, organization_id, domain, source_key, confirmation, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, domain, source_key) DO UPDATE SET updated_at = excluded.updated_at, confirmation = CASE WHEN excluded.confirmation = \'confirmed\' THEN \'confirmed\' ELSE organization_domains.confirmation END',
    newId(), time, time, organizationId, normalized, sourceKey, confirmation, evidenceId,
  );
  return normalized;
}

export interface CreateOrganizationInput { name: string; website?: string | null; kind?: string | null; collection?: string }
/** Creation needs only a name. Website and type are optional and no enrichment runs. */
export function createOrganization(ctx: Ctx, scope: AccessScope, input: CreateOrganizationInput): string {
  const name = cleanName(input.name);
  if (!name) throw new AppError('invalid_input', 'Enter a name');
  const collection = writableCollection(ctx, scope, input.collection);
  const website = input.website ? domainOf(input.website) : null;
  if (input.website && !website) throw new AppError('invalid_input', 'Enter a website such as fieldwork.example');
  const id = createOrganizationRecord(ctx, { origin: 'manual', collection, state: 'confirmed', nameOverride: name, kind: input.kind ?? null, website });
  if (website) addDomain(ctx, id, website, collection, 'confirmed');
  refreshOrganization(ctx, id);
  touch(ctx, collection);
  return id;
}

export interface SaveOrganizationInput { id: string; expectedRevision: number; name?: string | null; website?: string | null; kind?: string | null; archived?: boolean; confirm?: boolean; collection?: string }
export function saveOrganization(ctx: Ctx, scope: AccessScope, input: SaveOrganizationInput, refreshPerson: (ctx: Ctx, id: string) => void): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const id = resolveOrganizationId(ctx, input.id);
  const organization = getOrganizationRow(ctx, id);
  if (!organization || organization.merged_into) throw new AppError('not_found', 'This organization is no longer available');
  if (scope.kind !== 'owner') {
    const filter = sourceFilter(scope, 'source_key');
    if (!ctx.db.get(`SELECT 1 AS ok FROM organization_sources WHERE organization_id = ? AND ${filter.sql} LIMIT 1`, id, ...filter.params)) throw new AppError('not_found', 'This organization is no longer available');
    assertWritable(scope, organization.collection);
  }
  if (organization.revision !== input.expectedRevision) return { status: 'conflict', id, message: 'This company changed since you opened it. Compare and try again' };
  const time = iso(ctx);
  const changes: string[] = [];
  const params: Param[] = [];
  if (input.name !== undefined) {
    const name = input.name === null ? null : cleanName(input.name);
    if (input.name !== null && !name) throw new AppError('invalid_input', 'Enter a name or clear the correction');
    changes.push('name_override = ?'); params.push(name);
  }
  if (input.website !== undefined) {
    const website = input.website ? domainOf(input.website) : null;
    if (input.website && !website) throw new AppError('invalid_input', 'Enter a website such as fieldwork.example');
    changes.push('website = ?'); params.push(website);
    if (website) addDomain(ctx, id, website, organization.collection, 'confirmed');
  }
  if (input.kind !== undefined) { changes.push('kind = ?'); params.push(input.kind); }
  if (input.archived !== undefined) { changes.push('archived_at = ?'); params.push(input.archived ? organization.archived_at ?? time : null); }
  if (input.confirm) { changes.push("state = 'confirmed'"); }
  if (input.collection !== undefined && input.collection !== organization.collection) { changes.push('collection = ?'); params.push(writableCollection(ctx, scope, input.collection)); }
  ctx.db.run(`UPDATE organizations SET ${[...changes, 'revision = revision + 1', 'updated_at = ?'].join(', ')} WHERE id = ?`, ...params, time, id);
  refreshOrganization(ctx, id);
  if (input.name !== undefined) refreshAffiliatedPeople(ctx, id, refreshPerson);
  touch(ctx, organization.collection, input.collection);
  return { status: 'saved', id };
}

// ─── Directory ───────────────────────────────────────────────────────────────

const cursorSchema = z.object({ k: z.union([z.string(), z.number()]), id: z.string() }).strict();
function scoped(scope: AccessScope, column: string): { sql: string; params: Param[] } {
  return sourceFilter(scope, column);
}
function inList(column: string, values: string[]): { sql: string; params: Param[] } {
  if (!values.length) return { sql: '0', params: [] };
  return { sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values };
}

export function organizationQuery(ctx: Ctx, scope: AccessScope, filters: OrganizationFilters, sort: Sort) {
  const now = ctx.now(), today = now.toISOString().slice(0, 10);
  const where: string[] = ['o.merged_into IS NULL'];
  const params: Param[] = [];
  const unavailable: string[] = [];
  const add = (sql: string, ...values: Param[]) => { where.push(sql); params.push(...values); };
  const archived = filters.archived ?? 'active';
  if (archived === 'active') add('o.archived_at IS NULL');
  else if (archived === 'archived') add('o.archived_at IS NOT NULL');
  if (scope.kind !== 'owner') { const s = scoped(scope, 'os.source_key'); add(`EXISTS (SELECT 1 FROM organization_sources os WHERE os.organization_id = o.id AND ${s.sql})`, ...s.params); }
  const fts = ftsQuery(filters.text);
  if (filters.text?.trim() && !fts) add('0');
  if (fts) { const s = scoped(scope, 'r.source_key'); add(`o.id IN (SELECT r.record_id FROM search_fts f JOIN search_rows r ON r.id = f.rowid WHERE search_fts MATCH ? AND r.record_kind = 'organization' AND ${s.sql})`, fts, ...s.params); }
  if (filters.listIds?.length) {
    const s = scoped(scope, 'l.collection'), list = inList('m.list_id', filters.listIds);
    add(`EXISTS (SELECT 1 FROM list_members m JOIN lists l ON l.id = m.list_id WHERE m.member_id = o.id AND ${list.sql} AND l.archived_at IS NULL AND ${s.sql})`, ...list.params, ...s.params);
  }
  if (filters.hasFollowUp !== undefined) {
    const c = scoped(scope, 'c.source_key'), t = scoped(scope, 't.collection'), op = opportunityFilter(scope, 'opp');
    const exists = `(EXISTS (SELECT 1 FROM commitments c WHERE c.organization_id = o.id AND c.state = 'accepted' AND ${c.sql}) OR EXISTS (SELECT 1 FROM task_links t WHERE t.subject_kind = 'organization' AND t.subject_id = o.id AND t.status IN ('pending','linked') AND ${t.sql}) OR EXISTS (SELECT 1 FROM opportunities opp JOIN pipeline_stages st ON st.id = opp.stage_id WHERE opp.organization_id = o.id AND opp.archived_at IS NULL AND st.kind = 'open' AND opp.next_action IS NOT NULL AND ${op.sql}))`;
    add(filters.hasFollowUp ? exists : `NOT ${exists}`, ...c.params, ...t.params, ...op.params);
  }
  const l = scoped(scope, 'il.source_key'), lc = scoped(scope, 'il.collection');
  const activityExpr = scope.kind === 'owner' ? 'o.last_activity_at' : `(SELECT MAX(il.occurred_at) FROM interaction_links il WHERE il.target_kind = 'organization' AND il.target_id = o.id AND il.state = 'linked' AND ${l.sql} AND ${lc.sql})`;
  const activityParams = scope.kind === 'owner' ? [] : [...l.params, ...lc.params];
  const bounds = dateBounds(filters.lastExchange, now);
  if (bounds) {
    const clauses: string[] = [], values: Param[] = [];
    if (bounds.from) { clauses.push(`${activityExpr} >= ?`); values.push(...activityParams, bounds.from); }
    if (bounds.to) { clauses.push(`${activityExpr} < ?`); values.push(...activityParams, bounds.to); }
    if (!clauses.length) { clauses.push(`${activityExpr} IS NOT NULL`); values.push(...activityParams); }
    const body = clauses.join(' AND ');
    add(filters.lastExchange?.includeNone ? `((${body}) OR ${activityExpr} IS NULL)` : `(${body})`, ...values, ...(filters.lastExchange?.includeNone ? activityParams : []));
  }
  if (filters.sources?.length) {
    const permitted = filters.sources.filter((source) => scope.kind === 'owner' || scope.sources.has(source));
    for (const source of filters.sources) if (!permitted.includes(source)) unavailable.push(source);
    const list = inList('os2.source_key', permitted);
    add(`EXISTS (SELECT 1 FROM organization_sources os2 WHERE os2.organization_id = o.id AND ${list.sql})`, ...list.params);
  }
  let key: string;
  const keyParams: Param[] = [];
  const ctes: string[] = [], cteParams: Param[] = [], joins: string[] = [];
  switch (sort.key) {
    case 'last_exchange': key = `COALESCE(${activityExpr}, '')`; keyParams.push(...activityParams); break;
    case 'added': key = 'o.created_at'; break;
    case 'next_action': {
      const c = scoped(scope, 'c.source_key'), t = scoped(scope, 't.collection'), op = opportunityFilter(scope, 'opp');
      ctes.push(`due AS (SELECT oid, MIN(d) AS d FROM (
        SELECT c.organization_id AS oid, c.due_date AS d FROM commitments c WHERE c.state = 'accepted' AND c.direction = 'i_owe' AND c.due_date IS NOT NULL AND c.organization_id IS NOT NULL AND ${c.sql}
        UNION ALL SELECT t.subject_id, substr(t.due_at, 1, 10) FROM task_links t WHERE t.subject_kind = 'organization' AND t.status IN ('pending','linked') AND t.due_at IS NOT NULL AND ${t.sql}
        UNION ALL SELECT opp.organization_id, opp.next_action_date FROM opportunities opp WHERE opp.organization_id IS NOT NULL AND opp.archived_at IS NULL AND opp.next_action_date IS NOT NULL AND ${op.sql}) GROUP BY oid)`);
      cteParams.push(...c.params, ...t.params, ...op.params);
      joins.push('LEFT JOIN due ON due.oid = o.id');
      key = "COALESCE(due.d, '9999')";
      break;
    }
    default:
      if (scope.kind === 'owner') key = 'o.sort_name';
      else {
        const n = scoped(scope, 'o.name_source'), m = scoped(scope, 'os4.source_key');
        key = `CASE WHEN ${n.sql} THEN o.sort_name ELSE COALESCE((SELECT os4.sort_name FROM organization_sources os4 WHERE os4.organization_id = o.id AND os4.sort_name IS NOT NULL AND ${m.sql} ORDER BY os4.name_rank ASC, os4.name_at DESC LIMIT 1), 'unnamed organization') END`;
        keyParams.push(...n.params, ...m.params);
      }
  }
  void today;
  return { where: where.join(' AND '), params, key, keyParams, unavailable, with: ctes.length ? `WITH ${ctes.join(', ')} ` : '', withParams: cteParams, joins: joins.join(' ') };
}

export function listOrganizations(ctx: Ctx, scope: AccessScope, input: { cursor?: string; limit: number; filters: OrganizationFilters; sort: Sort }) {
  const query = organizationQuery(ctx, scope, input.filters, input.sort);
  const descending = input.sort.direction === 'desc';
  const cursor = decodeCursor(cursorSchema, input.cursor);
  const page = ctx.db.all<{ id: string; k: string | number }>(
    `${query.with}SELECT id, k FROM (SELECT o.id AS id, ${query.key} AS k FROM organizations o ${query.joins} WHERE ${query.where}) ${cursor ? `WHERE (k, id) ${descending ? '<' : '>'} (?, ?)` : ''} ORDER BY k ${descending ? 'DESC' : 'ASC'}, id ${descending ? 'DESC' : 'ASC'} LIMIT ?`,
    ...query.withParams, ...query.keyParams, ...query.params, ...(cursor ? [cursor.k, cursor.id] : []), input.limit + 1,
  );
  const total = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM organizations o WHERE ${query.where}`, ...query.params)?.count ?? 0);
  const items = page.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: summarizeOrganizations(ctx, scope, items.map((row) => row.id)),
    nextCursor: page.length > input.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null,
    total,
    unavailableFilters: query.unavailable,
  };
}

export function organizationActivity(ctx: Ctx, scope: AccessScope, organization: Pick<OrganizationCore, 'id' | 'last_activity_at'>): string | null {
  if (scope.kind === 'owner') return organization.last_activity_at;
  const l = scoped(scope, 'source_key'), c = scoped(scope, 'collection');
  return ctx.db.get<{ at: string | null }>(`SELECT MAX(occurred_at) AS at FROM interaction_links WHERE target_kind = 'organization' AND target_id = ? AND state = 'linked' AND ${l.sql} AND ${c.sql}`, organization.id, ...l.params, ...c.params)?.at ?? null;
}
export function knownPeopleCount(ctx: Ctx, scope: AccessScope, organizationId: string, today: string): number {
  const s = scoped(scope, 'a.source_key');
  return Number(ctx.db.get<{ count: number }>(
    `SELECT COUNT(DISTINCT a.person_id) AS count FROM affiliations a JOIN persons p ON p.id = a.person_id
     WHERE a.organization_id = ? AND a.confidence != 'suggested' AND (a.decision IS NULL OR a.decision != 'rejected') AND a.status != 'former' AND (a.valid_to IS NULL OR a.valid_to >= ?) AND p.merged_into IS NULL AND ${s.sql}`,
    organizationId, today, ...s.params)?.count ?? 0);
}
export function organizationDomain(ctx: Ctx, scope: AccessScope, organizationId: string): string | null {
  const s = scoped(scope, 'source_key');
  return ctx.db.get<{ domain: string }>(`SELECT domain FROM organization_domains WHERE organization_id = ? AND ${s.sql} ORDER BY confirmation = 'confirmed' DESC, updated_at DESC LIMIT 1`, organizationId, ...s.params)?.domain ?? null;
}

export function summarizeOrganizations(ctx: Ctx, scope: AccessScope, ids: string[]): OrganizationSummary[] {
  if (!ids.length) return [];
  const labels = new Labels(ctx);
  const today = ctx.now().toISOString().slice(0, 10);
  const rows = new Map(ctx.db.all<OrganizationRow>(`SELECT * FROM organizations WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const organization = rows.get(id);
    if (!organization) return [];
    return [{
      id,
      name: organizationName(ctx, scope, organization),
      revision: organization.revision,
      state: organization.state as 'provisional' | 'confirmed',
      archived: !!organization.archived_at,
      domain: organizationDomain(ctx, scope, id),
      peopleCount: knownPeopleCount(ctx, scope, id, today),
      lastExchangeAt: organizationActivity(ctx, scope, organization),
      nextAction: nextActionFor(ctx, scope, { kind: 'organization', id }, today),
      lists: memberLists(ctx, scope, id),
      sourceLabels: sourceLabels(ctx, scope, 'organization_sources', 'organization_id', id, labels),
      addedAt: organization.created_at,
    } satisfies OrganizationSummary];
  });
}

export function searchOrganizations(ctx: Ctx, scope: AccessScope, text: string, limit: number): OrganizationSummary[] {
  const fts = ftsQuery(text);
  if (!fts) return [];
  const s = scoped(scope, 'r.source_key');
  const rows = ctx.db.all<OrganizationRow>(
    `SELECT DISTINCT o.* FROM search_fts f JOIN search_rows r ON r.id = f.rowid JOIN organizations o ON o.id = r.record_id
     WHERE search_fts MATCH ? AND r.record_kind = 'organization' AND ${s.sql} AND o.merged_into IS NULL AND o.archived_at IS NULL LIMIT 500`, fts, ...s.params);
  const ranked = rows.map((row) => ({ id: row.id, key: sortKey(organizationName(ctx, scope, row)) })).sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  return summarizeOrganizations(ctx, scope, ranked.slice(0, limit).map((row) => row.id));
}
