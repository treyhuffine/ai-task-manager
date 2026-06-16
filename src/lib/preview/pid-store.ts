/**
 * Crash-safe PID tracking for command-mode preview processes.
 *
 * Why: the supervisor's process map lives in memory. If Flow crashes,
 * restarts, or `tsx` reloads on save, that map is gone — but the dev
 * server processes the supervisor spawned are still running, holding
 * their ports, leaking RAM. On next boot we'd happily spawn another set.
 *
 * Strategy:
 *   1. **At spawn**, before the child actually starts, write a small
 *      JSON file at `<brain>/preview/<key>.pid` containing
 *      `{ pid, pgid, command, startedAt }`. The key is the preview-target
 *      id (one supervised process per worktree/service). Persisted before
 *      the process is even running, so we never have a kid we don't know about.
 *   2. **At clean exit / stop**, delete the file.
 *   3. **On Flow boot**, scan the directory for stale entries:
 *      - If the pid is dead, just unlink the file.
 *      - If the pid is alive AND its command line matches the stored
 *        command, kill the process group (SIGTERM + grace + SIGKILL).
 *        The command check defends against PID recycling.
 *
 * `ps` is used cross-platform (macOS + Linux). Windows isn't supported
 * by the rest of the preview stack (no `sh -lc`), so we skip the
 * verification step there and just trust the PID.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkDir } from '@/lib/config/paths';

const execFileAsync = promisify(execFile);

export interface PidRecord {
  /** Preview-target id — the supervisor's process key. */
  key: string;
  pid: number;
  pgid: number;
  command: string;
  startedAt: string;
}

function getPreviewDir(): string {
  return path.join(getWorkDir(), 'preview');
}

function ensureDir(): string {
  const dir = getPreviewDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function recordPath(key: string): string {
  return path.join(getPreviewDir(), `${sanitize(key)}.pid`);
}

/** Defensive — keys are UUIDs so this is documentation, not real sanitization. */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function writePid(rec: PidRecord): void {
  const dir = ensureDir();
  const tmp = path.join(dir, `${sanitize(rec.key)}.pid.tmp`);
  const target = recordPath(rec.key);
  fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
  // Atomic move so a partial write never leaves a half-formed file.
  fs.renameSync(tmp, target);
}

export function deletePid(key: string): void {
  const p = recordPath(key);
  try {
    fs.unlinkSync(p);
  } catch {
    /* already gone — fine */
  }
}

export function listPidRecords(): PidRecord[] {
  const dir = getPreviewDir();
  if (!fs.existsSync(dir)) return [];
  const out: PidRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.pid')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf-8');
      const parsed = JSON.parse(raw) as PidRecord;
      if (
        typeof parsed === 'object' && parsed !== null &&
        typeof parsed.key === 'string' &&
        typeof parsed.pid === 'number' &&
        typeof parsed.command === 'string'
      ) {
        out.push(parsed);
      }
    } catch {
      /* skip malformed entries */
    }
  }
  return out;
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 — just probe existence.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function commandLineMatches(pid: number, expected: string): Promise<boolean> {
  try {
    // `ps -p <pid> -o command=` works on both macOS and Linux. Output is
    // the full command line of the process. We compare loosely — the
    // child was spawned as `sh -lc "<command>"`, so the actual command
    // appears as a substring of `args`. This is enough to distinguish
    // "our supervised process" from a PID-recycled unrelated one.
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], {
      timeout: 3_000,
    });
    return stdout.includes(expected.trim().split(/\s+/)[0] ?? '');
  } catch {
    // ps not available, or pid gone between isAlive and exec. Treat as
    // non-match to be conservative — we'd rather leak an orphan than
    // kill an unrelated process.
    return false;
  }
}

/**
 * Boot-time orphan sweep. Reads every record, decides for each whether
 * to kill the process, and returns a summary the instrumentation hook
 * can log. Safe to run unconditionally on every boot.
 */
export async function sweepOrphans(): Promise<{ checked: number; killed: number; skipped: number }> {
  const records = listPidRecords();
  let killed = 0;
  let skipped = 0;
  for (const rec of records) {
    try {
      if (!isAlive(rec.pid)) {
        deletePid(rec.key);
        continue;
      }
      const match = await commandLineMatches(rec.pid, rec.command);
      if (!match) {
        // PID is alive but doesn't look like ours. Don't kill — leave
        // the stale file so an operator can investigate.
        skipped++;
        continue;
      }
      // Kill the whole group.
      try {
        if (rec.pgid && rec.pgid !== rec.pid) {
          process.kill(-rec.pgid, 'SIGTERM');
        } else {
          process.kill(-rec.pid, 'SIGTERM');
        }
      } catch {
        try { process.kill(rec.pid, 'SIGTERM'); } catch { /* dead already */ }
      }
      // 2s grace, then SIGKILL.
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      if (isAlive(rec.pid)) {
        try {
          if (rec.pgid && rec.pgid !== rec.pid) {
            process.kill(-rec.pgid, 'SIGKILL');
          } else {
            process.kill(-rec.pid, 'SIGKILL');
          }
        } catch {
          try { process.kill(rec.pid, 'SIGKILL'); } catch { /* fine */ }
        }
      }
      deletePid(rec.key);
      killed++;
    } catch {
      skipped++;
    }
  }
  return { checked: records.length, killed, skipped };
}
