/**
 * A task's rank: its numbered spot in the Priority Order of committed work
 * (Todo and In progress, across every Area), 1 being the top. The order itself
 * lives in `sortKey` (fractional keys, unranked tasks last, newest first), so a
 * rank is not stored anywhere. Setting one gives the task a key between the
 * tasks that will sit above and below it.
 *
 * Pure, so the server (`rankTask` in queries.ts) and the client's optimistic
 * cache place a task the same way from the same list.
 */
import { generateNKeysBetween } from 'fractional-indexing';

/** The list a rank counts against. `active` is the query layer's alias for
 * todo | in_progress. One shared object, so the slideout's readout and the
 * optimistic write address the same cache entry. */
export const PRIORITY_RANK_FILTER = { status: 'active', orderBy: 'sortKey' } as const;

/** The statuses a rank applies to. */
export const RANKED_STATUSES: readonly string[] = ['todo', 'in_progress'];

export interface RankEntry {
  id: string;
  sortKey: string | null;
}

export interface RankPlacement<T extends RankEntry> {
  /** The list in its new order, with every written key applied. */
  list: T[];
  /** Where the task landed: the request, held to 1..total. */
  rank: number;
  total: number;
  /** Keys to persist: the task's own, plus any task above it that needed a key
   * first (an unranked task, or one tied with its neighbor at the slot). */
  writes: { id: string; sortKey: string }[];
}

/** Hold a requested rank to the list: below 1 is the top, past the end is last. */
export function clampRank(rank: number, total: number): number {
  return Math.min(Math.max(Math.trunc(rank), 1), Math.max(total, 1));
}

// fractional-indexing checks a key's shape but not every digit, so a malformed
// legacy bound could yield a malformed key. Such a list is re-keyed instead.
const KEY_PATTERN = /^[A-Za-z][0-9A-Za-z]+$/;

/**
 * Place `taskId` at `rank` in a Priority Order list, given in its canonical
 * order (keyed tasks ascending, then unranked ones). Only the task moves:
 * everything else keeps its relative order. Returns null when the task isn't
 * in the list.
 */
export function placeAtRank<T extends RankEntry>(
  list: readonly T[],
  taskId: string,
  requested: number,
): RankPlacement<T> | null {
  const from = list.findIndex((t) => t.id === taskId);
  if (from === -1) return null;
  const total = list.length;
  const rank = clampRank(requested, total);
  const slot = rank - 1;
  const moved = list[from];

  // Already there and ranked: nothing to write, so a retry is a no-op.
  if (from === slot && moved.sortKey !== null) return { list: [...list], rank, total, writes: [] };

  const others = list.filter((_, i) => i !== from);
  let keys: Map<string, string>;
  try {
    keys = keysForSlot(others, slot, taskId);
  } catch {
    keys = rekeyAround(others, slot, taskId);
  }

  const ordered = [...others.slice(0, slot), moved, ...others.slice(slot)];
  const writes: RankPlacement<T>['writes'] = [];
  const next = ordered.map((t) => {
    const key = keys.get(t.id);
    if (key === undefined || key === t.sortKey) return t;
    writes.push({ id: t.id, sortKey: key });
    return { ...t, sortKey: key };
  });
  return { list: next, rank, total, writes };
}

/**
 * The fewest keys that open the slot. Usually one key between the neighbors.
 * Unranked tasks above the slot get keys in their current order, since a keyed
 * task always sorts ahead of them. A tie (neighbors sharing one key) leaves no
 * key between them, so the tied tasks above the slot take fresh keys too.
 */
function keysForSlot(others: readonly RankEntry[], slot: number, taskId: string): Map<string, string> {
  const keys = new Map<string, string>();
  const firstUnranked = others.findIndex((t) => t.sortKey === null);
  const rankedCount = firstUnranked === -1 ? others.length : firstUnranked;

  let from: number;
  let upper: string | null;
  if (slot > rankedCount) {
    from = rankedCount;
    upper = null;
  } else {
    upper = slot < rankedCount ? others[slot].sortKey : null;
    from = slot;
    while (upper !== null && from > 0 && others[from - 1].sortKey === upper) from--;
  }
  const lower = from > 0 ? others[from - 1].sortKey : null;
  for (const bound of [lower, upper]) {
    if (bound !== null && !KEY_PATTERN.test(bound)) throw new Error('Invalid ordering key');
  }

  const fresh = generateNKeysBetween(lower, upper, slot - from + 1);
  for (let i = from; i < slot; i++) keys.set(others[i].id, fresh[i - from]);
  keys.set(taskId, fresh[fresh.length - 1]);
  return keys;
}

/**
 * The fallback for a list whose keys can't bound a new one (out of order or
 * malformed): fresh keys for everything ranked, in the new order. Unranked
 * tasks below the slot stay unranked.
 */
function rekeyAround(others: readonly RankEntry[], slot: number, taskId: string): Map<string, string> {
  const keyed = [
    ...others.slice(0, slot).map((t) => t.id),
    taskId,
    ...others.slice(slot).filter((t) => t.sortKey !== null).map((t) => t.id),
  ];
  const fresh = generateNKeysBetween(null, null, keyed.length);
  return new Map(keyed.map((id, i) => [id, fresh[i]]));
}
