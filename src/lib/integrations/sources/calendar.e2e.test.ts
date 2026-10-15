/**
 * A Google Calendar connected through Composio feeds Ri's Calendar view, `get_day_shape` and the
 * deck (docs/connector-service-spec.md §4 "Calendar view and deck"), through the shared calendar
 * service, against the fake Composio API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMock = vi.hoisted(() => ({
  runtime: null as null | { listConnections: () => Promise<unknown[]>; runAction: (...args: unknown[]) => Promise<unknown> },
  store: null as unknown,
}));

vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationOwnerId: () => 'local',
  getIntegrationRuntime: async () => runtimeMock.runtime,
  getIntegrationConnectionStore: () => runtimeMock.store,
}));

vi.mock('@/lib/db/queries', () => ({
  getWorkdayBounds: () => ({ workdayStart: '09:00', workdayEnd: '18:00' }),
}));

import { clearCalendarRangeCache, getCalendarRange } from '@/lib/calendar/service';
import { setCalendarProvider, readCalendarDay } from '@/lib/deck/calendar';
import { ensureCalendarProvider } from '@/lib/deck/calendar-integration';
import { getAttempt } from './attempts';
import * as service from './service';
import { createSourcesHarness, FAKE_KEY, type SourcesHarness } from './testing';
import { updatePreferences } from './preferences';

const DATE = '2026-07-20';
let h: SourcesHarness;

beforeEach(() => {
  h = createSourcesHarness();
  runtimeMock.store = h.store;
  // No direct connections unless a case adds them.
  runtimeMock.runtime = { listConnections: async () => [], runAction: async () => ({ ok: false, reason: 'not_handled' }) };
  clearCalendarRangeCache();
  setCalendarProvider(null);
});
afterEach(() => { h.cleanup(); setCalendarProvider(null); });

async function connectCalendar(email: string) {
  await service.addComposioSource({ apiKey: FAKE_KEY }).catch(() => {});
  const begun = await service.beginManagedConnect(null, { applicationId: 'google_calendar' });
  const attempt = getAttempt(begun.attemptId)!;
  h.fake.completeLink(attempt.remoteAccountId, email);
  const done = await service.completeManagedAttempt(begun.attemptId, { via: 'callback' });
  if (done.status !== 'completed') throw new Error(JSON.stringify(done));
  return done.connectionId;
}

function seedCalendar(events: Array<Record<string, unknown>>, opts: { pages?: boolean } = {}) {
  h.fake.state.results.set('GOOGLECALENDAR_LIST_CALENDARS', (_args, account) => ({
    items: [{ id: account.email, summary: account.email, primary: true, selected: true, accessRole: 'owner', backgroundColor: '#123456' }],
  }));
  h.fake.state.results.set('GOOGLECALENDAR_EVENTS_LIST', args => (opts.pages && !args.pageToken
    ? { items: events.slice(0, 1), nextPageToken: 'p2' }
    : { items: opts.pages ? events.slice(1) : events }));
}

const meeting = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, iCalUID: `${id}@google.com`, summary: id, start: { dateTime: start }, end: { dateTime: end }, status: 'confirmed', ...extra,
});

describe('managed Google Calendar in Ri\'s calendar', () => {
  it('reads a calendar the user lets Ri show, at the pinned version, through the exact account', async () => {
    const connectionId = await connectCalendar('work@example.com');
    seedCalendar([meeting('standup', `${DATE}T15:00:00Z`, `${DATE}T15:30:00Z`), meeting('lunch', `${DATE}T18:00:00Z`, `${DATE}T19:00:00Z`, { transparency: 'transparent' })]);
    const range = await getCalendarRange({ start: DATE, days: 1, fresh: true });
    expect(range.status).toBe('ok');
    expect(range.providers).toEqual([expect.objectContaining({ connectionId, ok: true, via: 'Composio', providerId: 'google' })]);
    const titles = range.days[0]!.events.map(e => e.title);
    expect(titles).toEqual(['standup', 'lunch']);
    expect(range.days[0]!.events.find(e => e.title === 'lunch')!.countsAsBusy).toBe(false);
    const reads = h.fake.state.executions.filter(e => e.slug.startsWith('GOOGLECALENDAR_') && e.slug !== 'GOOGLECALENDAR_GET_CALENDAR');
    expect(reads.every(e => e.via === 'pinned' && e.version === '20261010_00')).toBe(true);
    expect(reads.find(e => e.slug === 'GOOGLECALENDAR_EVENTS_LIST')!.args).toMatchObject({ singleEvents: true, calendarId: 'work@example.com' });
  });

  it('reads nothing once the user turns Calendar use off, independently of agent access', async () => {
    const connectionId = await connectCalendar('work@example.com');
    seedCalendar([meeting('standup', `${DATE}T15:00:00Z`, `${DATE}T15:30:00Z`)]);
    await service.setCalendarUse(connectionId, false);
    const range = await getCalendarRange({ start: DATE, days: 1, fresh: true });
    expect(range.status).toBe('no_providers');
  });

  it('follows every page', async () => {
    await connectCalendar('work@example.com');
    seedCalendar([meeting('a', `${DATE}T15:00:00Z`, `${DATE}T15:30:00Z`), meeting('b', `${DATE}T16:00:00Z`, `${DATE}T16:30:00Z`)], { pages: true });
    const range = await getCalendarRange({ start: DATE, days: 1, fresh: true });
    expect(range.days[0]!.events.map(e => e.title)).toEqual(['a', 'b']);
    expect(range.days[0]!.complete).toBe(true);
  });

  it('merges a meeting that also arrives through a direct Google connection', async () => {
    await connectCalendar('work@example.com');
    seedCalendar([meeting('sync', `${DATE}T15:00:00Z`, `${DATE}T16:00:00Z`)]);
    runtimeMock.runtime = {
      listConnections: async () => [{ id: 'direct-google', providerId: 'google' }],
      runAction: async (action: unknown) => action === 'google_calendar.list_calendars'
        ? { ok: true, result: { calendars: [{ id: 'me@example.com', summary: 'Me', primary: true, selected: true, accessRole: 'owner' }] } }
        : { ok: true, result: { events: [{ id: 'sync-copy', iCalUID: 'sync@google.com', summary: 'sync', start: `${DATE}T15:00:00Z`, end: `${DATE}T16:00:00Z` }] } },
    };
    const range = await getCalendarRange({ start: DATE, days: 1, fresh: true });
    expect(range.days[0]!.events).toHaveLength(1);
    expect(range.days[0]!.busyMinutes).toBe(60);
  });

  it('an unreadable response is a failed read, never an empty calendar, and the deck says so', async () => {
    await connectCalendar('work@example.com');
    seedCalendar([]);
    h.fake.state.results.set('GOOGLECALENDAR_EVENTS_LIST', () => ({ something: 'else' }));
    const range = await getCalendarRange({ start: DATE, days: 1, fresh: true });
    expect(range.status).toBe('error');
    expect(range.days[0]!.complete).toBe(false);
    ensureCalendarProvider();
    clearCalendarRangeCache();
    const day = await readCalendarDay(DATE);
    expect(day.availability).toBe('unknown');
  });

  it('a retired tool version is reported as unavailable, never read at latest', async () => {
    await connectCalendar('work@example.com');
    seedCalendar([meeting('standup', `${DATE}T15:00:00Z`, `${DATE}T15:30:00Z`)]);
    h.fake.state.tools.set('GOOGLECALENDAR_EVENTS_LIST', (h.fake.state.tools.get('GOOGLECALENDAR_EVENTS_LIST') ?? []).map(t => ({ ...t, version: '20270101_00' })));
    const range = await getCalendarRange({ start: DATE, days: 1, fresh: true });
    expect(range.status).toBe('error');
    expect(range.providers[0]!.detail).toMatch(/retired/);
  });

  it('a source turned off stops background reads', async () => {
    await connectCalendar('work@example.com');
    seedCalendar([meeting('standup', `${DATE}T15:00:00Z`, `${DATE}T15:30:00Z`)]);
    updatePreferences(prefs => { prefs.sources[0]!.enabled = false; });
    const range = await getCalendarRange({ start: DATE, days: 1, fresh: true });
    expect(range.status).toBe('no_providers');
  });
});
