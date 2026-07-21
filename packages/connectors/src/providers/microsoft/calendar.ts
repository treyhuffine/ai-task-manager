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
  isAllDay?: boolean;
  /** free | tentative | busy | oof | workingElsewhere | unknown */
  showAs?: string;
  responseStatus?: { response?: string };
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
}

/**
 * Graph returns naive dateTimes in the requested zone (UTC unless a
 * `Prefer: outlook.timezone` header is sent, which we don't). Stamp the zone
 * back on so callers get a real instant.
 */
function toInstant(t?: { dateTime?: string; timeZone?: string }): string | undefined {
  if (!t?.dateTime) return undefined;
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(t.dateTime);
  if (hasOffset || (t.timeZone && t.timeZone !== 'UTC')) return t.dateTime;
  return `${t.dateTime}Z`;
}

function eventSummary(e: RawEvent) {
  return {
    id: e.id,
    subject: e.subject,
    start: toInstant(e.start),
    end: toInstant(e.end),
    location: e.location?.displayName,
    webLink: e.webLink,
    isAllDay: e.isAllDay,
    showAs: e.showAs,
    /** organizer | accepted | declined | tentativelyAccepted | notResponded | none */
    responseStatus: e.responseStatus?.response,
    isCancelled: e.isCancelled,
    joinUrl: e.onlineMeeting?.joinUrl,
  };
}

const EVENT_SELECT =
  'id,subject,start,end,location,webLink,isAllDay,showAs,responseStatus,isCancelled,onlineMeeting,isOnlineMeeting';

export const outlookCalendar = defineToolkit({
  id: 'outlook_calendar',
  providerId: 'microsoft',
  displayName: 'Outlook Calendar',
  actions: [
    httpAction({
      id: 'outlook_calendar.list_events',
      description:
        'List events on the connected Outlook calendar. Pass startDateTime/endDateTime (ISO 8601) ' +
        'to query a window via calendarView, which expands recurring events into instances.',
      scopes: [MICROSOFT_SCOPES.calendarsRead],
      input: z.object({
        top: z.number().int().positive().max(500).default(25),
        startDateTime: z.string().optional().describe('ISO 8601 window start, e.g. 2026-07-20T00:00:00Z'),
        endDateTime: z.string().optional().describe('ISO 8601 window end'),
      }),
      request: (i) =>
        i.startDateTime && i.endDateTime
          ? {
              method: 'GET',
              path: '/me/calendarView',
              query: {
                startDateTime: i.startDateTime,
                endDateTime: i.endDateTime,
                $top: i.top,
                $select: EVENT_SELECT,
                $orderby: 'start/dateTime',
              },
            }
          : {
              method: 'GET',
              path: '/me/events',
              query: { $top: i.top, $select: EVENT_SELECT, $orderby: 'start/dateTime' },
            },
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
