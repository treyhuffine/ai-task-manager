import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serviceIdentity } from './paths';
const execute = promisify(execFile);

export async function ownedProcesses(parent: number): Promise<string[]> {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,comm=']);
  const rows = stdout.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), parent: Number(match[2]), name: match[3].split('/').pop()! } : null;
  }).filter(row => row !== null);
  const ids = new Set([parent]);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } }
  return rows.filter(row => row.pid !== parent && ids.has(row.pid)).map(row => row.name);
}

/** A legacy binary that predates access leases is not safe to migrate under.
 * lsof is required for managed activation on both supported host platforms. */
export async function assertNoLegacyWriters() {
  let stdout = '';
  try { ({ stdout } = await execute('lsof', ['-t', serviceIdentity().database])); }
  catch (error) {
    const result = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (Number(result.code) === 1 && !result.stdout && !result.stderr) return;
    throw new Error('Cannot prove that the database is closed. Install lsof and retry the update.');
  }
  if (stdout.trim()) throw new Error('Another process still has this database open. Stop the older CLI or application before updating.');
}
