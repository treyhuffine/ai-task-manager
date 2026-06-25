/**
 * Calendar seam for the proactive deck.
 *
 * The deck is "your tasks poured into the real gaps of your real day" — so it
 * needs to know the day's busy blocks. That data arrives via a calendar
 * connector (separate, in-flight). This module is the boundary the connector
 * plugs into: until one registers a provider, `getCalendarEventsForDay`
 * returns no events and the deck degrades gracefully to "a normal day".
 *
 * Everything below the provider is pure (gap math) so it's fully testable
 * without a real calendar.
 */

import type { CalendarBlock } from '@/lib/db/schema';

export type { CalendarBlock };

/** A free stretch within the workday, in minutes from local midnight. */
export interface CalendarGap {
  startMinute: number;
  endMinute: number;
  minutes: number;
}

export interface WorkdayBounds {
  /** Local HH:MM, e.g. '09:00'. */
  workdayStart: string;
  /** Local HH:MM, e.g. '18:00'. */
  workdayEnd: string;
}

// ─── Provider registry (connector injection point) ──────────────

export type CalendarProvider = (date: string) => Promise<CalendarBlock[]>;

let provider: CalendarProvider | null = null;

/** A calendar connector registers its reader here. Pass null to unregister. */
export function setCalendarProvider(fn: CalendarProvider | null): void {
  provider = fn;
}

export function hasCalendarProvider(): boolean {
  return provider != null;
}

/**
 * Busy blocks for a local day (YYYY-MM-DD). Returns [] when no provider is
 * registered or the provider throws — the deck treats the day as fully open.
 */
export async function getCalendarEventsForDay(date: string): Promise<CalendarBlock[]> {
  if (!provider) return [];
  try {
    return await provider(date);
  } catch (err) {
    console.error('[calendar] provider failed, treating day as open', err);
    return [];
  }
}

// ─── Pure time math ─────────────────────────────────────────────

/** 'HH:MM' → minutes since midnight. Clamped to [0, 1440]. */
export function parseHhMm(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return Math.max(0, Math.min(1440, mins));
}

/** minutes since midnight → 'H:MM AM/PM' for display. */
export function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, '0');
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${ampm}`;
}

/** "Xh Ym" / "Xh" / "Ym" from a minute count. */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * A block's busy interval on `date`, as [startMinute, endMinute] from local
 * midnight, or null if the block doesn't overlap that day. Multi-day / all-day
 * blocks are clamped to the day's bounds.
 */
function blockBusyMinutes(block: CalendarBlock, date: string): [number, number] | null {
  const dayStart = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) return null;
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const s = new Date(block.start);
  const e = new Date(block.end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  if (e <= dayStart || s >= dayEnd) return null; // not on this day

  const startMin = Math.round((Math.max(s.getTime(), dayStart.getTime()) - dayStart.getTime()) / 60000);
  const endMin = Math.round((Math.min(e.getTime(), dayEnd.getTime()) - dayStart.getTime()) / 60000);
  if (endMin <= startMin) return null;
  return [startMin, endMin];
}

/**
 * Free gaps within the workday window, after subtracting (merged) busy blocks.
 * With no blocks, returns a single gap spanning the whole workday.
 */
export function computeFreeGaps(
  blocks: CalendarBlock[],
  opts: WorkdayBounds & { date: string },
): CalendarGap[] {
  const dayStart = parseHhMm(opts.workdayStart);
  const dayEnd = parseHhMm(opts.workdayEnd);
  if (dayEnd <= dayStart) return [];

  const busy = blocks
    .map((b) => blockBusyMinutes(b, opts.date))
    .filter((iv): iv is [number, number] => iv != null)
    .map(([s, e]): [number, number] => [Math.max(s, dayStart), Math.min(e, dayEnd)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  // Merge overlapping/adjacent busy intervals.
  const merged: [number, number][] = [];
  for (const iv of busy) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }

  // Complement within [dayStart, dayEnd].
  const gaps: CalendarGap[] = [];
  let cursor = dayStart;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push({ startMinute: cursor, endMinute: s, minutes: s - cursor });
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) gaps.push({ startMinute: cursor, endMinute: dayEnd, minutes: dayEnd - cursor });
  return gaps;
}

/** Total free minutes across gaps. */
export function availableMinutes(gaps: CalendarGap[]): number {
  return gaps.reduce((sum, g) => sum + g.minutes, 0);
}

/** "9:00 AM to 10:30 AM (1h 30m)" */
export function formatGap(gap: CalendarGap): string {
  return `${minutesToLabel(gap.startMinute)} to ${minutesToLabel(gap.endMinute)} (${formatMinutes(gap.minutes)})`;
}
