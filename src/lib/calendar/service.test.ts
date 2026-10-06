import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getIntegrationRuntime: vi.fn() }));

vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationOwnerId: () => 'local',
  getIntegrationRuntime: mocks.getIntegrationRuntime,
}));

vi.mock('@/lib/db/queries', () => ({
  getWorkdayBounds: () => ({ workdayStart: '09:00', workdayEnd: '18:00' }),
}));

import { clearCalendarRangeCache, getCalendarRange } from './service';

const DATE = '2026-07-20';

type Outcome = { ok: true; result: unknown } | { ok: false; reason: string; code?: string; message?: string };

function makeRuntime(
  connections: Array<{ id: string; providerId: string }>,
  handlers: Record<string, (input: Record<string, unknown>) => Outcome>,
) {
  // An action a case doesn't handle fails, the way an unreadable calendar list
  // does: the read falls back to the primary calendar, unnamed.
  const runAction = vi.fn<(action: string, input: Record<string, unknown>, ctx?: unknown) => Promise<Outcome>>(
    async (action, input) => handlers[action]?.(input) ?? { ok: false, reason: 'not_handled' },
  );
  const runtime = { listConnections: async () => connections, runAction };
  mocks.getIntegrationRuntime.mockResolvedValue(runtime);
  return { runAction };
}

beforeEach(() => {
  clearCalendarRangeCache();
  mocks.getIntegrationRuntime.mockReset();
});

describe('getCalendarRange', () => {
  it('merges google + outlook connections into one sorted day shape', async () => {
    // Local-naive timestamps so gap math is timezone-independent in CI.
    const { runAction } = makeRuntime(
      [
        { id: 'c1', providerId: 'google' },
        { id: 'c2', providerId: 'microsoft' },
      ],
      {
        'google_calendar.list_events': () => ({
          ok: true,
          result: {
            events: [
              { id: 'g1', summary: 'Late sync', start: `${DATE}T13:00:00`, end: `${DATE}T14:00:00` },
              // Declined: must surface in events but not consume free time.
              {
                id: 'g2',
                summary: 'Skipped',
                start: `${DATE}T15:00:00`,
                end: `${DATE}T16:00:00`,
                responseStatus: 'declined',
              },
            ],
          },
        }),
        'outlook_calendar.list_events': () => ({
          ok: true,
          result: {
            events: [{ id: 'o1', subject: 'Standup', start: `${DATE}T10:00:00`, end: `${DATE}T11:00:00` }],
          },
        }),
      },
    );

    const r = await getCalendarRange({ start: DATE });
    expect(r.status).toBe('ok');
    expect(r.providers).toEqual([
      { providerId: 'google', connectionId: 'c1', ok: true },
      { providerId: 'microsoft', connectionId: 'c2', ok: true },
    ]);
    expect(r.days).toHaveLength(1);

    const day = r.days[0];
    expect(day.events.map((e) => e.id)).toEqual(['o1', 'g1', 'g2']); // sorted by start
    // 9-18 workday = 540m, minus Standup (60) and Late sync (60). Declined g2 is free.
    expect(day.freeMinutes).toBe(420);
    expect(day.busyMinutes).toBe(120);
    expect(day.largestGapMinutes).toBe(240); // 14:00 → 18:00
    expect(day.events.find((e) => e.id === 'g2')?.countsAsBusy).toBe(false);

    // Outlook fetch went through the ranged calendarView params.
    const outlookCall = runAction.mock.calls.find(([a]) => a === 'outlook_calendar.list_events');
    expect(outlookCall?.[1]).toMatchObject({ startDateTime: expect.any(String), endDateTime: expect.any(String) });
  });

  it('spans multiple days and assigns events to the right day', async () => {
    makeRuntime([{ id: 'c1', providerId: 'google' }], {
      'google_calendar.list_events': () => ({
        ok: true,
        result: {
          events: [
            { id: 'd1', summary: 'Mon', start: `${DATE}T09:00:00`, end: `${DATE}T10:00:00` },
            { id: 'd2', summary: 'Tue', start: '2026-07-21T09:00:00', end: '2026-07-21T10:00:00' },
          ],
        },
      }),
    });
    const r = await getCalendarRange({ start: DATE, days: 2 });
    expect(r.days.map((d) => d.date)).toEqual([DATE, '2026-07-21']);
    expect(r.days[0].events.map((e) => e.id)).toEqual(['d1']);
    expect(r.days[1].events.map((e) => e.id)).toEqual(['d2']);
  });

  it('no connections → no_providers with fully open days', async () => {
    makeRuntime([], {});
    const r = await getCalendarRange({ start: DATE });
    expect(r.status).toBe('no_providers');
    expect(r.providers).toEqual([]);
    expect(r.days[0].freeMinutes).toBe(540);
    expect(r.days[0].events).toEqual([]);
  });

  it('one of two connections failing → degraded, with per-provider detail', async () => {
    makeRuntime(
      [
        { id: 'c1', providerId: 'google' },
        { id: 'c2', providerId: 'microsoft' },
      ],
      {
        'google_calendar.list_events': () => ({
          ok: true,
          result: { events: [{ id: 'g1', summary: 'Sync', start: `${DATE}T10:00:00`, end: `${DATE}T11:00:00` }] },
        }),
        'outlook_calendar.list_events': () => ({
          ok: false,
          reason: 'error',
          code: 'token_expired',
          message: 'refresh failed',
        }),
      },
    );
    const r = await getCalendarRange({ start: DATE });
    expect(r.status).toBe('degraded');
    expect(r.providers[1]).toEqual({
      providerId: 'microsoft',
      connectionId: 'c2',
      ok: false,
      detail: 'token_expired: refresh failed',
    });
    // The surviving provider's data still comes through — never a silently thin day.
    expect(r.days[0].events).toHaveLength(1);
    expect(r.days[0].freeMinutes).toBe(480);
  });

  it('every connection failing → error', async () => {
    makeRuntime([{ id: 'c1', providerId: 'google' }], {
      'google_calendar.list_events': () => ({ ok: false, reason: 'needs_consent' }),
    });
    const r = await getCalendarRange({ start: DATE });
    expect(r.status).toBe('error');
    expect(r.providers[0]).toMatchObject({ ok: false, detail: 'needs_consent' });
  });

  it('runtime unavailable → error, not a fake open day marked ok', async () => {
    mocks.getIntegrationRuntime.mockRejectedValue(new Error('boom'));
    const r = await getCalendarRange({ start: DATE });
    expect(r.status).toBe('error');
    expect(r.providers).toEqual([]);
  });

  it('caches per range for the TTL, fresh bypasses', async () => {
    const { runAction } = makeRuntime([{ id: 'c1', providerId: 'google' }], {
      'google_calendar.list_events': () => ({ ok: true, result: { events: [] } }),
    });
    const eventReads = () => runAction.mock.calls.filter(([a]) => a === 'google_calendar.list_events').length;

    await getCalendarRange({ start: DATE });
    await getCalendarRange({ start: DATE });
    expect(eventReads()).toBe(1); // second call served from cache

    await getCalendarRange({ start: DATE, days: 7 });
    expect(eventReads()).toBe(2); // different key

    await getCalendarRange({ start: DATE, fresh: true });
    expect(eventReads()).toBe(3); // fresh bypass
    // Which calendars the connection has is asked once, not per range.
    expect(runAction.mock.calls.filter(([a]) => a === 'google_calendar.list_calendars')).toHaveLength(1);
  });
});

describe('calendars and copies', () => {
  const ev = (id: string, uid: string, hour: number, extra: Record<string, unknown> = {}) => ({
    id,
    iCalUID: uid,
    summary: id,
    start: `${DATE}T${String(hour).padStart(2, '0')}:00:00`,
    end: `${DATE}T${String(hour + 1).padStart(2, '0')}:00:00`,
    ...extra,
  });

  it('reads every calendar checked in Google, named and colored, and only your own take your time', async () => {
    const { runAction } = makeRuntime([{ id: 'c1', providerId: 'google' }], {
      'google_calendar.list_calendars': () => ({
        ok: true,
        result: {
          calendars: [
            { id: 'me@x.com', summary: 'me@x.com', primary: true, selected: true, accessRole: 'owner', backgroundColor: '#9FC6E7' },
            { id: 'gym@group', summary: 'Gym', selected: true, accessRole: 'owner', backgroundColor: '#7bd148' },
            { id: 'team@group', summary: 'Team', selected: true, accessRole: 'reader', backgroundColor: '#f83a22' },
            { id: 'off@group', summary: 'Unchecked', selected: false, accessRole: 'owner' },
            { id: 'gone@group', summary: 'Hidden', selected: true, hidden: true, accessRole: 'owner' },
          ],
        },
      }),
      'google_calendar.list_events': (input) => ({
        ok: true,
        result: {
          events: {
            'me@x.com': [ev('standup', 'u1', 10, { colorId: '11' })],
            'gym@group': [ev('lift', 'u2', 12)],
            'team@group': [ev('their-offsite', 'u3', 14)],
          }[input.calendarId as string] ?? [],
        },
      }),
    });

    const r = await getCalendarRange({ start: DATE });
    const read = runAction.mock.calls.filter(([a]) => a === 'google_calendar.list_events').map(([, i]) => i.calendarId);
    expect(read).toEqual(['me@x.com', 'gym@group', 'team@group']);

    const byId = new Map(r.days[0].events.map((e) => [e.id, e]));
    // An event's own color wins over its calendar's (Tomato), else the calendar's, as hex.
    expect(byId.get('standup')).toMatchObject({ color: '#d50000', calendar: { name: 'me@x.com', primary: true, owned: true } });
    expect(byId.get('lift')).toMatchObject({ color: '#7bd148', countsAsBusy: true, calendar: { name: 'Gym', owned: true } });
    // A calendar shared with you shows, but doesn't take your time.
    expect(byId.get('their-offsite')).toMatchObject({ color: '#f83a22', countsAsBusy: false, calendar: { owned: false } });
    expect(r.days[0].freeMinutes).toBe(540 - 120);
  });

  it('reads a calendar two accounts share once, and merges a meeting on both into one event', async () => {
    const { runAction } = makeRuntime(
      [
        { id: 'personal', providerId: 'google' },
        { id: 'work', providerId: 'google' },
      ],
      {},
    );
    // The work calendar is shared with the personal account (as a reader), and owned by the work account.
    const lists: Record<string, unknown[]> = {
      personal: [
        { id: 'me@gmail.com', summary: 'Personal', primary: true, selected: true, accessRole: 'owner' },
        { id: 'me@work.com', summary: 'Work (shared)', selected: true, accessRole: 'reader' },
      ],
      work: [{ id: 'me@work.com', summary: 'Work', primary: true, selected: true, accessRole: 'owner' }],
    };
    runAction.mockImplementation(async (action: string, input: Record<string, unknown>, ctx?: unknown) => {
      const conn = (ctx as { connectionId: string }).connectionId;
      if (action === 'google_calendar.list_calendars') return { ok: true, result: { calendars: lists[conn] } };
      const events = {
        'me@gmail.com': [ev('dinner', 'u-dinner', 18), ev('invite-personal', 'u-sync', 15, { responseStatus: 'needsAction' })],
        'me@work.com': [ev('invite-work', 'u-sync', 15, { responseStatus: 'accepted' }), ev('planning', 'u-plan', 9)],
      }[input.calendarId as string];
      return { ok: true, result: { events: events ?? [] } };
    });

    const r = await getCalendarRange({ start: DATE });
    const reads = runAction.mock.calls
      .filter(([a]) => a === 'google_calendar.list_events')
      .map(([, i, ctx]) => `${(ctx as { connectionId: string }).connectionId}:${i.calendarId}`);
    // The shared work calendar is read once, through the account that owns it.
    expect(reads.sort()).toEqual(['personal:me@gmail.com', 'work:me@work.com']);

    const events = r.days[0].events;
    expect(events.map((e) => e.id)).toEqual(['planning', 'invite-work', 'dinner']);
    // Invited at both addresses: one event, the accepted copy, naming the other calendar.
    expect(events[1]).toMatchObject({ rsvp: 'accepted', calendar: { name: 'Work' }, alsoOn: ['Personal'] });
    expect(r.providers.every((p) => p.ok)).toBe(true);
  });

  it('a shared calendar failing is named, but only your own calendars failing marks the account down', async () => {
    makeRuntime([{ id: 'c1', providerId: 'google' }], {
      'google_calendar.list_calendars': () => ({
        ok: true,
        result: {
          calendars: [
            { id: 'me@x.com', summary: 'Me', primary: true, selected: true, accessRole: 'owner' },
            { id: 'holidays', summary: 'Holidays', selected: true, accessRole: 'reader' },
          ],
        },
      }),
      'google_calendar.list_events': (input) =>
        input.calendarId === 'holidays'
          ? { ok: false, reason: 'error', code: 'forbidden', message: 'no access' }
          : { ok: true, result: { events: [ev('focus', 'u1', 10)] } },
    });
    const r = await getCalendarRange({ start: DATE });
    expect(r.status).toBe('ok');
    expect(r.providers[0]).toEqual({ providerId: 'google', connectionId: 'c1', ok: true, detail: 'Holidays: forbidden: no access' });
    expect(r.days[0].events).toHaveLength(1);
  });

  it('names and colors the Outlook default calendar', async () => {
    makeRuntime([{ id: 'o1', providerId: 'microsoft' }], {
      'outlook_calendar.list_calendars': () => ({
        ok: true,
        result: {
          calendars: [
            { id: 'cal-b', name: 'Birthdays', isDefault: false },
            { id: 'cal-a', name: 'Calendar', hexColor: '#E3008C', isDefault: true },
          ],
        },
      }),
      'outlook_calendar.list_events': () => ({
        ok: true,
        result: { events: [{ id: 'o1', iCalUId: 'u1', subject: 'Review', start: `${DATE}T10:00:00`, end: `${DATE}T11:00:00` }] },
      }),
    });
    const r = await getCalendarRange({ start: DATE });
    expect(r.days[0].events[0]).toMatchObject({
      uid: 'u1',
      color: '#e3008c',
      calendar: { id: 'cal-a', name: 'Calendar', primary: true, owned: true },
      countsAsBusy: true,
    });
  });
});
