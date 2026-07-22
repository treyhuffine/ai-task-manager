/**
 * The HUD next-boundary button's label state machine. Pure — the component
 * feeds it the cached day shape and the current time, and re-evaluates on a
 * local timer. Copy rules: no em dashes, no semicolons in output strings.
 */
import { formatMinutes, minutesToLabel } from '@/lib/deck/calendar';
import { eventWindowOnDate } from './layout';
import type { CalendarDay, CalendarReadStatus } from './types';

export interface HudState {
  text: string;
  /** 'warning' when the next commitment starts within 10 minutes. */
  tone: 'default' | 'warning';
}

const TITLE_MAX = 24;
const IMMINENT_MINUTES = 10;
const SOON_MINUTES = 90;

function truncate(title: string): string {
  if (title.length <= TITLE_MAX) return title;
  return `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export function hudLabel(
  day: CalendarDay | undefined,
  status: CalendarReadStatus,
  now: Date,
): HudState {
  if (status === 'error') return { text: 'Calendar unreachable', tone: 'default' };
  if (!day) return { text: 'Nothing scheduled today', tone: 'default' };

  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const windows = day.events
    .filter((e) => e.countsAsBusy)
    .map((e) => ({ title: truncate(e.title), window: eventWindowOnDate(e, day.date) }))
    .filter((x): x is { title: string; window: { startMinute: number; endMinute: number } } => x.window != null)
    .sort((a, b) => a.window.startMinute - b.window.startMinute);

  if (windows.length === 0) return { text: 'Nothing scheduled today', tone: 'default' };

  const ongoing = windows.filter(
    (w) => w.window.startMinute <= nowMinute && nowMinute < w.window.endMinute,
  );
  const next = windows.find((w) => w.window.startMinute > nowMinute);

  // The label tracks the NEXT BOUNDARY — the earliest moment anything
  // changes. Overlapping meetings: the soonest END wins, with a marker for
  // the rest. And an upcoming start beats a later ongoing end — a meeting
  // you could miss matters more than when the current one wraps.
  if (ongoing.length > 0) {
    const soonest = ongoing.reduce((min, w) =>
      w.window.endMinute < min.window.endMinute ? w : min,
    );
    if (!next || soonest.window.endMinute <= next.window.startMinute) {
      const more = ongoing.length - 1;
      return {
        text: `${soonest.title} ends ${minutesToLabel(soonest.window.endMinute)}${more > 0 ? ` · +${more} now` : ''}`,
        tone: 'default',
      };
    }
  }
  // Status, not an instruction ('Clear rest of day' read like a command to
  // empty the calendar), and 'scheduled' not 'meetings' — events aren't all
  // meetings.
  if (!next) return { text: 'Nothing else scheduled today', tone: 'default' };

  const minutesUntil = next.window.startMinute - nowMinute;
  if (minutesUntil <= SOON_MINUTES) {
    // Past the hour, raw minutes stop being readable ("in 87m") — formatMinutes
    // renders "1h 27m".
    return {
      text: `${next.title} in ${minutesUntil >= 60 ? formatMinutes(minutesUntil) : `${minutesUntil}m`}`,
      tone: minutesUntil <= IMMINENT_MINUTES ? 'warning' : 'default',
    };
  }
  return { text: `${next.title} at ${minutesToLabel(next.window.startMinute)}`, tone: 'default' };
}
