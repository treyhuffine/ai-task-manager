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

import { execFile } from 'node:child_process';
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
    stdout = (err as { stdout?: string }).stdout ?? '';
  }
  const processes: ProcessIdentity[] = [];
  for (const line of stdout.split('\n')) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    processes.push({ pid: Number(match[1]), ppid: Number(match[2]), started: match[3]!.replace(/\s+/g, ' '), command: match[4]! });
  }
  return { processes, psPid };
}

/** The process with this pid now, or null when there is none. */
export async function processIdentity(pid: number): Promise<ProcessIdentity | null> {
  return (await ps(['-p', String(pid)])).processes.find((p) => p.pid === pid) ?? null;
}

const same = (a: ProcessIdentity | null, b: ProcessIdentity) => !!a && a.started === b.started && a.command === b.command;

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
