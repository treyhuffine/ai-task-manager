/**
 * Retiring a home (docs/homes-spec.md §10.2-10.3): after its records were
 * brought into another home, or the home moved to another device.
 * "Retirement writes a durable role marker checked at startup", so the old
 * root never runs as a home beside the new one, and "the old host can then
 * enroll as a worker".
 *
 * Retiring moves the stopped home's database and this machine's identity
 * into `<root>/.retired/<time>/`, beside a note of what it was and where it
 * went. Nothing is deleted, and nothing else in the folder moves: execution
 * worktrees under `.work` stay where the imported executions expect them,
 * and the folder can connect to the home that took over (`ri connect`),
 * whose worker uses them. A database is never created again in a folder with
 * a retired home, unless the retirement is undone, so starting Ri there by
 * habit says what happened instead of opening an empty new home.
 *
 * The database is only checkpointed (its write-ahead log folded in) before it
 * moves, never migrated: a home retired from an older version stays exactly
 * as that version left it.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getAppRoot, getConnectionPath, getDbPath, getMachineIdentityPath } from '@/lib/config/paths';
import { readLiveServerRuntime } from '@/lib/server-runtime/record';
import { exclusiveDatabaseAccess } from '@/lib/service/maintenance';
import { RETIRED_DIR, RETIRED_MARKER, retiredHomes, type RetiredHome } from './retired';

export { assertNotRetired, describeRetired, RetiredHomeError, retiredHomes, type RetiredHome } from './retired';

export class RetireError extends Error {}

const COUNTED = ['tasks', 'notes', 'workspaces', 'chat_sessions', 'executions'] as const;

/** Refuse while anything has the home's database open: its server, a script, the desktop app. */
export function assertStopped(dbPath: string, doing = 'retire it'): void {
  if (readLiveServerRuntime()) throw new RetireError(`Ri is running from this folder. Stop it first, then ${doing}.`);
  try {
    exclusiveDatabaseAccess(dbPath)();
  } catch {
    throw new RetireError(`Something has ${dbPath} open. Stop it first, then ${doing}.`);
  }
}

/** What the database says it is, read without migrating it. */
function describeDatabase(db: Database.Database): Pick<RetiredHome, 'homeId' | 'homeName' | 'host' | 'counts'> {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name));
  const counts: Record<string, number> = {};
  for (const t of COUNTED) if (tables.has(t)) counts[t] = (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n;
  const home = tables.has('home') ? (db.prepare('SELECT id, name, host_device_id AS host FROM home LIMIT 1').get() as { id: string; name: string; host: string } | undefined) : undefined;
  const host = home && tables.has('devices') ? (db.prepare('SELECT name FROM devices WHERE id = ?').get(home.host) as { name: string } | undefined) : undefined;
  return { homeId: home?.id ?? null, homeName: home?.name ?? 'My Ri', host: host?.name ?? null, counts };
}

/** Retire the stopped home in this folder. Returns where its data went. */
export function retireHome(opts: { successor?: string | null } = {}): { dir: string; retired: RetiredHome } {
  const dbPath = getDbPath();
  if (fs.existsSync(getConnectionPath())) throw new RetireError('This folder is connected to a home elsewhere, so it has no home of its own to retire.');
  if (!fs.existsSync(dbPath)) throw new RetireError('This folder has no home to retire.');
  assertStopped(dbPath);

  // Fold the write-ahead log into the database, so the file that moves is
  // the whole home. Nothing else is written: no migration, no identity.
  const db = new Database(dbPath, { fileMustExist: true });
  let about: ReturnType<typeof describeDatabase>;
  try {
    about = describeDatabase(db);
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }

  const retiredAt = new Date().toISOString();
  const dir = path.join(getAppRoot(), RETIRED_DIR, retiredAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const retired: RetiredHome = { version: 1, ...about, retiredAt, successor: opts.successor?.trim() || null };
  // The note first, so a folder with its database moved aside always says why.
  writeAtomic(path.join(dir, RETIRED_MARKER), JSON.stringify(retired, null, 2) + '\n');
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, getMachineIdentityPath()]) {
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dir, path.basename(file)));
  }
  return { dir, retired };
}

/** Bring back the home retired last in this folder, as it was. */
export function undoRetire(): { dir: string; retired: RetiredHome } {
  const dbPath = getDbPath();
  if (fs.existsSync(getConnectionPath())) {
    throw new RetireError('This folder is connected to a home elsewhere. Disconnect it first (`ri disconnect`), then bring its old home back.');
  }
  if (fs.existsSync(dbPath)) throw new RetireError('This folder already has a home. Nothing was changed.');
  const latest = retiredHomes()[0];
  if (!latest) throw new RetireError('No retired home in this folder.');
  const machine = getMachineIdentityPath();
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, machine]) {
    const kept = path.join(latest.dir, path.basename(file));
    if (!fs.existsSync(kept)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.renameSync(kept, file);
  }
  fs.rmSync(path.join(latest.dir, RETIRED_MARKER));
  // Empty now, unless something else was put there: then it stays.
  if (fs.readdirSync(latest.dir).length === 0) fs.rmdirSync(latest.dir);
  return latest;
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
