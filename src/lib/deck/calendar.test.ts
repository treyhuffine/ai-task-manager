import { describe, it, expect, afterEach } from 'vitest';
import {
  computeFreeGaps,
  availableMinutes,
  parseHhMm,
  minutesToLabel,
  getCalendarEventsForDay,
  setCalendarProvider,
  hasCalendarProvider,
  type CalendarBlock,
} from './calendar';

const DATE = '2026-06-18';
const bounds = { workdayStart: '09:00', workdayEnd: '18:00', date: DATE };

function block(startH: number, endH: number, title = 'Meeting'): CalendarBlock {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${DATE}T${pad(startH)}:00:00`, end: `${DATE}T${pad(endH)}:00:00`, title, source: 'test' };
}

describe('parseHhMm / minutesToLabel', () => {
  it('parses and clamps', () => {
    expect(parseHhMm('09:00')).toBe(540);
    expect(parseHhMm('18:30')).toBe(1110);
    expect(parseHhMm('bogus')).toBe(0);
  });
  it('labels 12h', () => {
    expect(minutesToLabel(540)).toBe('9:00 AM');
    expect(minutesToLabel(780)).toBe('1:00 PM');
    expect(minutesToLabel(0)).toBe('12:00 AM');
  });
});

describe('computeFreeGaps', () => {
  it('returns the whole workday when there are no blocks', () => {
    const gaps = computeFreeGaps([], bounds);
    expect(gaps).toHaveLength(1);
    expect(availableMinutes(gaps)).toBe(9 * 60); // 9am–6pm
  });

  it('splits the day around a midday block', () => {
    const gaps = computeFreeGaps([block(12, 13)], bounds);
    expect(gaps).toHaveLength(2);
    expect(availableMinutes(gaps)).toBe(8 * 60); // 9h minus 1h meeting
  });

  it('merges overlapping blocks', () => {
    const gaps = computeFreeGaps([block(12, 14), block(13, 15)], bounds);
    // One merged busy 12–15 → gaps 9–12 and 15–18 = 6h free
    expect(gaps).toHaveLength(2);
    expect(availableMinutes(gaps)).toBe(6 * 60);
  });

  it('returns no gaps when the workday is fully booked', () => {
    const gaps = computeFreeGaps([block(9, 18)], bounds);
    expect(gaps).toHaveLength(0);
    expect(availableMinutes(gaps)).toBe(0);
  });

  it('ignores blocks outside the workday window', () => {
    const gaps = computeFreeGaps([block(6, 8), block(19, 21)], bounds);
    expect(availableMinutes(gaps)).toBe(9 * 60);
  });

  it('ignores blocks on a different day', () => {
    const other: CalendarBlock = { start: '2026-06-17T12:00:00', end: '2026-06-17T13:00:00', title: 'x', source: 'test' };
    expect(availableMinutes(computeFreeGaps([other], bounds))).toBe(9 * 60);
  });

  it('clamps a block that overruns the workday', () => {
    const gaps = computeFreeGaps([block(8, 10)], bounds); // 8–10, clamps to 9–10
    expect(availableMinutes(gaps)).toBe(8 * 60); // only the 9–10 hour counts as busy
  });
});

describe('provider seam', () => {
  afterEach(() => setCalendarProvider(null));

  it('returns [] with no provider', async () => {
    expect(hasCalendarProvider()).toBe(false);
    expect(await getCalendarEventsForDay(DATE)).toEqual([]);
  });

  it('delegates to a registered provider', async () => {
    setCalendarProvider(async () => [block(10, 11)]);
    expect(hasCalendarProvider()).toBe(true);
    const events = await getCalendarEventsForDay(DATE);
    expect(events).toHaveLength(1);
  });

  it('degrades to [] when the provider throws', async () => {
    setCalendarProvider(async () => { throw new Error('boom'); });
    expect(await getCalendarEventsForDay(DATE)).toEqual([]);
  });
});
