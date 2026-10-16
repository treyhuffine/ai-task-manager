import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import { iso, newId, type Ctx } from './context.js';
import { refreshOrganization } from './organizations.js';
import { refreshPerson } from './people.js';
import { organizationVisible, personVisible } from './projection.js';
import { assertWritable, canSee, sourceFilter, touch, writableCollection } from './scope.js';
import { cleanName, sortKey } from './text.js';
import type { ListRecord } from '../schemas.js';

type ListRow = { id: string; revision: number; name: string; record_kind: 'person' | 'organization'; collection: string; archived_at: string | null };

function memberCount(ctx: Ctx, scope: AccessScope, list: ListRow): number {
  if (scope.kind === 'owner') return Number(ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM list_members m WHERE m.list_id = ?', list.id)?.count ?? 0);
  const table = list.record_kind === 'person' ? 'person_sources' : 'organization_sources';
  const column = list.record_kind === 'person' ? 'person_id' : 'organization_id';
  const filter = sourceFilter(scope, 's.source_key');
  return Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM list_members m WHERE m.list_id = ? AND EXISTS (SELECT 1 FROM ${table} s WHERE s.${column} = m.member_id AND ${filter.sql})`, list.id, ...filter.params)?.count ?? 0);
}
export function projectList(ctx: Ctx, scope: AccessScope, row: ListRow): ListRecord {
  return { id: row.id, revision: row.revision, name: row.name, recordKind: row.record_kind, collection: row.collection as ListRecord['collection'], memberCount: memberCount(ctx, scope, row), archived: !!row.archived_at };
}
export function getListRow(ctx: Ctx, scope: AccessScope, id: string): ListRow | null {
  const row = ctx.db.get<ListRow>('SELECT * FROM lists WHERE id = ?', id);
  return row && canSee(scope, row.collection) ? row : null;
}

const cursorSchema = z.object({ k: z.string(), id: z.string() }).strict();
export function listLists(ctx: Ctx, scope: AccessScope, input: { recordKind?: 'person' | 'organization'; includeArchived?: boolean; cursor?: string; limit: number }) {
  const filter = sourceFilter(scope, 'collection');
  const cursor = decodeCursor(cursorSchema, input.cursor);
  const rows = ctx.db.all<ListRow & { k: string }>(
    `SELECT *, lower(name) AS k FROM lists WHERE ${filter.sql} ${input.recordKind ? 'AND record_kind = ?' : ''} ${input.includeArchived ? '' : 'AND archived_at IS NULL'} ${cursor ? 'AND (lower(name), id) > (?, ?)' : ''} ORDER BY k, id LIMIT ?`,
    ...filter.params, ...(input.recordKind ? [input.recordKind] : []), ...(cursor ? [cursor.k, cursor.id] : []), input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return { items: items.map((row) => projectList(ctx, scope, row)), nextCursor: rows.length > input.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null };
}

/** A list has one record kind and its own collection. It is not a permission container. */
export function saveList(ctx: Ctx, scope: AccessScope, input: { id?: string; expectedRevision?: number; name?: string; recordKind?: 'person' | 'organization'; collection?: string; archived?: boolean }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const time = iso(ctx);
  if (!input.id) {
    const name = cleanName(input.name, 120);
    if (!name) throw new AppError('invalid_input', 'Name the list');
    if (!input.recordKind) throw new AppError('invalid_input', 'Choose whether the list holds people or companies');
    const collection = writableCollection(ctx, scope, input.collection);
    const id = newId();
    ctx.db.run('INSERT INTO lists (id, created_at, updated_at, revision, name, record_kind, collection, archived_at) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)', id, time, time, name, input.recordKind, collection);
    touch(ctx, collection);
    return { status: 'saved', id };
  }
  const row = getListRow(ctx, scope, input.id);
  if (!row) throw new AppError('not_found', 'This list is no longer available');
  assertWritable(scope, row.collection);
  if (input.recordKind && input.recordKind !== row.record_kind) throw new AppError('invalid_input', 'A list keeps its record kind. Create a new list instead');
  if (input.expectedRevision === undefined || row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This list changed since you opened it. Compare and try again' };
  const name = input.name !== undefined ? cleanName(input.name, 120) : row.name;
  if (!name) throw new AppError('invalid_input', 'Name the list');
  const archived = input.archived === undefined ? row.archived_at : input.archived ? row.archived_at ?? time : null;
  const collection = input.collection !== undefined && input.collection !== row.collection ? writableCollection(ctx, scope, input.collection) : row.collection;
  ctx.db.run('UPDATE lists SET name = ?, archived_at = ?, collection = ?, revision = revision + 1, updated_at = ? WHERE id = ?', name, archived, collection, time, row.id);
  if (archived !== row.archived_at || collection !== row.collection) refreshMembers(ctx, row);
  touch(ctx, collection, row.collection);
  return { status: 'saved', id: row.id };
}
function refreshMembers(ctx: Ctx, row: ListRow) {
  for (const member of ctx.db.all<{ member_id: string }>('SELECT member_id FROM list_members WHERE list_id = ? LIMIT 5000', row.id))
    row.record_kind === 'person' ? refreshPerson(ctx, member.member_id) : refreshOrganization(ctx, member.member_id);
}

/**
 * Add, remove or reorder members of one list. Every member must be a visible
 * record of the list's kind. Membership never copies records or shares them.
 */
export function updateListMembers(ctx: Ctx, scope: AccessScope, actor: string, input: { listId: string; expectedRevision: number; add?: string[]; remove?: string[]; order?: string[] }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const row = getListRow(ctx, scope, input.listId);
  if (!row || row.archived_at) throw new AppError('not_found', 'This list is no longer available');
  assertWritable(scope, row.collection);
  if (row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This list changed since you opened it. Compare and try again' };
  const visible = (id: string) => (row.record_kind === 'person' ? personVisible(ctx, scope, id) : organizationVisible(ctx, scope, id));
  const time = iso(ctx);
  const touched = new Set<string>();
  let position = Number(ctx.db.get<{ position: number | null }>('SELECT MAX(position) AS position FROM list_members WHERE list_id = ?', row.id)?.position ?? 0);
  for (const id of input.add ?? []) {
    if (!visible(id)) throw new AppError('not_found', `A ${row.record_kind === 'person' ? 'person' : 'company'} in this change is no longer available`);
    const result = ctx.db.run('INSERT INTO list_members (id, created_at, updated_at, list_id, member_id, position, added_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(list_id, member_id) DO NOTHING', `${row.id}:${id}`, time, time, row.id, id, ++position, actor);
    if (Number(result.changes)) touched.add(id);
  }
  for (const id of input.remove ?? []) {
    if (!visible(id)) continue;
    if (Number(ctx.db.run('DELETE FROM list_members WHERE list_id = ? AND member_id = ?', row.id, id).changes)) touched.add(id);
  }
  if (input.order?.length) {
    const current = new Set(ctx.db.all<{ member_id: string }>('SELECT member_id FROM list_members WHERE list_id = ?', row.id).map((member) => member.member_id));
    let index = 0;
    for (const id of input.order) if (current.has(id) && visible(id)) ctx.db.run('UPDATE list_members SET position = ?, updated_at = ? WHERE list_id = ? AND member_id = ?', ++index, time, row.id, id);
  }
  ctx.db.run('UPDATE lists SET revision = revision + 1, updated_at = ? WHERE id = ?', time, row.id);
  for (const id of touched) row.record_kind === 'person' ? refreshPerson(ctx, id) : refreshOrganization(ctx, id);
  touch(ctx, row.collection);
  return { status: 'saved', id: row.id };
}

/** Members in list order, visible to this caller only. */
export function listMemberIds(ctx: Ctx, scope: AccessScope, listId: string, limit = 100): string[] {
  const row = getListRow(ctx, scope, listId);
  if (!row) return [];
  const table = row.record_kind === 'person' ? 'person_sources' : 'organization_sources';
  const column = row.record_kind === 'person' ? 'person_id' : 'organization_id';
  const filter = sourceFilter(scope, 's.source_key');
  return ctx.db.all<{ member_id: string }>(`SELECT m.member_id FROM list_members m WHERE m.list_id = ? AND EXISTS (SELECT 1 FROM ${table} s WHERE s.${column} = m.member_id AND ${filter.sql}) ORDER BY m.position LIMIT ?`, row.id, ...filter.params, limit).map((member) => member.member_id);
}
export { sortKey };
