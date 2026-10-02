import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { servicePaths } from './paths';

/** Held for the entire backend lifetime. The OS releases this on a crash.
 * All managed launchers use the same lock for the canonical DB path. */
export function acquireServiceOwner(): () => void {
  const file = servicePaths().ownerLock;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(file, 'a', 0o600));
  const lock = new Database(file, { timeout: 0 });
  try { lock.exec('BEGIN IMMEDIATE'); } catch {
    lock.close();
    throw new Error('Another Ri launcher owns this database. Attach to it or stop it before starting another.');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.exec('ROLLBACK');
    lock.close();
  };
}

/** Whether a launcher holds this database's owner lock right now, checked
 * without taking it or creating anything. Lets a second launcher refuse up
 * front with a reason, rather than start and fail on the lock. */
export function serviceOwnerHeld(): boolean {
  const file = servicePaths().ownerLock;
  if (!fs.existsSync(file)) return false;
  const lock = new Database(file, { timeout: 0, fileMustExist: true });
  try {
    lock.exec('BEGIN IMMEDIATE');
    lock.exec('ROLLBACK');
    return false;
  } catch (error) {
    if ((error as { code?: string }).code === 'SQLITE_BUSY') return true;
    throw error;
  } finally {
    lock.close();
  }
}
