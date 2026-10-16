import { describe, it, expect } from 'vitest';
import { makeHarness } from './_harness';

const meeting = {
  id: 'evt_1_20261016T160000Z', iCalUID: 'evt_1@google.com', status: 'confirmed', summary: 'Portfolio discussion',
  start: { dateTime: '2026-10-16T10:00:00-06:00', timeZone: 'America/Denver' }, end: { dateTime: '2026-10-16T11:00:00-06:00', timeZone: 'America/Denver' },
  recurringEventId: 'evt_1', originalStartTime: { dateTime: '2026-10-16T10:00:00-06:00', timeZone: 'America/Denver' },
  organizer: { email: 'maya@northstar.example', displayName: 'Maya Chen' },
  attendees: [
    { email: 'owner@example.test', self: true, responseStatus: 'accepted' },
    { email: 'maya@northstar.example', displayName: 'Maya Chen', organizer: true, responseStatus: 'accepted' },
    { email: 'room-4@resource.calendar.google.com', resource: true, responseStatus: 'accepted' },
  ],
  updated: '2026-10-14T18:22:00.000Z', created: '2026-10-08T15:00:00.000Z', description: 'Join: https://meet.example/abc',
};

describe('google_calendar.sync_events', () => {
  it('returns typed participants, recurrence identity, original zones, cancellations and both cursors', async () => {
    const h = makeHarness(); await h.connect(); const urls: string[] = [];
    h.env.action = (call) => {
      urls.push(call.url);
      const url = new URL(call.url);
      if (!url.searchParams.get('pageToken'))
        return { json: { timeZone: 'America/Denver', nextPageToken: 'page-2', items: [meeting] } };
      return { json: { nextSyncToken: 'sync-1', items: [{ id: 'evt_2', status: 'cancelled' }] } };
    };
    const first = await h.runtime.runAction('google_calendar.sync_events', { calendarId: 'primary', timeMin: '2026-07-17T00:00:00Z', timeMax: '2027-04-13T00:00:00Z' });
    expect(first).toMatchObject({ ok: true, result: {
      calendarTimeZone: 'America/Denver', nextPageToken: 'page-2',
      events: [{
        id: meeting.id, iCalUID: meeting.iCalUID, start: '2026-10-16T10:00:00-06:00', startTimeZone: 'America/Denver', allDay: false,
        recurringEventId: 'evt_1', originalStartTime: { timeZone: 'America/Denver' }, organizer: { email: 'maya@northstar.example', self: false },
        attendees: [{ self: true }, { organizer: true, displayName: 'Maya Chen' }, { resource: true }], updated: meeting.updated, cancelled: false,
      }],
    } });
    const query = new URL(urls[0]!).searchParams;
    expect(query.get('showDeleted')).toBe('true');
    expect(query.get('singleEvents')).toBe('true');
    expect(query.get('timeMin')).toBe('2026-07-17T00:00:00Z');
    const second = await h.runtime.runAction('google_calendar.sync_events', { calendarId: 'primary', pageToken: 'page-2' });
    expect(second).toMatchObject({ ok: true, result: { nextSyncToken: 'sync-1', events: [{ id: 'evt_2', cancelled: true, attendees: [] }] } });
  });

  it('sends a sync token without a time window and reports an expired token as a 410', async () => {
    const h = makeHarness(); await h.connect(); const urls: string[] = [];
    h.env.action = (call) => { urls.push(call.url); return { json: { nextSyncToken: 'sync-2', items: [] } }; };
    expect(await h.runtime.runAction('google_calendar.sync_events', { syncToken: 'sync-1', timeMin: '2026-01-01T00:00:00Z' })).toMatchObject({ ok: true, result: { nextSyncToken: 'sync-2' } });
    expect(new URL(urls[0]!).searchParams.get('syncToken')).toBe('sync-1');
    expect(new URL(urls[0]!).searchParams.has('timeMin')).toBe(false);
    h.env.action = () => ({ status: 410, json: { error: { message: 'Sync token is no longer valid' } } });
    expect(await h.runtime.runAction('google_calendar.sync_events', { syncToken: 'expired' })).toMatchObject({ ok: false, reason: 'error', status: 410 });
  });

  it('keeps list_events summaries unchanged while adding pagination', async () => {
    const h = makeHarness(); await h.connect(); const urls: string[] = [];
    h.env.action = (call) => { urls.push(call.url); return { json: { nextPageToken: 'next', items: [meeting] } }; };
    const out = await h.runtime.runAction('google_calendar.list_events', { calendarId: 'primary', pageToken: 'p1' });
    expect(new URL(urls[0]!).searchParams.get('pageToken')).toBe('p1');
    expect(out).toMatchObject({ ok: true, result: { nextPageToken: 'next' } });
    const event = (out as { result: { events: Record<string, unknown>[] } }).result.events[0]!;
    expect(Object.keys(event).sort()).toEqual(['colorId', 'end', 'htmlLink', 'iCalUID', 'id', 'joinUrl', 'location', 'responseStatus', 'start', 'status', 'summary', 'transparency'].sort());
  });
});
