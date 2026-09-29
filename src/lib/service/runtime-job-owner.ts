import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { serviceIdentity, canonical } from './paths';

export interface RuntimeJobOwner { pid: number; nonce: string }
const lockPath = (database: string) => `${canonical(database)}.jobs.lock.sqlite`;

/** Call only while owning the service's lifetime lock, before any DB opener.
 * An old helper's read transaction prevents this new epoch from committing,
 * including when that helper cannot process IPC disconnect during sync I/O. */
export function establishRuntimeJobOwner(database = serviceIdentity().database): RuntimeJobOwner {
  const file = lockPath(database);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(file, 'a', 0o600));
  const db = new Database(file, { timeout: 0 });
  try {
    db.exec('BEGIN EXCLUSIVE');
    db.exec('CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, nonce TEXT NOT NULL)');
    const owner = { pid: process.pid, nonce: randomBytes(32).toString('hex') };
    db.prepare('INSERT OR REPLACE INTO owner (id, pid, nonce) VALUES (1, ?, ?)').run(owner.pid, owner.nonce);
    db.exec('COMMIT');
    return owner;
  } finally { db.close(); }
}

/** The shared transaction spans the entire helper operation. Replacement
 * controllers take the exclusive side before recovering or opening SQLite.
 * A helper that starts late must also match the current epoch and parent. */
export function acquireRuntimeJobLease(owner: RuntimeJobOwner, database = serviceIdentity().database): () => void {
  const db = new Database(lockPath(database), { timeout: 0, fileMustExist: true });
  try {
    db.exec('BEGIN');
    const active = db.prepare('SELECT pid, nonce FROM owner WHERE id = 1').get() as RuntimeJobOwner | undefined;
    if (!active || active.pid !== owner?.pid || active.nonce !== owner?.nonce ||
        process.ppid !== owner.pid || !process.connected) {
      throw new Error('The initiating service no longer owns this runtime job');
    }
    let released = false;
    return () => { if (!released) { released = true; db.close(); } };
  } catch (error) { db.close(); throw error; }
}
