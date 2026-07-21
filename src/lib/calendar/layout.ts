/**
 * Pure view math for the calendar surfaces (strip, day view, week view).
 * No React, no fetching — everything here is unit-testable geometry.
 */
import { minutesToLabel, parseHhMm } from '@/lib/deck/calendar';
import type { CalendarDay, CalendarEvent } from './types';

export const MAX_EVENT_COLUMNS = 3;

export interface MinuteWindow {
  startMinute: number;
  endMinute: number;
}

/**
 * Time renders as FRACTIONS of the visible range, never as pixel math: a
 * minute's position is a percentage of the track, and the track's height is
 * `calc(<hours> * var(--hour-h))` with the hour scale set once in rem by the
 * surface. JS stays in minutes; CSS owns every length.
 */
export function minutePct(minute: number, bounds: MinuteWindow): number {
  const span = bounds.endMinute - bounds.startMinute;
  if (span <= 0) return 0;
  return ((minute - bounds.startMinute) / span) * 100;
}

export function windowPct(
  window: MinuteWindow,
  bounds: MinuteWindow,
): { topPct: number; heightPct: number } {
  const span = bounds.endMinute - bounds.startMinute;
  if (span <= 0) return { topPct: 0, heightPct: 0 };
  return {
    topPct: minutePct(window.startMinute, bounds),
    heightPct: Math.max(0, ((window.endMinute - window.startMinute) / span) * 100),
  };
}

/** The whole-hour marks inside a bounds range (for gridlines and labels). */
export function hourMarks(bounds: MinuteWindow): number[] {
  const out: number[] = [];
  for (let m = bounds.startMinute; m <= bounds.endMinute; m += 60) out.push(m);
  return out;
}

/** CSS height expression for a time track: hours × the surface's hour scale. */
export function trackHeight(bounds: MinuteWindow): string {
  return `calc(${(bounds.endMinute - bounds.startMinute) / 60} * var(--hour-h))`;
}

/**
 * A timed event's minute window on a local date, clamped to [0, 1440].
 * Null when the event doesn't touch that day or has unparseable times.
 */
export function eventWindowOnDate(e: CalendarEvent, date: string): MinuteWindow | null {
  const dayStart = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) return null;
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const s = new Date(e.start.includes('T') ? e.start : `${e.start}T00:00:00`);
  const en = new Date(e.end.includes('T') ? e.end : `${e.end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) return null;
  if (en <= dayStart || s >= dayEnd) return null;

  const startMinute = Math.round(
    (Math.max(s.getTime(), dayStart.getTime()) - dayStart.getTime()) / 60000,
  );
  const endMinute = Math.round(
    (Math.min(en.getTime(), dayEnd.getTime()) - dayStart.getTime()) / 60000,
  );
  if (endMinute <= startMinute) return null;
  return { startMinute, endMinute };
}

// ─── Day view: overlap packing ──────────────────────────────────

export interface PlacedEvent {
  event: CalendarEvent;
  startMinute: number;
  endMinute: number;
  /** 0-based column within the overlap cluster. */
  column: number;
  /** Total rendered columns in the cluster (≤ MAX_EVENT_COLUMNS). */
  columns: number;
}

export interface OverflowGroup {
  startMinute: number;
  endMinute: number;
  events: CalendarEvent[];
}

export interface PackedDay {
  placed: PlacedEvent[];
  overflow: OverflowGroup[];
}

/**
 * Greedy interval packing: sort by start, place each event in the first
 * column free at its start. Clusters (connected overlap components) wider
 * than MAX_EVENT_COLUMNS collapse their extra events into one overflow group
 * (rendered as a "+N" chip in the last column).
 */
export function packColumns(events: CalendarEvent[], date: string): PackedDay {
  const windows = events
    .map((event) => ({ event, window: eventWindowOnDate(event, date) }))
    .filter((x): x is { event: CalendarEvent; window: MinuteWindow } => x.window != null)
    .sort(
      (a, b) =>
        a.window.startMinute - b.window.startMinute || b.window.endMinute - a.window.endMinute,
    );

  interface Working {
    event: CalendarEvent;
    window: MinuteWindow;
    column: number;
    cluster: number;
  }

  const working: Working[] = [];
  // Column occupancy: last end minute per column, reset per cluster.
  let columnEnds: number[] = [];
  let clusterId = -1;
  let clusterMaxEnd = -1;

  for (const { event, window } of windows) {
    if (window.startMinute >= clusterMaxEnd) {
      // New cluster — nothing currently open overlaps this event.
      clusterId += 1;
      columnEnds = [];
      clusterMaxEnd = window.endMinute;
    } else {
      clusterMaxEnd = Math.max(clusterMaxEnd, window.endMinute);
    }
    let column = columnEnds.findIndex((end) => end <= window.startMinute);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(window.endMinute);
    } else {
      columnEnds[column] = window.endMinute;
    }
    working.push({ event, window, column, cluster: clusterId });
  }

  const placed: PlacedEvent[] = [];
  const overflow: OverflowGroup[] = [];
  const byCluster = new Map<number, Working[]>();
  for (const w of working) {
    const list = byCluster.get(w.cluster) ?? [];
    list.push(w);
    byCluster.set(w.cluster, list);
  }

  for (const members of byCluster.values()) {
    const totalColumns = Math.max(...members.map((m) => m.column)) + 1;
    if (totalColumns <= MAX_EVENT_COLUMNS) {
      for (const m of members) {
        placed.push({
          event: m.event,
          startMinute: m.window.startMinute,
          endMinute: m.window.endMinute,
          column: m.column,
          columns: totalColumns,
        });
      }
      continue;
    }
    // Overflowing cluster: first two columns render, the rest collapse.
    const visible = members.filter((m) => m.column < MAX_EVENT_COLUMNS - 1);
    const hidden = members.filter((m) => m.column >= MAX_EVENT_COLUMNS - 1);
    for (const m of visible) {
      placed.push({
        event: m.event,
        startMinute: m.window.startMinute,
        endMinute: m.window.endMinute,
        column: m.column,
        columns: MAX_EVENT_COLUMNS,
      });
    }
    overflow.push({
      startMinute: Math.min(...hidden.map((m) => m.window.startMinute)),
      endMinute: Math.max(...hidden.map((m) => m.window.endMinute)),
      events: hidden.map((m) => m.event),
    });
  }

  placed.sort((a, b) => a.startMinute - b.startMinute || a.column - b.column);
  overflow.sort((a, b) => a.startMinute - b.startMinute);
  return { placed, overflow };
}

// ─── Axis bounds ────────────────────────────────────────────────

/**
 * Calendar viewports span the whole day. Workday bounds are a WORK-capacity
 * input (deck sizing, free-minute math) — they must never clamp what the
 * calendar shows, because the calendar holds a life, not a shift. The
 * scrollable track covers midnight to midnight and `landingTopMinute`
 * decides where the viewport lands.
 */
export const FULL_DAY_BOUNDS: MinuteWindow = { startMinute: 0, endMinute: 1440 };

/** The viewport's morning anchor — a civil 7 AM, not the 9:00 workday
 *  setting (the viewport is a life concept; workday bounds are a deck one). */
const MORNING_ANCHOR = 7 * 60;
/** Show a little runway above an early first event. */
const FIRST_EVENT_PAD = 15;
/** Keep at least this much of the recent past above the now line. */
const PAST_PAD = 30;
/** Today must always show now plus this much future. */
const LOOKAHEAD = 120;

/**
 * The minute that should sit at the TOP of a time surface when it opens.
 * Worked backward from the reading: mornings anchor at 7 AM (or just above
 * an earlier first event) so the day reads from its start; once now + 2h of
 * lookahead no longer fits the visible window, the frame slides down exactly
 * far enough. Guards: now never lands above the frame (early riser), a
 * browsed day whose events all live later frames its first event with an
 * hour of context, and the frame clamps to the day's end.
 *
 * `viewportMinutes` is how much of the day the scroller can show at once —
 * measured from the rendered elements, never a constant.
 */
export function landingTopMinute(opts: {
  days: CalendarDay[];
  today: string;
  now: Date;
  viewportMinutes: number;
}): number {
  const { days, today, now, viewportMinutes } = opts;

  const starts = days.flatMap((d) =>
    d.events
      .map((e) => eventWindowOnDate(e, d.date))
      .filter((w): w is MinuteWindow => w != null)
      .map((w) => w.startMinute),
  );
  const firstEvent = starts.length > 0 ? Math.min(...starts) : null;

  let top =
    firstEvent != null
      ? Math.min(MORNING_ANCHOR, firstEvent - FIRST_EVENT_PAD)
      : MORNING_ANCHOR;

  if (days.some((d) => d.date === today)) {
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    // Slide down just enough to keep now + lookahead in frame...
    top = Math.max(top, nowMinute + LOOKAHEAD - viewportMinutes);
    // ...but never past now itself (keep a little recent past visible).
    top = Math.min(top, Math.max(0, nowMinute - PAST_PAD));
  } else if (firstEvent != null && firstEvent > top + viewportMinutes) {
    // The browsed day happens later (an evening-only day): frame its start.
    top = firstEvent - 60;
  }

  return Math.max(0, Math.min(top, 1440 - viewportMinutes));
}

// ─── Strip segments ─────────────────────────────────────────────

export interface StripSegment {
  /** Percentages across the workday track, clamped to [0, 100]. */
  startPct: number;
  widthPct: number;
  label: string;
  /** Tooltip copy: title plus the unclamped time range. */
  detail: string;
  /** True when the underlying interval spilled past a workday edge. */
  clamped: boolean;
}

/**
 * The compact strip's proportional busy segments over workday bounds.
 * Commitments only — the deck is a stack, not a schedule.
 */
export function stripSegments(
  day: CalendarDay | undefined,
  workday: { start: string; end: string },
): StripSegment[] {
  const wdStart = parseHhMm(workday.start);
  const wdEnd = parseHhMm(workday.end);
  const span = wdEnd - wdStart;
  if (span <= 0 || !day) return [];

  const segments: StripSegment[] = [];
  for (const e of day.events) {
    if (!e.countsAsBusy) continue;
    const w = eventWindowOnDate(e, day.date);
    if (!w) continue;
    const start = Math.max(w.startMinute, wdStart);
    const end = Math.min(w.endMinute, wdEnd);
    if (end <= start) continue;
    segments.push({
      startPct: ((start - wdStart) / span) * 100,
      widthPct: ((end - start) / span) * 100,
      label: e.title,
      detail: `${e.title} · ${minutesToLabel(w.startMinute)} to ${minutesToLabel(w.endMinute)}`,
      clamped: w.startMinute < wdStart || w.endMinute > wdEnd,
    });
  }
  return segments.sort((a, b) => a.startPct - b.startPct);
}
