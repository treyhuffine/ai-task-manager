/**
 * The perf recorder against a real better-sqlite3 database and real timers:
 * statements attributed to the scope around them, slow statements and stalls
 * written with their cause, the minute rollup, and log rotation.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginPerfScope,
  currentPerfLabel,
  flushPerfRollup,
  perfScope,
  startPerfRecorder,
  stopPerfRecorder,
} from './recorder';
import { startServerPerfLog } from './server';

/** About 0.3 to 0.5s on a laptop: past both the slow and the stall threshold. */
const SLOW_SQL = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < ?) SELECT count(*) AS n FROM c';
const SLOW_ROWS = 6_000_000;

let dir: string;
let logPath: string;
let db: Database.Database;

interface Logged { type: string; [key: string]: unknown }
const logged = (): Logged[] =>
  fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Logged) : [];
const ofType = (type: string) => logged().filter((l) => l.type === type);
const rollupLabels = () => {
  flushPerfRollup();
  const rollups = ofType('rollup');
  return rollups[rollups.length - 1]!.labels as Record<string, { n: number; ms: number; dbMs: number; dbN: number }>;
};
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 150));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-perf-'));
  logPath = path.join(dir, 'perf.jsonl');
  db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  startServerPerfLog({ logPath });
});

afterEach(() => {
  stopPerfRecorder();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('perf recorder', () => {
  it('starts the log with its thresholds', () => {
    expect(ofType('start')[0]).toMatchObject({ pid: process.pid, slowMs: 100, stallMs: 200 });
  });

  it('attributes each statement to the innermost scope, and work outside any to (none)', async () => {
    db.prepare('INSERT INTO t (v) VALUES (?)').run('outside');
    await perfScope('http:GET /api/x', async () => {
      db.prepare('SELECT * FROM t').all();
      await perfScope('action:create_task', async () => {
        expect(currentPerfLabel()).toBe('action:create_task');
        db.prepare('INSERT INTO t (v) VALUES (?)').run('inner');
      });
      expect(currentPerfLabel()).toBe('http:GET /api/x');
    });
    expect(currentPerfLabel()).toBeUndefined();
    const labels = rollupLabels();
    expect(labels['(none)']).toMatchObject({ n: 0, dbN: 1 });
    expect(labels['http:GET /api/x']).toMatchObject({ n: 1, dbN: 1 });
    expect(labels['action:create_task']).toMatchObject({ n: 1, dbN: 1 });
  });

  it('attributes work that outlives its scope as (after)', async () => {
    let later!: () => void;
    const done = new Promise<void>((resolve) => { later = resolve; });
    await perfScope('trpc:sessions.send', async () => {
      // A request that starts a run and answers before the run's work.
      setTimeout(() => { db.prepare('SELECT count(*) FROM t').get(); later(); }, 5);
    });
    await done;
    expect(rollupLabels()['trpc:sessions.send (after)']).toMatchObject({ n: 0, dbN: 1 });
  });

  it('times iterate across its rows, and exec', () => {
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 5; i++) insert.run(`row ${i}`);
    perfScope('job:read', () => {
      expect([...db.prepare('SELECT v FROM t').iterate()]).toHaveLength(5);
      db.exec('CREATE INDEX t_v ON t (v)');
    });
    expect(rollupLabels()['job:read']).toMatchObject({ n: 1, dbN: 2 });
  });

  it('writes a slow statement with its SQL and scope, never its parameters', () => {
    perfScope('trpc:claudeAuth.stuckSessionsGet', () => db.prepare(SLOW_SQL).get(SLOW_ROWS));
    const [slow] = ofType('slow');
    expect(slow).toMatchObject({ label: 'trpc:claudeAuth.stuckSessionsGet' });
    expect(slow).not.toHaveProperty('rows');
    expect(slow!.ms).toBeGreaterThanOrEqual(100);
    expect(slow!.sql).toBe(SLOW_SQL);
    expect(JSON.stringify(slow)).not.toContain(String(SLOW_ROWS));
  });

  it('writes a stall with the statements that held the thread and what was in flight', async () => {
    const waiting = beginPerfScope('http:GET /api/live');
    await nextTick();
    perfScope('trpc:claudeAuth.stuckSessionsGet', () => {
      db.prepare(SLOW_SQL).get(SLOW_ROWS);
      // Hold the thread past the stall threshold however fast the machine.
      const until = performance.now() + 250;
      while (performance.now() < until) { /* blocked, as a slow handler would be */ }
    });
    await nextTick();
    waiting.end();
    const [stall] = ofType('stall') as Array<Logged & { ms: number; db: { ms: number; byLabel: { label: string }[] }; slowest: { sql: string }[]; inFlight: { label: string }[] }>;
    expect(stall).toBeDefined();
    expect(stall!.ms).toBeGreaterThanOrEqual(200);
    expect(stall!.db.byLabel[0]!.label).toBe('trpc:claudeAuth.stuckSessionsGet');
    expect(stall!.slowest[0]!.sql).toBe(SLOW_SQL);
    expect(stall!.inFlight.map((f) => f.label)).toContain('http:GET /api/live');
    flushPerfRollup();
    expect((ofType('rollup').at(-1)!.loop as { stalls: number }).stalls).toBeGreaterThanOrEqual(1);
  });

  it('counts each scope with its time in the rollup, then starts a new minute', async () => {
    for (let i = 0; i < 3; i++) await perfScope('trpc:sessions.needsReviewGet', async () => db.prepare('SELECT 1').get());
    const first = rollupLabels()['trpc:sessions.needsReviewGet']!;
    expect(first).toMatchObject({ n: 3, dbN: 3 });
    expect(rollupLabels()['trpc:sessions.needsReviewGet']).toBeUndefined();
  });

  it('ends a scope when its promise rejects, and rethrows', async () => {
    await expect(perfScope('trpc:broken', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    expect(() => perfScope('job:sync', () => { throw new Error('sync nope'); })).toThrow('sync nope');
    const labels = rollupLabels();
    expect(labels['trpc:broken']).toMatchObject({ n: 1 });
    expect(labels['job:sync']).toMatchObject({ n: 1 });
  });

  it('rotates into perf.1.jsonl at the size cap, keeping one previous file', () => {
    stopPerfRecorder();
    startPerfRecorder({ logPath, maxBytes: 2_000 });
    for (let i = 0; i < 40; i++) perfScope('trpc:x', () => db.prepare(SLOW_SQL).get(10));
    for (let i = 0; i < 30; i++) flushPerfRollup();
    expect(fs.existsSync(path.join(dir, 'perf.1.jsonl'))).toBe(true);
    expect(fs.statSync(logPath).size).toBeLessThanOrEqual(2_000);
  });

  it('records nothing once stopped', () => {
    stopPerfRecorder();
    const before = fs.readFileSync(logPath, 'utf8');
    perfScope('trpc:quiet', () => db.prepare(SLOW_SQL).get(SLOW_ROWS));
    expect(fs.readFileSync(logPath, 'utf8')).toBe(before);
    expect(perfScope('trpc:quiet', () => 42)).toBe(42);
  });
});
