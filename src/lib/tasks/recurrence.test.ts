import { describe, expect, it } from 'vitest';
import {
  RECURRENCE_PRESETS,
  addRecurrence,
  describeRecurrence,
  isRestingUntilNext,
  nextOccurrence,
  nextOccurrenceNote,
  occurrenceDate,
  parseRecurrence,
  recurrenceHasDetail,
  recurrenceLabel,
  recurrenceProblem,
  recurrenceValue,
  scheduleNextOccurrence,
} from './recurrence';

const day = (every: number) => ({ every, unit: 'day' as const });
const week = (every: number) => ({ every, unit: 'week' as const });
const month = (every: number) => ({ every, unit: 'month' as const });
const year = (every: number) => ({ every, unit: 'year' as const });

describe('parseRecurrence', () => {
  it.each([
    ['daily', day(1)], ['weekly', week(1)], ['monthly', month(1)], ['yearly', year(1)],
    ['Daily', day(1)], ['WEEKLY', week(1)], ['annually', year(1)], ['annual', year(1)],
    ['3d', day(3)], ['2w', week(2)], ['6m', month(6)], ['2y', year(2)], ['21d', day(21)], ['1w', week(1)],
    ['21 days', day(21)], ['6 months', month(6)], ['2 wks', week(2)],
    ['every day', day(1)], ['each week', week(1)], ['every month', month(1)], ['every year', year(1)],
    ['every 3 days', day(3)], ['every 2 weeks', week(2)], ['every two weeks', week(2)], ['Every 6 months', month(6)],
    ['every other week', week(2)], ['every other month', month(2)],
    ['biweekly', week(2)], ['bi-weekly', week(2)], ['fortnightly', week(2)],
    ['quarterly', month(3)], ['semi-annually', month(6)], ['twice a year', month(6)], ['half-yearly', month(6)], ['half yearly', month(6)],
    ['FREQ=DAILY', day(1)], ['FREQ=WEEKLY;INTERVAL=2', week(2)], ['RRULE:FREQ=MONTHLY;INTERVAL=3', month(3)],
  ])('reads %j', (text, expected) => {
    expect(parseRecurrence(text)).toEqual(expected);
  });

  // Every recurrence on the owner's real Home, as agents and the Notion import wrote them.
  it.each([
    ['Monthly', month(1)],
    ['Yearly', year(1)],
    ['Yearly, only if applicable', year(1)],
    ['Weekly, if the plan remains active', week(1)],
    ['Every 6 months, confirm desired cadence', month(6)],
    ['Every 2 years, verify', year(2)],
    ['Every 2 years', year(2)],
    ['Quarterly', month(3)],
    ['Quarterly, only when estimated payments are required', month(3)],
    ['Monthly, confirm desired cadence', month(1)],
    ['Yearly if subscription is active', year(1)],
    ['Yearly during tax planning', year(1)],
    ['Yearly, while entity remains active', year(1)],
    ['About every 3 months, verify provider behavior', month(3)],
    ['Daily until audit is complete', day(1)],
    ['21d', day(21)],
  ])('reads the real %j', (text, expected) => {
    expect(parseRecurrence(text)).toEqual(expected);
  });

  it('prefers an explicit interval over a stray cadence word', () => {
    expect(parseRecurrence('weekly review, every 2 weeks')).toEqual(week(2));
  });

  it.each([
    '', '   ', null, undefined, 'every Monday', 'every Monday and Thursday', 'every weekday', 'whenever', 'soon',
    'FREQ=WEEKLY;BYDAY=MO,TH', '0d', 'every 0 days', '1000d',
    // A word that changes what the cadence word means: refused, never read as that word.
    'twice weekly', 'twice a week', 'three times a week', 'every week and a half', 'every 1.5 weeks',
    'bi-monthly', 'bimonthly', 'bi-annually', 'semi-monthly', 'semi-weekly', 'monthly, twice if busy',
  ])('finds no cadence Ri can follow in %j', (text) => {
    expect(parseRecurrence(text)).toBeNull();
  });
});

describe('canonical form and labels', () => {
  it('stores single units as words and intervals as compact', () => {
    expect([day(1), week(1), month(1), year(1), day(3), week(2), month(6), year(2)].map(recurrenceValue))
      .toEqual(['daily', 'weekly', 'monthly', 'yearly', '3d', '2w', '6m', '2y']);
  });

  it('round-trips every canonical value', () => {
    for (const preset of RECURRENCE_PRESETS) expect(parseRecurrence(recurrenceValue(preset))).toEqual(preset);
  });

  it('describes cadences in words', () => {
    expect(RECURRENCE_PRESETS.map(describeRecurrence))
      .toEqual(['Daily', 'Weekly', 'Every 2 weeks', 'Monthly', 'Every 3 months', 'Yearly']);
  });

  it('labels stored text by its cadence, and unreadable text as written', () => {
    expect(recurrenceLabel('21d')).toBe('Every 21 days');
    expect(recurrenceLabel('Yearly, only if applicable')).toBe('Yearly');
    expect(recurrenceLabel(' every Tuesday ')).toBe('every Tuesday');
    expect(recurrenceLabel(null)).toBeNull();
    expect(recurrenceLabel('  ')).toBeNull();
  });

  it('knows when stored text says more than its cadence', () => {
    expect(recurrenceHasDetail('Yearly, only if applicable')).toBe(true);
    expect(recurrenceHasDetail('About every 3 months, verify provider behavior')).toBe(true);
    for (const plain of ['weekly', 'Weekly', '2w', 'Every 2 weeks', 'Quarterly', 'biweekly', null, 'every Tuesday']) {
      expect(recurrenceHasDetail(plain)).toBe(false);
    }
  });

  it('explains what to write instead of a cadence it cannot follow', () => {
    expect(recurrenceProblem('every 2 weeks')).toBeNull();
    expect(recurrenceProblem('every Monday and Thursday')).toMatch(/can't follow the repeat "every Monday and Thursday".*weekly.*next date/);
    // Copy rule: no semicolons or long dashes in text a person reads.
    expect(recurrenceProblem('every Monday')).not.toMatch(/[;—–]/);
  });
});

describe('calendar math', () => {
  it('steps days and weeks across month, year and DST boundaries', () => {
    expect(addRecurrence('2026-11-16', day(1))).toBe('2026-11-17');
    expect(addRecurrence('2026-12-31', day(1))).toBe('2027-01-01');
    expect(addRecurrence('2026-03-07', week(1))).toBe('2026-03-14'); // US DST starts Mar 8
    expect(addRecurrence('2026-10-30', week(2))).toBe('2026-11-13'); // US DST ends Nov 1
    expect(addRecurrence('2028-02-28', day(1))).toBe('2028-02-29');
  });

  it('clamps months into short months and keeps end-of-month', () => {
    expect(addRecurrence('2027-01-31', month(1))).toBe('2027-02-28');
    expect(addRecurrence('2027-02-28', month(1))).toBe('2027-03-31');
    expect(addRecurrence('2028-01-31', month(1))).toBe('2028-02-29');
    expect(addRecurrence('2027-01-15', month(1))).toBe('2027-02-15');
    expect(addRecurrence('2026-11-30', month(3))).toBe('2027-02-28');
    expect(addRecurrence('2026-12-15', month(1))).toBe('2027-01-15');
  });

  it('steps years, with Feb 29 landing on Feb 28', () => {
    expect(addRecurrence('2027-01-21', year(1))).toBe('2028-01-21');
    expect(addRecurrence('2028-02-29', year(1))).toBe('2029-02-28');
    expect(addRecurrence('2026-05-31', year(2))).toBe('2028-05-31');
  });

  it('finds the next occurrence one interval on, even when done early', () => {
    expect(nextOccurrence(week(1), '2026-11-16', '2026-11-16')).toBe('2026-11-23');
    expect(nextOccurrence(week(1), '2026-11-21', '2026-11-16')).toBe('2026-11-28');
  });

  it('skips missed occurrences and keeps the rhythm when done late', () => {
    expect(nextOccurrence(day(1), '2026-11-13', '2026-11-16')).toBe('2026-11-17');
    expect(nextOccurrence(week(1), '2026-10-01', '2026-11-16')).toBe('2026-11-19');
    expect(nextOccurrence(month(1), '2026-01-31', '2026-11-16')).toBe('2026-11-30');
    expect(nextOccurrence(year(1), '2024-01-21', '2026-11-16')).toBe('2027-01-21');
  });

  describe('with a deadline', () => {
    it('keeps the lead between the scheduled day and the deadline, done on time', () => {
      expect(scheduleNextOccurrence(week(1), { scheduled: '2026-11-16', deadline: '2026-11-20', today: '2026-11-18' }))
        .toEqual({ next: '2026-11-23', deadline: '2026-11-27' });
    });

    it('done late with the next deadline still ahead, the next one is open now and stays due on time', () => {
      // Scheduled Nov 16, due Nov 20, done Nov 25: the Nov 23 occurrence isn't
      // missed, its deadline is Nov 27. Never a deadline before its occurrence.
      expect(scheduleNextOccurrence(week(1), { scheduled: '2026-11-16', deadline: '2026-11-20', today: '2026-11-25' }))
        .toEqual({ next: '2026-11-23', deadline: '2026-11-27' });
    });

    it('done early, both move one interval', () => {
      expect(scheduleNextOccurrence(week(1), { scheduled: '2026-11-21', deadline: '2026-11-23', today: '2026-11-18' }))
        .toEqual({ next: '2026-11-28', deadline: '2026-11-30' });
    });

    it('with no scheduled day, the first completion sets one, never after the deadline', () => {
      // A yearly tax paid on time comes back a year from today, before next year's deadline.
      expect(scheduleNextOccurrence(year(1), { scheduled: null, deadline: '2027-01-21', today: '2027-01-10' }))
        .toEqual({ next: '2028-01-10', deadline: '2028-01-21' });
      // Paid late, it still comes back by next year's deadline, not after it.
      expect(scheduleNextOccurrence(year(1), { scheduled: null, deadline: '2027-01-21', today: '2027-02-15' }))
        .toEqual({ next: '2028-01-21', deadline: '2028-01-21' });
    });

    it('a long-stale deadline lands on its first future date', () => {
      expect(scheduleNextOccurrence(month(3), { scheduled: null, deadline: '2024-01-12', today: '2026-11-16' }))
        .toEqual({ next: '2027-01-12', deadline: '2027-01-12' });
    });

    it('without one, only the scheduled day moves', () => {
      expect(scheduleNextOccurrence(week(1), { scheduled: '2026-11-13', deadline: null, today: '2026-11-16' }))
        .toEqual({ next: '2026-11-20', deadline: null });
      expect(scheduleNextOccurrence(day(1), { scheduled: null, deadline: null, today: '2026-11-16' }))
        .toEqual({ next: '2026-11-17', deadline: null });
    });
  });

  it('says when the next one comes, or that it is already open', () => {
    const now = new Date(2026, 10, 25, 9);
    expect(nextOccurrenceNote('2026-11-30', now)).toBe('Next one Mon, Nov 30');
    expect(nextOccurrenceNote('2027-01-04', now)).toBe('Next one Mon, Jan 4, 2027');
    expect(nextOccurrenceNote('2026-11-23', now)).toBe('The next one is ready now');
    expect(nextOccurrenceNote('2026-11-25', now)).toBe('The next one is ready now');
  });

  it('never returns today or earlier', () => {
    expect(nextOccurrence(day(1), '2026-11-15', '2026-11-16')).toBe('2026-11-17');
  });

  it('reads stored dates and instants as calendar dates', () => {
    expect(occurrenceDate('2026-11-23')).toBe('2026-11-23');
    expect(occurrenceDate('2026-11-23T15:30:00.000Z')).toBe('2026-11-23');
    expect(occurrenceDate('2026-02-30')).toBeNull();
    expect(occurrenceDate('soon')).toBeNull();
    expect(occurrenceDate(null)).toBeNull();
  });
});

describe('isRestingUntilNext', () => {
  // Local 9pm on Nov 16 in America/* zones is already Nov 17 in UTC: the
  // calendar day, not the UTC instant, decides.
  const now = new Date(2026, 10, 16, 21, 0);

  it('rests until the local day of the next occurrence', () => {
    expect(isRestingUntilNext({ recurrence: 'daily', nextRecurrenceAt: '2026-11-17' }, now)).toBe(true);
    expect(isRestingUntilNext({ recurrence: 'daily', nextRecurrenceAt: '2026-11-16' }, now)).toBe(false);
    expect(isRestingUntilNext({ recurrence: 'daily', nextRecurrenceAt: '2026-11-17' }, new Date(2026, 10, 17, 0, 1))).toBe(false);
  });

  it('is never resting without a repeat or a next date', () => {
    expect(isRestingUntilNext({ recurrence: null, nextRecurrenceAt: '2026-12-01' }, now)).toBe(false);
    expect(isRestingUntilNext({ recurrence: 'weekly', nextRecurrenceAt: null }, now)).toBe(false);
  });
});
