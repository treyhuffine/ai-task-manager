import { describe, expect, it } from 'vitest';
import { parseTypedDate } from './date-input';

// A Wednesday.
const now = new Date(2026, 10, 4, 12, 0);

describe('parseTypedDate', () => {
  it.each([
    ['today', '2026-11-04'],
    ['tomorrow', '2026-11-05'],
    ['yesterday', '2026-11-03'],
    ['fri', '2026-11-06'],
    ['Friday', '2026-11-06'],
    ['next friday', '2026-11-13'],
    ['mon', '2026-11-09'],
    ['in 3 days', '2026-11-07'],
    ['in 2 weeks', '2026-11-18'],
    ['next week', '2026-11-11'],
  ])('reads %s relative to today', (text, expected) => {
    expect(parseTypedDate(text, now)).toBe(expected);
  });

  it.each([
    ['nov 12', '2026-11-12'],
    ['December 25', '2026-12-25'],
    ['11/12', '2026-11-12'],
    ['nov 1', '2027-11-01'],
    ['11/1', '2027-11-01'],
    ['jan 3', '2027-01-03'],
  ])('takes the next %s when no year is given', (text, expected) => {
    expect(parseTypedDate(text, now)).toBe(expected);
  });

  it.each([
    ['nov 1 2026', '2026-11-01'],
    ['11/12/2027', '2027-11-12'],
    ['2027-01-15', '2027-01-15'],
    ['Nov 12, 2026', '2026-11-12'],
  ])('keeps the year in %s, even a past date', (text, expected) => {
    expect(parseTypedDate(text, now)).toBe(expected);
  });

  it('stays on the local day late at night', () => {
    expect(parseTypedDate('tomorrow', new Date(2026, 10, 4, 23, 30))).toBe('2026-11-05');
  });

  it('drops a time', () => {
    expect(parseTypedDate('friday at 3pm', now)).toBe('2026-11-06');
  });

  it.each(['', '   ', 'banana', '12'])('returns null for %j', (text) => {
    expect(parseTypedDate(text, now)).toBeNull();
  });
});
