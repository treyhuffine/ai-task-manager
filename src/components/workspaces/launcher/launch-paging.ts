import type { LaunchSourceItem } from '@/lib/executions/launch-draft';

/**
 * How the browse panel decides which rows to render, and how the rest are
 * reached.
 *
 * Pure on purpose — the panel's list math is the part that silently hides
 * results when it's wrong, and a node-environment test can only reach it if
 * it lives outside the component.
 *
 * Two modes, because "there are more rows" means two different things:
 *
 *   - **Several sources share the list** (the All tab, or Tasks with
 *     connectors). Breadth wins: every source gets a couple of rows out of a
 *     shared budget, and the overflow affordance *narrows* to that source.
 *   - **One source owns the list** (any narrowed tab). Depth wins: rows come
 *     a page at a time and the affordance reveals the next page in place.
 *
 * The second mode is what makes a long list reachable at all. Before it, a
 * narrowed tab rendered `items` verbatim and every source pre-sliced itself
 * to ~6 rows, so PRs 7..200 existed in the cache and were unreachable with no
 * indication they were there.
 */

/**
 * Rows revealed per page once the list is narrowed to a single source.
 *
 * Deliberately much larger than the shared budget below: a narrowed tab is an
 * explicit "show me this list", where scrolling is expected and a 5-row page
 * would mean clicking through 40 pages of a big repo's branches.
 */
export const PAGE_SIZE = 20;

/**
 * Total rows to spend across all groups when several share the list.
 *
 * A fixed per-group cap doesn't survive growth: at four rows each, two task
 * sources fill 8 rows and six sources fill 24, so the list gets longer exactly
 * as it gets more fragmented. Budgeting the total instead keeps it scannable
 * at any N — the share per source shrinks as sources are added, and every
 * source stays visible without scrolling, which is the whole point.
 *
 * A query narrows this for free: groups that match nothing drop out, so the
 * remaining ones split the budget between fewer claimants. Search for
 * something only Linear has and Linear gets the room.
 */
// Sized against what the panel actually shows without scrolling (~7 rows at
// two lines each), not against an abstract sense of "enough". Set too high and
// the first group alone fills the viewport, which is the bug this exists to
// prevent: two groups at a budget of 14 gives 6 rows each and the second
// header lands below the fold.
export const ROW_BUDGET = 8;
export const MIN_ROWS_PER_GROUP = 2;
export const MAX_ROWS_PER_GROUP = 5;

/**
 * The slice of a source group this module needs. Structural rather than the
 * full `LaunchSourceGroup` so tests can build one in a line.
 */
export interface PageableGroup {
  id: string;
  items: LaunchSourceItem[];
  /**
   * The source capped the list itself, so `items.length` is a floor on what
   * exists rather than the total. Set by server-backed groups (local tasks,
   * chat search, connector tasks) whose fetch limit grows with the page count.
   */
  truncated?: boolean;
}

export interface PlannedGroup<G extends PageableGroup = PageableGroup> {
  group: G;
  shown: LaunchSourceItem[];
  /** Rows held back. A floor, not a total, when `group.truncated`. */
  hidden: number;
  /**
   * How the held-back rows are reached.
   *  - `page` — reveal them right here; this source owns the list.
   *  - `jump` — narrow to this source first; it's sharing the list.
   *  - `none` — nothing held back.
   */
  more: 'none' | 'page' | 'jump';
}

/** Pages revealed so far, by group id. Absent means the first page. */
export type PageState = Record<string, number>;

function pageCount(pages: PageState, groupId: string): number {
  const n = pages[groupId];
  return n && n > 0 ? n : 1;
}

/**
 * How many rows to ask a server-backed source for, given how far the user has
 * paged through it.
 *
 * The `+ 1` is a sentinel: a source that returns exactly this many rows has at
 * least one more we haven't seen, which is the only way to tell "that's all of
 * them" from "that's all you asked for" without a separate count query.
 */
export function fetchLimit(pages: PageState, groupId: string): number {
  return pageCount(pages, groupId) * PAGE_SIZE + 1;
}

/** The fetch limit before the user has paged at all. */
export const BASE_FETCH_LIMIT = PAGE_SIZE + 1;

/** Next page state after revealing more of one group. */
export function expand(pages: PageState, groupId: string): PageState {
  return { ...pages, [groupId]: pageCount(pages, groupId) + 1 };
}

export function planRows<G extends PageableGroup>(
  groups: G[],
  pages: PageState,
): PlannedGroup<G>[] {
  // Breadth beats depth while several sources share the list; once the user
  // has narrowed to one, that's a deliberate "show me everything from here".
  if (groups.length <= 1) {
    return groups.map((group) => {
      const cap = pageCount(pages, group.id) * PAGE_SIZE;
      const hidden = Math.max(0, group.items.length - cap);
      return {
        group,
        shown: group.items.slice(0, cap),
        hidden,
        more: hidden > 0 ? 'page' : 'none',
      };
    });
  }

  const share = Math.round(ROW_BUDGET / groups.length);
  const cap = Math.min(MAX_ROWS_PER_GROUP, Math.max(MIN_ROWS_PER_GROUP, share));
  return groups.map((group) => {
    const hidden = Math.max(0, group.items.length - cap);
    return {
      group,
      shown: group.items.slice(0, cap),
      hidden,
      more: hidden > 0 ? 'jump' : 'none',
    };
  });
}

/**
 * Label for the reveal-more control on a narrowed list.
 *
 * A truncated source gets no number. With the `+ 1` sentinel its `hidden` is
 * always exactly 1, and "Show 1 more" on a list with 300 rows behind it is
 * worse than saying nothing.
 */
export function showMoreLabel(hidden: number, truncated?: boolean): string {
  return truncated ? 'Show more' : `Show ${hidden} more`;
}

/** Label for the narrow-to-this-source control on a shared list. */
export function jumpLabel(hidden: number, truncated: boolean | undefined, label: string): string {
  return truncated ? `More in ${label}` : `+${hidden} more in ${label}`;
}

/** The next group whose held-back rows can be revealed in place, if any. */
export function nextExpandable<G extends PageableGroup>(
  planned: PlannedGroup<G>[],
): PlannedGroup<G> | undefined {
  return planned.find((p) => p.more === 'page');
}
