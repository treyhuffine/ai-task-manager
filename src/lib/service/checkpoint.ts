import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { canonical, serviceIdentity } from './paths';

export function fileDigest(file: string) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try { let n: number; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
export function validateDatabase(file: string, searchIndexes = false) {
  const db = new Database(file, { fileMustExist: true });
  try {
    sqliteVec.load(db);
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed');
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Database has existing broken references. Repair these before updating.');
    if (searchIndexes) {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%USING fts5%'").all() as { name: string }[]) {
        const quoted = `"${name.replaceAll('"', '""')}"`;
        db.prepare(`INSERT INTO ${quoted} (${quoted}, rank) VALUES ('integrity-check', 1)`).run();
      }
    }
  } finally { db.close(); }
}

interface Entry { source: string; saved: string; size?: number; sha256?: string; link?: string }
interface Checkpoint { format: 1; identity: ReturnType<typeof serviceIdentity>; database: string; entries: Entry[] }
const volatile = /\.(?:owner|activity|access|lock)\.sqlite(?:-journal|-wal|-shm)?$/;

function inventory(identity: Checkpoint['identity']) {
  const roots = [...new Set([identity.root, identity.config, identity.work])].sort((a, b) => a.length - b.length)
    .filter((root, index, all) => !all.slice(0, index).some(parent => root.startsWith(`${parent}${path.sep}`)));
  const entries: Entry[] = [];
  const walk = (source: string, saved: string) => {
    // Chromium keeps this profile live while the service updates. A file copy
    // is not a consistent snapshot of its LevelDB/SQLite stores. Service
    // migrations never mutate it, and rollback must leave its drafts intact.
    if (source === path.join(identity.config, 'electron-demo')) return;
    if (source === identity.database || source.startsWith(`${identity.database}-`) || source === `${identity.database}.maintenance.json` || volatile.test(source)) return;
    const stat = fs.lstatSync(source);
    if (stat.isDirectory()) for (const name of fs.readdirSync(source)) walk(path.join(source, name), path.join(saved, name));
    else if (stat.isFile()) entries.push({ source, saved, size: stat.size });
    else if (stat.isSymbolicLink()) entries.push({ source, saved, link: fs.readlinkSync(source) });
    // Unix sockets and named pipes are live endpoints, never recovery content.
  };
  roots.forEach((root, index) => { if (fs.existsSync(root)) walk(root, `files/${index}`); });
  return { roots, entries };
}

export function requireDiskSpace(directory: string, bytes: number) {
  const stat = fs.statfsSync(directory);
  if (Number(stat.bavail) * Number(stat.bsize) < bytes) throw new Error(`Not enough free disk space. Need at least ${Math.ceil(bytes / 1024 / 1024)} MiB.`);
}

/** Called only with Next stopped and the exclusive access lease held. A full
 * file inventory includes machine credentials and unpublished working files.
 * Symlinks are preserved as links, never followed outside the selected roots. */
export async function createCheckpoint(directory: string, identity = serviceIdentity()): Promise<string> {
  directory = canonical(directory);
  const { roots, entries } = inventory(identity);
  if (roots.some(root => directory === root || directory.startsWith(`${root}${path.sep}`))) throw new Error('Recovery storage must be outside the data/config/work roots');
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  const databaseSize = fs.statSync(identity.database).size;
  requireDiskSpace(path.dirname(directory), entries.reduce((n, e) => n + (e.size ?? 0), 0) + databaseSize * 3 + 128 * 1024 * 1024);
  validateDatabase(identity.database, true);
  const temporary = `${directory}.partial-${randomUUID()}`;
  fs.mkdirSync(temporary, { mode: 0o700 });
  try {
    const db = new Database(identity.database, { readonly: true, fileMustExist: true });
    try { await db.backup(path.join(temporary, 'database.sqlite')); } finally { db.close(); }
    const snapshotFd = fs.openSync(path.join(temporary, 'database.sqlite'), 'r');
    try { fs.fsyncSync(snapshotFd); } finally { fs.closeSync(snapshotFd); }
    validateDatabase(path.join(temporary, 'database.sqlite'));
    for (const entry of entries) {
      const target = path.join(temporary, entry.saved);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (entry.link !== undefined) fs.symlinkSync(entry.link, target);
      else {
        fs.copyFileSync(entry.source, target);
        fs.chmodSync(target, 0o600);
        entry.sha256 = fileDigest(target);
        if (entry.sha256 !== fileDigest(entry.source)) throw new Error(`A file changed during the checkpoint: ${entry.source}`);
        const fd = fs.openSync(target, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
    }
    const manifest: Checkpoint = { format: 1, identity, database: fileDigest(path.join(temporary, 'database.sqlite')), entries };
    atomicWriteFile(path.join(temporary, 'checkpoint.json'), JSON.stringify(manifest));
    fs.renameSync(temporary, directory);
    const fd = fs.openSync(path.dirname(directory), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return directory;
  } catch (error) { fs.rmSync(temporary, { recursive: true, force: true }); throw error; }
}

export function verifyCheckpoint(directory: string, identity = serviceIdentity()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'checkpoint.json'), 'utf8')) as Checkpoint;
  if (manifest.format !== 1 || JSON.stringify(manifest.identity) !== JSON.stringify(identity)) throw new Error('Checkpoint belongs to a different data root');
  if (fileDigest(path.join(directory, 'database.sqlite')) !== manifest.database) throw new Error('Checkpoint database checksum mismatch');
  for (const entry of manifest.entries) {
    const file = path.resolve(directory, entry.saved);
    if (!file.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('Invalid checkpoint path');
    if (entry.link !== undefined ? fs.readlinkSync(file) !== entry.link : fileDigest(file) !== entry.sha256) throw new Error(`Checkpoint file checksum mismatch: ${entry.saved}`);
  }
  validateDatabase(path.join(directory, 'database.sqlite'));
  return manifest;
}

/** Validation boot may change ONLY SQLite. Restore it before any new writes
 * were admitted. Other files and browser drafts are deliberately left intact.
 * The complete inventory is retained for an explicit manual recovery. */
export async function restoreCheckpointDatabase(directory: string, identity = serviceIdentity()) {
  verifyCheckpoint(directory, identity);
  if (fs.existsSync(identity.database)) {
    const failed = path.join(directory, `failed-${randomUUID()}.sqlite`);
    const db = new Database(identity.database, { readonly: true });
    try { await db.backup(failed); } finally { db.close(); }
  }
  const staged = `${identity.database}.restore-${randomUUID()}`;
  fs.copyFileSync(path.join(directory, 'database.sqlite'), staged);
  fs.chmodSync(staged, 0o600);
  const fd = fs.openSync(staged, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(identity.database + suffix, { force: true });
  fs.renameSync(staged, identity.database);
  const parent = fs.openSync(path.dirname(staged), 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
