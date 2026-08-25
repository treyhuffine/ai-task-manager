import { describe, it, expect } from 'vitest';
import {
  toDateOnly,
  dateInputToStored,
  parseLocalDate,
  startOfLocalDay,
  calendarDaysUntil,
  formatLocalDate,
  isPastDate,
} from './dates';

describe('toDateOnly', () => {
  it('passes through a bare calendar date', () => {
    expect(toDateOnly('2026-08-25')).toBe('2026-08-25');
  });

  it('strips a legacy UTC-midnight timestamp suffix', () => {
    expect(toDateOnly('2026-08-25T00:00:00.000Z')).toBe('2026-08-25');
  });

  it('strips any time/zone suffix', () => {
    expect(toDateOnly('2026-08-25T14:32:00-05:00')).toBe('2026-08-25');
  });

  it('returns null for empty/nullish', () => {
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly(undefined)).toBeNull();
    expect(toDateOnly('')).toBeNull();
  });
});

describe('dateInputToStored', () => {
  it('keeps a date-input value as a bare date (never UTC-pins it)', () => {
    expect(dateInputToStored('2026-08-25')).toBe('2026-08-25');
  });

  it('maps an empty input to null', () => {
    expect(dateInputToStored('')).toBeNull();
  });
});

describe('parseLocalDate', () => {
  it('builds a LOCAL midnight, not UTC midnight (the core bug guard)', () => {
    const d = parseLocalDate('2026-08-25')!;
    // These read local components and must match the typed date in EVERY zone.
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('ignores a legacy timestamp suffix and still lands on the same local day', () => {
    const d = parseLocalDate('2026-08-25T00:00:00.000Z')!;
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
  });

  it('returns null for unset values', () => {
    expect(parseLocalDate(null)).toBeNull();
  });
});

describe('calendarDaysUntil', () => {
  it('is 0 for today even late in the local evening', () => {
    const lateTonight = new Date(2026, 7, 25, 23, 30, 0);
    expect(calendarDaysUntil('2026-08-25', lateTonight)).toBe(0);
  });

  it('is 1 for tomorrow, -1 for yesterday', () => {
    const noon = new Date(2026, 7, 25, 12, 0, 0);
    expect(calendarDaysUntil('2026-08-26', noon)).toBe(1);
    expect(calendarDaysUntil('2026-08-24', noon)).toBe(-1);
  });

  it('counts multi-day spans', () => {
    const noon = new Date(2026, 7, 25, 12, 0, 0);
    expect(calendarDaysUntil('2026-09-01', noon)).toBe(7);
  });

  it('is null when unset', () => {
    expect(calendarDaysUntil(null)).toBeNull();
  });
});

describe('startOfLocalDay', () => {
  it('zeroes the time in local terms', () => {
    const d = startOfLocalDay(new Date(2026, 7, 25, 18, 45, 12));
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe('formatLocalDate', () => {
  it('renders the typed day, never shifting to the day before', () => {
    // The whole point: a bare date must not localize to the previous day.
    expect(formatLocalDate('2026-08-25', { month: 'short', day: 'numeric' })).toBe('Aug 25');
  });

  it('renders a legacy UTC-midnight value on its own day', () => {
    expect(formatLocalDate('2026-08-25T00:00:00.000Z', { month: 'short', day: 'numeric' })).toBe(
      'Aug 25',
    );
  });

  it('returns null when unset', () => {
    expect(formatLocalDate(null)).toBeNull();
  });
});

describe('isPastDate', () => {
  const noon = new Date(2026, 7, 25, 12, 0, 0);

  it('is false for today and the future', () => {
    expect(isPastDate('2026-08-25', noon)).toBe(false);
    expect(isPastDate('2026-08-26', noon)).toBe(false);
  });

  it('is true for a past calendar date', () => {
    expect(isPastDate('2026-08-24', noon)).toBe(true);
  });

  it('is false when unset', () => {
    expect(isPastDate(null, noon)).toBe(false);
  });
});
