/**
 * Pure normalization: provider event payloads → `CalendarEvent`, plus the
 * `countsAsBusy` derivation the whole day-shape pipeline hangs on.
 *
 * Cancelled events are dropped at normalization (they render nowhere).
 * Everything else survives normalization — declined and free-transparency
 * events still reach the UI (rendered dimmed) but are excluded from busy
 * math by `countsAsBusy`. Client-safe: no runtime imports.
 */
import type { CalendarBlock } from '@/lib/db/schema';
import type { CalendarEvent, CalendarProviderId, CalendarSource } from './types';

/** `google_calendar.list_events` output item (packages/integrations). */
export interface RawGoogleEvent {
  id?: string;
  iCalUID?: string;
  summary?: string;
  /** ISO datetime for timed events, date-only (YYYY-MM-DD) for all-day. */
  start?: string;
  end?: string;
  status?: string;
  htmlLink?: string;
  transparency?: string;
  location?: string;
  joinUrl?: string;
  /** Google's event palette key, "1" to "11" (`GOOGLE_EVENT_COLORS`). */
  colorId?: string;
  responseStatus?: string;
}

/** `outlook_calendar.list_events` output item (packages/integrations). */
export interface RawOutlookEvent {
  id?: string;
  iCalUId?: string;
  subject?: string;
  start?: string;
  end?: string;
  location?: string;
  webLink?: string;
  isAllDay?: boolean;
  showAs?: string;
  responseStatus?: string;
  isCancelled?: boolean;
  joinUrl?: string;
}

const isDateOnly = (v: string) => !v.includes('T');

/**
 * Google's event colors, as Google Calendar shows them today (the API's own
 * `colors` endpoint still answers with an older, paler set): Lavender, Sage,
 * Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil,
 * Tomato.
 */
export const GOOGLE_EVENT_COLORS: Readonly<Record<string, string>> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A hex color as the provider gave it, or null for anything else. */
export function hexColor(value: string | null | undefined): string | null {
  return value && HEX.test(value) ? value.toLowerCase() : null;
}

/**
 * Whether a calendar's events can take your time: your main calendar and
 * calendars you own do, calendars shared with you (a colleague's, a family
 * calendar, a holiday feed) only show. No calendar named counts, as the
 * primary-only read always did.
 */
export function calendarCountsTime(calendar: CalendarSource | null): boolean {
  return !calendar || calendar.primary || calendar.owned;
}

interface BusyInputs {
  allDay: boolean;
  transparency: CalendarEvent['transparency'];
  rsvp: CalendarEvent['rsvp'];
  calendar?: CalendarSource | null;
}

/**
 * Does this event consume work time? All-day events don't (a birthday must
 * not zero out the day), free-transparency events don't (the user marked
 * themselves available), declined events don't (they're not going), and
 * events on a calendar that isn't yours don't. Tentative counts busy — an
 * unresolved maybe still owns the time.
 */
export function countsAsBusy({ allDay, transparency, rsvp, calendar = null }: BusyInputs): boolean {
  return !allDay && transparency === 'busy' && rsvp !== 'declined' && calendarCountsTime(calendar);
}

function build(
  providerId: CalendarProviderId,
  connectionId: string,
  calendar: CalendarSource | null,
  f: {
    id?: string;
    uid?: string;
    /** The event's own color, overriding its calendar's. */
    color?: string | null;
    title?: string;
    start: string;
    end: string;
    allDay: boolean;
    location?: string | null;
    joinUrl?: string | null;
    sourceUrl?: string | null;
    transparency: CalendarEvent['transparency'];
    rsvp: CalendarEvent['rsvp'];
  },
): CalendarEvent {
  return {
    id: f.id ?? `${providerId}:${f.start}:${f.title ?? ''}`,
    providerId,
    connectionId,
    uid: f.uid || null,
    calendar,
    color: f.color ?? calendar?.color ?? null,
    alsoOn: [],
    title: f.title?.trim() || 'Busy',
    start: f.start,
    end: f.end,
    allDay: f.allDay,
    location: f.location ?? null,
    joinUrl: f.joinUrl ?? null,
    sourceUrl: f.sourceUrl ?? null,
    rsvp: f.rsvp,
    transparency: f.transparency,
    countsAsBusy: countsAsBusy({ ...f, calendar }),
  };
}

function googleRsvp(r?: string): CalendarEvent['rsvp'] {
  switch (r) {
    case 'accepted':
    case 'declined':
    case 'tentative':
      return r;
    case 'needsAction':
      return 'needs_action';
    default:
      return null;
  }
}

export function normalizeGoogleEvent(
  e: RawGoogleEvent,
  connectionId: string,
  calendar: CalendarSource | null = null,
): CalendarEvent | null {
  if (!e.start || !e.end) return null;
  if (e.status === 'cancelled') return null;
  return build('google', connectionId, calendar, {
    id: e.id,
    uid: e.iCalUID,
    color: e.colorId ? (GOOGLE_EVENT_COLORS[e.colorId] ?? null) : null,
    title: e.summary,
    start: e.start,
    end: e.end,
    allDay: isDateOnly(e.start),
    location: e.location,
    joinUrl: e.joinUrl,
    sourceUrl: e.htmlLink,
    transparency: e.transparency === 'transparent' ? 'free' : 'busy',
    rsvp: googleRsvp(e.responseStatus),
  });
}

function outlookRsvp(r?: string): CalendarEvent['rsvp'] {
  switch (r) {
    case 'organizer':
    case 'accepted':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'tentativelyAccepted':
      return 'tentative';
    case 'notResponded':
    case 'none':
      return 'needs_action';
    default:
      return null;
  }
}

export function normalizeOutlookEvent(
  e: RawOutlookEvent,
  connectionId: string,
  calendar: CalendarSource | null = null,
): CalendarEvent | null {
  if (!e.start || !e.end) return null;
  if (e.isCancelled) return null;
  return build('microsoft', connectionId, calendar, {
    id: e.id,
    uid: e.iCalUId,
    title: e.subject,
    start: e.start,
    end: e.end,
    allDay: !!e.isAllDay || isDateOnly(e.start),
    location: e.location,
    joinUrl: e.joinUrl,
    sourceUrl: e.webLink,
    transparency: e.showAs === 'free' || e.showAs === 'workingElsewhere' ? 'free' : 'busy',
    rsvp: outlookRsvp(e.responseStatus),
  });
}

const RSVP_RANK: Record<string, number> = { accepted: 0, tentative: 1, needs_action: 2, declined: 4 };

/** Which copy of a meeting speaks for it: yours before shared, primary first, the RSVP you kept. */
function copyRank(e: CalendarEvent): [number, number, number] {
  return [calendarCountsTime(e.calendar) ? 0 : 1, e.calendar?.primary ? 0 : 1, e.rsvp ? (RSVP_RANK[e.rsvp] ?? 3) : 3];
}

function rankBefore(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/**
 * One event per meeting (docs/calendar-view-spec.md, "Calendars and colors").
 * The same meeting reaches Ri more than once when a calendar is shared with
 * another of your accounts, or you're invited at two addresses. Copies share
 * an iCalendar UID and a start, so they merge into the copy that speaks for
 * the meeting (`copyRank`), naming the other calendars in `alsoOn`. Done on
 * every read and never stored, so the result always follows what's connected
 * and checked right now. Events without a UID are left as they are.
 */
export function mergeCopies(events: readonly CalendarEvent[]): CalendarEvent[] {
  const groups = new Map<string, CalendarEvent[]>();
  const out: Array<CalendarEvent | string> = [];
  for (const e of events) {
    const key = e.uid ? `${e.uid}|${e.allDay ? e.start : Date.parse(e.start)}` : null;
    if (!key) {
      out.push(e);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(e);
    else {
      groups.set(key, [e]);
      out.push(key);
    }
  }
  return out.map((item) => {
    if (typeof item !== 'string') return item;
    const copies = groups.get(item)!;
    if (copies.length === 1) return copies[0]!;
    let best = copies[0]!;
    for (const c of copies.slice(1)) if (rankBefore(copyRank(c), copyRank(best))) best = c;
    const alsoOn = [
      ...new Set(copies.filter((c) => c !== best).map((c) => c.calendar?.name).filter((n): n is string => !!n && n !== best.calendar?.name)),
    ];
    return { ...best, alsoOn };
  });
}

/** The planning-layer projection the deck seam consumes. */
export function eventToBlock(e: CalendarEvent): CalendarBlock {
  return { start: e.start, end: e.end, title: e.title, source: e.providerId };
}

/**
 * Does the event overlap the local day [00:00, next 00:00)? All-day events
 * use exclusive date ends (a one-day event on the 20th ends "on" the 21st and
 * must not appear on the 21st).
 */
export function eventOverlapsDay(e: CalendarEvent, date: string): boolean {
  const dayStart = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) return false;
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const s = new Date(isDateOnly(e.start) ? `${e.start}T00:00:00` : e.start);
  const en = new Date(isDateOnly(e.end) ? `${e.end}T00:00:00` : e.end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) return false;
  return en > dayStart && s < dayEnd;
}
