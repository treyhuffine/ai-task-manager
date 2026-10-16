import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import { iso, newId, type Ctx } from './context.js';
import { organizationVisible } from './projection.js';
import { assertWritable, canSee, sourceFilter, touch, writableCollection } from './scope.js';
import { cleanName, json } from './text.js';
import {
  OPPORTUNITY_COLUMNS, OPPORTUNITY_SORTS, ORGANIZATION_COLUMNS, ORGANIZATION_SORTS, PEOPLE_COLUMNS, PEOPLE_SORTS,
  opportunityFiltersSchema, organizationFiltersSchema, peopleFiltersSchema, sortSchema,
  type SavedView, type Sort,
} from '../schemas.js';

type ViewRow = { id: string; revision: number; label: string; record_kind: SavedView['recordKind']; filters: string; sort: string; columns: string; list_id: string | null; pipeline_id: string | null; navigation: 'picker' | 'pinned'; collection: string; archived_at: string | null };

export const DEFAULT_SORT: Record<SavedView['recordKind'], Sort> = {
  person: { key: 'name', direction: 'asc' },
  organization: { key: 'name', direction: 'asc' },
  opportunity: { key: 'stage', direction: 'asc' },
};
export const DEFAULT_COLUMNS: Record<SavedView['recordKind'], SavedView['columns']> = {
  person: ['company', 'last_exchange', 'next_action'],
  organization: ['people', 'last_exchange', 'next_action'],
  opportunity: ['organization', 'stage', 'next_action'],
};

/**
 * A saved view stores only the allowlisted filter vocabulary, a sort and
 * columns. It is validated strictly so no expression, SQL or code can be
 * stored, and it is evaluated against the reader's scope every time.
 */
export function validateView(recordKind: SavedView['recordKind'], filters: unknown, sort: unknown, columns: unknown) {
  const filterSchema = recordKind === 'person' ? peopleFiltersSchema : recordKind === 'organization' ? organizationFiltersSchema : opportunityFiltersSchema;
  const parsedFilters = filterSchema.safeParse(filters ?? {});
  if (!parsedFilters.success) throw new AppError('invalid_input', 'A saved view can use only the listed filters');
  const parsedSort = sortSchema.safeParse(sort ?? DEFAULT_SORT[recordKind]);
  const sorts: readonly string[] = recordKind === 'person' ? PEOPLE_SORTS : recordKind === 'organization' ? ORGANIZATION_SORTS : OPPORTUNITY_SORTS;
  if (!parsedSort.success || !sorts.includes(parsedSort.data.key)) throw new AppError('invalid_input', 'Choose a supported sort for this view');
  const allowed: readonly string[] = recordKind === 'person' ? PEOPLE_COLUMNS : recordKind === 'organization' ? ORGANIZATION_COLUMNS : OPPORTUNITY_COLUMNS;
  const list = z.array(z.string()).max(10).safeParse(columns ?? DEFAULT_COLUMNS[recordKind]);
  if (!list.success || list.data.some((column) => !allowed.includes(column))) throw new AppError('invalid_input', 'Choose supported columns for this view');
  return { filters: parsedFilters.data, sort: parsedSort.data, columns: [...new Set(list.data)] as SavedView['columns'] };
}

/** Filters this caller can no longer evaluate: they narrow the result and are named, never dropped. */
export function unavailableFilters(ctx: Ctx, scope: AccessScope, recordKind: SavedView['recordKind'], filters: Record<string, unknown>, listId: string | null): string[] {
  const missing: string[] = [];
  for (const source of (filters.sources as string[] | undefined) ?? []) if (!canSee(scope, source)) missing.push(`Source no longer permitted`);
  for (const id of (filters.listIds as string[] | undefined) ?? []) {
    const list = ctx.db.get<{ collection: string; archived_at: string | null }>('SELECT collection, archived_at FROM lists WHERE id = ?', id);
    if (!list || list.archived_at || !canSee(scope, list.collection)) missing.push('List unavailable');
  }
  for (const id of (filters.organizationIds as string[] | undefined) ?? []) if (!organizationVisible(ctx, scope, id)) missing.push('Company unavailable');
  if (listId) {
    const list = ctx.db.get<{ collection: string; archived_at: string | null }>('SELECT collection, archived_at FROM lists WHERE id = ?', listId);
    if (!list || list.archived_at || !canSee(scope, list.collection)) missing.push('List unavailable');
  }
  void recordKind;
  return [...new Set(missing)].slice(0, 20);
}

export function projectView(ctx: Ctx, scope: AccessScope, row: ViewRow): SavedView {
  const filters = json<Record<string, unknown>>(row.filters, {});
  return {
    id: row.id, revision: row.revision, label: row.label, recordKind: row.record_kind,
    filters: filters as SavedView['filters'], sort: json<Sort>(row.sort, DEFAULT_SORT[row.record_kind]), columns: json<SavedView['columns']>(row.columns, DEFAULT_COLUMNS[row.record_kind]),
    listId: row.list_id, pipelineId: row.pipeline_id, navigation: row.navigation, collection: row.collection as SavedView['collection'],
    unavailableFilters: unavailableFilters(ctx, scope, row.record_kind, filters, row.list_id), archived: !!row.archived_at,
  };
}
export function getView(ctx: Ctx, scope: AccessScope, id: string): SavedView | null {
  const row = ctx.db.get<ViewRow>('SELECT * FROM saved_views WHERE id = ?', id);
  return row && canSee(scope, row.collection) ? projectView(ctx, scope, row) : null;
}

const cursorSchema = z.object({ k: z.string(), id: z.string() }).strict();
export function listViews(ctx: Ctx, scope: AccessScope, input: { recordKind?: SavedView['recordKind']; text?: string; includeArchived?: boolean; cursor?: string; limit: number }) {
  const filter = sourceFilter(scope, 'collection');
  const cursor = decodeCursor(cursorSchema, input.cursor);
  const text = input.text?.trim().toLowerCase();
  const rows = ctx.db.all<ViewRow & { k: string }>(
    `SELECT *, lower(label) AS k FROM saved_views WHERE ${filter.sql} ${input.recordKind ? 'AND record_kind = ?' : ''} ${input.includeArchived ? '' : 'AND archived_at IS NULL'} ${text ? "AND instr(lower(label), ?) > 0" : ''} ${cursor ? 'AND (lower(label), id) > (?, ?)' : ''} ORDER BY k, id LIMIT ?`,
    ...filter.params, ...(input.recordKind ? [input.recordKind] : []), ...(text ? [text] : []), ...(cursor ? [cursor.k, cursor.id] : []), input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return { items: items.map((row) => projectView(ctx, scope, row)), nextCursor: rows.length > input.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null };
}

export interface SaveViewInput { id?: string; expectedRevision?: number; label?: string; recordKind?: SavedView['recordKind']; filters?: unknown; sort?: unknown; columns?: unknown; listId?: string | null; pipelineId?: string | null; collection?: string; archived?: boolean }
export function saveView(ctx: Ctx, scope: AccessScope, input: SaveViewInput): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const time = iso(ctx);
  const checkRefs = (listId: string | null | undefined, pipelineId: string | null | undefined) => {
    if (listId) { const list = ctx.db.get<{ collection: string }>('SELECT collection FROM lists WHERE id = ? AND archived_at IS NULL', listId); if (!list || !canSee(scope, list.collection)) throw new AppError('not_found', 'That list is no longer available'); }
    if (pipelineId) { const pipeline = ctx.db.get<{ collection: string }>('SELECT collection FROM pipelines WHERE id = ? AND archived_at IS NULL', pipelineId); if (!pipeline || !canSee(scope, pipeline.collection)) throw new AppError('not_found', 'That pipeline is no longer available'); }
  };
  if (!input.id) {
    const label = cleanName(input.label, 120);
    if (!label) throw new AppError('invalid_input', 'Name the view');
    if (!input.recordKind) throw new AppError('invalid_input', 'Choose what the view shows');
    const valid = validateView(input.recordKind, input.filters, input.sort, input.columns);
    checkRefs(input.listId, input.pipelineId);
    const collection = writableCollection(ctx, scope, input.collection);
    const id = newId();
    ctx.db.run(
      'INSERT INTO saved_views (id, created_at, updated_at, revision, label, record_kind, filters, sort, columns, list_id, pipeline_id, navigation, collection, archived_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
      id, time, time, label, input.recordKind, JSON.stringify(valid.filters), JSON.stringify(valid.sort), JSON.stringify(valid.columns), input.listId ?? null, input.pipelineId ?? null, 'picker', collection,
    );
    touch(ctx, collection);
    return { status: 'saved', id };
  }
  const row = ctx.db.get<ViewRow>('SELECT * FROM saved_views WHERE id = ?', input.id);
  if (!row || !canSee(scope, row.collection)) throw new AppError('not_found', 'This view is no longer available');
  assertWritable(scope, row.collection);
  if (input.recordKind && input.recordKind !== row.record_kind) throw new AppError('invalid_input', 'A view keeps its record kind');
  if (input.expectedRevision === undefined || row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This view changed since you opened it. Compare and try again' };
  const valid = validateView(row.record_kind, input.filters ?? json(row.filters, {}), input.sort ?? json(row.sort, null), input.columns ?? json(row.columns, null));
  const label = input.label !== undefined ? cleanName(input.label, 120) : row.label;
  if (!label) throw new AppError('invalid_input', 'Name the view');
  checkRefs(input.listId, input.pipelineId);
  const archived = input.archived === undefined ? row.archived_at : input.archived ? row.archived_at ?? time : null;
  ctx.db.run('UPDATE saved_views SET label = ?, filters = ?, sort = ?, columns = ?, list_id = ?, pipeline_id = ?, archived_at = ?, navigation = CASE WHEN ? IS NOT NULL THEN \'picker\' ELSE navigation END, revision = revision + 1, updated_at = ? WHERE id = ?',
    label, JSON.stringify(valid.filters), JSON.stringify(valid.sort), JSON.stringify(valid.columns),
    input.listId !== undefined ? input.listId : row.list_id, input.pipelineId !== undefined ? input.pipelineId : row.pipeline_id, archived, archived, time, row.id);
  touch(ctx, row.collection);
  return { status: 'saved', id: row.id };
}

// ─── Navigation (user only) ──────────────────────────────────────────────────

export const navigationSchema = z.object({
  companies: z.enum(['shown', 'hidden']),
  pipelines: z.enum(['shown', 'hidden']),
  landing: z.string().regex(/^(today|people|follow-ups|companies|pipelines|sources|view:[A-Za-z0-9-]{1,64})$/),
  companiesOffered: z.boolean(),
}).strict();
export type Navigation = z.infer<typeof navigationSchema>;
export const DEFAULT_NAVIGATION: Navigation = { companies: 'hidden', pipelines: 'hidden', landing: 'today', companiesOffered: false };
export function getNavigation(ctx: Ctx): Navigation {
  return ctx.settings.get('navigation', navigationSchema, DEFAULT_NAVIGATION);
}
/** Add view and Hide view change navigation only. Records, grants, sync and task links are untouched. */
export function saveNavigation(ctx: Ctx, input: Partial<Navigation> & { pinViewIds?: string[]; unpinViewIds?: string[] }) {
  const current = getNavigation(ctx);
  const next = navigationSchema.parse({ ...current, ...Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && key in current)) });
  if (next.landing.startsWith('view:') && !ctx.db.get('SELECT 1 AS ok FROM saved_views WHERE id = ? AND archived_at IS NULL', next.landing.slice(5))) throw new AppError('not_found', 'That view is no longer available');
  ctx.settings.set('navigation', next);
  const time = iso(ctx);
  for (const id of input.pinViewIds ?? []) ctx.db.run("UPDATE saved_views SET navigation = 'pinned', updated_at = ? WHERE id = ? AND archived_at IS NULL", time, id);
  for (const id of input.unpinViewIds ?? []) ctx.db.run("UPDATE saved_views SET navigation = 'picker', updated_at = ? WHERE id = ?", time, id);
  touch(ctx);
  return next;
}
export function pinnedViews(ctx: Ctx, scope: AccessScope) {
  const filter = sourceFilter(scope, 'collection');
  return ctx.db.all<{ id: string; label: string; record_kind: string }>(`SELECT id, label, record_kind FROM saved_views WHERE navigation = 'pinned' AND archived_at IS NULL AND ${filter.sql} ORDER BY lower(label) LIMIT 8`, ...filter.params)
    .map((row) => ({ id: row.id, label: row.label, recordKind: row.record_kind as SavedView['recordKind'] }));
}
