import { describe, expect, it } from 'vitest';
import { pickPairing, type PairableItem } from './pairing';
import type { CalendarDay } from './types';

function day(gaps: Array<[number, number]>): CalendarDay {
  return {
    date: '2026-07-20',
    allDay: [],
    events: [],
    gaps: gaps.map(([startMinute, endMinute]) => ({
      startMinute,
      endMinute,
      minutes: endMinute - startMinute,
    })),
    freeMinutes: 0,
    largestGapMinutes: 0,
    busyMinutes: 0,
  };
}

const at = (h: number, m = 0) => new Date(2026, 6, 20, h, m);

const ITEMS: PairableItem[] = [
  { title: 'Write launch strategy', energy: 'deep' },
  { title: 'Reply to Jake', energy: 'light' },
];

describe('pickPairing', () => {
  it('a long clear stretch pairs with the top deep task', () => {
    const p = pickPairing(day([[540, 1080]]), ITEMS, at(11))!;
    expect(p.title).toBe('Write launch strategy');
    expect(p.window).toBe('7h clear until 6:00 PM');
  });

  it('a short slice before the next event pairs with the top light task', () => {
    const p = pickPairing(day([[540, 630]]), ITEMS, at(10))!; // 30m left
    expect(p.title).toBe('Reply to Jake');
    expect(p.window).toBe('30m clear until 10:30 AM');
  });

  it('falls back to the top of the deck when no energy label matches', () => {
    const p = pickPairing(day([[540, 1080]]), [{ title: 'Untyped work' }], at(11))!;
    expect(p.title).toBe('Untyped work');
  });

  it('returns null inside a meeting (no containing gap)', () => {
    expect(pickPairing(day([[540, 600]]), ITEMS, at(12))).toBeNull();
  });

  it('returns null when the sliver left is below the noise floor', () => {
    expect(pickPairing(day([[540, 610]]), ITEMS, at(10))).toBeNull(); // 10m left
  });

  it('returns null with no day shape or an empty deck', () => {
    expect(pickPairing(undefined, ITEMS, at(10))).toBeNull();
    expect(pickPairing(day([[540, 1080]]), [], at(10))).toBeNull();
  });
});
