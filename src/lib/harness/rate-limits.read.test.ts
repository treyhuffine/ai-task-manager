import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitUpdate, TelemetryObservation } from '@agentex/agent';

type Read = (ctx: unknown) => Promise<TelemetryObservation<RateLimitUpdate>>;
const reads = vi.hoisted(() => ({ claude: vi.fn<Read>(), codex: vi.fn<Read>() }));

vi.mock('./runtime', () => ({ runtimeContextForHarness: async () => ({ env: { HOME: '/home' }, config: { command: '/bin/x' } }) }));
vi.mock('@agentex/agent', () => ({
  getProvider: (id: string) => (id === 'claude' || id === 'codex' ? { readRateLimits: reads[id] } : {}),
}));

const { getHarnessRateLimits, rateLimitsNeedRead, readHarnessRateLimits, recordRateLimits, RATE_LIMIT_READ_AFTER_MS } = await import('./rate-limits');

const T0 = Date.parse('2026-10-09T22:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const observation = (provider: string, percent: number, at: number): TelemetryObservation<RateLimitUpdate> => ({
  support: 'supported', status: 'fresh', refreshSupported: true,
  value: { mode: 'replace', snapshot: { provider, observedAt: iso(at), buckets: [
    { id: 'five_hour', owner: { kind: 'account' }, applicability: { kind: 'all_models' }, usedPercent: percent, observedAt: iso(at) },
  ] } },
});
const unavailable: TelemetryObservation<RateLimitUpdate> = { support: 'unknown', status: 'unavailable', value: null, refreshSupported: false, reason: 'timed out' };

describe('reading rate limits outside a chat', () => {
  let dir: string;
  const slot = Symbol.for('ri.process.harness.rate-limits');
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-limits-read-'));
    process.env.RI_CONFIG_DIR = dir;
    delete (globalThis as Record<symbol, unknown>)[slot];
    reads.claude.mockReset();
    reads.codex.mockReset();
  });
  afterEach(() => {
    delete process.env.RI_CONFIG_DIR;
    delete (globalThis as Record<symbol, unknown>)[slot];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads each readable harness once, with its runtime context, and keeps the result', async () => {
    reads.claude.mockResolvedValue(observation('claude', 15, T0));
    reads.codex.mockResolvedValue(observation('codex', 40, T0));
    expect(rateLimitsNeedRead(T0)).toBe(true);
    const result = await readHarnessRateLimits(T0);
    expect(result.map((entry) => [entry.harness, entry.buckets[0]?.usedPercent])).toEqual([['codex', 40], ['claude', 15]]);
    expect(reads.claude).toHaveBeenCalledWith(expect.objectContaining({ env: { HOME: '/home' }, config: { command: '/bin/x' }, timeoutMs: 15_000 }));
    expect(rateLimitsNeedRead(T0 + 1000)).toBe(false);
    expect(getHarnessRateLimits()).toEqual(result);
  });

  it('skips a harness a chat reported on in the last minute, and reads it once that is older', async () => {
    recordRateLimits('claude', observation('claude', 9, T0).value!);
    reads.codex.mockResolvedValue(observation('codex', 40, T0));
    await readHarnessRateLimits(T0 + 30_000);
    expect(reads.claude).not.toHaveBeenCalled();
    expect(reads.codex).toHaveBeenCalledTimes(1);
    reads.claude.mockResolvedValue(observation('claude', 20, T0 + RATE_LIMIT_READ_AFTER_MS));
    await readHarnessRateLimits(T0 + RATE_LIMIT_READ_AFTER_MS);
    expect(reads.claude).toHaveBeenCalledTimes(1);
    expect(reads.codex).toHaveBeenCalledTimes(1);
  });

  it('lets a second hover join the read in flight', async () => {
    let finish!: (value: TelemetryObservation<RateLimitUpdate>) => void;
    reads.claude.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    reads.codex.mockResolvedValue(observation('codex', 40, T0));
    const first = readHarnessRateLimits(T0);
    const second = readHarnessRateLimits(T0 + 10);
    await vi.waitFor(() => expect(reads.claude).toHaveBeenCalled());
    finish(observation('claude', 15, T0));
    const [a, b] = await Promise.all([first, second]);
    expect(reads.claude).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(b.find((entry) => entry.harness === 'claude')?.buckets[0]?.usedPercent).toBe(15);
  });

  it('keeps the last numbers when a read fails, and waits a minute before trying again', async () => {
    recordRateLimits('claude', observation('claude', 9, T0 - 5 * 60_000).value!);
    reads.claude.mockResolvedValue(unavailable);
    reads.codex.mockRejectedValue(new Error('spawn failed'));
    const result = await readHarnessRateLimits(T0);
    expect(result).toEqual([expect.objectContaining({ harness: 'claude', buckets: [expect.objectContaining({ usedPercent: 9 })] })]);
    expect(rateLimitsNeedRead(T0 + 30_000)).toBe(false);
    await readHarnessRateLimits(T0 + 30_000);
    expect(reads.claude).toHaveBeenCalledTimes(1);
    expect(rateLimitsNeedRead(T0 + RATE_LIMIT_READ_AFTER_MS)).toBe(true);
  });
});
