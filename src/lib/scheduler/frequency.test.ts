import { describe, expect, it } from 'vitest';
import {
  describeFrequency,
  dateTimeInTimezone,
  frequencyToTrigger,
  triggerToFrequency,
} from './frequency';

describe('frequencyToTrigger', () => {
  it('compiles a calendar date and time in the selected timezone to an exact instant', () => {
    expect(frequencyToTrigger({ kind: 'once', date: '2026-10-20', time: '09:30', timezone: 'America/Denver' })).toEqual({
      kind: 'at', cronExpression: null, runAt: '2026-10-20T15:30:00.000Z',
    });
    expect(frequencyToTrigger({ kind: 'once', date: '2026-12-20', time: '09:30', timezone: 'America/Denver' }).runAt).toBe('2026-12-20T16:30:00.000Z');
  });

  it('handles midnight and non-hour timezone offsets without using the host timezone', () => {
    expect(frequencyToTrigger({ kind: 'once', date: '2026-10-20', time: '00:00', timezone: 'Asia/Kathmandu' }).runAt).toBe('2026-10-19T18:15:00.000Z');
    expect(dateTimeInTimezone(new Date('2026-10-19T18:15:00Z'), 'Asia/Kathmandu')).toEqual({ date: '2026-10-20', time: '00:00' });
  });

  it('rejects missing dates, invalid dates, timezone names and daylight saving gaps', () => {
    for (const choice of [
      { kind: 'once' as const, time: '09:00' },
      { kind: 'once' as const, date: '2027-02-30', time: '09:00' },
      { kind: 'once' as const, date: '2027-03-14', time: '02:30', timezone: 'America/Denver' },
      { kind: 'once' as const, date: '2027-03-14', time: '09:00', timezone: 'No/Such_Zone' },
    ]) expect(() => frequencyToTrigger(choice)).toThrow();
  });

  it('preserves interval schedules and rejects invalid intervals', () => {
    expect(frequencyToTrigger({ kind: 'every', intervalSeconds: 90 })).toEqual({ kind: 'every', cronExpression: null, intervalSeconds: 90 });
    for (const intervalSeconds of [0, -10, 1.5, NaN]) {
      expect(() => frequencyToTrigger({ kind: 'every', intervalSeconds })).toThrow();
    }
  });

  it('manual → kind=manual, no cron', () => {
    expect(frequencyToTrigger({ kind: 'manual' })).toEqual({
      kind: 'manual',
      cronExpression: null,
    });
  });

  it('webhook → kind=webhook, no cron', () => {
    expect(frequencyToTrigger({ kind: 'webhook' })).toEqual({
      kind: 'webhook',
      cronExpression: null,
    });
  });

  it('hourly → top-of-hour cron', () => {
    expect(frequencyToTrigger({ kind: 'hourly' })).toEqual({
      kind: 'cron',
      cronExpression: '0 * * * *',
    });
  });

  it('daily at 09:00 → 0 9 * * *', () => {
    expect(frequencyToTrigger({ kind: 'daily', time: '09:00' })).toEqual({
      kind: 'cron',
      cronExpression: '0 9 * * *',
    });
  });

  it('weekly on Monday at 08:30 → 30 8 * * 1', () => {
    expect(frequencyToTrigger({ kind: 'weekly', time: '08:30', weekday: 1 })).toEqual({
      kind: 'cron',
      cronExpression: '30 8 * * 1',
    });
  });

  it('monthly on the 15th at 6 PM → 0 18 15 * *', () => {
    expect(frequencyToTrigger({ kind: 'monthly', time: '18:00', dayOfMonth: 15 })).toEqual({
      kind: 'cron',
      cronExpression: '0 18 15 * *',
    });
  });

  it('monthly clamps day-of-month to 28', () => {
    expect(frequencyToTrigger({ kind: 'monthly', time: '09:00', dayOfMonth: 31 })).toEqual({
      kind: 'cron',
      cronExpression: '0 9 28 * *',
    });
  });

  it('custom passes through the raw expression', () => {
    expect(
      frequencyToTrigger({ kind: 'custom', cronExpression: '*/15 * * * *' }),
    ).toEqual({ kind: 'cron', cronExpression: '*/15 * * * *' });
  });
});

describe('triggerToFrequency (round trip)', () => {
  it('opens one-time jobs in their saved timezone and preserves the selected instant', () => {
    const choice = triggerToFrequency({ kind: 'at', cronExpression: null, runAt: '2026-10-20T15:30:00.000Z', timezone: 'America/Denver' });
    expect(choice).toEqual({ kind: 'once', date: '2026-10-20', time: '09:30', timezone: 'America/Denver', runAt: '2026-10-20T15:30:00.000Z' });
    expect(frequencyToTrigger(choice).runAt).toBe('2026-10-20T15:30:00.000Z');
  });

  it('preserves seconds and the original offset in a repeated daylight saving hour until edited', () => {
    const runAt = '2030-11-03T08:30:45.000Z';
    const choice = triggerToFrequency({ kind: 'at', cronExpression: null, runAt, timezone: 'America/Denver' });
    expect(choice).toMatchObject({ date: '2030-11-03', time: '01:30' });
    expect(frequencyToTrigger(choice).runAt).toBe(runAt);
    expect(frequencyToTrigger({ ...choice, time: '03:30' }).runAt).toBe('2030-11-03T10:30:00.000Z');
  });

  it('recognizes intervals instead of turning them into empty custom cron expressions', () => {
    expect(triggerToFrequency({ kind: 'every', cronExpression: null, intervalSeconds: 90 })).toEqual({ kind: 'every', intervalSeconds: 90 });
  });

  const cases = [
    { friendly: { kind: 'hourly' as const } },
    { friendly: { kind: 'daily' as const, time: '09:00' } },
    { friendly: { kind: 'daily' as const, time: '15:30' } },
    { friendly: { kind: 'weekly' as const, time: '08:30', weekday: 1 as const } },
    { friendly: { kind: 'monthly' as const, time: '18:00', dayOfMonth: 15 } },
  ];
  for (const { friendly } of cases) {
    it(`${JSON.stringify(friendly)} round-trips`, () => {
      const compiled = frequencyToTrigger(friendly);
      const reverse = triggerToFrequency({
        kind: 'cron',
        cronExpression: compiled.cronExpression,
      });
      expect(reverse).toEqual(friendly);
    });
  }

  it('falls back to custom for cron expressions the menu cannot express', () => {
    expect(
      triggerToFrequency({ kind: 'cron', cronExpression: '*/15 * * * 1-5' }),
    ).toEqual({ kind: 'custom', cronExpression: '*/15 * * * 1-5' });
  });

  it('manual → manual', () => {
    expect(triggerToFrequency({ kind: 'manual', cronExpression: null })).toEqual({
      kind: 'manual',
    });
  });
});

describe('describeFrequency', () => {
  it('manual', () => {
    expect(
      describeFrequency({
        kind: 'manual', cronExpression: null, intervalSeconds: null,
        runAt: null, timezone: null,
      }),
    ).toMatch(/Manual/);
  });

  it('webhook', () => {
    expect(
      describeFrequency({
        kind: 'webhook', cronExpression: null, intervalSeconds: null,
        runAt: null, timezone: null,
      }),
    ).toBe('Webhook');
  });

  it('daily', () => {
    expect(
      describeFrequency({
        kind: 'cron', cronExpression: '0 9 * * *', intervalSeconds: null,
        runAt: null, timezone: 'UTC',
      }),
    ).toBe('Daily at 9:00 AM');
  });

  it('weekly', () => {
    expect(
      describeFrequency({
        kind: 'cron', cronExpression: '0 9 * * 1', intervalSeconds: null,
        runAt: null, timezone: 'UTC',
      }),
    ).toBe('Weekly on Monday at 9:00 AM');
  });
});
