import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INACTIVE_AFTER_DAYS,
  formatInactiveAfter,
  isSessionInactive,
  isValidInactiveAfterDays,
  partitionInactive,
  resolveInactiveAfterDays,
} from './inactive';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();
const session = (over: Partial<{ lastActivityAt: string | null; unreadMarkerAt: string | null; startedAt: string }> = {}) => ({
  lastActivityAt: null,
  unreadMarkerAt: null,
  startedAt: daysAgo(30),
  ...over,
});

describe('resolveInactiveAfterDays', () => {
  it('reads null as the default, 0 as off, and anything else as days', () => {
    expect(resolveInactiveAfterDays(null)).toBe(DEFAULT_INACTIVE_AFTER_DAYS);
    expect(resolveInactiveAfterDays(undefined)).toBe(DEFAULT_INACTIVE_AFTER_DAYS);
    expect(resolveInactiveAfterDays(0)).toBeNull();
    expect(resolveInactiveAfterDays(3)).toBe(3);
  });
});

describe('isValidInactiveAfterDays', () => {
  it('accepts null, 0, and whole days up to the cap', () => {
    for (const ok of [null, 0, 1, 7, 3650]) expect(isValidInactiveAfterDays(ok)).toBe(true);
    for (const bad of [-1, 1.5, 3651, '7', undefined, NaN]) expect(isValidInactiveAfterDays(bad)).toBe(false);
  });
});

describe('isSessionInactive', () => {
  it('goes inactive once the last activity is older than the threshold', () => {
    expect(isSessionInactive(session({ lastActivityAt: daysAgo(8) }), 7, NOW)).toBe(true);
    expect(isSessionInactive(session({ lastActivityAt: daysAgo(6) }), 7, NOW)).toBe(false);
  });

  it('counts the most recent of activity, an unread marker, and the start', () => {
    // Started long ago, but marked unread yesterday: still active.
    expect(isSessionInactive(session({ lastActivityAt: daysAgo(20), unreadMarkerAt: daysAgo(1) }), 7, NOW)).toBe(false);
    // Never had activity recorded: the start is the floor.
    expect(isSessionInactive(session({ startedAt: daysAgo(2) }), 7, NOW)).toBe(false);
    // Legacy space-format start.
    expect(isSessionInactive(session({ startedAt: '2026-09-01 10:00:00' }), 7, NOW)).toBe(true);
  });

  it('never folds running work or anything when folding is off', () => {
    const old = session({ lastActivityAt: daysAgo(60) });
    expect(isSessionInactive(old, 7, NOW, true)).toBe(false);
    expect(isSessionInactive(old, null, NOW)).toBe(false);
  });
});

describe('partitionInactive', () => {
  it('splits a list and keeps each half in order', () => {
    const { active, inactive } = partitionInactive([1, 2, 3, 4, 5], (n) => n % 2 === 0);
    expect(active).toEqual([1, 3, 5]);
    expect(inactive).toEqual([2, 4]);
  });
});

describe('formatInactiveAfter', () => {
  it('names days and whole weeks', () => {
    expect(formatInactiveAfter(1)).toBe('1 day');
    expect(formatInactiveAfter(3)).toBe('3 days');
    expect(formatInactiveAfter(7)).toBe('1 week');
    expect(formatInactiveAfter(14)).toBe('2 weeks');
    expect(formatInactiveAfter(30)).toBe('30 days');
  });
});
