import { describe, expect, it } from 'vitest';
import type { LaunchSourceItem } from '@/lib/executions/launch-draft';
import {
  BASE_FETCH_LIMIT,
  MAX_ROWS_PER_GROUP,
  MIN_ROWS_PER_GROUP,
  PAGE_SIZE,
  expand,
  fetchLimit,
  jumpLabel,
  nextExpandable,
  planRows,
  showMoreLabel,
  type PageableGroup,
} from './launch-paging';

function items(n: number): LaunchSourceItem[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'pr' as const,
    key: String(i),
    title: `row ${i}`,
  }));
}

function group(id: string, count: number, truncated?: boolean): PageableGroup {
  return { id, items: items(count), truncated };
}

describe('planRows — one source owns the list', () => {
  it('renders a page at a time and reports the rest as reachable here', () => {
    const [plan] = planRows([group('pr', 200)], {});
    expect(plan.shown).toHaveLength(PAGE_SIZE);
    expect(plan.hidden).toBe(180);
    expect(plan.more).toBe('page');
  });

  it('reveals one more page per expand, in order', () => {
    let pages = {};
    pages = expand(pages, 'pr');
    expect(planRows([group('pr', 200)], pages)[0].shown).toHaveLength(PAGE_SIZE * 2);
    pages = expand(pages, 'pr');
    const plan = planRows([group('pr', 200)], pages)[0];
    expect(plan.shown).toHaveLength(PAGE_SIZE * 3);
    expect(plan.shown[PAGE_SIZE * 2].key).toBe(String(PAGE_SIZE * 2));
  });

  it('stops offering more once the list is exhausted', () => {
    const plan = planRows([group('pr', 25)], expand({}, 'pr'))[0];
    expect(plan.shown).toHaveLength(25);
    expect(plan.hidden).toBe(0);
    expect(plan.more).toBe('none');
  });

  it('does not page a list that fits', () => {
    const plan = planRows([group('pr', 3)], {})[0];
    expect(plan.shown).toHaveLength(3);
    expect(plan.more).toBe('none');
  });

  // The regression this module exists for: sources used to pre-slice to ~6
  // rows, so `hidden` was computed from an already-truncated array and always
  // came out zero. The tail of every list was unreachable and unannounced.
  it('never reports zero hidden while rows are held back', () => {
    for (const count of [21, 40, 41, 199]) {
      const plan = planRows([group('pr', count)], {})[0];
      expect(plan.shown.length + plan.hidden).toBe(count);
      expect(plan.more).toBe('page');
    }
  });
});

describe('planRows — several sources share the list', () => {
  it('splits a fixed budget and points at the owning source', () => {
    const plan = planRows([group('a', 50), group('b', 50)], {});
    expect(plan[0].shown).toHaveLength(4);
    expect(plan[0].hidden).toBe(46);
    expect(plan[0].more).toBe('jump');
  });

  it('shrinks the per-source share as sources are added, never past the floor', () => {
    const many = Array.from({ length: 8 }, (_, i) => group(`g${i}`, 50));
    for (const plan of planRows(many, {})) {
      expect(plan.shown.length).toBeGreaterThanOrEqual(MIN_ROWS_PER_GROUP);
      expect(plan.shown.length).toBeLessThanOrEqual(MAX_ROWS_PER_GROUP);
    }
  });

  it('ignores page state — paging belongs to a narrowed list', () => {
    const shared = [group('a', 50), group('b', 50)];
    expect(planRows(shared, expand({}, 'a'))[0].shown).toHaveLength(4);
  });
});

describe('fetchLimit', () => {
  it('asks for one more row than it can render, to detect a capped source', () => {
    expect(fetchLimit({}, 'task')).toBe(PAGE_SIZE + 1);
    expect(fetchLimit({}, 'task')).toBe(BASE_FETCH_LIMIT);
    expect(fetchLimit(expand({}, 'task'), 'task')).toBe(PAGE_SIZE * 2 + 1);
  });

  it('is per group', () => {
    const pages = expand(expand({}, 'task'), 'task');
    expect(fetchLimit(pages, 'task')).toBe(PAGE_SIZE * 3 + 1);
    expect(fetchLimit(pages, 'chat')).toBe(BASE_FETCH_LIMIT);
  });
});

describe('labels', () => {
  it('counts exactly when the whole list is in hand', () => {
    expect(showMoreLabel(180)).toBe('Show 180 more');
    expect(jumpLabel(46, false, 'Pull requests')).toBe('+46 more in Pull requests');
  });

  // A truncated source returns exactly `PAGE_SIZE + 1` rows, so `hidden` is 1
  // no matter how many hundreds are behind it. Saying "Show 1 more" there is
  // worse than saying nothing.
  it('drops the count when the source capped itself', () => {
    expect(showMoreLabel(1, true)).toBe('Show more');
    expect(jumpLabel(1, true, 'Your tasks')).toBe('More in Your tasks');
  });
});

describe('nextExpandable', () => {
  it('finds the group that can grow in place', () => {
    const plan = planRows([group('pr', 200)], {});
    expect(nextExpandable(plan)?.group.id).toBe('pr');
  });

  it('is undefined when the overflow is a tab away, not a page away', () => {
    expect(nextExpandable(planRows([group('a', 50), group('b', 50)], {}))).toBeUndefined();
  });

  it('is undefined when nothing is held back', () => {
    expect(nextExpandable(planRows([group('pr', 3)], {}))).toBeUndefined();
  });
});
