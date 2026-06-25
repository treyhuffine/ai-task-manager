/**
 * The `google_calendar` toolkit (§14). Clean REST — the proving connector. Scopes are
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
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

function eventSummary(e: RawEvent) {
  return {
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    status: e.status,
    htmlLink: e.htmlLink,
  };
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
      request: () => ({ method: 'GET', path: `${CAL}/users/me/calendarList` }),
      output: (raw) => {
        const r = raw as { items?: Array<{ id?: string; summary?: string; primary?: boolean }> };
        return { calendars: (r.items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary })) };
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
        },
      }),
      output: (raw) => {
        const r = raw as { items?: RawEvent[] };
        return { events: (r.items ?? []).map(eventSummary) };
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
