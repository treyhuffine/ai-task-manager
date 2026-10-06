/**
 * The work ribbon's numbers (docs/work-view.md, "The ribbon"): a day cut into
 * 15-minute windows, each counting the chats working in it, by agent. Width
 * in the ribbon is how many ran at once, so the shape of a day shows its
 * parallelism, the leverage, at a glance. Pure and client-safe.
 */

import { instantWindowOnDate, type MinuteWindow } from '@/lib/calendar/layout';
import type { WorkDay } from './types';

export const BIN_MINUTES = 15;

export interface RibbonBin {
  startMinute: number;
  /** Chats working in this window, all agents. */
  total: number;
  /** Per agent, in the order given (stacking order, so colors line up). */
  byAgent: Array<{ agentId: string | null; count: number }>;
}

/**
 * Count each window's working chats by agent. A chat counts in every window
 * its stretch touches. Empty windows are left out.
 */
export function activityBins(
  day: Pick<WorkDay, 'date' | 'blocks'>,
  order: (agentId: string | null) => number,
  binMinutes = BIN_MINUTES,
): RibbonBin[] {
  const bins = new Map<number, Map<string | null, number>>();
  for (const b of day.blocks) {
    const w = instantWindowOnDate(b.start, b.end, day.date);
    if (!w) continue;
    const first = Math.floor(w.startMinute / binMinutes);
    const last = Math.ceil(w.endMinute / binMinutes) - 1;
    for (let i = first; i <= last; i++) {
      const counts = bins.get(i) ?? new Map<string | null, number>();
      counts.set(b.agentId, (counts.get(b.agentId) ?? 0) + 1);
      bins.set(i, counts);
    }
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, counts]) => {
      const byAgent = [...counts.entries()]
        .map(([agentId, count]) => ({ agentId, count }))
        .sort((a, b) => order(a.agentId) - order(b.agentId));
      return { startMinute: i * binMinutes, total: byAgent.reduce((n, a) => n + a.count, 0), byAgent };
    });
}

/** The widest window across days: every day's ribbon shares this scale. */
export function ribbonScale(binsByDay: ReadonlyArray<readonly RibbonBin[]>): number {
  let max = 1;
  for (const bins of binsByDay) for (const b of bins) max = Math.max(max, b.total);
  return max;
}

/** Your sittings on the day as minute windows. */
export function sittingWindows(day: Pick<WorkDay, 'date' | 'sittings'>): MinuteWindow[] {
  return day.sittings
    .map((s) => instantWindowOnDate(s.start, s.end, day.date))
    .filter((w): w is MinuteWindow => w !== null);
}
