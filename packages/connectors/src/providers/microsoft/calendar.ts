/**
 * The `outlook_calendar` toolkit (Microsoft Graph). Reads need `Calendars.Read`; writes need
 * `Calendars.ReadWrite` (which satisfies the read scope via the provider hierarchy).
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { MICROSOFT_SCOPES } from './provider';

interface RawEvent {
  id?: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  webLink?: string;
}

function eventSummary(e: RawEvent) {
  return {
    id: e.id,
    subject: e.subject,
    start: e.start?.dateTime,
    end: e.end?.dateTime,
    location: e.location?.displayName,
    webLink: e.webLink,
  };
}

export const outlookCalendar = defineToolkit({
  id: 'outlook_calendar',
  providerId: 'microsoft',
  displayName: 'Outlook Calendar',
  actions: [
    httpAction({
      id: 'outlook_calendar.list_events',
      description: 'List events on the connected Outlook calendar.',
      scopes: [MICROSOFT_SCOPES.calendarsRead],
      input: z.object({ top: z.number().int().positive().max(100).default(25) }),
      request: (i) => ({
        method: 'GET',
        path: '/me/events',
        query: { $top: i.top, $select: 'id,subject,start,end,location,webLink', $orderby: 'start/dateTime' },
      }),
      output: (raw) => {
        const r = raw as { value?: RawEvent[] };
        return { events: (r.value ?? []).map(eventSummary) };
      },
    }),

    httpAction({
      id: 'outlook_calendar.create_event',
      description: 'Create an event on the connected Outlook calendar (times in ISO 8601).',
      mutating: true,
      risk: 'medium',
      scopes: [MICROSOFT_SCOPES.calendarsReadWrite],
      input: z.object({
        subject: z.string(),
        start: z.string().describe('ISO 8601 start, e.g. 2026-06-20T15:00:00'),
        end: z.string().describe('ISO 8601 end'),
        timeZone: z.string().default('UTC'),
        location: z.string().optional(),
        body: z.string().optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/me/events',
        body: {
          subject: i.subject,
          start: { dateTime: i.start, timeZone: i.timeZone },
          end: { dateTime: i.end, timeZone: i.timeZone },
          ...(i.location ? { location: { displayName: i.location } } : {}),
          ...(i.body ? { body: { contentType: 'Text', content: i.body } } : {}),
        },
      }),
      output: (raw) => eventSummary(raw as RawEvent),
    }),

    httpAction({
      id: 'outlook_calendar.update_event',
      description: 'Update fields on an existing Outlook event.',
      mutating: true,
      risk: 'medium',
      scopes: [MICROSOFT_SCOPES.calendarsReadWrite],
      input: z.object({
        eventId: z.string(),
        subject: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        timeZone: z.string().default('UTC'),
        location: z.string().optional(),
      }),
      request: (i) => ({
        method: 'PATCH',
        path: `/me/events/${encodeURIComponent(i.eventId)}`,
        body: {
          subject: i.subject,
          ...(i.start ? { start: { dateTime: i.start, timeZone: i.timeZone } } : {}),
          ...(i.end ? { end: { dateTime: i.end, timeZone: i.timeZone } } : {}),
          ...(i.location ? { location: { displayName: i.location } } : {}),
        },
      }),
      output: (raw) => eventSummary(raw as RawEvent),
    }),

    httpAction({
      id: 'outlook_calendar.delete_event',
      description: 'Delete an event from the connected Outlook calendar.',
      mutating: true,
      risk: 'high',
      scopes: [MICROSOFT_SCOPES.calendarsReadWrite],
      input: z.object({ eventId: z.string() }),
      request: (i) => ({ method: 'DELETE', path: `/me/events/${encodeURIComponent(i.eventId)}` }),
      output: () => ({ deleted: true }),
    }),
  ],
});
