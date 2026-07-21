import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getConnectorRuntime: vi.fn() }));

vi.mock('@/lib/connectors/runtime', () => ({
  getConnectorOwnerId: () => 'local',
  getConnectorRuntime: mocks.getConnectorRuntime,
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
  const runAction = vi.fn(async (action: string, input: Record<string, unknown>) => handlers[action](input));
  const runtime = { listConnections: async () => connections, runAction };
  mocks.getConnectorRuntime.mockResolvedValue(runtime);
  return { runAction };
}

beforeEach(() => {
  clearCalendarRangeCache();
  mocks.getConnectorRuntime.mockReset();
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
    mocks.getConnectorRuntime.mockRejectedValue(new Error('boom'));
    const r = await getCalendarRange({ start: DATE });
    expect(r.status).toBe('error');
    expect(r.providers).toEqual([]);
  });

  it('caches per range for the TTL, fresh bypasses', async () => {
    const { runAction } = makeRuntime([{ id: 'c1', providerId: 'google' }], {
      'google_calendar.list_events': () => ({ ok: true, result: { events: [] } }),
    });

    await getCalendarRange({ start: DATE });
    await getCalendarRange({ start: DATE });
    expect(runAction).toHaveBeenCalledTimes(1); // second call served from cache

    await getCalendarRange({ start: DATE, days: 7 });
    expect(runAction).toHaveBeenCalledTimes(2); // different key

    await getCalendarRange({ start: DATE, fresh: true });
    expect(runAction).toHaveBeenCalledTimes(3); // fresh bypass
  });
});
