/**
 * Reading another root's database without writing to that root.
 *
 * Ri databases run in WAL mode. Opening one, even read-only, creates its
 * `-wal` and `-shm` files when they don't exist yet, which is a write into a
 * root that is supposed to be only read (a stopped home, a production home
 * being backed up). `better-sqlite3` does not accept URI filenames, so
 * SQLite's `immutable` flag is not available. Instead:
 *
 * - When the sidecar files exist, the home may be running. Opening read-only
 *   creates nothing new and sees its latest committed writes.
 * - When they don't, nothing has the database open. Clone the file
 *   (copy-on-write on APFS, so instant and free) and read the clone.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export function hasSidecars(dbPath: string): boolean {
  return fs.existsSync(`${dbPath}-wal`) || fs.existsSync(`${dbPath}-shm`);
}

/** Copy a file, cloning it copy-on-write where the filesystem supports it. */
export function cloneFile(src: string, dest: string): void {
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
}

/**
 * Write a consistent copy of `dbPath` to `destPath`. The copy is switched to
 * rollback-journal mode, so reading it later never creates sidecar files
 * next to it. `getDb()` switches a restored database back to WAL on open.
 */
export async function copySourceDatabase(dbPath: string, destPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  let copied = false;
  if (!hasSidecars(dbPath)) {
    cloneFile(dbPath, destPath);
    // Something opened the database while it was being cloned. The clone may
    // be torn, so take the online backup instead.
    copied = !hasSidecars(dbPath);
    if (!copied) fs.rmSync(destPath, { force: true });
  }
  if (!copied) {
    const source = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      // The online backup restarts whenever another connection writes to the
      // source between steps, and a running home writes chat events all the
      // time. After the first step, copy every remaining page in one step so
      // a busy home can't keep it restarting.
      await source.backup(destPath, { progress: ({ totalPages }) => totalPages });
    } finally {
      source.close();
    }
  }
  const dest = new Database(destPath);
  try {
    dest.pragma('journal_mode = DELETE');
  } finally {
    dest.close();
  }
}

/**
 * Run `fn` against a read-only view of `dbPath` without writing into its
 * folder. A database with no sidecars is read from a temporary clone.
 */
export function withSourceDatabase<T>(dbPath: string, fn: (db: Database.Database) => T): T {
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}.`);
  let tmpDir: string | null = null;
  let target = dbPath;
  if (!hasSidecars(dbPath)) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-source-db-'));
    target = path.join(tmpDir, 'data.db');
    cloneFile(dbPath, target);
  }
  const db = new Database(target, { readonly: !tmpDir, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
