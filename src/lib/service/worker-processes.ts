/** Only descendants observed under this worker, reidentified before each
 * signal. Shared harness binaries and unrelated shells are never selected by
 * name, path, or process group. */
import { ownProcesses, processIdentity, sameProcess, type ProcessIdentity } from '@/lib/worker/leftovers';

export async function workerDescendants(parent = process.pid): Promise<ProcessIdentity[]> {
  const found = new Map<number, ProcessIdentity>();
  const queue = [parent];
  while (queue.length) {
    const record = await ownProcesses(queue.shift()!);
    if (!record) continue;
    for (const child of record.children) {
      if (found.has(child.pid) || child.pid === process.pid) continue;
      found.set(child.pid, child); queue.push(child.pid);
      if (found.size > 1000) throw new Error('Too many local worker processes to verify cleanup safely.');
    }
  }
  // Children first, then their parents. Captured identities remain usable if
  // a harness close reparents descendants before cleanup gets to them.
  return [...found.values()].reverse();
}
/**
 * SIGTERM, then SIGKILL after `graceMs`, each only to a process still verified
 * as the one recorded. Returns the ones that may still run.
 *
 * A process this has delivered SIGKILL to is stopped even while `ps` still
 * lists it. SIGKILL can't be caught, blocked or ignored, so it never runs
 * another instruction of its own. The kernel can keep it listed for as long
 * as it likes: blocked in a system call that never returns (state U, as every
 * `lsof` on a Mac was one morning), or a zombie whose stuck parent never
 * collects it. Counting those as running left a chat refusing every message
 * and an update unable to drain, until the computer restarted.
 */
export async function stopWorkerDescendants(processes: ProcessIdentity[], graceMs = 2000, unchanged: (now: ProcessIdentity | null, recorded: ProcessIdentity) => boolean | null = sameProcess): Promise<ProcessIdentity[]> {
  const killed = new Set<number>();
  const signal = async (child: ProcessIdentity, kind: NodeJS.Signals) => {
    if (unchanged(await processIdentity(child.pid), child) !== true) return;
    try {
      process.kill(child.pid, kind);
      if (kind === 'SIGKILL') killed.add(child.pid);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const remaining = async () => {
    const values = await Promise.all(processes.map(async child => unchanged(await processIdentity(child.pid), child) !== false ? child : null));
    return values.filter((child): child is ProcessIdentity => child !== null);
  };
  for (const child of processes) await signal(child, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  let live = await remaining();
  while (live.length && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); live = await remaining(); }
  for (const child of live) await signal(child, 'SIGKILL');
  if (live.length) await new Promise(resolve => setTimeout(resolve, 50));
  return (await remaining()).filter(child => !killed.has(child.pid));
}
