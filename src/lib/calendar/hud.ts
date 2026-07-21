/**
 * The HUD next-boundary button's label state machine. Pure — the component
 * feeds it the cached day shape and the current time, and re-evaluates on a
 * local timer. Copy rules: no em dashes, no semicolons in output strings.
 */
import { minutesToLabel } from '@/lib/deck/calendar';
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

  const ongoing = windows.find(
    (w) => w.window.startMinute <= nowMinute && nowMinute < w.window.endMinute,
  );
  if (ongoing) {
    return { text: `${ongoing.title} ends ${minutesToLabel(ongoing.window.endMinute)}`, tone: 'default' };
  }

  const next = windows.find((w) => w.window.startMinute > nowMinute);
  // Status, not an instruction ('Clear rest of day' read like a command to
  // empty the calendar), and 'scheduled' not 'meetings' — events aren't all
  // meetings.
  if (!next) return { text: 'Nothing else scheduled today', tone: 'default' };

  const minutesUntil = next.window.startMinute - nowMinute;
  if (minutesUntil <= SOON_MINUTES) {
    return {
      text: `${next.title} in ${minutesUntil}m`,
      tone: minutesUntil <= IMMINENT_MINUTES ? 'warning' : 'default',
    };
  }
  return { text: `${next.title} at ${minutesToLabel(next.window.startMinute)}`, tone: 'default' };
}
