import { describe, expect, it } from 'vitest';
import { isTriggerInactive } from './inactive';

describe('isTriggerInactive', () => {
  it('is true for a paused trigger of any kind', () => {
    for (const kind of ['manual', 'at', 'every', 'cron', 'webhook'] as const) {
      expect(isTriggerInactive({ enabled: false, kind, nextRunAt: '2026-10-06T11:00:00.000Z' })).toBe(true);
    }
  });

  it('is true for a one-time trigger that already fired', () => {
    expect(isTriggerInactive({ enabled: true, kind: 'at', nextRunAt: null })).toBe(true);
  });

  it('is false for anything that will still run', () => {
    expect(isTriggerInactive({ enabled: true, kind: 'at', nextRunAt: '2026-10-06T11:00:00.000Z' })).toBe(false);
    expect(isTriggerInactive({ enabled: true, kind: 'cron', nextRunAt: '2026-10-06T11:00:00.000Z' })).toBe(false);
    expect(isTriggerInactive({ enabled: true, kind: 'every', nextRunAt: '2026-10-06T11:00:00.000Z' })).toBe(false);
    // Run on demand, so never "next".
    expect(isTriggerInactive({ enabled: true, kind: 'manual', nextRunAt: null })).toBe(false);
    expect(isTriggerInactive({ enabled: true, kind: 'webhook', nextRunAt: null })).toBe(false);
  });
});
