import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { untraced } from '@/lib/utils/untraced';
import { serviceIdentity } from './paths';
const execute = promisify(execFile);

async function descendants(parent: number) {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,comm=']);
  const rows = stdout.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), parent: Number(match[2]), name: match[3].split('/').pop()! } : null;
  }).filter(row => row !== null);
  const ids = new Set([parent]);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } }
  return rows.filter(row => row.pid !== parent && ids.has(row.pid));
}

export async function ownedProcesses(parent: number): Promise<string[]> {
  return (await descendants(parent)).map(row => row.name);
}

/** Every process under `parent`, for stopping a hung server's whole tree. */
export async function ownedProcessIds(parent: number): Promise<number[]> {
  return (await descendants(parent)).map(row => row.pid);
}

/** How long lsof gets before Ri stops waiting for it. */
export const LSOF_WAIT_MS = 30_000;

/** lsof never answered. */
export class LsofTimeout extends Error {}

/**
 * Runs lsof, giving up after `waitMs`. lsof checks every mounted volume when
 * it starts, so a single drive that stops answering (an external disk did on
 * 2026-11-10) leaves every lsof stuck in the kernel, where even SIGKILL
 * can't end it until the drive answers. Both execFile's own timeout and its
 * callback wait for the process to exit, so the wait here stops on its own
 * and lets go of the process. Resolves with stdout, and rejects as execFile
 * does with `code`, `stdout` and `stderr`, or with `LsofTimeout`.
 */
export function lsof(args: string[], waitMs = LSOF_WAIT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(untraced('lsof'), args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (error) reject(Object.assign(error, { stdout, stderr })); else resolve(stdout);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      reject(new LsofTimeout(`lsof didn't answer within ${waitMs / 1000} seconds`));
    }, waitMs);
  });
}

/** A legacy binary that predates access leases is not safe to migrate under.
 * lsof is required for managed activation on both supported host platforms. */
export async function assertNoLegacyWriters(waitMs = LSOF_WAIT_MS) {
  const database = serviceIdentity().database;
  // A restore moves the database aside for a moment. With no file there,
  // nothing holds it, and `lsof` would call the missing path an error, leaving
  // a crash during a restore unable to finish.
  if (!fs.existsSync(/* turbopackIgnore: true */ database)) return;
  let stdout = '';
  try { stdout = await lsof(['-t', database], waitMs); }
  catch (error) {
    // The update fails here and the Home starts again on the version it ran,
    // instead of staying offline for as long as the drive stays stuck.
    if (error instanceof LsofTimeout) throw new Error(`Ri couldn't check whether another program has this database open, because ${error.message}. A drive that stopped responding usually causes this. Eject or unplug it (or restart the computer), then update again.`);
    const result = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (Number(result.code) === 1 && !result.stdout && !result.stderr) return;
    throw new Error('Cannot prove that the database is closed. Install lsof and retry the update.');
  }
  if (stdout.trim()) throw new Error('Another process still has this database open. Stop the older CLI or application before updating.');
}
