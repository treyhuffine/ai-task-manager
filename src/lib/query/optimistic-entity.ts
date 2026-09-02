/**
 * Optimistic cache surgery for the task / note / area entity caches.
 *
 * Every everyday mutation on these entities (complete, change area, move dates,
 * flip status, rename, edit body) used to do nothing to the cache until the
 * server round-trip finished, then `invalidateQueries` and wait for a *second*
 * round-trip (the refetch) before the UI moved. Over a proxy that is two serial
 * RTTs of dead air per click, which is the lag the app felt.
 *
 * These helpers let a mutation patch the cache in `onMutate` so the UI reflects
 * the change instantly, roll back in `onError`, and reconcile in `onSettled`.
 * They are deliberately field-agnostic: the same task/note update hook carries
 * `title`, `energy`, `areaId`, `dueAt`, `body`, `sortKey`, ... so the patch is
 * always a partial merge, never a record replace.
 *
 * Two shapes live under each root key:
 *   - single-entity cache `[root, id]`  → the full record (WITH `body`)
 *   - list caches `[root, filter]`       → an array of list DTOs. Lists OMIT
 *     `body` and carry `bodyExcerpt` + `bodyLen` instead (see
 *     `@/lib/api/dto/entity-list`), so a body edit is projected to the excerpt
 *     shape before it is written into a list.
 *
 * Body safety: the rich editor (`src/components/editor/rich-editor.tsx`) is the
 * sole source of truth for its document while focused — its content-sync effect
 * bails on `editor.isFocused` and on `content === prevContentRef.current`. We
 * only ever write `body` back as the exact markdown the editor just emitted
 * (equal to `prevContentRef.current`), and the server stores `body` verbatim
 * (see `updateTask`/`updateNote` in `queries.ts`), so an optimistic body patch
 * or a settle refetch can never reflow the open editor. Do not change this to
 * write a server-normalized body into the live cache.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { LIST_BODY_EXCERPT_CHARS } from '@/lib/api/dto/entity-list';

export type EntityRoot = 'tasks' | 'notes' | 'areas';

/** Every cache entry we touched, captured before mutating, for rollback. */
export type OptimisticSnapshot = Array<[QueryKey, unknown]>;

export type EntityPatch = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasId(value: unknown, id: string): value is Record<string, unknown> {
  return isRecord(value) && value.id === id;
}

/**
 * Lists carry no `body`. When a patch touches `body`, translate it into the
 * `bodyExcerpt` / `bodyLen` fields the list DTO actually renders, and drop the
 * raw `body` so we never leave a stray field on a list row.
 */
export function projectPatchToList(patch: EntityPatch): EntityPatch {
  if (!('body' in patch)) return patch;
  const { body, ...rest } = patch;
  const full = (body as string | null) ?? '';
  return {
    ...rest,
    bodyExcerpt: full ? full.slice(0, LIST_BODY_EXCERPT_CHARS) : null,
    bodyLen: full.length,
  };
}

/**
 * Merge `patch` into the row matching `id` across every cache under `[root]` —
 * the single-entity record and each filtered list. Cancels in-flight refetches
 * first so a late-landing GET can't clobber the optimistic write, and returns a
 * snapshot for {@link rollbackOptimistic}.
 */
export async function optimisticPatch(
  qc: QueryClient,
  root: EntityRoot,
  id: string,
  patch: EntityPatch,
): Promise<OptimisticSnapshot> {
  await qc.cancelQueries({ queryKey: [root] });
  const snapshot = qc.getQueriesData({ queryKey: [root] }) as OptimisticSnapshot;

  const listPatch = projectPatchToList(patch);

  qc.setQueriesData<unknown>({ queryKey: [root] }, (data: unknown) => {
    if (data == null) return data;
    // Single-entity cache: the record itself, full shape (with body).
    if (hasId(data, id)) return { ...data, ...patch };
    // List cache: array of DTOs (no body → project the patch).
    if (Array.isArray(data)) {
      return data.map((row) => (hasId(row, id) ? { ...row, ...listPatch } : row));
    }
    return data;
  });

  return snapshot;
}

/**
 * Remove the row matching `id` from every list cache under `[root]` and drop
 * its single-entity cache. Returns a snapshot for rollback.
 */
export async function optimisticRemove(
  qc: QueryClient,
  root: EntityRoot,
  id: string,
): Promise<OptimisticSnapshot> {
  await qc.cancelQueries({ queryKey: [root] });
  const snapshot = qc.getQueriesData({ queryKey: [root] }) as OptimisticSnapshot;

  qc.setQueriesData<unknown>({ queryKey: [root] }, (data: unknown) => {
    if (Array.isArray(data)) return data.filter((row) => !hasId(row, id));
    return data;
  });
  qc.removeQueries({ queryKey: [root, id] });

  return snapshot;
}

/**
 * Does a task with `status` belong in a list whose query-key filter carried
 * `filterStatus`? A missing filter (or the `all` sentinel) matches everything.
 * The legacy `active` alias expands to the derived current union todo|in_progress.
 */
function statusMatchesFilter(status: string, filterStatus: unknown): boolean {
  if (filterStatus == null) return true;
  const raw = Array.isArray(filterStatus) ? filterStatus : [filterStatus];
  if (raw.includes('all')) return true;
  const expanded = new Set<string>();
  for (const s of raw) {
    if (s === 'active') {
      expanded.add('todo');
      expanded.add('in_progress');
    } else if (typeof s === 'string') {
      expanded.add(s);
    }
  }
  return expanded.has(status);
}

/**
 * Optimistically apply a lifecycle status change (Start, Archive, Reopen, ...).
 * Patches `status` (+ any `extraPatch`, e.g. clearing `completedAt` on reopen)
 * on the single-entity record, and for each filtered list decides membership
 * from the list's OWN query-key filter: if the destination status still matches,
 * the row is patched in place; otherwise it is removed so it disappears from the
 * lane it left immediately. Placing the row into a newly-matching list it was
 * not already in is left to {@link settleEntity}'s refetch. Returns a snapshot
 * for {@link rollbackOptimistic}.
 */
export async function optimisticTransition(
  qc: QueryClient,
  id: string,
  toStatus: string,
  extraPatch: EntityPatch = {},
): Promise<OptimisticSnapshot> {
  await qc.cancelQueries({ queryKey: ['tasks'] });
  const snapshot = qc.getQueriesData({ queryKey: ['tasks'] }) as OptimisticSnapshot;
  const patch = { status: toStatus, ...extraPatch };

  // The row being moved, from wherever it currently lives, so it can be INSERTED
  // into the lane it now belongs to (not just dropped from the old one) — which
  // is what stops a Kanban card from vanishing between drop and refetch.
  let movingRow: Record<string, unknown> | undefined;
  for (const [, data] of qc.getQueriesData({ queryKey: ['tasks'] })) {
    if (Array.isArray(data)) {
      const hit = data.find((r) => hasId(r, id));
      if (hit) { movingRow = { ...(hit as Record<string, unknown>) }; break; }
    } else if (data && hasId(data, id)) {
      movingRow = { ...(data as Record<string, unknown>) };
    }
  }

  for (const [key, data] of qc.getQueriesData({ queryKey: ['tasks'] })) {
    if (data == null) continue;
    if (hasId(data, id)) {
      qc.setQueryData(key, { ...data, ...patch });
      continue;
    }
    if (Array.isArray(data)) {
      const filter = (key as unknown[])[1] as { status?: unknown } | undefined;
      const stays = statusMatchesFilter(toStatus, filter?.status);
      const had = data.some((row) => hasId(row, id));
      const next = data.reduce<unknown[]>((acc, row) => {
        if (hasId(row, id)) {
          if (stays) acc.push({ ...row, ...patch });
          // else: drop it from this lane
        } else {
          acc.push(row);
        }
        return acc;
      }, []);
      // Newly belongs here but wasn't present: place it now. Restricted to pure
      // status lanes (e.g. the Kanban's per-status queries) so we never wrongly
      // insert into an area/parent/search-filtered list the row may not match.
      if (stays && !had && movingRow && isPureStatusLane(filter)) {
        next.push({ ...movingRow, ...patch });
      }
      qc.setQueryData(key, next);
    }
  }
  return snapshot;
}

/** A list filter that constrains by status (and ordering) only — safe to place
 * a row into purely by its new status. Anything narrower (area, parent, search)
 * is skipped, since status alone cannot prove membership. */
function isPureStatusLane(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return false;
  const f = filter as Record<string, unknown>;
  const constraining = ['areaId', 'parentId', 'workspaceId', 'q', 'search', 'taskId'];
  return constraining.every((k) => f[k] == null);
}

/** Restore every cache entry captured in a snapshot (rollback on error). */
export function rollbackOptimistic(qc: QueryClient, snapshot: OptimisticSnapshot | undefined) {
  if (!snapshot) return;
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

/**
 * Reconcile the entity against the server after a mutation settles. This is the
 * convergence net: it refetches server-derived fields the optimistic patch
 * cannot predict (attachments re-derived from body markers, `updatedAt`, list
 * excerpts, a recurring task's next occurrence) and picks up any write from
 * another actor. It is fire-and-forget — the UI already shows the optimistic
 * state, so this never gates responsiveness, and the editor's focus guard means
 * a body refetch cannot disturb an open document.
 */
export function settleEntity(qc: QueryClient, root: EntityRoot) {
  qc.invalidateQueries({ queryKey: [root] });
  // Backlinks point at *targets*, so editing/renaming this entity changes the
  // backlink views of the entities it links to. And a rename changes this
  // entity's title everywhere it is referenced as a chip. Invalidate both
  // link-derived caches broadly in the target direction — each only refetches
  // where actually mounted. See docs/entity-links-spec.md §9.3.
  qc.invalidateQueries({ queryKey: ['entity-backlinks'] });
  qc.invalidateQueries({ queryKey: ['entity-title'] });
}
