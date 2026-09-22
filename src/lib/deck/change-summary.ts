import type { DeckChangeView } from '@/types/dashboard';

export interface DeckChangeSummary {
  /** Human parts, in display order: "N carried over", "N new", "N moved off". */
  parts: string[];
  /** Any change came from a mid-day calendar adaptation. */
  fromCalendar: boolean;
}

/**
 * Summarize a deck's change log for display. Shared by the classic change
 * brief and the focused layout's "Today" section header so both say the same
 * thing. `reordered` is intentionally not counted: it is noise at a glance.
 */
export function summarizeDeckChanges(
  changes: Pick<DeckChangeView, 'kind' | 'source'>[],
): DeckChangeSummary {
  const carried = changes.filter((c) => c.kind === 'carried').length;
  const added = changes.filter((c) => c.kind === 'added').length;
  const moved = changes.filter(
    (c) => c.kind === 'deferred' || c.kind === 'dropped' || c.kind === 'bumped',
  ).length;

  const parts: string[] = [];
  if (carried > 0) parts.push(`${carried} carried over`);
  if (added > 0) parts.push(`${added} new`);
  if (moved > 0) parts.push(`${moved} moved off`);

  return { parts, fromCalendar: changes.some((c) => c.source === 'calendar') };
}
