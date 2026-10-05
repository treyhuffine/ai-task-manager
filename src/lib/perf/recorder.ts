/**
 * The server's perf log: what holds the one thread the server runs on.
 *
 * better-sqlite3 runs every statement synchronously on that thread, so a slow
 * query, or any long stretch of synchronous work, makes every other request
 * wait (AGENTS.md, "Query cost"). This records enough to name the cause
 * afterwards, to `<work>/perf.jsonl`, read with `ri perf`:
 *
 * - `slow`: a statement that took `SLOW_STATEMENT_MS` or more, with its SQL
 *   (never its parameters) and the scope that ran it.
 * - `stall`: the thread was blocked `STALL_MS` or more, measured by a timer
 *   firing late, with the statements that ran in that time and what was in
 *   flight.
 * - `rollup`, once a minute: per scope, how many ran, their time and their
 *   database time, plus event-loop delay percentiles.
 *
 * A scope is a label for a unit of work: an HTTP request (`http:GET /api/x`),
 * a tRPC procedure (`trpc:tasks.list`), an orchestrator action, a timer, an
 * agent event being stored. Scopes ride AsyncLocalStorage, so a statement is
 * attributed to the innermost one around it. Work that outlives its scope
 * (a request that started an agent run) is attributed as `<label> (after)`,
 * and work in no scope as `(none)`, which is the cue to label it.
 *
 * State lives on globalThis: the service's HTTP host and Next's compiled
 * routes load separate copies of this module, and both must feed one log.
 * Nothing records until the server starts it at boot (`startServerPerfLog`
 * in ./server.ts, which also times every statement). Recording never throws
 * into the caller. Full description: docs/server-perf-log.md.
 *
 * This module never loads better-sqlite3, so the runner and worker, which
 * reach no database (src/lib/runner/boundary.test.ts), can open scopes too.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';
import { getWorkDir } from '@/lib/config/paths';

export const SLOW_STATEMENT_MS = 100;
export const STALL_MS = 200;
const TICK_MS = 100;
const ROLLUP_MS = 60_000;
/** Each of the two files. At a minute's rollup a line this holds about a week. */
const MAX_LOG_BYTES = 8 * 1024 * 1024;
/** Distinct labels per rollup before the rest fold into `other`. */
const MAX_LABELS = 400;
const SQL_CHARS = 400;
const IN_FLIGHT_SHOWN = 8;
const SLOWEST_KEPT = 3;

interface Scope {
  label: string;
  startedAt: number;
  ended: boolean;
}

interface LabelStats {
  n: number;
  ms: number;
  maxMs: number;
  dbMs: number;
  dbN: number;
}

interface StatementSample {
  sql: string;
  ms: number;
  label: string;
}

interface State {
  als: AsyncLocalStorage<Scope>;
  started: boolean;
  logPath: string | null;
  logBytes: number;
  maxBytes: number;
  warnedWrite: boolean;
  inFlight: Set<Scope>;
  labels: Map<string, LabelStats>;
  windowStartedAt: number;
  stalls: number;
  stalledMs: number;
  tickDbMs: number;
  tickDbN: number;
  tickByLabel: Map<string, { ms: number; n: number }>;
  tickSlowest: StatementSample[];
  lastTick: number;
  histogram: IntervalHistogram | null;
  timers: NodeJS.Timeout[];
}

const STATE_KEY = Symbol.for('ri.perf.recorder');

function state(): State {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: State };
  return (g[STATE_KEY] ??= {
    als: new AsyncLocalStorage<Scope>(),
    started: false,
    logPath: null,
    logBytes: 0,
    maxBytes: MAX_LOG_BYTES,
    warnedWrite: false,
    inFlight: new Set(),
    labels: new Map(),
    windowStartedAt: Date.now(),
    stalls: 0,
    stalledMs: 0,
    tickDbMs: 0,
    tickDbN: 0,
    tickByLabel: new Map(),
    tickSlowest: [],
    lastTick: 0,
    histogram: null,
    timers: [],
  });
}

/** `<work>/perf.jsonl` and the previous file it rotated into. */
export function perfLogPaths(workDir = getWorkDir()): { current: string; previous: string } {
  return { current: path.join(workDir, 'perf.jsonl'), previous: path.join(workDir, 'perf.1.jsonl') };
}

/**
 * Start recording for this process. Idempotent. The server starts it once at
 * boot through `startServerPerfLog`, and nothing else should: a CLI command
 * or a test that opens the database records nothing.
 */
export function startPerfRecorder(options: { logPath?: string; maxBytes?: number } = {}): void {
  const s = state();
  if (s.started) return;
  try {
    const logPath = options.logPath ?? perfLogPaths().current;
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    s.logPath = logPath;
    s.logBytes = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    s.maxBytes = options.maxBytes ?? MAX_LOG_BYTES;
  } catch (err) {
    console.warn('[perf] not recording:', err instanceof Error ? err.message : err);
    return;
  }
  s.started = true;
  s.windowStartedAt = Date.now();
  s.lastTick = performance.now();
  s.histogram = monitorEventLoopDelay({ resolution: 20 });
  s.histogram.enable();
  const tick = setInterval(checkEventLoop, TICK_MS);
  const rollup = setInterval(flushPerfRollup, ROLLUP_MS);
  tick.unref();
  rollup.unref();
  s.timers = [tick, rollup];
  write({ type: 'start', pid: process.pid, slowMs: SLOW_STATEMENT_MS, stallMs: STALL_MS });
}

/** Stop recording, writing what the current minute has so far. */
export function stopPerfRecorder(): void {
  const s = state();
  if (!s.started) return;
  flushPerfRollup();
  for (const timer of s.timers) clearInterval(timer);
  s.timers = [];
  s.histogram?.disable();
  s.histogram = null;
  s.started = false;
  s.inFlight.clear();
}

export interface PerfScopeHandle {
  /** Run `fn` inside the scope, so what it does is attributed to it. */
  run<T>(fn: () => T): T;
  /** Count the scope as done. What it started keeps running as `(after)`. */
  end(): void;
}

const IDLE_HANDLE: PerfScopeHandle = { run: (fn) => fn(), end: () => {} };

/** Open a scope whose end the caller decides, such as a response finishing. */
export function beginPerfScope(label: string): PerfScopeHandle {
  const s = state();
  if (!s.started) return IDLE_HANDLE;
  const scope: Scope = { label, startedAt: performance.now(), ended: false };
  s.inFlight.add(scope);
  return {
    run: (fn) => s.als.run(scope, fn),
    end: () => {
      if (scope.ended) return;
      scope.ended = true;
      s.inFlight.delete(scope);
      const ms = performance.now() - scope.startedAt;
      const stats = labelStats(s, label);
      stats.n++;
      stats.ms += ms;
      if (ms > stats.maxMs) stats.maxMs = ms;
    },
  };
}

/** Run `fn` as a scope that ends when it returns or, for a promise, settles. */
export function perfScope<T>(label: string, fn: () => T): T {
  const handle = beginPerfScope(label);
  if (handle === IDLE_HANDLE) return fn();
  let result: T;
  try {
    result = handle.run(fn);
  } catch (err) {
    handle.end();
    throw err;
  }
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    Promise.resolve(result).then(handle.end, handle.end);
  } else {
    handle.end();
  }
  return result;
}

/** The innermost open scope's label, if any. */
export function currentPerfLabel(): string | undefined {
  const scope = state().als.getStore();
  return scope && !scope.ended ? scope.label : undefined;
}

/** One statement's time. Called by the better-sqlite3 instrumentation. */
export function recordStatement(sql: string, ms: number, rows?: number): void {
  const s = state();
  if (!s.started) return;
  try {
    const scope = s.als.getStore();
    const label = scope ? (scope.ended ? `${scope.label} (after)` : scope.label) : '(none)';
    const stats = labelStats(s, label);
    stats.dbMs += ms;
    stats.dbN++;
    s.tickDbMs += ms;
    s.tickDbN++;
    const byLabel = s.tickByLabel.get(label);
    if (byLabel) {
      byLabel.ms += ms;
      byLabel.n++;
    } else {
      s.tickByLabel.set(label, { ms, n: 1 });
    }
    // Only the slowest few survive a tick, so most statements stop here.
    const slowest = s.tickSlowest;
    if (ms >= 1 && (slowest.length < SLOWEST_KEPT || ms > slowest[slowest.length - 1]!.ms)) {
      slowest.push({ sql: clipSql(sql), ms: round(ms), label });
      slowest.sort((a, b) => b.ms - a.ms);
      if (slowest.length > SLOWEST_KEPT) slowest.pop();
    }
    if (ms >= SLOW_STATEMENT_MS) {
      write({ type: 'slow', ms: round(ms), label, sql: clipSql(sql), ...(rows !== undefined ? { rows } : {}) });
    }
  } catch {
    // Recording must never fail the statement it measures.
  }
}

/**
 * A timer due every TICK_MS that fires late measures how long the thread was
 * held. Whatever ran in that time ran between this tick and the last.
 */
function checkEventLoop(): void {
  const s = state();
  const now = performance.now();
  const lag = now - s.lastTick - TICK_MS;
  s.lastTick = now;
  if (lag >= STALL_MS) {
    s.stalls++;
    s.stalledMs += lag;
    const byLabel = [...s.tickByLabel.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, 5)
      .map(([label, v]) => ({ label, ms: round(v.ms), n: v.n }));
    const inFlight = [...s.inFlight]
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, IN_FLIGHT_SHOWN)
      .map((scope) => ({ label: scope.label, ms: round(now - scope.startedAt) }));
    write({
      type: 'stall',
      ms: round(lag),
      db: { ms: round(s.tickDbMs), n: s.tickDbN, byLabel },
      slowest: s.tickSlowest,
      inFlight,
      inFlightTotal: s.inFlight.size,
    });
  }
  s.tickDbMs = 0;
  s.tickDbN = 0;
  s.tickByLabel = new Map();
  s.tickSlowest = [];
}

/** Write the current minute's rollup and start the next. */
export function flushPerfRollup(): void {
  const s = state();
  if (!s.started) return;
  const now = Date.now();
  const h = s.histogram;
  const loop: Record<string, number> = { stalls: s.stalls, stalledMs: round(s.stalledMs) };
  if (h && h.count > 0) {
    loop.p50Ms = round(h.percentile(50) / 1e6);
    loop.p99Ms = round(h.percentile(99) / 1e6);
    loop.maxMs = round(h.max / 1e6);
  }
  h?.reset();
  const labels: Record<string, LabelStats> = {};
  for (const [label, v] of s.labels) {
    labels[label] = { n: v.n, ms: round(v.ms), maxMs: round(v.maxMs), dbMs: round(v.dbMs), dbN: v.dbN };
  }
  write({ type: 'rollup', windowMs: now - s.windowStartedAt, loop, labels });
  s.labels = new Map();
  s.stalls = 0;
  s.stalledMs = 0;
  s.windowStartedAt = now;
}

function labelStats(s: State, label: string): LabelStats {
  let stats = s.labels.get(label);
  if (!stats) {
    const key = s.labels.size >= MAX_LABELS ? 'other' : label;
    stats = s.labels.get(key);
    if (!stats) {
      stats = { n: 0, ms: 0, maxMs: 0, dbMs: 0, dbN: 0 };
      s.labels.set(key, stats);
    }
  }
  return stats;
}

function write(record: Record<string, unknown>): void {
  const s = state();
  if (!s.logPath) return;
  try {
    const line = `${JSON.stringify({ t: new Date().toISOString(), ...record })}\n`;
    const bytes = Buffer.byteLength(line);
    if (s.logBytes + bytes > s.maxBytes) {
      try {
        fs.renameSync(s.logPath, perfLogPaths(path.dirname(s.logPath)).previous);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      s.logBytes = 0;
    }
    fs.appendFileSync(s.logPath, line, { mode: 0o600 });
    s.logBytes += bytes;
  } catch (err) {
    if (!s.warnedWrite) {
      s.warnedWrite = true;
      console.warn('[perf] log write failed:', err instanceof Error ? err.message : err);
    }
  }
}

function clipSql(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > SQL_CHARS ? `${flat.slice(0, SQL_CHARS)}…` : flat;
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
