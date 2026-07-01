import { describe, expect, it } from 'vitest';
import { sessionHotnessKey, sortSessionsHotnessDesc } from './session-sort';

interface Row {
  id: string;
  startedAt: string;
  lastOutcomeEventAt: string | null;
  unreadMarkerAt: string | null;
}

const row = (id: string, p: Partial<Row>): Row => ({
  id,
  startedAt: p.startedAt ?? '2026-06-29T00:00:00.000Z',
  lastOutcomeEventAt: p.lastOutcomeEventAt ?? null,
  unreadMarkerAt: p.unreadMarkerAt ?? null,
});

describe('sessionHotnessKey', () => {
  it('takes the most recent of startedAt / outcome / unread across formats', () => {
    const s = row('a', {
      startedAt: '2026-06-29 22:00:00', // space-format, latest in real time
      lastOutcomeEventAt: '2026-06-29T10:00:00.000Z',
      unreadMarkerAt: '2026-06-29T12:00:00.000Z',
    });
    expect(sessionHotnessKey(s)).toBe(Date.parse('2026-06-29T22:00:00.000Z'));
  });
});

describe('sortSessionsHotnessDesc', () => {
  it('floats a brand-new session (space-format startedAt) to the top', () => {
    // Reproduces the rail bug: the new "Untitled" chat has only a
    // space-format `startedAt` ("now"); the others have ISO outcome
    // timestamps. Raw lexicographic compare buried it between today's
    // active sessions and yesterday's. It should sort first.
    const fresh = row('fresh', { startedAt: '2026-06-29 22:00:00' });
    const oneHour = row('1h', {
      startedAt: '2026-06-29 09:00:00',
      lastOutcomeEventAt: '2026-06-29T21:00:00.000Z',
    });
    const fiveHour = row('5h', {
      startedAt: '2026-06-29 09:00:00',
      lastOutcomeEventAt: '2026-06-29T17:00:00.000Z',
    });
    const oneDay = row('1d', {
      startedAt: '2026-06-28 09:00:00',
      lastOutcomeEventAt: '2026-06-28T12:00:00.000Z',
    });

    const sorted = sortSessionsHotnessDesc([oneHour, fiveHour, oneDay, fresh]);
    expect(sorted.map((s) => s.id)).toEqual(['fresh', '1h', '5h', '1d']);
  });

  it('does not mutate the input array', () => {
    const input = [row('a', {}), row('b', { startedAt: '2026-06-29 22:00:00' })];
    const before = input.map((s) => s.id);
    sortSessionsHotnessDesc(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });
});
