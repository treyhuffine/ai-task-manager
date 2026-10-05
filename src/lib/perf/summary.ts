/**
 * Read the perf log (src/lib/perf/recorder.ts) back as a summary for `ri perf`:
 * the stalls and what caused them, slow statements grouped by SQL, and each
 * scope's rate and time.
 */

export interface PerfStall {
  t: string;
  ms: number;
  /** The scope whose statements took most of the stall, when the database did. */
  dbLabel: string | null;
  dbMs: number;
  sql: string | null;
  inFlight: string[];
}

export interface PerfSlowGroup {
  sql: string;
  n: number;
  totalMs: number;
  maxMs: number;
  labels: string[];
}

export interface PerfLabelRow {
  label: string;
  n: number;
  perMin: number;
  avgMs: number;
  maxMs: number;
  dbMs: number;
  dbN: number;
}

export interface PerfSummary {
  from: string | null;
  to: string | null;
  /** Minutes the rollups cover, the denominator for every rate. */
  minutes: number;
  starts: number;
  stalls: { count: number; totalMs: number; longest: PerfStall[] };
  slow: { count: number; groups: PerfSlowGroup[] };
  loop: { worstP99Ms: number | null; maxMs: number | null };
  byCalls: PerfLabelRow[];
  byDbTime: PerfLabelRow[];
}

interface Line {
  t?: string;
  type?: string;
  [key: string]: unknown;
}

interface StallLine extends Line {
  ms: number;
  db?: { ms: number; byLabel?: { label: string; ms: number }[] };
  slowest?: { sql: string; ms: number; label: string }[];
  inFlight?: { label: string; ms: number }[];
}

interface RollupLine extends Line {
  windowMs: number;
  loop?: { p99Ms?: number; maxMs?: number };
  labels?: Record<string, { n: number; ms: number; maxMs: number; dbMs: number; dbN: number }>;
}

export function summarizePerfLog(lines: Iterable<string>, options: { since?: number; top?: number } = {}): PerfSummary {
  const since = options.since ?? 0;
  const top = options.top ?? 15;
  let from: string | null = null;
  let to: string | null = null;
  let windowMs = 0;
  let starts = 0;
  const stalls: StallLine[] = [];
  const slow = new Map<string, PerfSlowGroup & { labelSet: Set<string> }>();
  let slowCount = 0;
  let worstP99: number | null = null;
  let maxLoop: number | null = null;
  const labels = new Map<string, { n: number; ms: number; maxMs: number; dbMs: number; dbN: number }>();

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    const at = typeof line.t === 'string' ? Date.parse(line.t) : NaN;
    if (!Number.isFinite(at) || at < since) continue;
    if (from === null || line.t! < from) from = line.t!;
    if (to === null || line.t! > to) to = line.t!;
    switch (line.type) {
      case 'start':
        starts++;
        break;
      case 'stall':
        stalls.push(line as StallLine);
        break;
      case 'slow': {
        slowCount++;
        const sql = String(line.sql ?? '');
        const key = fingerprint(sql);
        const ms = Number(line.ms) || 0;
        const group = slow.get(key) ?? { sql: key, n: 0, totalMs: 0, maxMs: 0, labels: [], labelSet: new Set<string>() };
        group.n++;
        group.totalMs += ms;
        group.maxMs = Math.max(group.maxMs, ms);
        group.labelSet.add(String(line.label ?? '(none)'));
        slow.set(key, group);
        break;
      }
      case 'rollup': {
        const rollup = line as RollupLine;
        windowMs += Number(rollup.windowMs) || 0;
        if (typeof rollup.loop?.p99Ms === 'number') worstP99 = Math.max(worstP99 ?? 0, rollup.loop.p99Ms);
        if (typeof rollup.loop?.maxMs === 'number') maxLoop = Math.max(maxLoop ?? 0, rollup.loop.maxMs);
        for (const [label, v] of Object.entries(rollup.labels ?? {})) {
          const row = labels.get(label) ?? { n: 0, ms: 0, maxMs: 0, dbMs: 0, dbN: 0 };
          row.n += v.n;
          row.ms += v.ms;
          row.maxMs = Math.max(row.maxMs, v.maxMs);
          row.dbMs += v.dbMs;
          row.dbN += v.dbN;
          labels.set(label, row);
        }
        break;
      }
    }
  }

  const minutes = windowMs / 60_000;
  const rows: PerfLabelRow[] = [...labels].map(([label, row]) => ({
    label,
    n: row.n,
    perMin: minutes > 0 ? round(row.n / minutes) : 0,
    avgMs: row.n > 0 ? round(row.ms / row.n) : 0,
    maxMs: round(row.maxMs),
    dbMs: round(row.dbMs),
    dbN: row.dbN,
  }));

  return {
    from,
    to,
    minutes: round(minutes),
    starts,
    stalls: {
      count: stalls.length,
      totalMs: round(stalls.reduce((sum, s) => sum + (Number(s.ms) || 0), 0)),
      longest: stalls
        .sort((a, b) => b.ms - a.ms)
        .slice(0, top)
        .map((s) => {
          const db = s.db?.byLabel?.[0];
          return {
            t: s.t!,
            ms: s.ms,
            dbLabel: db?.label ?? null,
            dbMs: s.db?.ms ?? 0,
            sql: s.slowest?.[0]?.sql ?? null,
            inFlight: (s.inFlight ?? []).map((f) => f.label),
          };
        }),
    },
    slow: {
      count: slowCount,
      groups: [...slow.values()]
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, top)
        .map(({ labelSet, ...group }) => ({ ...group, totalMs: round(group.totalMs), maxMs: round(group.maxMs), labels: [...labelSet] })),
    },
    loop: { worstP99Ms: worstP99, maxMs: maxLoop },
    byCalls: rows.filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, top),
    byDbTime: rows.filter((r) => r.dbMs > 0).sort((a, b) => b.dbMs - a.dbMs).slice(0, top),
  };
}

/** One group per query shape: an IN list of any length reads the same. */
function fingerprint(sql: string): string {
  return sql.replace(/\?(?:\s*,\s*\?)+/g, '?…').slice(0, 200);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** `30m`, `24h`, `7d` as milliseconds. */
export function parseDuration(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([mhd])$/i.exec(value.trim());
  if (!match) return null;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!.toLowerCase() as 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}
