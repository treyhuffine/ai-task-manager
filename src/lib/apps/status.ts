/**
 * An installed app's state, Restart and Logs (docs/personal-apps.md "Status, Restart and Logs",
 * shared spec §2 "Status"), from the kit's own `status`, `restart` and `logs` commands with `--json`
 * (the kit's `docs/safe-change.md`). Ri runs each with the app's own copy of the kit, as it runs
 * `serve --install` and `change`, so it never starts, stops or reads an app's process or data itself.
 *
 * An app made with an older kit has no such commands. Ri says so instead of guessing.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { processState } from '@/lib/process-state';
import { untraced } from '@/lib/utils/untraced';
import { AppBuildError, finish, foldKitLine, kitCliFor, newJob, pnpmCommand, requireFolder, runIn, type AppJob } from './builder';
import { appToolchain } from './toolchain';

export type AppState = 'running' | 'starting' | 'stopped' | 'not_installed' | 'unknown';

export interface AppStatus {
  state: AppState;
  /** When `state` is `unknown`: why Ri couldn't tell. */
  problem?: 'no_folder' | 'not_prepared' | 'kit_too_old' | 'failed';
  service?: string | null;
  pid?: number | null;
  since?: string | null;
  release?: string | null;
  answering?: string | null;
  core?: string | null;
  address?: string | null;
  lastChange?: { at?: string; outcome?: string; release?: string; previous?: string; message?: string; kind?: string } | null;
  /** The last error the kit found, set only when it isn't running. */
  lastError?: string | null;
  message?: string;
  checkedAt: string;
}

export interface AppLogLine { time: string | null; text: string }

const STATES = new Set<AppState>(['running', 'starting', 'stopped', 'not_installed']);
const KIT_TIMEOUT_MS = 30_000;

/** The last line of output that is a JSON object: the kit prints one for `status`. */
export function lastJsonObject(output: string): Record<string, unknown> | null {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const value = JSON.parse(lines[i]!);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* Not JSON. */ }
  }
  return null;
}

const text = (value: unknown, max = 1000) => (typeof value === 'string' ? value.slice(0, max) : null);

/** The kit's `status --json` object, kept to the fields Ri shows. */
export function parseStatus(raw: Record<string, unknown>, checkedAt: string): AppStatus {
  const state = STATES.has(raw.state as AppState) ? raw.state as AppState : 'unknown';
  const change = raw.lastChange && typeof raw.lastChange === 'object' ? raw.lastChange as Record<string, unknown> : null;
  return {
    state,
    ...(state === 'unknown' ? { problem: 'failed' as const, message: 'The app kit reported a state Ri doesn’t know.' } : {}),
    service: text(raw.service, 40), pid: typeof raw.pid === 'number' ? raw.pid : null, since: text(raw.since, 40),
    release: text(raw.release, 80), answering: text(raw.answering, 80), core: text(raw.core, 40), address: text(raw.address, 300),
    lastChange: change ? {
      ...(text(change.at, 40) ? { at: text(change.at, 40)! } : {}), ...(text(change.outcome, 40) ? { outcome: text(change.outcome, 40)! } : {}),
      ...(text(change.release, 80) ? { release: text(change.release, 80)! } : {}), ...(text(change.previous, 80) ? { previous: text(change.previous, 80)! } : {}),
      ...(text(change.message) ? { message: text(change.message)! } : {}), ...(text(change.kind, 40) ? { kind: text(change.kind, 40)! } : {}),
    } : null,
    lastError: text(raw.lastError),
    checkedAt,
  };
}

/**
 * Whether the kit didn't know the command: an app made before it had one. A kit that knows
 * `status`, `restart` or `logs --json` answers in JSON, so an answer with words but no JSON is the
 * kit's help (which older kits print, exiting 0, for a command they don't have).
 */
export function kitDidNotKnow(result: { code: number; stdout: string; stderr: string }): boolean {
  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const json = lines.some((line) => { try { return typeof JSON.parse(line) === 'object'; } catch { return false; } });
  if (json) return false;
  return (result.code === 0 && lines.length > 0) || /unknown command|usage:/i.test(result.stdout + result.stderr);
}

/** Terminal colors and cursor codes in a log line, which read as noise outside a terminal. */
const TERMINAL_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Run one of the kit's commands in the app's folder with Ri's toolchain, and return its output. */
function runKit(folder: string, args: string[], timeout = KIT_TIMEOUT_MS): Promise<{ code: number; stdout: string; stderr: string }> {
  const tools = appToolchain();
  const cli = kitCliFor(folder);
  return new Promise((resolve) => {
    execFile(untraced(pnpmCommand(tools)), ['exec', cli, ...args], { cwd: folder, env: { ...process.env, ...tools.env }, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function prepared(folder: string): boolean {
  return fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ folder, 'node_modules', '.bin'));
}

const cache = () => processState('apps.status.cache', () => new Map<string, { at: number; status: Promise<AppStatus> }>());
const CACHE_MS = 5_000;

/**
 * The app's state from the kit's `status --json`. Several views ask at once (the Apps page, the
 * app's page), so an answer is shared for a few seconds.
 */
export function appStatus(sourceId: string, options: { fresh?: boolean } = {}): Promise<AppStatus> {
  const cached = cache().get(sourceId);
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.status;
  const status = readStatus(sourceId);
  cache().set(sourceId, { at: Date.now(), status });
  return status;
}

async function readStatus(sourceId: string): Promise<AppStatus> {
  const checkedAt = new Date().toISOString();
  let folder: string;
  try { folder = requireFolder(sourceId).folder!; }
  catch (error) { return { state: 'unknown', problem: 'no_folder', message: error instanceof Error ? error.message : String(error), checkedAt }; }
  if (!prepared(folder)) return { state: 'unknown', problem: 'not_prepared', message: 'Its dependencies aren’t installed in its folder yet. Install and connect it first.', checkedAt };
  let result;
  try { result = await runKit(folder, ['status', '--json']); }
  catch (error) { return { state: 'unknown', problem: 'failed', message: error instanceof Error ? error.message : String(error), checkedAt }; }
  const raw = lastJsonObject(result.stdout);
  if (raw && 'state' in raw) return parseStatus(raw, checkedAt);
  if (kitDidNotKnow(result)) {
    return { state: 'unknown', problem: 'kit_too_old', message: 'This app was made with an older app kit, which can’t report its state. Update its kit to see it here.', checkedAt };
  }
  const reason = (result.stderr || result.stdout).trim().split('\n').pop() ?? '';
  return { state: 'unknown', problem: 'failed', message: `The app kit couldn’t read its state${reason ? `: ${reason.slice(0, 300)}` : '.'}`, checkedAt };
}

/** Restart the app's service with the kit's `restart --json`, as a job like an install. */
export function restartApp(sourceId: string): AppJob {
  const source = requireFolder(sourceId);
  const folder = source.folder!;
  if (!prepared(folder)) throw new AppBuildError('setup', `${source.name} isn’t installed yet. Install and connect it first.`);
  const tools = appToolchain();
  const cli = kitCliFor(folder);
  const job = newJob(source.id, 'restart');
  void (async () => {
    try {
      const { code, tail } = await runIn(tools, folder, pnpmCommand(tools), ['exec', cli, 'restart', '--json'], {}, (line) => foldKitLine(job, line));
      cache().delete(source.id);
      const outcome = job.result?.outcome;
      if (code === 0 && (outcome === 'restarted' || outcome === 'started' || outcome === 'running')) return finish(job, 'done');
      if (!job.result && kitDidNotKnow({ code, stdout: tail, stderr: '' })) return finish(job, 'failed', 'This app was made with an older app kit, which can’t restart it. Update its kit first.');
      finish(job, 'failed', job.result?.message || `The app kit couldn’t restart it: ${tail.trim().split('\n').pop() ?? ''}`);
    } catch (error) {
      finish(job, 'failed', error instanceof Error ? error.message : String(error));
    }
  })();
  return job;
}

export interface LogsQuery {
  /** How many lines from the end, 1 to 2000. */
  lines?: number;
  /** Only lines at or after this ISO time or span back (`15m`, `2h`, `1d`). */
  since?: string;
  /** The latest install, change or upgrade log instead of the server's. */
  change?: boolean;
}

const SINCE = /^(\d{1,4}[mhd]|\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2}))$/;

/** The end of the app's log from the kit's `logs --json`: the server's, or its last install or change. */
export async function appLogs(sourceId: string, query: LogsQuery = {}): Promise<{ lines: AppLogLine[]; message: string | null }> {
  const source = requireFolder(sourceId);
  const folder = source.folder!;
  if (!prepared(folder)) return { lines: [], message: `${source.name} isn’t installed yet.` };
  const lines = Math.max(1, Math.min(2000, Math.floor(query.lines ?? 500)));
  if (query.since && !SINCE.test(query.since)) throw new AppBuildError('invalid', 'Give a time like 15m, 2h or an ISO time.');
  const args = ['logs', '--json', '--lines', String(lines), ...(query.since ? ['--since', query.since] : []), ...(query.change ? ['--change'] : [])];
  const result = await runKit(folder, args);
  const parsed: AppLogLine[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as { time?: unknown; text?: unknown };
      if (typeof value.text === 'string') parsed.push({ time: typeof value.time === 'string' ? value.time : null, text: value.text.replace(TERMINAL_CODES, '').slice(0, 4000) });
    } catch { /* Not one of the kit's log lines. */ }
  }
  if (parsed.length || (result.code === 0 && !kitDidNotKnow(result))) return { lines: parsed.slice(-lines), message: null };
  if (kitDidNotKnow(result)) return { lines: [], message: 'This app was made with an older app kit, which can’t show its logs. Update its kit to see them here.' };
  if (query.change) return { lines: [], message: 'There’s no install or change log yet.' };
  return { lines: [], message: `The app kit couldn’t read its logs: ${(result.stderr || result.stdout).trim().split('\n').pop()?.slice(0, 300) ?? ''}` };
}
