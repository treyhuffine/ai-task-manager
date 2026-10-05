import { describe, expect, it } from 'vitest';
import { parseDuration, summarizePerfLog } from './summary';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 20, minute)).toISOString();
const line = (record: Record<string, unknown>) => JSON.stringify(record);

const LOG = [
  line({ t: at(0), type: 'start', pid: 1, slowMs: 100, stallMs: 200 }),
  line({ t: at(1), type: 'slow', ms: 51_200, label: 'trpc:claudeAuth.stuckSessionsGet', sql: 'WITH ranked_events AS (SELECT 1)' }),
  line({
    t: at(1), type: 'stall', ms: 51_300,
    db: { ms: 51_200, n: 1, byLabel: [{ label: 'trpc:claudeAuth.stuckSessionsGet', ms: 51_200, n: 1 }] },
    slowest: [{ sql: 'WITH ranked_events AS (SELECT 1)', ms: 51_200, label: 'trpc:claudeAuth.stuckSessionsGet' }],
    inFlight: [{ label: 'http:GET /api/live', ms: 90_000 }], inFlightTotal: 1,
  }),
  line({ t: at(2), type: 'stall', ms: 400, db: { ms: 5, n: 2, byLabel: [] }, slowest: [], inFlight: [{ label: 'trpc:tasks.list', ms: 380 }] }),
  line({ t: at(2), type: 'slow', ms: 150, label: 'trpc:executions.reviewContextGet', sql: 'SELECT id FROM chat_events WHERE session_id IN (?, ?)' }),
  line({ t: at(3), type: 'slow', ms: 250, label: 'trpc:tasks.attention', sql: 'SELECT id FROM chat_events WHERE session_id IN (?, ?, ?)' }),
  line({ t: at(2), type: 'rollup', windowMs: 60_000, loop: { stalls: 1, stalledMs: 51_300, p50Ms: 10, p99Ms: 20, maxMs: 51_300 }, labels: {
    'trpc:sessions.needsReviewGet': { n: 12, ms: 24, maxMs: 4, dbMs: 12, dbN: 12 },
    'ingest:codex': { n: 300, ms: 900, maxMs: 9, dbMs: 600, dbN: 900 },
  } }),
  line({ t: at(3), type: 'rollup', windowMs: 60_000, loop: { stalls: 1, stalledMs: 400, p50Ms: 10, p99Ms: 35, maxMs: 400 }, labels: {
    'trpc:sessions.needsReviewGet': { n: 12, ms: 36, maxMs: 6, dbMs: 12, dbN: 12 },
    'trpc:sessions.send (after)': { n: 0, ms: 0, maxMs: 0, dbMs: 2_000, dbN: 40 },
  } }),
  'not json',
  '',
];

describe('summarizePerfLog', () => {
  const summary = summarizePerfLog(LOG, { top: 10 });

  it('covers the time the rollups span, and counts server starts', () => {
    expect(summary).toMatchObject({ from: at(0), to: at(3), minutes: 2, starts: 1 });
    expect(summary.loop).toEqual({ worstP99Ms: 35, maxMs: 51_300 });
  });

  it('lists stalls longest first, naming the scope when the database held the thread', () => {
    expect(summary.stalls.count).toBe(2);
    expect(summary.stalls.totalMs).toBe(51_700);
    expect(summary.stalls.longest[0]).toMatchObject({
      ms: 51_300, dbLabel: 'trpc:claudeAuth.stuckSessionsGet', sql: 'WITH ranked_events AS (SELECT 1)', inFlight: ['http:GET /api/live'],
    });
    expect(summary.stalls.longest[1]).toMatchObject({ ms: 400, dbLabel: null, dbMs: 5, inFlight: ['trpc:tasks.list'] });
  });

  it('groups slow statements by shape, whatever the IN list length', () => {
    expect(summary.slow.count).toBe(3);
    const inList = summary.slow.groups.find((g) => g.sql.includes('IN (?…)'))!;
    expect(inList).toMatchObject({ n: 2, totalMs: 400, maxMs: 250 });
    expect(inList.labels.sort()).toEqual(['trpc:executions.reviewContextGet', 'trpc:tasks.attention']);
  });

  it('rates each scope per minute and ranks database time, including work that outlived its scope', () => {
    expect(summary.byCalls.map((r) => r.label)).toEqual(['ingest:codex', 'trpc:sessions.needsReviewGet']);
    expect(summary.byCalls.find((r) => r.label === 'trpc:sessions.needsReviewGet')).toMatchObject({ n: 24, perMin: 12, avgMs: 2.5, maxMs: 6 });
    expect(summary.byDbTime[0]).toMatchObject({ label: 'trpc:sessions.send (after)', dbMs: 2_000, n: 0 });
  });

  it('reads only what is newer than since', () => {
    const recent = summarizePerfLog(LOG, { since: Date.parse(at(3)) });
    expect(recent.stalls.count).toBe(0);
    expect(recent.slow.count).toBe(1);
    expect(recent.minutes).toBe(1);
  });
});

describe('parseDuration', () => {
  it('reads minutes, hours and days', () => {
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('24h')).toBe(86_400_000);
    expect(parseDuration('7d')).toBe(604_800_000);
    expect(parseDuration('1.5h')).toBe(5_400_000);
    expect(parseDuration('soon')).toBeNull();
  });
});
