import { describe, expect, it } from 'vitest';
import { isSessionUnread, sessionHotnessKey, sortSessionsHotnessDesc } from './session-sort';

interface Row {
  id: string;
  startedAt: string;
  lastActivityAt: string | null;
  unreadMarkerAt: string | null;
}

const row = (id: string, p: Partial<Row>): Row => ({
  id,
  startedAt: p.startedAt ?? '2026-06-29T00:00:00.000Z',
  lastActivityAt: p.lastActivityAt ?? null,
  unreadMarkerAt: p.unreadMarkerAt ?? null,
});

describe('sessionHotnessKey', () => {
  it('takes the most recent of startedAt / activity / unread across formats', () => {
    const s = row('a', {
      startedAt: '2026-06-29 22:00:00', // space-format, latest in real time
      lastActivityAt: '2026-06-29T10:00:00.000Z',
      unreadMarkerAt: '2026-06-29T12:00:00.000Z',
    });
    expect(sessionHotnessKey(s)).toBe(Date.parse('2026-06-29T22:00:00.000Z'));
  });

  it('treats creation as a floor, never a ceiling', () => {
    // The headline behavior: an execution opened a month ago that ran today
    // ranks as today, not as a month ago.
    const old = row('old', {
      startedAt: '2026-07-01T00:00:00.000Z',
      lastActivityAt: '2026-08-13T14:55:00.000Z',
    });
    expect(sessionHotnessKey(old)).toBe(Date.parse('2026-08-13T14:55:00.000Z'));
  });

  it('falls back to creation for a session that has never been touched', () => {
    expect(sessionHotnessKey(row('fresh', { startedAt: '2026-08-13T09:00:00.000Z' })))
      .toBe(Date.parse('2026-08-13T09:00:00.000Z'));
  });

  it('still honors an unread marker written without an activity bump', () => {
    // Belt-and-braces: `markSessionUnread` bumps activity too, so these agree
    // in practice. Kept so any other writer of the marker cannot silently
    // produce a row that ranks below its own unread state.
    expect(sessionHotnessKey(row('m', { unreadMarkerAt: '2026-08-13T14:55:00.000Z' })))
      .toBe(Date.parse('2026-08-13T14:55:00.000Z'));
  });

  it('tolerates a row that predates the lastActivityAt backfill', () => {
    const legacy = { startedAt: '2026-08-01T00:00:00.000Z', unreadMarkerAt: null };
    expect(sessionHotnessKey(legacy)).toBe(Date.parse('2026-08-01T00:00:00.000Z'));
  });
});

describe('sortSessionsHotnessDesc', () => {
  it('floats a brand-new session (space-format startedAt) to the top', () => {
    // Reproduces the rail bug: the new "Untitled" chat has only a
    // space-format `startedAt` ("now"); the others have ISO activity
    // timestamps. Raw lexicographic compare buried it between today's
    // active sessions and yesterday's. It should sort first.
    const fresh = row('fresh', { startedAt: '2026-06-29 22:00:00' });
    const oneHour = row('1h', {
      startedAt: '2026-06-29 09:00:00',
      lastActivityAt: '2026-06-29T21:00:00.000Z',
    });
    const fiveHour = row('5h', {
      startedAt: '2026-06-29 09:00:00',
      lastActivityAt: '2026-06-29T17:00:00.000Z',
    });
    const oneDay = row('1d', {
      startedAt: '2026-06-28 09:00:00',
      lastActivityAt: '2026-06-28T12:00:00.000Z',
    });

    const sorted = sortSessionsHotnessDesc([oneHour, fiveHour, oneDay, fresh]);
    expect(sorted.map((s) => s.id)).toEqual(['fresh', '1h', '5h', '1d']);
  });

  it('puts the most recently active first regardless of creation order', () => {
    const monthOldButActiveToday = row('old-active', {
      startedAt: '2026-07-01T00:00:00.000Z',
      lastActivityAt: '2026-08-13T14:55:00.000Z',
    });
    const newButIdle = row('new-idle', {
      startedAt: '2026-08-12T00:00:00.000Z',
      lastActivityAt: '2026-08-12T00:00:00.000Z',
    });
    const sorted = sortSessionsHotnessDesc([newButIdle, monthOldButActiveToday]);
    expect(sorted.map((s) => s.id)).toEqual(['old-active', 'new-idle']);
  });

  it('does not mutate the input array', () => {
    // Rail lists come straight out of the React Query cache — sorting in
    // place would mutate a cached array and break referential stability.
    const input = [row('a', {}), row('b', { startedAt: '2026-06-29 22:00:00' })];
    const before = input.map((s) => s.id);
    sortSessionsHotnessDesc(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });
});

describe('isSessionUnread', () => {
  it('stays keyed to agent output, not to activity', () => {
    // The whole reason `lastActivityAt` is a separate column: your own
    // typing bumps activity and must NOT make the chat unread.
    expect(
      isSessionUnread({
        lastOutcomeEventAt: null,
        unreadMarkerAt: null,
        lastViewedAt: '2026-08-13T10:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('is unread when output landed after the last view', () => {
    expect(
      isSessionUnread({
        lastOutcomeEventAt: '2026-08-13T11:00:00.000Z',
        unreadMarkerAt: null,
        lastViewedAt: '2026-08-13T10:00:00.000Z',
      }),
    ).toBe(true);
  });
});
