import { describe, expect, it } from 'vitest';
import { deriveExecutionHeaderStatus } from './execution-header-status';

const base = {
  isArchived: false,
  isSetupFailed: false,
  isSettingUp: false,
  isPending: false,
  isRunning: false,
  hasBackgroundTasks: false,
  lastOutcomeEventAt: null,
  lastViewedAt: null,
};

describe('deriveExecutionHeaderStatus', () => {
  it('uses the direct runtime state even when persisted outcome data looks idle', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      isRunning: true,
      lastOutcomeEventAt: '2026-07-15T20:00:00.000Z',
      lastViewedAt: '2026-07-15T20:01:00.000Z',
    })).toBe('working');
  });

  it('returns to idle after the direct runtime state stops', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      lastOutcomeEventAt: '2026-07-15T20:00:00.000Z',
      lastViewedAt: '2026-07-15T20:01:00.000Z',
    })).toBe('idle');
  });

  it('distinguishes child work that outlives the root turn', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      hasBackgroundTasks: true,
      lastOutcomeEventAt: '2026-07-15T20:00:00.000Z',
      lastViewedAt: '2026-07-15T20:01:00.000Z',
    })).toBe('background');
  });

  it('keeps foreground working ahead of background work', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      isRunning: true,
      hasBackgroundTasks: true,
    })).toBe('working');
  });

  it('keeps pending input ahead of a running process', () => {
    expect(deriveExecutionHeaderStatus({
      ...base,
      isPending: true,
      isRunning: true,
    })).toBe('pending');
  });
});
