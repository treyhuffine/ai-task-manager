import { describe, expect, it } from 'vitest';
import { ageLabel, rateLimitRows, resetLabel } from './rate-limit-display';
import type { StoredRateLimitBucket } from './rate-limits';

const NOW = new Date(2026, 9, 9, 14, 0, 0);
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
const bucket = (id: string, extra: Partial<StoredRateLimitBucket> = {}): StoredRateLimitBucket => ({
  id, owner: { kind: 'account' }, applicability: { kind: 'all_models' }, observedAt: at(-0.1), ...extra,
});

describe('rateLimitRows', () => {
  it('names Claude windows from their ids, shared windows first, each with its own reset', () => {
    const rows = rateLimitRows([
      bucket('seven_day_opus', { applicability: { kind: 'model_family', family: 'opus' }, usedPercent: 30, resetAt: at(72) }),
      bucket('seven_day', { usedPercent: 61, resetAt: at(72) }),
      bucket('five_hour', { usedPercent: 42.4, resetAt: at(1.5) }),
    ], NOW);
    expect(rows.map((row) => [row.label, row.percent])).toEqual([['5-hour', 42.4], ['Weekly', 61], ['Weekly Opus', 30]]);
    expect(rows[0].reset).toBe(resetLabel(at(1.5), NOW));
    expect(rows[0].reset).toMatch(/^resets \d/);
    expect(rows[1].reset).toMatch(/^resets [A-Z][a-z]{2} /);
  });

  it('names Codex windows from their duration and prefixes the pool only when there are several', () => {
    const primary = bucket('codex:primary', { applicability: { kind: 'provider_pool', pool: 'codex' }, label: 'Codex', durationMs: 300 * 60_000, usedPercent: 12 });
    const weekly = bucket('codex:secondary', { applicability: { kind: 'provider_pool', pool: 'codex' }, label: 'Codex', durationMs: 10_080 * 60_000, usedPercent: 8 });
    expect(rateLimitRows([weekly, primary], NOW).map((row) => row.label)).toEqual(['5-hour', 'Weekly']);
    const spark = bucket('spark:primary', { applicability: { kind: 'provider_pool', pool: 'spark' }, durationMs: 300 * 60_000, usedPercent: 50 });
    expect(rateLimitRows([primary, spark], NOW).map((row) => row.label)).toEqual(['Codex 5-hour', 'spark 5-hour']);
  });

  it('shows credits, blocking and reset windows without inventing a percentage', () => {
    const rows = rateLimitRows([
      bucket('codex:credits', { credits: { hasCredits: true, balance: '12.50' } }),
      bucket('codex:enforcement', { enforcement: { allowed: false, reason: 'spend_control' } }),
      bucket('five_hour', { usedPercent: 100, resetAt: at(-1) }),
      bucket('seven_day', { usedPercent: 101, resetAt: at(24), enforcement: { status: 'rejected' } }),
      bucket('quiet', { enforcement: { allowed: true } }),
    ], NOW);
    expect(rows).toEqual([
      { key: 'five_hour', label: '5-hour', detail: 'Reset since last report', blocked: false },
      expect.objectContaining({ key: 'seven_day', percent: 101, blocked: true }),
      expect.objectContaining({ key: 'codex:enforcement', detail: 'Limit reached', blocked: true }),
      { key: 'codex:credits', label: 'Credits', detail: (12.5).toLocaleString([], { maximumFractionDigits: 2 }), blocked: false },
    ]);
  });

  it('shows extra usage only when it says something, and never as a blocked window', () => {
    expect(rateLimitRows([bucket('extra_usage', { overage: { isUsing: true } })], NOW))
      .toEqual([{ key: 'extra_usage', label: 'Extra usage', detail: 'In use', blocked: false }]);
    expect(rateLimitRows([bucket('overage', { overage: {} })], NOW)).toEqual([]);
    // Claude Code's real report on 2026-10-09: extra usage enabled, out of credits.
    expect(rateLimitRows([bucket('overage', {
      applicability: { kind: 'provider_pool', pool: 'overage' },
      overage: { status: 'rejected', reason: 'out_of_credits', isUsing: false, enabled: true },
      enforcement: { status: 'rejected' },
    })], NOW)).toEqual([{ key: 'overage', label: 'Extra usage', detail: 'Out of credits', blocked: false }]);
  });

  it('formats a long credit balance', () => {
    expect(rateLimitRows([bucket('codex:credits', { credits: { hasCredits: true, unlimited: false, balance: '49316.6808475000' } })], NOW)[0].detail)
      .toBe((49316.68).toLocaleString([], { maximumFractionDigits: 2 }));
  });
});

describe('ageLabel', () => {
  it.each([
    [-0.005, 'just now'],
    [-0.5, '30 min ago'],
    [-3, '3 hr ago'],
  ])('words an observation %s hours old', (hours, label) => {
    expect(ageLabel(at(hours), NOW)).toBe(label);
  });
});
