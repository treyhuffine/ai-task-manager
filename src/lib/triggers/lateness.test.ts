import { describe, expect, it } from 'vitest';
import { lateBy, overdueLabel } from './lateness';

const DUE = '2026-11-03T15:00:00.000Z';
const at = (time: string) => new Date(`2026-11-03T${time}Z`);

describe('lateBy', () => {
  it('stays quiet until a job is 5 minutes past its time', () => {
    expect(lateBy(DUE, at('15:04:59'))).toBeNull();
    expect(lateBy(DUE, at('15:05:00'))).toBe('5m');
    expect(lateBy(DUE, at('14:00:00'))).toBeNull();
  });

  it('reads in whole minutes, then hours and days', () => {
    expect(lateBy(DUE, at('18:39:32'))).toBe('3h 39m');
    expect(lateBy(DUE, '2026-11-05T17:30:00.000Z')).toBe('2d 2h');
  });

  it('has nothing to say without a due time', () => {
    expect(lateBy(null)).toBeNull();
    expect(lateBy(undefined)).toBeNull();
    expect(lateBy('not a date')).toBeNull();
  });
});

describe('overdueLabel', () => {
  const job = { enabled: true, kind: 'cron', targetKind: 'orchestrator', nextRunAt: DUE } as const;

  it('says a repeating job past its time has not started', () => {
    expect(overdueLabel(job, at('18:39:32'))).toBe("Hasn't started, 3h 39m late");
  });

  it('says a one-time job for a chat is waiting for that chat', () => {
    expect(overdueLabel({ ...job, kind: 'at', targetKind: 'session' }, at('18:39:32'))).toBe('Waiting for its chat, 3h 39m late');
  });

  it('says nothing for a job on time, paused or finished', () => {
    expect(overdueLabel(job, at('15:01:00'))).toBeNull();
    expect(overdueLabel({ ...job, enabled: false }, at('18:39:32'))).toBeNull();
    expect(overdueLabel({ ...job, nextRunAt: null }, at('18:39:32'))).toBeNull();
  });
});
