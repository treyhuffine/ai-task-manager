/**
 * The `google_calendar` toolkit (§14). Clean REST — the proving integration. Scopes are
 * genuinely action-level: `list_calendars` needs `calendar.readonly`; event reads need
 * the narrower `calendar.events.readonly`; writes need `calendar.events`. A connection
 * holding the broader write scope still satisfies the read actions via the provider's
 * `scopeSatisfies` hierarchy (`calendar.events ⊇ calendar.events.readonly`), so precise
 * action scopes don't cause spurious re-consent.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { GOOGLE_SCOPES } from './provider';

const CAL = '/calendar/v3';

interface RawEvent {
  id?: string;
  /** The iCalendar UID: the same on every calendar's copy of a meeting. */
  iCalUID?: string;
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  /** 'transparent' = shows as free; absent/'opaque' = shows as busy. */
  transparency?: string;
  location?: string;
  hangoutLink?: string;
  /** The event's own color, overriding its calendar's: a key into Google's event palette ("1" to "11"). */
  colorId?: string;
  attendees?: Array<{
    email?: string;
    displayName?: string;
    self?: boolean;
    organizer?: boolean;
    resource?: boolean;
    optional?: boolean;
    responseStatus?: string;
  }>;
  attendeesOmitted?: boolean;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  description?: string;
  /** Set on every instance of a recurring series: the series' own event id. */
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
  created?: string;
  eventType?: string;
}

function eventSummary(e: RawEvent) {
  const self = e.attendees?.find((a) => a.self);
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video');
  return {
    id: e.id,
    iCalUID: e.iCalUID,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    status: e.status,
    htmlLink: e.htmlLink,
    transparency: e.transparency,
    location: e.location,
    joinUrl: e.hangoutLink ?? video?.uri,
    colorId: e.colorId,
    /** The user's own RSVP: needsAction | declined | tentative | accepted. */
    responseStatus: self?.responseStatus,
  };
}

const text = (value: string | undefined, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);

/**
 * The full typed event a sync consumer needs: participants, organizer, the
 * recurrence identity of an occurrence, the zone the organizer chose, the
 * provider's update time and cancellation. A cancelled event in an incremental
 * sync carries little more than its id and status, so every field is optional.
 */
export function eventDetail(e: RawEvent) {
  return {
    ...eventSummary(e),
    allDay: !!(e.start?.date && !e.start?.dateTime),
    startTimeZone: text(e.start?.timeZone, 100),
    endTimeZone: text(e.end?.timeZone, 100),
    recurringEventId: text(e.recurringEventId, 1024),
    originalStartTime: e.originalStartTime
      ? {
          dateTime: text(e.originalStartTime.dateTime, 64),
          date: text(e.originalStartTime.date, 32),
          timeZone: text(e.originalStartTime.timeZone, 100),
        }
      : undefined,
    organizer: e.organizer
      ? { email: text(e.organizer.email, 320), displayName: text(e.organizer.displayName, 300), self: !!e.organizer.self }
      : undefined,
    attendees: (e.attendees ?? []).slice(0, 200).map((a) => ({
      email: text(a.email, 320),
      displayName: text(a.displayName, 300),
      self: !!a.self,
      organizer: !!a.organizer,
      resource: !!a.resource,
      optional: !!a.optional,
      responseStatus: text(a.responseStatus, 32),
    })),
    attendeesOmitted: !!e.attendeesOmitted || (e.attendees?.length ?? 0) > 200,
    description: text(e.description, 8000),
    eventType: text(e.eventType, 64),
    updated: text(e.updated, 64),
    created: text(e.created, 64),
    cancelled: e.status === 'cancelled',
  };
}

interface RawCalendar {
  id?: string;
  summary?: string;
  /** The name the user gave a calendar shared with them, shown instead of `summary`. */
  summaryOverride?: string;
  primary?: boolean;
  /** Checked in Google Calendar's sidebar, so its events show. */
  selected?: boolean;
  /** Removed from the sidebar's list altogether. */
  hidden?: boolean;
  /** owner | writer | reader | freeBusyReader */
  accessRole?: string;
  /** The color the user picked for the calendar, as hex. */
  backgroundColor?: string;
  foregroundColor?: string;
}

export const googleCalendar = defineToolkit({
  id: 'google_calendar',
  providerId: 'google',
  displayName: 'Google Calendar',
  // `scopes` (upfront-consent bundle) defaults to the union of the actions' scopes (§3).
  actions: [
    httpAction({
      id: 'google_calendar.list_calendars',
      description: 'List the calendars the user can access.',
      scopes: [GOOGLE_SCOPES.calendarReadonly],
      input: z.object({}),
      request: () => ({ method: 'GET', path: `${CAL}/users/me/calendarList`, query: { maxResults: 250 } }),
      output: (raw) => {
        const r = raw as { items?: RawCalendar[] };
        return {
          calendars: (r.items ?? []).map((c) => ({
            id: c.id,
            summary: c.summaryOverride ?? c.summary,
            primary: !!c.primary,
            selected: !!c.selected,
            hidden: !!c.hidden,
            accessRole: c.accessRole,
            backgroundColor: c.backgroundColor,
            foregroundColor: c.foregroundColor,
          })),
        };
      },
    }),

    httpAction({
      id: 'google_calendar.list_events',
      description: 'List upcoming or recently changed events on a calendar.',
      scopes: [GOOGLE_SCOPES.calendarEventsReadonly],
      input: z.object({
        calendarId: z.string().default('primary'),
        timeMin: z.string().optional().describe('RFC3339 lower bound (e.g. 2026-06-18T00:00:00Z)'),
        timeMax: z.string().optional(),
        maxResults: z.number().int().positive().max(2500).default(25),
        query: z.string().optional().describe('Free-text search over events'),
        pageToken: z.string().max(2000).optional().describe('Continue from a previous nextPageToken'),
      }),
      request: (i) => ({
        method: 'GET',
        path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events`,
        query: {
          timeMin: i.timeMin,
          timeMax: i.timeMax,
          maxResults: i.maxResults,
          q: i.query,
          singleEvents: true,
          orderBy: 'startTime',
          pageToken: i.pageToken,
        },
      }),
      output: (raw) => {
        const r = raw as { items?: RawEvent[]; nextPageToken?: string };
        return { events: (r.items ?? []).map(eventSummary), ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) };
      },
    }),

    httpAction({
      id: 'google_calendar.sync_events',
      description:
        'Read one page of a calendar for synchronization: typed participants, organizer, recurrence identity, original time zones, update times and cancellations. ' +
        'Start with timeMin/timeMax, follow nextPageToken, then pass the final nextSyncToken to receive only later changes. An expired sync token fails with status 410.',
      scopes: [GOOGLE_SCOPES.calendarEventsReadonly],
      input: z
        .object({
          calendarId: z.string().min(1).max(1024).default('primary'),
          syncToken: z.string().max(4000).optional(),
          pageToken: z.string().max(4000).optional(),
          timeMin: z.string().max(64).optional(),
          timeMax: z.string().max(64).optional(),
          maxResults: z.number().int().min(1).max(250).default(100),
        })
        // Google rejects a time window beside a sync token. The token already
        // carries the window of the full sync that produced it, so it wins.
        .strict(),
      request: (i) => ({
        method: 'GET',
        path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events`,
        query: {
          syncToken: i.syncToken,
          pageToken: i.pageToken,
          timeMin: i.syncToken ? undefined : i.timeMin,
          timeMax: i.syncToken ? undefined : i.timeMax,
          maxResults: i.maxResults,
          singleEvents: true,
          showDeleted: true,
        },
      }),
      output: (raw) => {
        const r = z
          .object({
            items: z.array(z.record(z.string(), z.unknown())).max(2500).optional(),
            nextPageToken: z.string().max(4000).optional(),
            nextSyncToken: z.string().max(4000).optional(),
            timeZone: z.string().max(100).optional(),
          })
          .passthrough()
          .parse(raw);
        return {
          events: (r.items ?? []).map((item) => eventDetail(item as RawEvent)),
          calendarTimeZone: r.timeZone,
          ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}),
          ...(r.nextSyncToken ? { nextSyncToken: r.nextSyncToken } : {}),
        };
      },
    }),

    httpAction({
      id: 'google_calendar.get_event',
      description: 'Get a single calendar event by id.',
      scopes: [GOOGLE_SCOPES.calendarEventsReadonly],
      input: z.object({ calendarId: z.string().default('primary'), eventId: z.string() }),
      request: (i) => ({
        method: 'GET',
        path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events/${encodeURIComponent(i.eventId)}`,
      }),
      output: (raw) => eventSummary(raw as RawEvent),
    }),

    httpAction({
      id: 'google_calendar.create_event',
      description: 'Create an event on a calendar.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.calendarEvents],
      input: z.object({
        calendarId: z.string().default('primary'),
        summary: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z.string().describe('RFC3339 start, e.g. 2026-06-20T15:00:00-04:00'),
        end: z.string().describe('RFC3339 end'),
        attendees: z.array(z.string().email()).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events`,
        body: {
          summary: i.summary,
          description: i.description,
          location: i.location,
          start: { dateTime: i.start },
          end: { dateTime: i.end },
          attendees: i.attendees?.map((email) => ({ email })),
        },
      }),
      output: (raw) => eventSummary(raw as RawEvent),
    }),

    httpAction({
      id: 'google_calendar.update_event',
      description: 'Update fields on an existing event.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.calendarEvents],
      input: z.object({
        calendarId: z.string().default('primary'),
        eventId: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      }),
      request: (i) => ({
        method: 'PATCH',
        path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events/${encodeURIComponent(i.eventId)}`,
        body: {
          summary: i.summary,
          description: i.description,
          location: i.location,
          start: i.start ? { dateTime: i.start } : undefined,
          end: i.end ? { dateTime: i.end } : undefined,
        },
      }),
      output: (raw) => eventSummary(raw as RawEvent),
    }),

    httpAction({
      id: 'google_calendar.delete_event',
      description: 'Delete an event from a calendar.',
      mutating: true,
      risk: 'high',
      scopes: [GOOGLE_SCOPES.calendarEvents],
      input: z.object({ calendarId: z.string().default('primary'), eventId: z.string() }),
      request: (i) => ({
        method: 'DELETE',
        path: `${CAL}/calendars/${encodeURIComponent(i.calendarId)}/events/${encodeURIComponent(i.eventId)}`,
      }),
      output: () => ({ deleted: true }),
    }),
  ],
});
