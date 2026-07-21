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
import type { CalendarEvent, CalendarProviderId } from './types';

/** `google_calendar.list_events` output item (packages/connectors). */
export interface RawGoogleEvent {
  id?: string;
  summary?: string;
  /** ISO datetime for timed events, date-only (YYYY-MM-DD) for all-day. */
  start?: string;
  end?: string;
  status?: string;
  htmlLink?: string;
  transparency?: string;
  location?: string;
  joinUrl?: string;
  responseStatus?: string;
}

/** `outlook_calendar.list_events` output item (packages/connectors). */
export interface RawOutlookEvent {
  id?: string;
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

interface BusyInputs {
  allDay: boolean;
  transparency: CalendarEvent['transparency'];
  rsvp: CalendarEvent['rsvp'];
}

/**
 * Does this event consume work time? All-day events don't (a birthday must
 * not zero out the day), free-transparency events don't (the user marked
 * themselves available), declined events don't (they're not going).
 * Tentative counts busy — an unresolved maybe still owns the time.
 */
export function countsAsBusy({ allDay, transparency, rsvp }: BusyInputs): boolean {
  return !allDay && transparency === 'busy' && rsvp !== 'declined';
}

function build(
  providerId: CalendarProviderId,
  connectionId: string,
  f: {
    id?: string;
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
    title: f.title?.trim() || 'Busy',
    start: f.start,
    end: f.end,
    allDay: f.allDay,
    location: f.location ?? null,
    joinUrl: f.joinUrl ?? null,
    sourceUrl: f.sourceUrl ?? null,
    rsvp: f.rsvp,
    transparency: f.transparency,
    countsAsBusy: countsAsBusy(f),
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

export function normalizeGoogleEvent(e: RawGoogleEvent, connectionId: string): CalendarEvent | null {
  if (!e.start || !e.end) return null;
  if (e.status === 'cancelled') return null;
  return build('google', connectionId, {
    id: e.id,
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

export function normalizeOutlookEvent(e: RawOutlookEvent, connectionId: string): CalendarEvent | null {
  if (!e.start || !e.end) return null;
  if (e.isCancelled) return null;
  return build('microsoft', connectionId, {
    id: e.id,
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
