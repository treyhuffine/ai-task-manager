import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { canonical } from './paths';
import { getDbPath } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-file';

export interface MaintenanceGate { phase: 'draining' | 'offline'; token: string; startedAt: string }
export function gatePath(database = getDbPath()) { return `${canonical(database)}.maintenance.json`; }
export function readMaintenance(database?: string): MaintenanceGate | null {
  try { return JSON.parse(fs.readFileSync(gatePath(database), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export function writeMaintenance(gate: MaintenanceGate, database?: string) { atomicWriteFile(gatePath(database), JSON.stringify(gate)); }
export function clearMaintenance(database?: string) { fs.rmSync(gatePath(database), { force: true }); }
export class MaintenanceError extends Error {
  constructor() { super('Ri is preparing an update. Please retry shortly.'); this.name = 'MaintenanceError'; }
}

/** Rollback-journal locks are shared across processes and released by the OS
 * after a crash. Never unlink these sidecars or replace them with timed leases. */
function lock(database: string, kind: 'access' | 'activity', exclusive: boolean) {
  const file = `${canonical(database)}.${kind}.sqlite`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(file, 'a', 0o600));
  const db = new Database(file, { timeout: 0 });
  try {
    // A first opener initializes before admitting readers. Read-only SELECT
    // must actually touch a table, not SELECT 1, to acquire a shared lock.
    if (!(db.prepare("SELECT name FROM sqlite_master WHERE name='lease'").get())) {
      db.exec('CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY)');
    }
    db.exec(exclusive ? 'BEGIN EXCLUSIVE' : 'BEGIN');
    db.prepare('SELECT * FROM lease').all();
    let closed = false;
    return () => { if (!closed) { closed = true; db.close(); } };
  } catch (error) { db.close(); throw error; }
}

export function acquireDatabaseAccess(database: string): () => void {
  const gate = readMaintenance(database);
  if (gate?.phase === 'offline' && gate.token === process.env.RI_MAINTENANCE_TOKEN) return () => {};
  let release: () => void;
  try { release = lock(database, 'access', false); } catch { throw new MaintenanceError(); }
  if (readMaintenance(database)?.phase === 'offline') { release(); throw new MaintenanceError(); }
  return release;
}
export function exclusiveDatabaseAccess(database = getDbPath()) { return lock(database, 'access', true); }
export function exclusiveActivity(database = getDbPath()) { return lock(database, 'activity', true); }

export function beginActivity(database = getDbPath(), allowDrain = false): () => void {
  let release: () => void;
  try { release = lock(database, 'activity', false); } catch { throw new MaintenanceError(); }
  const gate = readMaintenance(database);
  if (gate && !(allowDrain && gate.phase === 'draining')) { release(); throw new MaintenanceError(); }
  return release;
}
export async function withActivity<T>(operation: () => Promise<T>): Promise<T> {
  const release = beginActivity();
  try { return await operation(); } finally { release(); }
}
