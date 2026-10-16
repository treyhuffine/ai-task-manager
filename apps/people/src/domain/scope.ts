import { AppError } from '@ri/app-kit/contract';
import { scopeFingerprint, sha256, type AccessScope } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { iso, type Ctx, type Param } from './context.js';

export const MANUAL = 'manual';
export const isAccountSource = (key: string) => key.startsWith('account:');
export const isCollectionSource = (key: string) => key === MANUAL || key.startsWith('collection:');
export const isImportSource = (key: string) => key.startsWith('import:');
export const accountOf = (key: string) => (isAccountSource(key) ? key.slice('account:'.length) : null);

export function resolveScope(ctx: Ctx, invocation: Pick<AppInvocation, 'principal' | 'access'>, operation: 'read' | 'write'): AccessScope {
  return ctx.scopes.resolve(invocation, operation);
}

export const isOwner = (scope: AccessScope) => scope.kind === 'owner';
export function canSee(scope: AccessScope, source: string | null | undefined) {
  return scope.kind === 'owner' || (!!source && scope.sources.has(source));
}

/**
 * A SQL predicate restricting `column` to the caller's sources. The owner sees
 * everything. A scope with no sources sees nothing, never everything.
 */
export function sourceFilter(scope: AccessScope, column: string): { sql: string; params: Param[] } {
  if (scope.kind === 'owner') return { sql: '1', params: [] };
  const sources = [...scope.sources];
  if (!sources.length) return { sql: '0', params: [] };
  return { sql: `${column} IN (${sources.map(() => '?').join(',')})`, params: sources };
}

/** Where a caller's new user-authored record goes. Chats write only to a collection they were given. */
export function writableCollection(ctx: Ctx, scope: AccessScope, requested?: string | null): string {
  const collection = requested ?? defaultCollection(scope);
  if (!isCollectionSource(collection)) throw new AppError('invalid_input', 'Choose one of your collections for this record');
  const exists = ctx.db.get('SELECT 1 AS ok FROM collections WHERE source_key = ? AND archived_at IS NULL', collection);
  if (!exists) throw new AppError('not_found', 'That collection is no longer available');
  if (scope.kind !== 'owner' && (!scope.sources.has(collection) || !scope.operations.has('write')))
    throw new AppError('forbidden', 'This chat may not add records to that collection');
  return collection;
}
function defaultCollection(scope: AccessScope) {
  if (scope.kind === 'owner') return MANUAL;
  if (scope.sources.has(MANUAL)) return MANUAL;
  const first = [...scope.sources].find(isCollectionSource);
  if (!first) throw new AppError('forbidden', 'This chat was not given a collection it may write to');
  return first;
}
/** A write to an existing user-authored record requires its collection. */
export function assertWritable(scope: AccessScope, collection: string) {
  if (scope.kind === 'owner') return;
  if (!scope.operations.has('write') || !scope.sources.has(collection))
    throw new AppError('forbidden', 'This chat may not change that record');
}

// ─── Data revisions ───────────────────────────────────────────────────────────

/** Bump the revision of every touched source plus the global counter, inside the caller's transaction. */
export function touch(ctx: Ctx, ...sources: (string | null | undefined)[]) {
  const time = iso(ctx);
  for (const key of new Set(['*', ...sources.filter((value): value is string => !!value)]))
    ctx.db.run(
      'INSERT INTO app_revisions (id, created_at, updated_at, revision) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at',
      key, time, time,
    );
}
/**
 * A revision string that changes when anything this caller may see changes.
 * A narrower caller's string depends only on its own sources, so hidden
 * activity cannot be inferred from it.
 */
export function dataRevision(ctx: Ctx, scope: AccessScope): string {
  if (scope.kind === 'owner') {
    const row = ctx.db.get<{ revision: number }>("SELECT revision FROM app_revisions WHERE id = '*'");
    return `o${row?.revision ?? 0}`;
  }
  const filter = sourceFilter(scope, 'id');
  const rows = ctx.db.all<{ id: string; revision: number }>(`SELECT id, revision FROM app_revisions WHERE ${filter.sql} ORDER BY id`, ...filter.params);
  return `s${sha256(JSON.stringify([scopeFingerprint(scope), rows.map((row) => [row.id, row.revision])])).slice(0, 24)}`;
}
