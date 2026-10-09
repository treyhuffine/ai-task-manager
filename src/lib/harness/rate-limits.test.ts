import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RateLimitBucket, RateLimitUpdate, StreamEvent } from '@agentex/agent';
import { parseStreamEvent } from '@/lib/runner/parse';
import { getHarnessRateLimits, mergeRateLimits, recordRateLimits } from './rate-limits';

const bucket = (id: string, observedAt: string, extra: Partial<RateLimitBucket> = {}): RateLimitBucket => ({
  id, owner: { kind: 'account' }, applicability: { kind: 'all_models' }, observedAt, ...extra,
});
const update = (buckets: RateLimitBucket[], observedAt: string, extra: Partial<RateLimitUpdate> = {}): RateLimitUpdate => ({
  mode: 'merge', snapshot: { provider: 'claude', buckets, observedAt }, ...extra,
});
const T1 = '2026-10-09T15:00:00.000Z';
const T2 = '2026-10-09T15:05:00.000Z';
const T3 = '2026-10-09T15:10:00.000Z';

describe('mergeRateLimits', () => {
  it('updates only the buckets a merge carries, and drops provider metadata', () => {
    const first = mergeRateLimits('claude', undefined, update([
      bucket('five_hour', T1, { usedPercent: 10, metadata: { native: true } }),
      bucket('seven_day', T1, { usedPercent: 40 }),
    ], T1));
    const next = mergeRateLimits('claude', first, update([bucket('five_hour', T2, { usedPercent: 25 })], T2));
    expect(next.observedAt).toBe(T2);
    expect(next.buckets.map((b) => [b.id, b.usedPercent])).toEqual([['five_hour', 25], ['seven_day', 40]]);
    expect(next.buckets[0]).not.toHaveProperty('metadata');
  });

  it('never lets an older observation overwrite or remove a newer one', () => {
    const current = mergeRateLimits('claude', undefined, update([bucket('five_hour', T3, { usedPercent: 60 })], T3));
    const late = mergeRateLimits('claude', current, update([bucket('five_hour', T1, { usedPercent: 5 })], T1, { removedBucketIds: ['five_hour'] }));
    expect(late.buckets).toEqual([expect.objectContaining({ id: 'five_hour', usedPercent: 60 })]);
    expect(late.observedAt).toBe(T3);
  });

  it('removes named buckets and replaced collections, and replace starts over', () => {
    const start = mergeRateLimits('claude', undefined, update([
      bucket('five_hour', T1, { usedPercent: 10 }),
      bucket('extra', T1),
      bucket('model_scoped:a', T1, { collectionId: 'model_scoped', usedPercent: 5 }),
    ], T1));
    const pruned = mergeRateLimits('claude', start, update([], T2, { removedBucketIds: ['extra'], replacedCollectionIds: ['model_scoped'] }));
    expect(pruned.buckets.map((b) => b.id)).toEqual(['five_hour']);
    const replaced = mergeRateLimits('claude', pruned, update([bucket('seven_day', T3, { usedPercent: 1 })], T3, { mode: 'replace' }));
    expect(replaced.buckets.map((b) => b.id)).toEqual(['seven_day']);
  });

  it('starts over when the account changes', () => {
    const a = mergeRateLimits('codex', undefined, { mode: 'merge', snapshot: { provider: 'codex', accountId: 'acct-a', buckets: [bucket('codex:primary', T1)], observedAt: T1 } });
    const b = mergeRateLimits('codex', a, { mode: 'merge', snapshot: { provider: 'codex', accountId: 'acct-b', buckets: [bucket('codex:secondary', T2)], observedAt: T2 } });
    expect(b).toMatchObject({ accountId: 'acct-b', buckets: [{ id: 'codex:secondary' }] });
  });
});

describe('recorded harness limits', () => {
  let dir: string;
  const slot = Symbol.for('ri.process.harness.rate-limits');
  const reset = () => { delete (globalThis as Record<symbol, unknown>)[slot]; };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-limits-'));
    process.env.RI_CONFIG_DIR = dir;
    reset();
  });
  afterEach(() => {
    delete process.env.RI_CONFIG_DIR;
    reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps one snapshot per harness in registry order and reads it back after a restart', () => {
    recordRateLimits('claude', update([bucket('five_hour', T1, { usedPercent: 42 })], T1));
    recordRateLimits('codex', { mode: 'merge', snapshot: { provider: 'codex', buckets: [bucket('codex:primary', T2, { usedPercent: 12, durationMs: 300 * 60_000 })], observedAt: T2 } });
    recordRateLimits('claude', update([bucket('seven_day', T3, { usedPercent: 61 })], T3));
    const expected = [
      { harness: 'codex', observedAt: T2, buckets: [expect.objectContaining({ id: 'codex:primary', usedPercent: 12 })] },
      { harness: 'claude', observedAt: T3, buckets: [expect.objectContaining({ id: 'five_hour' }), expect.objectContaining({ id: 'seven_day' })] },
    ];
    expect(getHarnessRateLimits()).toEqual(expected.map((entry) => expect.objectContaining(entry)));
    reset();
    expect(getHarnessRateLimits()).toEqual(expected.map((entry) => expect.objectContaining(entry)));
    expect(fs.statSync(path.join(dir, 'harness-rate-limits.json')).isFile()).toBe(true);
  });

  it('starts empty when nothing was saved', () => {
    expect(getHarnessRateLimits()).toEqual([]);
  });
});

describe('telemetry events in the transcript', () => {
  it.each([
    { type: 'rate_limits', update: update([bucket('five_hour', T1, { usedPercent: 3 })], T1) },
    { type: 'context_usage', usage: { usedTokens: 1000, capacityTokens: 200_000, observedAt: T1 } },
    { type: 'context_usage_invalidated', reason: 'compaction' },
  ])('stores no row for $type', (event) => {
    const full = { providerType: 'claude', sessionId: 's', messageId: null, eventId: null, turnId: null, parentToolCallId: null, timestamp: T1, raw: {}, ...event } as unknown as StreamEvent;
    expect(parseStreamEvent('chat-1', full)).toBeNull();
  });
});
