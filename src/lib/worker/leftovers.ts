/**
 * Processes a crashed worker left running (docs/homes-build.md, P2.8). A
 * worker stopped normally closes its sessions. One killed outright leaves
 * each harness orphaned, still working through the tool call it was on, even
 * though its turn will be reported cut off. So a worker starting up stops
 * what its predecessor left.
 *
 * Only what it can show its predecessor started (P2.7 to P2.9 review fixes).
 * A command line proves nothing: anyone's process can name any file. So a
 * worker writes down its own child processes, which is what agentex runs each
 * harness as: each one's pid, start time and command line, and its own, after
 * each command it handles and on every heartbeat. At startup, a leftover is a
 * recorded process that is still that same process, by start time and
 * command line, whose recorded worker is gone. It's checked again right
 * before each signal, so a pid reused in between is never signalled. Nothing
 * unrecorded is touched, whatever its command line says. A process started
 * and orphaned between two records is missed, which is the safe way to be
 * wrong.
 */

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getWorkDir } from '@/lib/config/paths';
import { writeFileAtomic } from './durable-file';

const run = promisify(execFile);

/** A process as `ps` shows it. `started` is its start time, which a reused pid doesn't share. */
export interface ProcessIdentity {
  pid: number;
  ppid: number;
  started: string;
  command: string;
  /** Linux kernel boot ID plus /proc start ticks. Stable across exec/adoption. */
  birthId?: string;
}

interface ProcessRecord {
  worker: ProcessIdentity;
  children: ProcessIdentity[];
}

export function processRecordPath(): string {
  return path.join(getWorkDir(), 'worker-processes.json');
}

// `lstart` in the C locale: "Fri Sep 26 06:45:12 2026".
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;

async function ps(args: string[]): Promise<{ processes: ProcessIdentity[]; psPid: number | undefined }> {
  const pending = run('ps', ['-ww', '-o', 'pid=,ppid=,lstart=,command=', ...args], {
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  const psPid = pending.child.pid;
  let stdout: string;
  try {
    stdout = (await pending).stdout;
  } catch (err) {
    // `ps -p` exits 1 when the process is gone, with nothing to parse.
    // A failed inspection (EMFILE, missing ps, etc.) proves no exit at all.
    if ((err as { code?: unknown }).code !== 1 || !args.includes('-p')) throw err;
    stdout = (err as { stdout?: string }).stdout ?? '';
  }
  return { processes: parsePs(stdout), psPid };
}

function parsePs(stdout: string): ProcessIdentity[] {
  const processes: ProcessIdentity[] = [];
  let bootId: string | undefined;
  if (process.platform === 'linux') {
    try { bootId = fs.readFileSync(/* turbopackIgnore: true */ '/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { /* identities remain unconfirmed without kernel proof */ }
  }
  for (const line of stdout.split('\n')) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const identity: ProcessIdentity = { pid: Number(match[1]), ppid: Number(match[2]), started: match[3]!.replace(/\s+/g, ' '), command: match[4]! };
    if (bootId) {
      try { identity.birthId = linuxProcessBirth(fs.readFileSync(/* turbopackIgnore: true */ `/proc/${identity.pid}/stat`, 'utf8'), bootId); } catch { /* process exited, or /proc is restricted */ }
    }
    processes.push(identity);
  }
  return processes;
}

/**
 * The processes with these pids now, by pid, read synchronously: for an exit
 * hook, which can't wait on anything.
 */
export function processIdentitiesSync(pids: number[]): Map<number, ProcessIdentity> {
  if (pids.length === 0) return new Map();
  let stdout: string;
  try {
    stdout = execFileSync('ps', ['-ww', '-o', 'pid=,ppid=,lstart=,command=', '-p', pids.join(',')], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // `ps -p` exits 1 when none of them is running.
    stdout = String((err as { stdout?: string }).stdout ?? '');
  }
  return new Map(parsePs(stdout).map((p) => [p.pid, p]));
}

/** The process with this pid now, or null when there is none. */
export async function processIdentity(pid: number): Promise<ProcessIdentity | null> {
  return (await ps(['-p', String(pid)])).processes.find((p) => p.pid === pid) ?? null;
}

/** Whether `now` is still the process `recorded` was: same start time and command line, so not a reused pid. */
export const sameProcess = (now: ProcessIdentity | null | undefined, recorded: ProcessIdentity) =>
  !!now && now.started === recorded.started && now.command === recorded.command;
/** /proc comm may contain spaces and parentheses. Field 22 is starttime. */
export function linuxProcessBirth(stat: string, bootId: string): string | undefined {
  const end = stat.lastIndexOf(')');
  if (end < 0 || !/^\d+ \(/.test(stat) || !bootId.trim()) return undefined;
  const ticks = stat.slice(end + 1).trim().split(/\s+/)[19];
  return ticks && /^\d+$/.test(ticks) ? `${bootId.trim()}:${ticks}` : undefined;
}

/** Exec preserves birth identity. Linux subreapers can adopt a tree under
 * any parent PID. Legacy records with an unexplained parent change are
 * ambiguous: keep them tracked, but do not signal an unproven identity. */
export function sameProcessLifetime(now: ProcessIdentity | null | undefined, recorded: ProcessIdentity): boolean | null {
  if (!now || now.pid !== recorded.pid) return false;
  if (recorded.birthId) return now.birthId ? now.birthId === recorded.birthId : null;
  if (now.started !== recorded.started) return false;
  return now.ppid === recorded.ppid || now.ppid === 1 ? true : null;
}
const same = sameProcess;

/** This process and its children, as they are now. */
export async function ownProcesses(self = process.pid): Promise<ProcessRecord | null> {
  const { processes, psPid } = await ps(['-ax']);
  const worker = processes.find((p) => p.pid === self);
  if (!worker) return null;
  return { worker, children: processes.filter((p) => p.ppid === self && p.pid !== psPid) };
}

/**
 * Write down this worker and its children. Records are taken one at a time,
 * so an older listing never lands after a newer one.
 */
export function processRecorder(file = processRecordPath()): () => Promise<void> {
  let chain = Promise.resolve();
  return () => {
    chain = chain.then(async () => {
      const record = await ownProcesses();
      if (record) writeFileAtomic(file, JSON.stringify(record));
    }).catch((err: unknown) => {
      console.warn(`[worker] couldn't record its processes: ${err instanceof Error ? err.message : String(err)}`);
    });
    return chain;
  };
}

function readRecord(file: string): ProcessRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ProcessRecord;
    return parsed?.worker && Array.isArray(parsed.children) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The recorded children of a worker that's gone, still running as the same
 * processes. None while that worker is still running.
 */
export async function findLeftovers(file = processRecordPath()): Promise<ProcessIdentity[]> {
  const record = readRecord(file);
  if (!record || record.worker.pid === process.pid) return [];
  if (same(await processIdentity(record.worker.pid), record.worker)) return [];
  const found: ProcessIdentity[] = [];
  for (const child of record.children) {
    if (same(await processIdentity(child.pid), child)) found.push(child);
  }
  return found;
}

/** Signal a recorded process only if it's still that process. */
async function signalIfSame(child: ProcessIdentity, signal: NodeJS.Signals): Promise<boolean> {
  if (!same(await processIdentity(child.pid), child)) return false;
  try {
    process.kill(child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop them: SIGTERM, then SIGKILL for any still the same process after the
 * grace period. Returns the pids stopped.
 */
export async function stopLeftovers(file = processRecordPath(), graceMs = 3_000): Promise<number[]> {
  const leftovers = await findLeftovers(file);
  const signalled: ProcessIdentity[] = [];
  for (const child of leftovers) {
    if (await signalIfSame(child, 'SIGTERM')) signalled.push(child);
  }
  const deadline = Date.now() + graceMs;
  const remaining = async () => {
    const still: ProcessIdentity[] = [];
    for (const child of signalled) if (same(await processIdentity(child.pid), child)) still.push(child);
    return still;
  };
  let still = await remaining();
  while (still.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    still = await remaining();
  }
  for (const child of still) await signalIfSame(child, 'SIGKILL');
  return signalled.map((c) => c.pid);
}
