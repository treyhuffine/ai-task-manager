import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
export { atomicWriteFile } from './atomic-write';

/** An OS-released interprocess lock, independent of the application's schema.
 * A tiny SQLite sidecar provides crash-safe advisory locking without expiring
 * a live process's lock or racing stale lockfile deletion. Never unlink it. */
export function withFileLock<T>(file: string, operation: () => T): T {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lockPath = `${file}.lock.sqlite`;
  const fd = fs.openSync(lockPath, 'a', 0o600);
  fs.closeSync(fd);
  const lock = new Database(lockPath, { timeout: 5000 });
  try {
    return lock.transaction(operation).immediate();
  } finally {
    lock.close();
  }
}
