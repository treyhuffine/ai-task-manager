/**
 * Gap-to-task pairing — the bridge between calendar and deck after the
 * placement retrenchment. Nothing gets drawn onto the timeline: given the
 * current free gap (deterministic calendar math) and the deck's ranked stack
 * (with its categorical deep/light labels), a code rule picks the top task
 * whose energy suits the time actually available right now.
 *
 * No LLM at runtime, no duration estimates, nothing that can go stale — the
 * pairing re-derives from the clock on every render.
 */
import { formatMinutes, minutesToLabel } from '@/lib/deck/calendar';
import type { CalendarDay, CalendarGap } from './types';

/** A gap is "deep-work sized" at or above this. */
const DEEP_GAP_MINUTES = 90;
/** Below this remaining time, suggesting anything is noise. */
const MIN_PAIRING_MINUTES = 15;

export interface PairableItem {
  title: string;
  energy?: 'deep' | 'light';
}

export interface Pairing {
  /** "2h clear until 2:00 PM" */
  window: string;
  /** The suggested task's title. */
  title: string;
}

/** The gap containing `nowMinute`, if any. */
function currentGap(gaps: CalendarGap[], nowMinute: number): CalendarGap | undefined {
  return gaps.find((g) => g.startMinute <= nowMinute && nowMinute < g.endMinute);
}

/**
 * Pick what the current stretch of free time is good for. Returns null when
 * there's no meaningful gap, no day shape, or nothing on the deck.
 */
export function pickPairing(
  day: CalendarDay | undefined,
  items: PairableItem[],
  now: Date,
): Pairing | null {
  if (!day || items.length === 0) return null;
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const gap = currentGap(day.gaps, nowMinute);
  if (!gap) return null;

  const remaining = gap.endMinute - nowMinute;
  if (remaining < MIN_PAIRING_MINUTES) return null;

  // Deep stretch → top deep task. Short slice → top light task. Either way,
  // fall back to the top of the deck: order is the deck's judgment, not ours.
  const wanted: PairableItem['energy'] = remaining >= DEEP_GAP_MINUTES ? 'deep' : 'light';
  const match = items.find((i) => i.energy === wanted) ?? items[0];

  return {
    window: `${formatMinutes(remaining)} clear until ${minutesToLabel(gap.endMinute)}`,
    title: match.title,
  };
}
