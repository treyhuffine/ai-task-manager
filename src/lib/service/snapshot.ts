/**
 * The snapshot an update takes before it changes anything (docs/always-on-spec.md
 * section 7.4 step 3): the database and the config folder, every update.
 *
 * - The database copy includes writes still in its log. With the server
 *   stopped and the exclusive access lease held, `wal_checkpoint(TRUNCATE)`
 *   moves them into the main file, which is then cloned (APFS `clonefile`, or a
 *   reflink on Linux): instant, and free until the database changes. If the
 *   log can't be emptied or the disk can't clone, SQLite's backup API copies it.
 * - It lives in the Home's work folder, on the same disk as the database, so a
 *   restore renames instead of copying and needs no space beyond what is there.
 * - Each Home keeps one, replaced at its next update and deleted after 7 days.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { serviceIdentity } from './paths';
import { restoreCheckpointDatabase } from './checkpoint';
import { untraced } from '@/lib/utils/untraced';

/** Room an update needs beyond the snapshot itself. A clone starts out free but
 * grows as the update rewrites pages, and SQLite needs room for its log. A
 * migration that still runs out fails safely: it runs in one transaction,
 * during the check-only start, before anything is committed. */
export const SNAPSHOT_MARGIN_BYTES = 2 * 1024 ** 3;
export const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const STALE_PARTIAL_MS = 60 * 60_000;
/** Tables whose newest row tells a manual rollback what it would lose. */
const CHANGE_TABLES = ['chat_events', 'chat_sessions', 'tasks', 'notes'] as const;
/** Not copied: the agent browser's Chromium profile (gigabytes, open while
 * the Home runs, never migrated), the desktop app's profile, live locks. */
const CONFIG_SKIP = new Set(['browser', 'electron-demo']);
const VOLATILE = /\.(?:lock|owner|activity|access)\.sqlite(?:-journal|-wal|-shm)?$/;
/** statfs f_type for APFS. */
const APFS = 26;

type Identity = ReturnType<typeof serviceIdentity>;

export interface SnapshotManifest {
  format: 2;
  identity: Identity;
  createdAt: string;
  /** The release the Home ran before the update, and the one it moved to. */
  from: string;
  to: string;
  cloned: boolean;
  /** Config files saved, relative to the config folder. */
  config: string[];
  /** The newest rowid per table at the snapshot, for counting what came after. */
  rowids: Partial<Record<(typeof CHANGE_TABLES)[number], number>>;
}

export class SnapshotSpaceError extends Error {}

export function snapshotRoot(identity: Identity = serviceIdentity()) {
  return path.join(/* turbopackIgnore: true */ identity.work, 'update-snapshots');
}

function sizeOf(file: string) {
  try { return fs.statSync(/* turbopackIgnore: true */ file).size; } catch { return 0; }
}

export function freeBytes(directory: string) {
  const stat = fs.statfsSync(/* turbopackIgnore: true */ directory);
  return Number(stat.bavail) * Number(stat.bsize);
}

function gib(bytes: number) { return `${(bytes / 1024 ** 3).toFixed(1)} GiB`; }

function fsyncPath(file: string) {
  const fd = fs.openSync(/* turbopackIgnore: true */ file, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/**
 * An instant copy that shares the original's blocks until either changes.
 * macOS: clonefile, through `cp -c`. Node's FICLONE flag makes a full copy
 * there, which on a nearly full disk would fill it. Checked first: the same
 * APFS volume, since `cp -c` quietly copies when it can't clone. Linux: the
 * FICLONE ioctl, on btrfs or xfs. False when this disk can't clone.
 */
/** Whether `cp -c` clones from `source` into `directory`: the same APFS volume. */
export function clonesOnMac(source: string, directory: string) {
  return process.platform === 'darwin' && fs.statSync(/* turbopackIgnore: true */ source).dev === fs.statSync(/* turbopackIgnore: true */ directory).dev
    && fs.statfsSync(/* turbopackIgnore: true */ directory).type === APFS;
}

function cloneFile(source: string, target: string) {
  const directory = path.dirname(target);
  if (process.platform === 'darwin') {
    if (!clonesOnMac(source, directory)) return false;
    try { execFileSync(untraced('/bin/cp'), ['-c', source, target], { stdio: 'ignore' }); return true; }
    catch { fs.rmSync(/* turbopackIgnore: true */ target, { force: true }); return false; }
  }
  try { fs.copyFileSync(/* turbopackIgnore: true */ source, target, fs.constants.COPYFILE_FICLONE_FORCE); return true; }
  catch { fs.rmSync(/* turbopackIgnore: true */ target, { force: true }); return false; }
}

/** Move committed writes out of the log, and note the newest row per table. */
function checkpointDatabase(database: string) {
  const db = new Database(database, { fileMustExist: true, timeout: 5000 });
  let busy = 1;
  const rowids: SnapshotManifest['rowids'] = {};
  try {
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
    busy = result[0]?.busy ?? 1;
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]);
    for (const table of CHANGE_TABLES) {
      if (tables.has(table)) rowids[table] = Number(db.prepare(`SELECT COALESCE(MAX(rowid), 0) FROM "${table}"`).pluck().get());
    }
  } finally { db.close(); }
  // Closing the last connection removes an emptied log. A log that is still
  // there with content means another connection kept writes in it.
  return { checkpointed: busy === 0 && sizeOf(`${database}-wal`) === 0, rowids };
}

function copyConfig(source: string, destination: string) {
  const saved: string[] = [];
  if (!fs.existsSync(/* turbopackIgnore: true */ source)) return saved;
  const walk = (relative: string) => {
    const from = path.join(/* turbopackIgnore: true */ source, relative);
    for (const entry of fs.readdirSync(/* turbopackIgnore: true */ from, { withFileTypes: true })) {
      const name = relative ? path.join(/* turbopackIgnore: true */ relative, entry.name) : entry.name;
      if (!relative && CONFIG_SKIP.has(entry.name)) continue;
      if (VOLATILE.test(entry.name)) continue;
      if (entry.isDirectory()) { walk(name); continue; }
      if (!entry.isFile()) continue; // sockets and links are live endpoints, not recovery data
      const target = path.join(/* turbopackIgnore: true */ destination, name);
      fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ source, name), target, fs.constants.COPYFILE_FICLONE);
      saved.push(name);
    }
  };
  walk('');
  return saved.sort();
}

export interface SnapshotOptions { from: string; to: string; identity?: Identity; now?: number; margin?: number }

/** Called only with the server stopped and the exclusive access lease held. */
export async function createSnapshot(options: SnapshotOptions): Promise<string> {
  const identity = options.identity ?? serviceIdentity();
  const now = options.now ?? Date.now();
  const margin = options.margin ?? SNAPSHOT_MARGIN_BYTES;
  const root = snapshotRoot(identity);
  fs.mkdirSync(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  const { checkpointed, rowids } = checkpointDatabase(identity.database);
  const directory = path.join(/* turbopackIgnore: true */ root, `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${options.to.slice(0, 12)}`);
  const temporary = `${directory}.partial-${randomUUID()}`;
  fs.mkdirSync(/* turbopackIgnore: true */ temporary, { mode: 0o700 });
  try {
    const target = path.join(/* turbopackIgnore: true */ temporary, 'database.sqlite');
    let cloned = false;
    if (checkpointed) cloned = cloneFile(identity.database, target);
    const free = freeBytes(root);
    if (cloned) {
      if (free < margin) throw new SnapshotSpaceError(`Not enough free disk space to update safely. The update needs ${gib(margin)} free and ${gib(free)} is.`);
    } else {
      const needed = sizeOf(identity.database) + margin;
      if (free < needed) throw new SnapshotSpaceError(`Not enough free disk space to update safely. This disk can't make an instant copy of the database, so the update needs ${gib(needed)} free and ${gib(free)} is.`);
      const db = new Database(identity.database, { readonly: true, fileMustExist: true });
      try { await db.backup(target); } finally { db.close(); }
    }
    fsyncPath(target);
    const manifest: SnapshotManifest = {
      format: 2, identity, createdAt: new Date(now).toISOString(), from: options.from, to: options.to, cloned,
      config: copyConfig(identity.config, path.join(/* turbopackIgnore: true */ temporary, 'config')), rowids,
    };
    atomicWriteFile(path.join(/* turbopackIgnore: true */ temporary, 'snapshot.json'), JSON.stringify(manifest));
    fs.renameSync(/* turbopackIgnore: true */ temporary, directory);
    fsyncPath(root);
  } catch (error) {
    fs.rmSync(/* turbopackIgnore: true */ temporary, { recursive: true, force: true });
    throw error;
  }
  pruneSnapshots({ identity, keep: [directory], now });
  return directory;
}

export function readSnapshot(directory: string, identity: Identity = serviceIdentity()): SnapshotManifest {
  const manifest = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'snapshot.json'), 'utf8')) as SnapshotManifest;
  if (manifest.format !== 2 || JSON.stringify(manifest.identity) !== JSON.stringify(identity)) throw new Error('This snapshot belongs to a different Home');
  return manifest;
}

/** Same disk: a rename, which needs no space. Another disk: copy, then remove. */
function move(from: string, to: string) {
  try { fs.renameSync(/* turbopackIgnore: true */ from, to); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    fs.copyFileSync(/* turbopackIgnore: true */ from, to);
    fsyncPath(to);
    fs.unlinkSync(/* turbopackIgnore: true */ from);
  }
}

/**
 * Put the snapshot back. Idempotent, so a restore interrupted at any point
 * finishes when it runs again: the failed database (with its `-wal` and
 * `-shm`) moves aside into the snapshot folder, then the saved database is
 * renamed into its place, then the config files are written back.
 */
export async function restoreSnapshot(directory: string, identity: Identity = serviceIdentity()) {
  // A recovery record from before snapshots names a full checkpoint.
  if (!fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'snapshot.json'))
    && fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'checkpoint.json'))) {
    await restoreCheckpointDatabase(directory, identity);
    return null;
  }
  const manifest = readSnapshot(directory, identity);
  const live = identity.database;
  const saved = path.join(/* turbopackIgnore: true */ directory, 'database.sqlite');
  if (fs.existsSync(/* turbopackIgnore: true */ saved)) {
    const aside = path.join(/* turbopackIgnore: true */ directory, 'failed');
    fs.mkdirSync(/* turbopackIgnore: true */ aside, { recursive: true, mode: 0o700 });
    // The main file first: a crash after it leaves no database at the live
    // path, which the next run recognizes and finishes.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const file = `${live}${suffix}`;
      if (fs.existsSync(/* turbopackIgnore: true */ file)) move(file, path.join(/* turbopackIgnore: true */ aside, `${path.basename(live)}${suffix}`));
    }
    move(saved, live);
    fsyncPath(path.dirname(live));
  }
  for (const name of manifest.config) {
    const source = path.join(/* turbopackIgnore: true */ directory, 'config', name);
    if (!fs.existsSync(/* turbopackIgnore: true */ source)) continue;
    const target = path.join(/* turbopackIgnore: true */ identity.config, name);
    fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(target), { recursive: true, mode: 0o700 });
    const staged = `${target}.restore-${randomUUID()}`;
    fs.copyFileSync(/* turbopackIgnore: true */ source, staged);
    fs.renameSync(/* turbopackIgnore: true */ staged, target);
  }
  return manifest;
}

export interface SnapshotEntry { directory: string; manifest: SnapshotManifest }

export function listSnapshots(identity: Identity = serviceIdentity()): SnapshotEntry[] {
  const root = snapshotRoot(identity);
  if (!fs.existsSync(/* turbopackIgnore: true */ root)) return [];
  const entries: SnapshotEntry[] = [];
  for (const name of fs.readdirSync(/* turbopackIgnore: true */ root)) {
    if (name.includes('.partial-')) continue;
    const directory = path.join(/* turbopackIgnore: true */ root, name);
    try { entries.push({ directory, manifest: readSnapshot(directory, identity) }); } catch { /* not a snapshot of this Home */ }
  }
  return entries.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

export interface PruneSnapshotOptions {
  identity?: Identity;
  /** Snapshots a recovery or a rollback still needs. */
  keep?: string[];
  now?: number;
  /** Free space below this deletes failed databases set aside by a restore early. */
  lowDiskBytes?: number;
}

/** One snapshot per Home, at most 7 days old, unless something still needs it. */
export function pruneSnapshots(options: PruneSnapshotOptions = {}) {
  const identity = options.identity ?? serviceIdentity();
  const now = options.now ?? Date.now();
  const keep = new Set((options.keep ?? []).map(directory => path.resolve(/* turbopackIgnore: true */ directory)));
  const root = snapshotRoot(identity);
  if (!fs.existsSync(/* turbopackIgnore: true */ root)) return [];
  for (const name of fs.readdirSync(/* turbopackIgnore: true */ root)) {
    if (!name.includes('.partial-')) continue;
    const directory = path.join(/* turbopackIgnore: true */ root, name);
    if (now - fs.statSync(/* turbopackIgnore: true */ directory).mtimeMs > STALE_PARTIAL_MS) fs.rmSync(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
  }
  const removed: string[] = [];
  const snapshots = listSnapshots(identity);
  const newest = snapshots[0]?.directory;
  const low = options.lowDiskBytes !== undefined && freeBytes(root) < options.lowDiskBytes;
  for (const { directory, manifest } of snapshots) {
    const needed = keep.has(path.resolve(/* turbopackIgnore: true */ directory));
    const expired = now - Date.parse(manifest.createdAt) > SNAPSHOT_RETENTION_MS;
    const replaced = keep.size > 0 ? !needed : directory !== newest;
    if (!needed && (expired || replaced)) {
      fs.rmSync(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
      removed.push(directory);
    } else if (low && !needed) {
      fs.rmSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'failed'), { recursive: true, force: true });
    }
  }
  return removed;
}

export interface SnapshotChanges { messages: number; chats: number; tasks: number; notes: number }

/** What restoring a snapshot would lose: rows added or changed since it was taken. */
export function snapshotChanges(manifest: SnapshotManifest, database = serviceIdentity().database): SnapshotChanges {
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]);
    const newer = (table: string) => tables.has(table) && manifest.rowids[table as keyof SnapshotManifest['rowids']] !== undefined
      ? Number(db.prepare(`SELECT COUNT(*) FROM "${table}" WHERE rowid > ?`).pluck().get(manifest.rowids[table as keyof SnapshotManifest['rowids']]))
      : 0;
    const changed = (table: string) => {
      if (!tables.has(table)) return 0;
      const columns = new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(column => column.name));
      if (!columns.has('updated_at')) return newer(table);
      // updated_at is SQLite's datetime('now'), in UTC without a zone.
      const since = manifest.createdAt.replace('T', ' ').replace(/\.\d+Z$|Z$/, '');
      return Number(db.prepare(`SELECT COUNT(*) FROM "${table}" WHERE rowid > ? OR updated_at > ?`).pluck().get(manifest.rowids[table as keyof SnapshotManifest['rowids']] ?? 0, since));
    };
    return { messages: newer('chat_events'), chats: changed('chat_sessions'), tasks: changed('tasks'), notes: changed('notes') };
  } finally { db.close(); }
}
