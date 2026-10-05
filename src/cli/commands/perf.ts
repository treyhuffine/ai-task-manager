/**
 * `<app> perf`: what has been holding the server, read from its perf log
 * (src/lib/perf/recorder.ts, docs/server-perf-log.md). Stalls and their cause,
 * slow statements by SQL, and how often each request, procedure, action and
 * background job ran and what it cost.
 */
import fs from 'node:fs';
import type { Command } from 'commander';
import pc from 'picocolors';
import { APP_ROOT_ENV, getDevAppRoot } from '@/lib/config/paths';
import { perfLogPaths, SLOW_STATEMENT_MS, STALL_MS } from '@/lib/perf/recorder';
import { parseDuration, summarizePerfLog, type PerfLabelRow, type PerfSummary } from '@/lib/perf/summary';

interface PerfOptions {
  since: string;
  top: string;
  dev?: boolean;
  json?: boolean;
}

export function registerPerfCommand(program: Command): void {
  program
    .command('perf')
    .description('Show what has been holding the server: stalls, slow queries and request rates')
    .option('--since <duration>', 'how far back to read, like 30m, 24h or 7d', '24h')
    .option('--top <n>', 'rows in each section', '15')
    .option('--dev', 'read the dev home')
    .option('--json', 'print the summary as JSON')
    .action((opts: PerfOptions) => {
      if (opts.dev && !process.env[APP_ROOT_ENV]) process.env[APP_ROOT_ENV] = getDevAppRoot();
      const window = parseDuration(opts.since);
      const top = Number.parseInt(opts.top, 10);
      if (window === null || !Number.isInteger(top) || top < 1) {
        console.error('Use --since like 30m, 24h or 7d, and a whole number for --top.');
        process.exitCode = 1;
        return;
      }
      const paths = perfLogPaths();
      const files = [paths.previous, paths.current].filter((file) => fs.existsSync(file));
      if (files.length === 0) {
        console.log(`No perf log at ${paths.current} yet. The server writes it while it runs.`);
        return;
      }
      const lines = files.flatMap((file) => fs.readFileSync(file, 'utf8').split('\n'));
      const summary = summarizePerfLog(lines, { since: Date.now() - window, top });
      if (opts.json) console.log(JSON.stringify(summary, null, 2));
      else print(summary, paths.current, opts.since);
    });
}

function print(summary: PerfSummary, file: string, since: string): void {
  const dim = pc.dim;
  console.log(`${dim('log')}     ${file}`);
  if (!summary.from) {
    console.log(`Nothing recorded in the last ${since}.`);
    return;
  }
  const starts = summary.starts === 1 ? '1 server start' : `${summary.starts} server starts`;
  console.log(`${dim('covers')}  ${when(summary.from)} to ${when(summary.to!)}, ${summary.minutes} min of rollups, ${starts}`);
  if (summary.loop.worstP99Ms !== null) {
    console.log(`${dim('loop')}    worst minute's p99 delay ${duration(summary.loop.worstP99Ms)}, longest delay ${duration(summary.loop.maxMs ?? 0)}`);
  }

  console.log('');
  console.log(pc.bold(`Stalls, the thread blocked ${STALL_MS} ms or more: ${summary.stalls.count}`) + dim(`, ${duration(summary.stalls.totalMs)} in total`));
  for (const stall of summary.stalls.longest) {
    const cause = stall.dbLabel && stall.dbMs >= stall.ms / 2
      ? `${stall.dbLabel}, ${duration(stall.dbMs)} in the database`
      : `not the database${stall.inFlight.length ? `. In flight: ${stall.inFlight.slice(0, 4).join(', ')}` : ''}`;
    console.log(`  ${when(stall.t)}  ${pad(duration(stall.ms), 8)} ${cause}`);
    if (stall.sql && stall.dbMs >= stall.ms / 2) console.log(`  ${' '.repeat(19)}  ${' '.repeat(8)} ${dim(clip(stall.sql, 90))}`);
  }

  console.log('');
  console.log(pc.bold(`Slow statements, ${SLOW_STATEMENT_MS} ms or more: ${summary.slow.count}`));
  if (summary.slow.groups.length) console.log(dim(`  ${pad('count', 6)} ${pad('total', 9)} ${pad('max', 9)} sql, and what ran it`));
  for (const group of summary.slow.groups) {
    console.log(`  ${pad(String(group.n), 6)} ${pad(duration(group.totalMs), 9)} ${pad(duration(group.maxMs), 9)} ${clip(group.sql, 80)}`);
    console.log(`  ${' '.repeat(26)} ${dim(group.labels.slice(0, 3).join(', '))}`);
  }

  console.log('');
  console.log(pc.bold('Most called') + dim(` per minute, over ${summary.minutes} min`));
  table(summary.byCalls, ['calls', '/min', 'avg', 'max', 'db'], (r) => [String(r.n), String(r.perMin), duration(r.avgMs), duration(r.maxMs), duration(r.dbMs)]);

  console.log('');
  console.log(pc.bold('Most database time') + dim(' (after) is work a scope started that outlived it, (none) is unlabeled'));
  table(summary.byDbTime, ['db', 'statements', 'calls'], (r) => [duration(r.dbMs), String(r.dbN), String(r.n)]);
}

function table(rows: PerfLabelRow[], headers: string[], cells: (row: PerfLabelRow) => string[]): void {
  if (rows.length === 0) {
    console.log(pc.dim('  none'));
    return;
  }
  const width = Math.min(56, Math.max(...rows.map((r) => r.label.length)) + 2);
  console.log(pc.dim(`  ${pad('label', width)}${headers.map((h) => pad(h, 11)).join('')}`));
  for (const row of rows) console.log(`  ${pad(clip(row.label, width - 2), width)}${cells(row).map((c) => pad(c, 11)).join('')}`);
}

function duration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value.padEnd(width);
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
