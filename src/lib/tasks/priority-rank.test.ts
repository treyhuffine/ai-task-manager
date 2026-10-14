import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import { clampRank, placeAtRank, type RankEntry } from './priority-rank';
import { BUCKET_OPTIONS, bucketRank, computeBucketPlacement } from '@/lib/utils/bucket-placement';

const entry = (id: string, sortKey: string | null): RankEntry => ({ id, sortKey });
const ids = (list: RankEntry[]) => list.map((t) => t.id);

/** Sort the way the query layer does: keys ascending, unranked last, and ties
 * in the list's original order (created time and id, in the database). */
function resort(list: RankEntry[], original: RankEntry[]): RankEntry[] {
  const at = new Map(original.map((t, i) => [t.id, i]));
  return [...list].sort((a, b) => {
    if (a.sortKey !== b.sortKey) {
      if (a.sortKey === null) return 1;
      if (b.sortKey === null) return -1;
      return a.sortKey < b.sortKey ? -1 : 1;
    }
    return at.get(a.id)! - at.get(b.id)!;
  });
}

function apply(list: RankEntry[], writes: { id: string; sortKey: string }[]): RankEntry[] {
  const keys = new Map(writes.map((w) => [w.id, w.sortKey]));
  return resort(list.map((t) => (keys.has(t.id) ? { ...t, sortKey: keys.get(t.id)! } : t)), list);
}

describe('placeAtRank', () => {
  const [k0, k1, k2, k3] = generateNKeysBetween(null, null, 4);
  const keyed = [entry('a', k0), entry('b', k1), entry('c', k2), entry('d', k3)];

  it('moves a task between its new neighbors with one write', () => {
    const placement = placeAtRank(keyed, 'd', 2)!;
    expect(placement).toMatchObject({ rank: 2, total: 4 });
    expect(placement.writes).toHaveLength(1);
    expect(placement.writes[0].id).toBe('d');
    expect(k0 < placement.writes[0].sortKey && placement.writes[0].sortKey < k1).toBe(true);
    expect(ids(placement.list)).toEqual(['a', 'd', 'b', 'c']);
    expect(ids(apply(keyed, placement.writes))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('holds a rank to the list: 0 is the top, past the end is last', () => {
    expect(ids(placeAtRank(keyed, 'c', 0)!.list)).toEqual(['c', 'a', 'b', 'd']);
    const last = placeAtRank(keyed, 'a', 99)!;
    expect(last.rank).toBe(4);
    expect(ids(apply(keyed, last.writes))).toEqual(['b', 'c', 'd', 'a']);
    expect(clampRank(2.7, 4)).toBe(2);
    expect(clampRank(5, 0)).toBe(1);
  });

  it('writes nothing when a ranked task is already there, so a retry is a no-op', () => {
    expect(placeAtRank(keyed, 'b', 2)).toEqual({ list: keyed, rank: 2, total: 4, writes: [] });
  });

  it('ranks an unranked task that already sits at the requested spot', () => {
    const list = [entry('a', k0), entry('new', null)];
    const placement = placeAtRank(list, 'new', 2)!;
    expect(placement.writes.map((w) => w.id)).toEqual(['new']);
    expect(placement.list[1].sortKey! > k0).toBe(true);
  });

  it('places an unranked task among ranked ones without touching other unranked tasks', () => {
    const list = [...keyed, entry('x', null), entry('y', null), entry('new', null)];
    const placement = placeAtRank(list, 'new', 3)!;
    expect(placement.writes.map((w) => w.id)).toEqual(['new']);
    expect(ids(apply(list, placement.writes))).toEqual(['a', 'b', 'new', 'c', 'd', 'x', 'y']);
    expect(placement.list.filter((t) => t.sortKey === null).map((t) => t.id)).toEqual(['x', 'y']);
  });

  it('keys only the unranked tasks above the spot, in their current order', () => {
    const created = [entry('a', k0), entry('x', null), entry('y', null), entry('z', null), entry('m', k1)];
    const canonical = resort(created, created);
    const placement = placeAtRank(canonical, 'a', 4)!;
    expect(ids(canonical)).toEqual(['a', 'm', 'x', 'y', 'z']);
    expect(placement.writes.map((w) => w.id)).toEqual(['x', 'y', 'a']);
    expect(ids(apply(canonical, placement.writes))).toEqual(['m', 'x', 'y', 'a', 'z']);
    expect(placement.list.find((t) => t.id === 'z')!.sortKey).toBeNull();
  });

  it('opens a slot between two tasks that share a key by re-keying the tied ones above it', () => {
    const list = [entry('a', k0), entry('t1', k1), entry('t2', k1), entry('t3', k1), entry('d', k3)];
    const placement = placeAtRank(list, 'd', 3)!;
    expect(placement.writes.map((w) => w.id)).toEqual(['t1', 'd']);
    expect(ids(apply(list, placement.writes))).toEqual(['a', 't1', 'd', 't2', 't3']);
  });

  it('leaves a tie elsewhere in the list alone', () => {
    const list = [entry('a', k0), entry('t1', k2), entry('t2', k2), entry('d', k3)];
    const placement = placeAtRank(list, 'd', 2)!;
    expect(placement.writes.map((w) => w.id)).toEqual(['d']);
    expect(ids(apply(list, placement.writes))).toEqual(['a', 'd', 't1', 't2']);
  });

  it('re-keys the ranked tasks when a neighbor key is malformed, keeping unranked ones unranked', () => {
    const list = [entry('a', 'a!'), entry('b', 'a!!'), entry('c', null), entry('m', null)];
    const placement = placeAtRank(list, 'm', 2)!;
    expect(ids(placement.list)).toEqual(['a', 'm', 'b', 'c']);
    expect(placement.list.find((t) => t.id === 'c')!.sortKey).toBeNull();
    const keys = placement.list.slice(0, 3).map((t) => t.sortKey!);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
  });

  it('falls back to re-keying a list whose keys are out of order', () => {
    const list = [entry('a', k2), entry('b', k0), entry('c', k3)];
    const placement = placeAtRank(list, 'c', 2)!;
    expect(ids(placement.list)).toEqual(['a', 'c', 'b']);
    expect(ids(apply(list, placement.writes))).toEqual(['a', 'c', 'b']);
  });

  it('returns null for a task outside the list', () => {
    expect(placeAtRank(keyed, 'missing', 1)).toBeNull();
  });

  it('always lands on the requested rank and keeps everything else in order', () => {
    // A seeded walk over lists with ties and unranked tails.
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let round = 0; round < 500; round++) {
      const ranked = Math.floor(random() * 8);
      const unranked = Math.floor(random() * 5);
      const pool = generateNKeysBetween(null, null, Math.max(ranked, 1));
      const keys = Array.from({ length: ranked }, () => pool[Math.floor(random() * pool.length)]).sort();
      const list = [
        ...keys.map((k, i) => entry(`r${i}`, k)),
        ...Array.from({ length: unranked }, (_, i) => entry(`u${i}`, null)),
      ];
      if (list.length === 0) continue;
      const task = list[Math.floor(random() * list.length)].id;
      const rank = 1 + Math.floor(random() * (list.length + 2));
      const placement = placeAtRank(list, task, rank)!;
      const after = apply(list, placement.writes);
      expect(ids(after)).toEqual(ids(placement.list));
      expect(after.indexOf(after.find((t) => t.id === task)!)).toBe(placement.rank - 1);
      expect(placement.rank).toBe(Math.min(rank, list.length));
      expect(ids(after.filter((t) => t.id !== task))).toEqual(ids(list.filter((t) => t.id !== task)));
      expect(after.find((t) => t.id === task)!.sortKey).not.toBeNull();
      const second = placeAtRank(after, task, rank)!;
      expect(second.writes).toEqual([]);
    }
  });
});

describe('bucketRank', () => {
  it('lands where the list view bucket placement does', () => {
    for (let total = 1; total <= 60; total++) {
      const keys = generateNKeysBetween(null, null, total);
      const list = keys.map((k, i) => entry(`t${i}`, k));
      for (const { value } of BUCKET_OPTIONS) {
        for (const moved of [list[0].id, list[Math.floor(total / 2)].id, list[total - 1].id]) {
          const placement = computeBucketPlacement(list, moved, value)!;
          const index = placement.reordered.findIndex((t) => t.id === moved);
          expect(bucketRank(value, total), `${value} in ${total}`).toBe(index + 1);
        }
      }
    }
  });
});
