import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export type Bucket = 'top' | 'high' | 'medium' | 'low' | 'lowest';

export const BUCKET_OPTIONS: { value: Bucket; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'lowest', label: 'Lowest' },
];

interface HasSortKey {
  id: string;
  sortKey: string | null;
}

export interface BucketPlacement<T extends HasSortKey> {
  reordered: T[];
  newKey: string;
  /** PATCHes for tasks whose sortKey needed to be backfilled. Excludes the moved task. */
  normalizationPatches: { id: string; sortKey: string }[];
  /** PATCH for the moved task itself. */
  movedPatch: { id: string; sortKey: string };
}

/**
 * Walk a sortKey-ordered list and fill in keys for any null-keyed entries,
 * threading them between the surrounding non-null anchors.
 */
export function backfillSortKeys<T extends HasSortKey>(list: T[]): T[] {
  const result: T[] = [];
  let i = 0;
  while (i < list.length) {
    if (list[i].sortKey !== null) {
      result.push(list[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < list.length && list[j].sortKey === null) j++;
    const prev = result.length > 0 ? result[result.length - 1].sortKey : null;
    const next = j < list.length ? list[j].sortKey : null;
    const keys = generateNKeysBetween(prev, next, j - i);
    for (let k = 0; k < keys.length; k++) {
      result.push({ ...list[i + k], sortKey: keys[k] });
    }
    i = j;
  }
  return result;
}

function bucketTargetIndex(bucket: Bucket, n: number): number {
  switch (bucket) {
    case 'top':    return 0;
    case 'high':   return Math.max(1, Math.floor(n * 0.10));
    case 'medium': return Math.floor(n * 0.375);
    case 'low':    return Math.floor(n * 0.70);
    case 'lowest': return n;
  }
}

/**
 * Place `taskId` in the chosen bucket within `list`. Backfills any null sort_keys
 * so the placement is well-defined, then computes a new key for the moved task
 * in the bucket's target zone. Returns the reordered list and the patches needed
 * to persist the change. Returns null if the task isn't in the list.
 */
export function computeBucketPlacement<T extends HasSortKey>(
  list: T[],
  taskId: string,
  bucket: Bucket,
): BucketPlacement<T> | null {
  if (!list.find(t => t.id === taskId)) return null;

  const normalized = backfillSortKeys(list);

  const normalizationPatches: { id: string; sortKey: string }[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].sortKey !== normalized[i].sortKey) {
      normalizationPatches.push({ id: list[i].id, sortKey: normalized[i].sortKey! });
    }
  }

  const others = normalized.filter(t => t.id !== taskId);
  const targetIndex = Math.max(0, Math.min(others.length, bucketTargetIndex(bucket, others.length)));

  const prev = targetIndex > 0 ? others[targetIndex - 1].sortKey : null;
  const next = targetIndex < others.length ? others[targetIndex].sortKey : null;
  const newKey = generateKeyBetween(prev, next);

  const movedTask = normalized.find(t => t.id === taskId)!;
  const reordered = [...others];
  reordered.splice(targetIndex, 0, { ...movedTask, sortKey: newKey });

  return {
    reordered,
    newKey,
    normalizationPatches: normalizationPatches.filter(p => p.id !== taskId),
    movedPatch: { id: taskId, sortKey: newKey },
  };
}
