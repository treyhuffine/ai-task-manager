import { describe, expect, it } from 'vitest';
import { describeHeartbeat, formatCheckInTime } from './status';
import type { HeartbeatCheckIn, HeartbeatConfig } from './types';

// Local wall-clock times so the formatter's same-day logic is timezone-proof.
const NOW = new Date(2026, 8, 22, 15, 30);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function config(overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    triggerId: '00000000-0000-0000-0000-000000000005',
    enabled: true,
    instructions: 'x',
    instructionsAreDefault: false,
    intervalSeconds: 3600,
    activeHoursStart: '09:00',
    activeHoursEnd: '21:00',
    timezone: 'UTC',
    provider: 'claude',
    model: null,
    effort: null,
    deliverResultTo: [],
    nextCheckInAt: at(22, 16),
    running: false,
    lastCheckIn: null,
    disabledReason: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function checkIn(overrides: Partial<HeartbeatCheckIn> = {}): HeartbeatCheckIn {
  return {
    runId: 'run-1',
    at: at(22, 14),
    completedAt: at(22, 14, 2),
    status: 'completed',
    quiet: false,
    chatSessionId: 'chat-1',
    unread: false,
    changedCount: 0,
    summary: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('formatCheckInTime', () => {
  it('shows the time alone today, and names yesterday and tomorrow', () => {
    expect(formatCheckInTime(at(22, 14), NOW)).toBe(time(at(22, 14)));
    expect(formatCheckInTime(at(21, 9), NOW)).toBe(`yesterday ${time(at(21, 9))}`);
    expect(formatCheckInTime(at(23, 9), NOW)).toBe(`tomorrow ${time(at(23, 9))}`);
  });

  it('adds the date further out', () => {
    expect(formatCheckInTime(at(18, 9), NOW)).toContain(', ');
  });
});

describe('describeHeartbeat', () => {
  it('says checking in while a run is live, even when off', () => {
    expect(describeHeartbeat(config({ running: true, enabled: false }), NOW)).toMatchObject({
      chip: 'checking in',
      tone: 'active',
    });
  });

  it('says off, and explains a budget pause', () => {
    expect(describeHeartbeat(config({ enabled: false }), NOW)).toMatchObject({ chip: 'off', tone: 'off' });
    expect(describeHeartbeat(config({ enabled: false, disabledReason: 'budget_exceeded' }), NOW).detail).toMatch(
      /monthly budget/,
    );
  });

  it('shows the next check-in before the first one', () => {
    const status = describeHeartbeat(config(), NOW);
    expect(status.chip).toBe(`next ${time(at(22, 16))}`);
    expect(status.detail).toMatch(/No check-ins yet\. Next check-in/);
  });

  it('shows the time of a quiet check-in and says nothing was needed', () => {
    const status = describeHeartbeat(config({ lastCheckIn: checkIn({ quiet: true, chatSessionId: null }) }), NOW);
    expect(status).toMatchObject({ chip: time(at(22, 14)), tone: 'idle' });
    expect(status.detail).toMatch(/Nothing needed/);
  });

  it('flags an unread report, with what it changed', () => {
    const status = describeHeartbeat(config({ lastCheckIn: checkIn({ unread: true, changedCount: 2 }) }), NOW);
    expect(status).toMatchObject({ chip: '1 for you', tone: 'attention' });
    expect(status.detail).toMatch(/left a report\. Changed 2 items\./);
  });

  it('flags a failed check-in with its error', () => {
    const status = describeHeartbeat(
      config({ lastCheckIn: checkIn({ status: 'failed', errorMessage: 'Run exceeded 1800s timeout' }) }),
      NOW,
    );
    expect(status).toMatchObject({ chip: 'failed', tone: 'error' });
    expect(status.detail).toContain('Run exceeded 1800s timeout');
  });

  it('keeps every sentence free of em dashes and semicolons', () => {
    const variants = [
      config({ running: true }),
      config({ enabled: false }),
      config({ enabled: false, disabledReason: 'budget_exceeded' }),
      config(),
      config({ lastCheckIn: checkIn({ quiet: true }) }),
      config({ lastCheckIn: checkIn({ unread: true, changedCount: 1 }) }),
      config({ lastCheckIn: checkIn({ status: 'failed' }) }),
      config({ lastCheckIn: checkIn({ status: 'cancelled' }) }),
    ];
    for (const c of variants) {
      const { chip, detail } = describeHeartbeat(c, NOW);
      expect(`${chip} ${detail}`).not.toMatch(/[—–;]/);
    }
  });
});
