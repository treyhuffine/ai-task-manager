import { describe, expect, it } from 'vitest';
import { parseCalendarWork } from './calendar-work';

describe('parseCalendarWork', () => {
  it('is on unless explicitly turned off', () => {
    expect(parseCalendarWork(null)).toBe(true);
    expect(parseCalendarWork('1')).toBe(true);
    expect(parseCalendarWork('0')).toBe(false);
  });
});
