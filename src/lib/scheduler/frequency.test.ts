import { describe, expect, it } from 'vitest';
import {
  describeFrequency,
  frequencyToSchedule,
  scheduleToFrequency,
} from './frequency';

describe('frequencyToSchedule', () => {
  it('manual → kind=manual, no cron', () => {
    expect(frequencyToSchedule({ kind: 'manual' })).toEqual({
      kind: 'manual',
      cronExpression: null,
    });
  });

  it('webhook → kind=webhook, no cron', () => {
    expect(frequencyToSchedule({ kind: 'webhook' })).toEqual({
      kind: 'webhook',
      cronExpression: null,
    });
  });

  it('hourly → top-of-hour cron', () => {
    expect(frequencyToSchedule({ kind: 'hourly' })).toEqual({
      kind: 'cron',
      cronExpression: '0 * * * *',
    });
  });

  it('daily at 09:00 → 0 9 * * *', () => {
    expect(frequencyToSchedule({ kind: 'daily', time: '09:00' })).toEqual({
      kind: 'cron',
      cronExpression: '0 9 * * *',
    });
  });

  it('weekly on Monday at 08:30 → 30 8 * * 1', () => {
    expect(frequencyToSchedule({ kind: 'weekly', time: '08:30', weekday: 1 })).toEqual({
      kind: 'cron',
      cronExpression: '30 8 * * 1',
    });
  });

  it('monthly on the 15th at 6 PM → 0 18 15 * *', () => {
    expect(frequencyToSchedule({ kind: 'monthly', time: '18:00', dayOfMonth: 15 })).toEqual({
      kind: 'cron',
      cronExpression: '0 18 15 * *',
    });
  });

  it('monthly clamps day-of-month to 28', () => {
    expect(frequencyToSchedule({ kind: 'monthly', time: '09:00', dayOfMonth: 31 })).toEqual({
      kind: 'cron',
      cronExpression: '0 9 28 * *',
    });
  });

  it('custom passes through the raw expression', () => {
    expect(
      frequencyToSchedule({ kind: 'custom', cronExpression: '*/15 * * * *' }),
    ).toEqual({ kind: 'cron', cronExpression: '*/15 * * * *' });
  });
});

describe('scheduleToFrequency (round trip)', () => {
  const cases = [
    { friendly: { kind: 'hourly' as const } },
    { friendly: { kind: 'daily' as const, time: '09:00' } },
    { friendly: { kind: 'daily' as const, time: '15:30' } },
    { friendly: { kind: 'weekly' as const, time: '08:30', weekday: 1 as const } },
    { friendly: { kind: 'monthly' as const, time: '18:00', dayOfMonth: 15 } },
  ];
  for (const { friendly } of cases) {
    it(`${JSON.stringify(friendly)} round-trips`, () => {
      const compiled = frequencyToSchedule(friendly);
      const reverse = scheduleToFrequency({
        kind: 'cron',
        cronExpression: compiled.cronExpression,
      });
      expect(reverse).toEqual(friendly);
    });
  }

  it('falls back to custom for cron expressions the menu cannot express', () => {
    expect(
      scheduleToFrequency({ kind: 'cron', cronExpression: '*/15 * * * 1-5' }),
    ).toEqual({ kind: 'custom', cronExpression: '*/15 * * * 1-5' });
  });

  it('manual → manual', () => {
    expect(scheduleToFrequency({ kind: 'manual', cronExpression: null })).toEqual({
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
