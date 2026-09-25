/**
 * Harness processes a crashed worker left running (docs/homes-build.md,
 * P2.8). A worker stopped normally closes its sessions. One killed outright
 * leaves each harness orphaned, still working through the tool call it was
 * on, even though its turn will be reported cut off. So a worker starting
 * up stops what its predecessor left.
 *
 * It finds them by what's certain: an orphan (its parent is gone) whose
 * command line names this worker's own session instructions folder, which
 * every harness it starts is given. Another worker's harnesses, anything the
 * user runs, and a process that happens to reuse an old pid never match.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { getWorkDir } from '@/lib/config/paths';

const run = promisify(execFile);

/** Orphaned processes whose command line names `marker`. */
export async function findLeftovers(marker: string): Promise<number[]> {
  let listing: string;
  try {
    listing = (await run('ps', ['-axww', '-o', 'pid=,ppid=,command='], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  } catch {
    return [];
  }
  const found: number[] = [];
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, command] = match;
    if (ppid === '1' && command!.includes(marker) && Number(pid) !== process.pid) found.push(Number(pid));
  }
  return found;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stop them: SIGTERM, then SIGKILL for any still there after the grace period. Returns the pids stopped. */
export async function stopLeftoverHarnesses(
  marker = path.join(getWorkDir(), 'session-instructions') + path.sep,
  graceMs = 3_000,
): Promise<number[]> {
  const pids = await findLeftovers(marker);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + graceMs;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  for (const pid of pids.filter(alive)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  return pids;
}
