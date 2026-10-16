import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import { iso, newId, type Ctx, type Param } from './context.js';
import { attachKey, ensureKey, observe, type KeyKind } from './identity.js';
import { Labels } from './coverage.js';
import {
  bestAffiliation, lastExchange, memberLists, nextActionFor, nextMeeting, organizationNameFor, personName, primaryEmail, sourceLabels, type PersonCore,
} from './projection.js';
import { assertWritable, canSee, opportunityFilter, sourceFilter, touch, writableCollection } from './scope.js';
import { OWNER_ONLY_SOURCE, ftsQuery, pruneSearchRows, removeSearchForRecord, setSearchRow } from './search.js';
import { cleanName, sortKey } from './text.js';
import type { PeopleFilters, PersonSummary, Sort } from '../schemas.js';

export type PersonRow = PersonCore & { merged_into: string | null; merged_at: string | null; sort_name: string };

export function getPersonRow(ctx: Ctx, id: string): PersonRow | undefined {
  return ctx.db.get<PersonRow>('SELECT * FROM persons WHERE id = ?', id);
}
/** Follow a durable merge mapping so an old ID still opens the surviving record. */
export function resolvePersonId(ctx: Ctx, id: string): string {
  let current = id;
  for (let hop = 0; hop < 10; hop++) {
    const mapping = ctx.db.get<{ to_id: string }>("SELECT to_id FROM id_mappings WHERE from_id = ? AND active = 1 AND kind = 'person' ORDER BY created_at DESC LIMIT 1", current);
    if (!mapping) return current;
    current = mapping.to_id;
  }
  return current;
}

type Contribution = { name: string | null; rank: number; nameAt: string | null; lastExchange: string | null; lastSeen: string | null; text: Set<string> };

/**
 * Recompute everything derived about a person from base rows: which sources
 * support it, the name each source supplies, last direct exchange per source,
 * the owner's cached display values and its search rows. Idempotent.
 */
export function refreshPerson(ctx: Ctx, personId: string) {
  const person = getPersonRow(ctx, personId);
  if (!person || person.merged_into) {
    ctx.db.run('DELETE FROM person_sources WHERE person_id = ?', personId);
    removeSearchForRecord(ctx, 'person', personId);
    return;
  }
  const rows = new Map<string, Contribution>();
  const add = (source: string, patch: Partial<Omit<Contribution, 'text'>> & { text?: (string | null | undefined)[] }) => {
    let row = rows.get(source);
    if (!row) rows.set(source, (row = { name: null, rank: 9, nameAt: null, lastExchange: null, lastSeen: null, text: new Set() }));
    if (patch.name && (patch.rank ?? 9) <= row.rank && (patch.rank! < row.rank || (patch.nameAt ?? '') >= (row.nameAt ?? ''))) {
      row.name = patch.name; row.rank = patch.rank ?? 9; row.nameAt = patch.nameAt ?? row.nameAt;
    }
    if (patch.lastExchange && (!row.lastExchange || patch.lastExchange > row.lastExchange)) row.lastExchange = patch.lastExchange;
    if (patch.lastSeen && (!row.lastSeen || patch.lastSeen > row.lastSeen)) row.lastSeen = patch.lastSeen;
    for (const text of patch.text ?? []) if (text) row.text.add(text);
  };
  for (const row of ctx.db.all<{ source_key: string; observed_name: string | null; last_seen_at: string; value: string; kind: string; shared: number }>(
    `SELECT o.source_key, o.observed_name, o.last_seen_at, o.value, k.kind, k.shared FROM identity_observations o JOIN identity_keys k ON k.id = o.key_id
     WHERE k.owner_kind = 'person' AND k.owner_id = ?`, personId)) {
    add(row.source_key, { lastSeen: row.last_seen_at, text: [row.observed_name, row.value] });
    if (row.observed_name) add(row.source_key, { name: row.observed_name, rank: 1, nameAt: row.last_seen_at });
    else if (row.kind === 'email' && !row.shared) add(row.source_key, { name: row.value, rank: 2, nameAt: row.last_seen_at });
  }
  for (const row of ctx.db.all<{ source_key: string; exchange: string | null; seen: string | null }>(
    `SELECT source_key, MAX(CASE WHEN direct = 1 AND active = 1 AND kind = 'email' THEN occurred_at END) AS exchange, MAX(occurred_at) AS seen
     FROM interaction_participants WHERE person_id = ? GROUP BY source_key`, personId))
    add(row.source_key, { lastExchange: row.exchange, lastSeen: row.seen });
  // The company name is indexed under the affiliation's source only as that source knows it. Otherwise only
  // the role, and the full name goes to a row only the owner's search matches.
  const withheld = new Set<string>();
  for (const row of ctx.db.all<{ source_key: string; role: string | null; observed_at: string; organization_id: string; display_name: string }>(
    `SELECT a.source_key, a.role, a.observed_at, a.organization_id, o.display_name FROM affiliations a JOIN organizations o ON o.id = a.organization_id
     WHERE a.person_id = ? AND a.confidence != 'suggested' AND (a.decision IS NULL OR a.decision != 'rejected')`, personId)) {
    const known = organizationNameFor(ctx, row.organization_id, row.source_key);
    if (!known) withheld.add(row.display_name);
    add(row.source_key, { lastSeen: row.observed_at, text: [row.role, known] });
  }
  for (const row of ctx.db.all<{ source_key: string; name: string | null; created_at: string }>('SELECT source_key, name, created_at FROM import_rows WHERE person_id = ?', personId))
    add(row.source_key, { name: row.name, rank: 1, nameAt: row.created_at, lastSeen: row.created_at, text: [row.name] });
  const supports: [string, Param][] = [
    ['SELECT DISTINCT collection AS source FROM notes WHERE subject_kind = \'person\' AND subject_id = ? AND archived_at IS NULL', personId],
    ['SELECT DISTINCT l.collection AS source FROM list_members m JOIN lists l ON l.id = m.list_id WHERE m.member_id = ? AND l.archived_at IS NULL', personId],
    // An opportunity supports a person under its collection only when its pipeline lives there too, so a single-source reader may see both.
    ['SELECT DISTINCT o.collection AS source FROM opportunity_people op JOIN opportunities o ON o.id = op.opportunity_id JOIN pipelines p ON p.id = o.pipeline_id WHERE op.person_id = ? AND o.archived_at IS NULL AND p.collection = o.collection', personId],
    ["SELECT DISTINCT source_key AS source FROM commitments WHERE person_id = ? AND state IN ('suggested','accepted','completed')", personId],
    ["SELECT DISTINCT collection AS source FROM task_links WHERE subject_kind = 'person' AND subject_id = ?", personId],
  ];
  for (const [sql, param] of supports) for (const row of ctx.db.all<{ source: string }>(sql, param)) add(row.source, {});
  if (person.origin === 'manual' || person.name_override || person.headline) add(person.collection, { name: person.name_override, rank: 0, nameAt: person.updated_at, text: [person.name_override, person.headline] });

  let best: { name: string; source: string; rank: number; at: string } | null = null;
  let exchange: string | null = null;
  for (const [source, row] of rows) {
    if (row.name && (!best || row.rank < best.rank || (row.rank === best.rank && (row.nameAt ?? '') > best.at))) best = { name: row.name, source, rank: row.rank, at: row.nameAt ?? '' };
    if (row.lastExchange && (!exchange || row.lastExchange > exchange)) exchange = row.lastExchange;
  }
  const display = person.name_override ?? best?.name ?? 'Unnamed contact';
  const nameSource = person.name_override ? person.collection : best?.source ?? null;
  const time = iso(ctx);
  ctx.db.run('DELETE FROM person_sources WHERE person_id = ?', personId);
  const keep = new Set<string>();
  for (const [source, row] of rows) {
    ctx.db.run(
      'INSERT INTO person_sources (id, created_at, updated_at, person_id, source_key, name, sort_name, name_rank, name_at, last_exchange_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `${personId}:${source}`, time, time, personId, source, row.name, row.name ? sortKey(row.name) : null, row.name ? row.rank : null, row.nameAt, row.lastExchange, row.lastSeen,
    );
    const ref = `person:${personId}:${source}`;
    keep.add(ref);
    setSearchRow(ctx, ref, 'person', personId, source, [row.name, ...row.text].filter(Boolean).join(' '));
  }
  if (withheld.size && rows.size) {
    const ref = `person:${personId}:${OWNER_ONLY_SOURCE}`;
    keep.add(ref);
    setSearchRow(ctx, ref, 'person', personId, OWNER_ONLY_SOURCE, [display, ...withheld].join(' '));
  }
  pruneSearchRows(ctx, 'person', personId, 'person:', keep);
  if (display !== person.display_name || nameSource !== person.name_source || exchange !== person.last_exchange_at)
    ctx.db.run('UPDATE persons SET display_name = ?, sort_name = ?, name_source = ?, last_exchange_at = ?, updated_at = ? WHERE id = ?', display, sortKey(display), nameSource, exchange, time, personId);
}

// ─── Creation and edits ──────────────────────────────────────────────────────

export const identifierInput = z.object({ kind: z.enum(['email', 'phone', 'linkedin']), value: z.string().min(1).max(320) }).strict();

/** A person created from an observed identifier (sync or import). Never merges by name. */
export function createPersonForKey(ctx: Ctx, keyId: string, origin: string, collection = 'manual'): string {
  const time = iso(ctx), id = newId();
  ctx.db.run(
    'INSERT INTO persons (id, created_at, updated_at, revision, collection, origin, name_override, display_name, sort_name, name_source, headline, pinned, archived_at, keep_in_touch_days, last_exchange_at, merged_into, merged_at) VALUES (?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL)',
    id, time, time, collection, origin, 'Unnamed contact', sortKey('Unnamed contact'),
  );
  attachKey(ctx, keyId, 'person', id, 'auto');
  return id;
}
/** A person with no identifier, such as a LinkedIn connection without an email. */
export function createPersonRecord(ctx: Ctx, input: { origin: string; collection: string; nameOverride?: string | null }): string {
  const time = iso(ctx), id = newId();
  const name = input.nameOverride ?? 'Unnamed contact';
  ctx.db.run(
    'INSERT INTO persons (id, created_at, updated_at, revision, collection, origin, name_override, display_name, sort_name, name_source, headline, pinned, archived_at, keep_in_touch_days, last_exchange_at, merged_into, merged_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, NULL, NULL, NULL)',
    id, time, time, input.collection, input.origin, input.nameOverride ?? null, name, sortKey(name), input.nameOverride ? input.collection : null,
  );
  return id;
}

export interface CreatePersonInput {
  name: string;
  headline?: string | null;
  collection?: string;
  identifiers?: { kind: 'email' | 'phone' | 'linkedin'; value: string }[];
  pinned?: boolean;
  keepInTouchDays?: number | null;
}
/** A manual person needs only a name. Identifiers already owned by someone else are refused, never moved. */
export function createManualPerson(ctx: Ctx, scope: AccessScope, input: CreatePersonInput): string {
  const name = cleanName(input.name);
  if (!name) throw new AppError('invalid_input', 'Enter a name');
  const collection = writableCollection(ctx, scope, input.collection);
  const keys = (input.identifiers ?? []).map((identifier) => {
    const key = ensureKey(ctx, identifier.kind as KeyKind, identifier.value);
    if (!key) throw new AppError('invalid_input', `${identifier.value.slice(0, 80)} is not a valid ${identifier.kind === 'email' ? 'email address' : identifier.kind}`);
    if (key.ownerKind === 'person' && key.ownerId) {
      const owner = getPersonRow(ctx, key.ownerId);
      throw new AppError('conflict', `${identifier.value.slice(0, 80)} already belongs to ${owner && !owner.merged_into ? personName(ctx, scope, owner) : 'another person'}. Open that person or review a merge instead`);
    }
    return { key, value: identifier.value };
  });
  const id = createPersonRecord(ctx, { origin: 'manual', collection, nameOverride: name });
  const time = iso(ctx);
  if (input.pinned || input.keepInTouchDays || input.headline) ctx.db.run('UPDATE persons SET pinned = ?, keep_in_touch_days = ?, headline = ? WHERE id = ?', input.pinned ? 1 : 0, input.keepInTouchDays ?? null, cleanName(input.headline ?? null, 120), id);
  for (const { key, value } of keys) {
    observe(ctx, { keyId: key.id, sourceKey: collection, value, at: time, confirmation: 'confirmed' });
    attachKey(ctx, key.id, 'person', id, 'user');
  }
  refreshPerson(ctx, id);
  touch(ctx, collection);
  return id;
}

export interface SavePersonInput {
  id: string;
  expectedRevision: number;
  name?: string | null;
  headline?: string | null;
  pinned?: boolean;
  archived?: boolean;
  keepInTouchDays?: number | null;
  collection?: string;
  addIdentifiers?: { kind: 'email' | 'phone' | 'linkedin'; value: string }[];
  detachKeyIds?: string[];
  sharedKeyIds?: string[];
}
export type SaveOutcome = { status: 'saved'; id: string } | { status: 'conflict'; id: string; message: string };

/** User edits win over observed values and survive resync. Revision checked. */
export function savePerson(ctx: Ctx, scope: AccessScope, input: SavePersonInput): SaveOutcome {
  const id = resolvePersonId(ctx, input.id);
  const person = getPersonRow(ctx, id);
  if (!person || person.merged_into) throw new AppError('not_found', 'This person is no longer available');
  if (scope.kind !== 'owner') {
    const filter = sourceFilter(scope, 'source_key');
    if (!ctx.db.get(`SELECT 1 AS ok FROM person_sources WHERE person_id = ? AND ${filter.sql} LIMIT 1`, id, ...filter.params)) throw new AppError('not_found', 'This person is no longer available');
    assertWritable(scope, person.collection);
  }
  if (person.revision !== input.expectedRevision) return { status: 'conflict', id, message: 'This person changed since you opened it. Compare and try again' };
  const time = iso(ctx);
  const changes: string[] = [];
  const params: Param[] = [];
  if (input.name !== undefined) {
    const name = input.name === null ? null : cleanName(input.name);
    if (input.name !== null && !name) throw new AppError('invalid_input', 'Enter a name or clear the correction');
    changes.push('name_override = ?'); params.push(name);
  }
  if (input.headline !== undefined) { changes.push('headline = ?'); params.push(input.headline === null ? null : cleanName(input.headline, 120)); }
  if (input.pinned !== undefined) { changes.push('pinned = ?'); params.push(input.pinned ? 1 : 0); }
  if (input.archived !== undefined) { changes.push('archived_at = ?'); params.push(input.archived ? person.archived_at ?? time : null); }
  if (input.keepInTouchDays !== undefined) {
    if (input.keepInTouchDays !== null && (input.keepInTouchDays < 7 || input.keepInTouchDays > 730)) throw new AppError('invalid_input', 'Choose a reminder interval between 7 and 730 days');
    changes.push('keep_in_touch_days = ?'); params.push(input.keepInTouchDays);
  }
  if (input.collection !== undefined && input.collection !== person.collection) {
    changes.push('collection = ?'); params.push(writableCollection(ctx, scope, input.collection));
  }
  ctx.db.run(`UPDATE persons SET ${[...changes, 'revision = revision + 1', 'updated_at = ?'].join(', ')} WHERE id = ?`, ...params, time, id);
  const collection = getPersonRow(ctx, id)!.collection;
  for (const identifier of input.addIdentifiers ?? []) {
    const key = ensureKey(ctx, identifier.kind as KeyKind, identifier.value);
    if (!key) throw new AppError('invalid_input', `${identifier.value.slice(0, 80)} is not valid`);
    if (key.ownerKind === 'person' && key.ownerId && key.ownerId !== id) throw new AppError('conflict', `${identifier.value.slice(0, 80)} already belongs to another person. Review a merge instead`);
    observe(ctx, { keyId: key.id, sourceKey: collection, value: identifier.value, at: time, confirmation: 'confirmed' });
    attachKey(ctx, key.id, 'person', id, 'user');
  }
  const affected = new Set<string>([id]);
  // Detaching an address keeps the person's name as yours, so the record never turns into an unnamed one.
  if ((input.detachKeyIds?.length || input.sharedKeyIds?.length) && !getPersonRow(ctx, id)!.name_override)
    ctx.db.run('UPDATE persons SET name_override = display_name, name_source = collection WHERE id = ? AND display_name != ?', id, 'Unnamed contact');
  for (const keyId of input.detachKeyIds ?? []) {
    const key = ctx.db.get<{ owner_id: string | null }>("SELECT owner_id FROM identity_keys WHERE id = ? AND owner_kind = 'person'", keyId);
    if (!key || key.owner_id !== id) throw new AppError('invalid_input', 'That address does not belong to this person');
    for (const person of attachKey(ctx, keyId, 'none', null, 'user')) affected.add(person);
  }
  for (const keyId of input.sharedKeyIds ?? []) {
    const key = ctx.db.get<{ owner_id: string | null }>('SELECT owner_id FROM identity_keys WHERE id = ?', keyId);
    if (!key || key.owner_id !== id) throw new AppError('invalid_input', 'That address does not belong to this person');
    ctx.db.run("UPDATE identity_keys SET shared = 1, owner_kind = 'none', owner_id = NULL, decision = 'user', revision = revision + 1, updated_at = ? WHERE id = ?", time, keyId);
    ctx.db.run('UPDATE interaction_participants SET person_id = NULL, updated_at = ? WHERE key_id = ?', time, keyId);
  }
  for (const affectedId of affected) refreshPerson(ctx, affectedId);
  touch(ctx, collection, person.collection);
  return { status: 'saved', id };
}

// ─── Directory ───────────────────────────────────────────────────────────────

const cursorSchema = z.object({ k: z.union([z.string(), z.number()]), id: z.string() }).strict();
export interface ListPeopleInput { cursor?: string; limit: number; filters: PeopleFilters; sort: Sort }

function scopeList(scope: AccessScope) {
  return scope.kind === 'owner' ? null : [...scope.sources];
}
function inList(column: string, values: string[]): { sql: string; params: Param[] } {
  if (!values.length) return { sql: '0', params: [] };
  return { sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values };
}
function scoped(scope: AccessScope, column: string) {
  const sources = scopeList(scope);
  return sources ? inList(column, sources) : { sql: '1', params: [] as Param[] };
}
export function dateBounds(filter: { from?: string; to?: string; withinDays?: number; olderThanDays?: number; nextDays?: number } | undefined, now: Date) {
  if (!filter) return null;
  const day = 864e5;
  const toIso = (value: string, end: boolean) => (value.length === 10 ? (end ? new Date(Date.parse(`${value}T00:00:00Z`) + day).toISOString() : `${value}T00:00:00.000Z`) : new Date(value).toISOString());
  let from = filter.from ? toIso(filter.from, false) : null;
  let to = filter.to ? toIso(filter.to, true) : null;
  if (filter.withinDays !== undefined) { const start = new Date(now.getTime() - filter.withinDays * day).toISOString(); from = !from || start > from ? start : from; }
  if (filter.olderThanDays !== undefined) { const end = new Date(now.getTime() - filter.olderThanDays * day).toISOString(); to = !to || end < to ? end : to; }
  if (filter.nextDays !== undefined) { const end = new Date(now.getTime() + filter.nextDays * day).toISOString(); to = !to || end < to ? end : to; from = from ?? now.toISOString(); }
  return { from, to };
}

/** SQL pieces for the person directory under a caller's scope. Unavailable source filters narrow, never broaden. */
export function peopleQuery(ctx: Ctx, scope: AccessScope, filters: PeopleFilters, sort: Sort) {
  const now = ctx.now(), nowIso = now.toISOString(), today = nowIso.slice(0, 10);
  const where: string[] = ['p.merged_into IS NULL'];
  const params: Param[] = [];
  const unavailable: string[] = [];
  const add = (sql: string, ...values: Param[]) => { where.push(sql); params.push(...values); };
  const archived = filters.archived ?? 'active';
  if (archived === 'active') add('p.archived_at IS NULL');
  else if (archived === 'archived') add('p.archived_at IS NOT NULL');
  if (scope.kind !== 'owner') { const s = scoped(scope, 'ps.source_key'); add(`EXISTS (SELECT 1 FROM person_sources ps WHERE ps.person_id = p.id AND ${s.sql})`, ...s.params); }
  const fts = ftsQuery(filters.text);
  if (filters.text?.trim() && !fts) add('0');
  if (fts) {
    const s = scoped(scope, 'r.source_key');
    add(`p.id IN (SELECT r.record_id FROM search_fts f JOIN search_rows r ON r.id = f.rowid WHERE search_fts MATCH ? AND r.record_kind = 'person' AND ${s.sql})`, fts, ...s.params);
  }
  if (filters.organizationIds?.length) {
    const s = scoped(scope, 'a.source_key'), list = inList('a.organization_id', filters.organizationIds);
    add(`EXISTS (SELECT 1 FROM affiliations a WHERE a.person_id = p.id AND ${list.sql} AND a.confidence != 'suggested' AND (a.decision IS NULL OR a.decision != 'rejected') AND a.status != 'former' AND (a.valid_to IS NULL OR a.valid_to >= ?) AND ${s.sql})`, ...list.params, today, ...s.params);
  }
  if (filters.listIds?.length) {
    const s = scoped(scope, 'l.collection'), list = inList('m.list_id', filters.listIds);
    add(`EXISTS (SELECT 1 FROM list_members m JOIN lists l ON l.id = m.list_id WHERE m.member_id = p.id AND ${list.sql} AND l.archived_at IS NULL AND ${s.sql})`, ...list.params, ...s.params);
  }
  if (filters.pinned !== undefined) add('p.pinned = ?', filters.pinned ? 1 : 0);
  if (filters.hasFollowUp !== undefined) {
    const c = scoped(scope, 'c.source_key'), t = scoped(scope, 't.collection');
    const exists = `(EXISTS (SELECT 1 FROM commitments c WHERE c.person_id = p.id AND c.state = 'accepted' AND ${c.sql}) OR EXISTS (SELECT 1 FROM task_links t WHERE t.subject_kind = 'person' AND t.subject_id = p.id AND t.status IN ('pending','linked') AND (t.task_status IS NULL OR t.task_status NOT IN ('done','completed','archived')) AND ${t.sql}))`;
    add(filters.hasFollowUp ? exists : `NOT ${exists}`, ...c.params, ...t.params);
  }
  // Per-person aggregates are computed once as common table expressions, then joined, never per row.
  const ctes: string[] = [], cteParams: Param[] = [], joins: string[] = [];
  const meetingBounds = dateBounds(filters.nextMeeting, now);
  const meetingExpr = 'meet.d';
  if (meetingBounds || sort.key === 'next_meeting') {
    const s = scoped(scope, 'ip.source_key');
    ctes.push(`meet AS (SELECT ip.person_id AS pid, MIN(ip.occurred_at) AS d FROM interaction_participants ip WHERE ip.kind = 'meeting' AND ip.active = 1 AND ip.occurred_at >= ? AND ip.person_id IS NOT NULL AND ${s.sql} GROUP BY ip.person_id)`);
    cteParams.push(nowIso, ...s.params);
    joins.push('LEFT JOIN meet ON meet.pid = p.id');
  }
  if (meetingBounds) {
    const clauses: string[] = [];
    const values: Param[] = [];
    if (meetingBounds.from) { clauses.push(`${meetingExpr} >= ?`); values.push(meetingBounds.from); }
    if (meetingBounds.to) { clauses.push(`${meetingExpr} < ?`); values.push(meetingBounds.to); }
    if (!clauses.length) clauses.push(`${meetingExpr} IS NOT NULL`);
    const body = clauses.join(' AND ');
    add(filters.nextMeeting?.includeNone ? `((${body}) OR ${meetingExpr} IS NULL)` : `(${body})`, ...values);
  }
  const ex = scoped(scope, 'ps2.source_key');
  const exchangeExpr = scope.kind === 'owner' ? 'p.last_exchange_at' : `(SELECT MAX(ps2.last_exchange_at) FROM person_sources ps2 WHERE ps2.person_id = p.id AND ${ex.sql})`;
  const exchangeParams: Param[] = scope.kind === 'owner' ? [] : ex.params;
  const exchangeBounds = dateBounds(filters.lastExchange, now);
  if (exchangeBounds) {
    const clauses: string[] = [];
    const values: Param[] = [];
    if (exchangeBounds.from) { clauses.push(`${exchangeExpr} >= ?`); values.push(...exchangeParams, exchangeBounds.from); }
    if (exchangeBounds.to) { clauses.push(`${exchangeExpr} < ?`); values.push(...exchangeParams, exchangeBounds.to); }
    if (!clauses.length) { clauses.push(`${exchangeExpr} IS NOT NULL`); values.push(...exchangeParams); }
    const body = clauses.join(' AND ');
    add(filters.lastExchange?.includeNone ? `((${body}) OR ${exchangeExpr} IS NULL)` : `(${body})`, ...values, ...(filters.lastExchange?.includeNone ? exchangeParams : []));
  }
  if (filters.sources?.length) {
    const permitted = filters.sources.filter((source) => scope.kind === 'owner' || scope.sources.has(source));
    for (const source of filters.sources) if (!permitted.includes(source)) unavailable.push(source);
    const list = inList('ps3.source_key', permitted);
    add(`EXISTS (SELECT 1 FROM person_sources ps3 WHERE ps3.person_id = p.id AND ${list.sql})`, ...list.params);
  }
  if (filters.listIds?.length) {
    const visible = new Set(listVisibleIds(ctx, scope, filters.listIds));
    for (const id of filters.listIds) if (!visible.has(id)) unavailable.push(`list:${id}`);
  }
  // Sort keys come from the same permitted rows as displayed values.
  let key: string;
  const keyParams: Param[] = [];
  switch (sort.key) {
    case 'last_exchange': key = `COALESCE(${exchangeExpr}, '')`; keyParams.push(...exchangeParams); break;
    case 'next_meeting': key = `COALESCE(${meetingExpr}, '9999')`; break;
    case 'added': key = 'p.created_at'; break;
    case 'next_action': {
      const c = scoped(scope, 'c.source_key'), t = scoped(scope, 't.collection'), o = opportunityFilter(scope, 'o');
      ctes.push(`due AS (SELECT pid, MIN(d) AS d FROM (
        SELECT c.person_id AS pid, c.due_date AS d FROM commitments c WHERE c.state = 'accepted' AND c.direction = 'i_owe' AND c.due_date IS NOT NULL AND c.person_id IS NOT NULL AND ${c.sql}
        UNION ALL SELECT t.subject_id, substr(t.due_at, 1, 10) FROM task_links t WHERE t.subject_kind = 'person' AND t.status IN ('pending','linked') AND t.due_at IS NOT NULL AND ${t.sql}
        UNION ALL SELECT op.person_id, o.next_action_date FROM opportunity_people op JOIN opportunities o ON o.id = op.opportunity_id WHERE o.archived_at IS NULL AND o.next_action_date IS NOT NULL AND ${o.sql}) GROUP BY pid)`);
      cteParams.push(...c.params, ...t.params, ...o.params);
      joins.push('LEFT JOIN due ON due.pid = p.id');
      key = "COALESCE(due.d, '9999')";
      break;
    }
    default:
      if (scope.kind === 'owner') key = 'p.sort_name';
      else {
        const n = scoped(scope, 'p.name_source'), m = scoped(scope, 'ps4.source_key');
        key = `CASE WHEN ${n.sql} THEN p.sort_name ELSE COALESCE((SELECT ps4.sort_name FROM person_sources ps4 WHERE ps4.person_id = p.id AND ps4.sort_name IS NOT NULL AND ${m.sql} ORDER BY ps4.name_rank ASC, ps4.name_at DESC LIMIT 1), 'unnamed contact') END`;
        keyParams.push(...n.params, ...m.params);
      }
  }
  return { where: where.join(' AND '), params, key, keyParams, unavailable, with: ctes.length ? `WITH ${ctes.join(', ')} ` : '', withParams: cteParams, joins: joins.join(' ') };
}

function listVisibleIds(ctx: Ctx, scope: AccessScope, ids: string[]) {
  const s = scoped(scope, 'collection'), list = inList('id', ids);
  return ctx.db.all<{ id: string }>(`SELECT id FROM lists WHERE ${list.sql} AND archived_at IS NULL AND ${s.sql}`, ...list.params, ...s.params).map((row) => row.id);
}

export function listPeople(ctx: Ctx, scope: AccessScope, input: ListPeopleInput) {
  const query = peopleQuery(ctx, scope, input.filters, input.sort);
  const descending = input.sort.direction === 'desc';
  const cursor = decodeCursor(cursorSchema, input.cursor);
  const keyed = `SELECT p.id AS id, ${query.key} AS k FROM persons p ${query.joins} WHERE ${query.where}`;
  const page = ctx.db.all<{ id: string; k: string | number }>(
    `${query.with}SELECT id, k FROM (${keyed}) ${cursor ? `WHERE (k, id) ${descending ? '<' : '>'} (?, ?)` : ''} ORDER BY k ${descending ? 'DESC' : 'ASC'}, id ${descending ? 'DESC' : 'ASC'} LIMIT ?`,
    ...query.withParams, ...query.keyParams, ...query.params, ...(cursor ? [cursor.k, cursor.id] : []), input.limit + 1,
  );
  const total = Number(ctx.db.get<{ count: number }>(`${query.with}SELECT COUNT(*) AS count FROM persons p ${query.joins} WHERE ${query.where}`, ...query.withParams, ...query.params)?.count ?? 0);
  const items = page.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: summarizePeople(ctx, scope, items.map((row) => row.id)),
    nextCursor: page.length > input.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null,
    total,
    unavailableFilters: query.unavailable,
  };
}

/** Directory rows for these people, projected for this caller. */
export function summarizePeople(ctx: Ctx, scope: AccessScope, ids: string[]): PersonSummary[] {
  if (!ids.length) return [];
  const labels = new Labels(ctx);
  const now = ctx.now(), nowIso = now.toISOString(), today = nowIso.slice(0, 10);
  const rows = new Map(ctx.db.all<PersonRow>(`SELECT * FROM persons WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const person = rows.get(id);
    if (!person) return [];
    const affiliation = bestAffiliation(ctx, scope, id, today);
    return [{
      id,
      name: personName(ctx, scope, person),
      revision: person.revision,
      pinned: person.pinned === 1,
      archived: !!person.archived_at,
      company: affiliation.company,
      role: affiliation.role ?? (canSee(scope, person.collection) ? person.headline : null),
      affiliationStatus: affiliation.status,
      lastExchangeAt: lastExchange(ctx, scope, person),
      nextAction: nextActionFor(ctx, scope, { kind: 'person', id }, today),
      nextMeeting: nextMeeting(ctx, scope, id, nowIso),
      primaryEmail: primaryEmail(ctx, scope, id),
      lists: memberLists(ctx, scope, id),
      sourceLabels: sourceLabels(ctx, scope, 'person_sources', 'person_id', id, labels),
      addedAt: person.created_at,
    } satisfies PersonSummary];
  });
}

const SEARCH_CANDIDATES = 2000;
/**
 * Search over permitted text. Rows are filtered by the caller's sources before
 * anything is ranked or counted, and the ranking uses only the projected name
 * this caller sees, so hidden records cannot influence order.
 */
export function searchPeople(ctx: Ctx, scope: AccessScope, input: { text: string; cursor?: string; limit: number }) {
  const fts = ftsQuery(input.text);
  if (!fts) return { items: [] as PersonSummary[], nextCursor: null as string | null, total: 0 };
  const offset = input.cursor ? decodeCursor(z.object({ offset: z.number().int().min(0).max(SEARCH_CANDIDATES) }).strict(), input.cursor)!.offset : 0;
  const s = scoped(scope, 'r.source_key');
  const base = `FROM search_fts f JOIN search_rows r ON r.id = f.rowid JOIN persons p ON p.id = r.record_id
    WHERE search_fts MATCH ? AND r.record_kind = 'person' AND ${s.sql} AND p.merged_into IS NULL AND p.archived_at IS NULL`;
  const candidates = ctx.db.all<PersonRow>(`SELECT DISTINCT p.* ${base} LIMIT ${SEARCH_CANDIDATES}`, fts, ...s.params);
  const total = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(DISTINCT r.record_id) AS count ${base}`, fts, ...s.params)?.count ?? 0);
  const words = (input.text.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? []).map(sortKey);
  const ranked = candidates.map((person) => {
    const name = personName(ctx, scope, person);
    const key = sortKey(name);
    const parts = key.split(/[^\p{L}\p{N}]+/u);
    const score = words.length && key.startsWith(words.join(' ')) ? 0 : words.every((word) => parts.some((part) => part.startsWith(word))) ? 1 : 2;
    return { id: person.id, score, key };
  }).sort((a, b) => a.score - b.score || a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  const page = ranked.slice(offset, offset + input.limit);
  return {
    items: summarizePeople(ctx, scope, page.map((row) => row.id)),
    nextCursor: offset + input.limit < ranked.length ? encodeCursor({ offset: offset + input.limit }) : null,
    total,
  };
}
