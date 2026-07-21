import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getConnectorRuntime: vi.fn() }));

vi.mock('@/lib/connectors/runtime', () => ({
  getConnectorOwnerId: () => 'local',
  getConnectorRuntime: mocks.getConnectorRuntime,
}));

vi.mock('@/lib/db/queries', () => ({
  getWorkdayBounds: () => ({ workdayStart: '09:00', workdayEnd: '18:00' }),
}));

import { ensureCalendarProvider } from './calendar-connector';
import { getCalendarEventsForDay, setCalendarProvider } from './calendar';
import { clearCalendarRangeCache } from '@/lib/calendar/service';

const DATE = '2026-06-26';

function runtimeReturning(events: unknown[]) {
  return {
    listConnections: async () => [{ id: 'c1', providerId: 'google' }],
    runAction: async () => ({ ok: true, result: { events } }),
  };
}

beforeEach(() => {
  setCalendarProvider(null);
  clearCalendarRangeCache();
  mocks.getConnectorRuntime.mockReset();
});
afterEach(() => setCalendarProvider(null));

describe('calendar-connector adapter', () => {
  it('maps busy events to blocks, skipping all-day, cancelled, declined, and free', async () => {
    mocks.getConnectorRuntime.mockResolvedValue(
      runtimeReturning([
        { start: `${DATE}T09:00:00-06:00`, end: `${DATE}T10:00:00-06:00`, summary: 'Standup', status: 'confirmed' },
        { start: DATE, end: '2026-06-27', summary: 'Birthday', status: 'confirmed' }, // all-day → skip
        { start: `${DATE}T11:00:00-06:00`, end: `${DATE}T11:30:00-06:00`, summary: 'X', status: 'cancelled' }, // skip
        // Declined and transparent events no longer consume the day.
        { start: `${DATE}T12:00:00-06:00`, end: `${DATE}T13:00:00-06:00`, summary: 'Skipped', responseStatus: 'declined' },
        { start: `${DATE}T13:00:00-06:00`, end: `${DATE}T14:00:00-06:00`, summary: 'Focus', transparency: 'transparent' },
        { start: `${DATE}T14:00:00-06:00`, end: `${DATE}T15:00:00-06:00`, status: 'confirmed' }, // no summary → "Busy"
      ]),
    );
    ensureCalendarProvider();
    const blocks = await getCalendarEventsForDay(DATE);
    expect(blocks.map((b) => b.title)).toEqual(['Standup', 'Busy']);
    expect(blocks.every((b) => b.source === 'google')).toBe(true);
  });

  it('returns [] when no calendar is connected', async () => {
    mocks.getConnectorRuntime.mockResolvedValue({
      listConnections: async () => [],
      runAction: async () => ({ ok: true, result: { events: [] } }),
    });
    ensureCalendarProvider();
    expect(await getCalendarEventsForDay(DATE)).toEqual([]);
  });

  it('returns [] (degrades) when the calendar action is not ok', async () => {
    mocks.getConnectorRuntime.mockResolvedValue({
      listConnections: async () => [{ id: 'c1', providerId: 'google' }],
      runAction: async () => ({ ok: false, reason: 'error', code: 'provider_not_configured', message: 'no client' }),
    });
    ensureCalendarProvider();
    expect(await getCalendarEventsForDay(DATE)).toEqual([]);
  });

  it('merges blocks across google and microsoft connections', async () => {
    mocks.getConnectorRuntime.mockResolvedValue({
      listConnections: async () => [
        { id: 'c1', providerId: 'google' },
        { id: 'c2', providerId: 'microsoft' },
      ],
      runAction: async (action: string) =>
        action === 'google_calendar.list_events'
          ? { ok: true, result: { events: [{ id: 'g', summary: 'G', start: `${DATE}T09:00:00`, end: `${DATE}T10:00:00` }] } }
          : { ok: true, result: { events: [{ id: 'o', subject: 'O', start: `${DATE}T11:00:00`, end: `${DATE}T12:00:00` }] } },
    });
    ensureCalendarProvider();
    const blocks = await getCalendarEventsForDay(DATE);
    expect(blocks.map((b) => `${b.title}:${b.source}`)).toEqual(['G:google', 'O:microsoft']);
  });

  it('does not clobber an already-registered provider (test/mocks stay intact)', async () => {
    setCalendarProvider(async () => [{ start: 'x', end: 'y', title: 'mock', source: 'test' }]);
    ensureCalendarProvider(); // no-op because a provider is already set
    expect(await getCalendarEventsForDay(DATE)).toEqual([
      { start: 'x', end: 'y', title: 'mock', source: 'test' },
    ]);
    expect(mocks.getConnectorRuntime).not.toHaveBeenCalled();
  });
});
