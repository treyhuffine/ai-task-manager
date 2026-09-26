/**
 * One worker per root (P2.7 to P2.9 re-check). Two workers over one root
 * would share its command and event journals and overwrite each other's
 * record of the processes they started, so a crash could leave a harness no
 * successor knows to stop. A worker takes this lock before it opens anything
 * of the root's, and holds it until it exits.
 *
 * The lock names its holder the way the process record does: pid, start
 * time and command line, so a pid reused since never passes for it. A second
 * worker is refused while the holder is still that same process, including a
 * second worker in the same process. A lock whose holder is gone, crashed
 * without releasing it, is taken over.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import { processIdentity, type ProcessIdentity } from './leftovers';

interface LockHolder extends ProcessIdentity {
  /** Which worker in its process holds it. */
  token: string;
}

export class WorkerLockedError extends Error {
  constructor(readonly holderPid: number) {
    super(`Another worker is already running for this computer (process ${holderPid}). Stop it first.`);
    this.name = 'WorkerLockedError';
  }
}

export interface WorkerLock {
  release(): void;
}

export function workerLockPath(): string {
  return path.join(getWorkDir(), 'worker.lock');
}

function readHolder(file: string): LockHolder | null {
  try {
    const holder = JSON.parse(fs.readFileSync(file, 'utf8')) as LockHolder;
    return typeof holder?.pid === 'number' && typeof holder.token === 'string' ? holder : null;
  } catch {
    return null;
  }
}

async function holderAlive(holder: LockHolder): Promise<boolean> {
  const now = await processIdentity(holder.pid);
  return !!now && now.started === holder.started && now.command === holder.command;
}

/** Take the root's worker lock, or throw `WorkerLockedError` naming the worker that holds it. */
export async function acquireWorkerLock(file = workerLockPath()): Promise<WorkerLock> {
  const self = await processIdentity(process.pid);
  if (!self) throw new Error("This worker couldn't identify its own process to lock its folder.");
  const token = randomUUID();
  const mine: LockHolder = { ...self, token };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 5; attempt++) {
    // Written whole, then linked into place: the link fails if a lock is
    // there, so there is never a moment with a lock file and no holder in it.
    const tmp = `${file}.${process.pid}.${token}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(mine), { mode: 0o600 });
    try {
      fs.linkSync(tmp, file);
      return {
        release() {
          if (readHolder(file)?.token === token) fs.rmSync(file, { force: true });
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    const holder = readHolder(file);
    if (holder && (holder.pid === process.pid || (await holderAlive(holder)))) {
      throw new WorkerLockedError(holder.pid);
    }
    // Gone, or unreadable: take it over, unless it changed hands meanwhile.
    if (JSON.stringify(readHolder(file)) === JSON.stringify(holder)) fs.rmSync(file, { force: true });
  }
  throw new Error("This worker couldn't take its folder's lock. Try again.");
}
