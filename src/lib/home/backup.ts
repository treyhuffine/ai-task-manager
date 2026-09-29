/**
 * Full backup, verification, and restore of a Ri data root.
 *
 * `ri snapshot` copies the database and the markdown mirror only. This is the
 * backup a move or a rollback can rely on (docs/homes-spec.md §10.2, §10.3):
 * the database, attachments, persona and memory, user skills, and the machine
 * config a restored home needs to keep working (connector secrets, VAPID keys,
 * the host token), with a checksum per file.
 *
 * Layout of a backup directory (0700, files 0600):
 *
 *   manifest.json        what was copied, checksums, row counts, what was skipped
 *   data.db              consistent copy through SQLite's online backup API
 *   attachments/ .archive/ skills/ CLAUDE.md MEMORY.md ...
 *   .config/config.json .config/connectors/ ...
 *
 * The source root is only read. Its database is copied without opening it
 * through `getDb()`, which would run migrations and boot-time backfills
 * against it, and without creating sidecar files next to it
 * (`source-db.ts`). The copy is in rollback-journal mode, so verifying it
 * never adds files to the backup either. What is copied is an allowlist, and every top-level entry left
 * out is named in the manifest with the reason, so nothing is dropped
 * silently.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { copySourceDatabase } from './source-db';

export const BACKUP_MANIFEST = 'manifest.json';
export const BACKUP_FORMAT_VERSION = 1;

/** Top-level content copied as-is when present. */
const CONTENT_DIRS = ['attachments', '.archive', 'skills'] as const;
const CONTENT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'MEMORY.md',
  'USER.md',
  'SOUL.md',
  'DECK.md',
  'triage-context.md',
] as const;

/**
 * Entries under `.config` that belong to this machine and are rebuilt or
 * re-established on the next one: this machine's identity (`machine.json`,
 * which must never travel, or a restored copy would take itself for the
 * original host), a worker's key for its home (`worker.json`), the agent
 * browser's profiles (logins), local TLS material, CLI editor preference,
 * and connector lock files.
 */
const CONFIG_MACHINE_LOCAL = new Set(['browser', 'tls', 'cli-config.json', 'machine.json', 'worker.json']);
const CONFIG_SKIPPED_NAMES = new Set(['locks']);

/** Why a known top-level entry is not in the backup. */
const SKIP_REASONS: Record<string, string> = {
  '.work': 'regenerable scratch (worktrees, clones, caches)',
  worktrees: 'execution worktrees; code travels by git, and unpublished work is inventoried separately',
  snapshots: 'older snapshots',
  tasks: 'markdown mirror, rebuilt from the database',
  notes: 'markdown mirror, rebuilt from the database',
  areas: 'markdown mirror, rebuilt from the database',
  streams: 'markdown mirror, rebuilt from the database',
  '.claude': 'skill links, regenerated at start',
  '.agents': 'skill links, regenerated at start',
  '.gitignore': 'regenerated at start',
  'README.md': 'the mirror readme, regenerated at start',
  '.DS_Store': 'Finder metadata',
};

export interface BackupFileEntry {
  /** Path relative to the backup directory, POSIX separators. */
  path: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  format: number;
  createdAt: string;
  source: {
    root: string;
    homeDir: string;
    hostname: string;
    platform: NodeJS.Platform;
  };
  database: {
    /** The home's stable id, when the database has one. */
    homeId?: string | null;
    migrations: string[];
    rowCounts: Record<string, number>;
    quickCheck: string;
  };
  files: BackupFileEntry[];
  skipped: { entry: string; reason: string }[];
}

function sha256File(file: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}

function mkdirPrivate(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

/** Copy one file with 0600 permissions and return its manifest entry. */
function copyPrivate(src: string, dest: string, rel: string): BackupFileEntry {
  mkdirPrivate(path.dirname(dest));
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o600);
  const size = fs.statSync(dest).size;
  return { path: toPosix(rel), size, sha256: sha256File(dest) };
}

/** Every regular file under `dir`, relative to `base`. Symlinks are not followed. */
function listFiles(dir: string, base: string, skipNames: Set<string> = new Set()): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skipNames.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(path.relative(base, full));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Tables and their row counts, including FTS and vector shadow tables. Only
 * for a database copy in rollback-journal mode, which a read-only open
 * leaves untouched.
 */
export function databaseFacts(dbPath: string): BackupManifest['database'] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);
    const rowCounts: Record<string, number> = {};
    for (const t of tables) {
      try {
        rowCounts[t] = (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n;
      } catch {
        // A virtual table whose module isn't loaded here (vec0) can't be
        // counted without the extension. Its shadow tables are counted.
      }
    }
    const migrations = tables.includes('__drizzle_migrations')
      ? (
          db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at').all() as {
            hash: string;
          }[]
        ).map((r) => r.hash)
      : [];
    const quickCheck = String(
      (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check,
    );
    const homeId = tables.includes('home')
      ? ((db.prepare('SELECT id FROM home').get() as { id: string } | undefined)?.id ?? null)
      : null;
    return { homeId, migrations, rowCounts, quickCheck };
  } finally {
    db.close();
  }
}

export interface CreateBackupOptions {
  /** The root to back up. Only read. */
  root: string;
  /** A directory that does not exist yet, or is empty. */
  outDir: string;
}

/** Back up `root` into `outDir`. Returns the manifest written there. */
export async function createHomeBackup(opts: CreateBackupOptions): Promise<BackupManifest> {
  const root = path.resolve(opts.root);
  const outDir = path.resolve(opts.outDir);
  const dbPath = path.join(root, 'data.db');
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}. Is ${root} a Ri home?`);
  if (outDir === root || outDir.startsWith(root + path.sep)) {
    throw new Error('Write the backup outside the root being backed up.');
  }
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`${outDir} is not empty.`);
  }
  mkdirPrivate(outDir);

  const files: BackupFileEntry[] = [];

  // Database: a consistent copy while the source may still be writing.
  const destDb = path.join(outDir, 'data.db');
  await copySourceDatabase(dbPath, destDb);
  fs.chmodSync(destDb, 0o600);
  const database = databaseFacts(destDb);
  files.push({ path: 'data.db', size: fs.statSync(destDb).size, sha256: sha256File(destDb) });

  for (const name of CONTENT_FILES) {
    const src = path.join(root, name);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      files.push(copyPrivate(src, path.join(outDir, name), name));
    }
  }
  for (const dir of CONTENT_DIRS) {
    const src = path.join(root, dir);
    if (!fs.existsSync(src)) continue;
    for (const rel of listFiles(src, root)) {
      files.push(copyPrivate(path.join(root, rel), path.join(outDir, rel), rel));
    }
  }

  const skipped: BackupManifest['skipped'] = [];
  const configDir = path.join(root, '.config');
  if (fs.existsSync(configDir)) {
    for (const e of fs.readdirSync(configDir, { withFileTypes: true })) {
      const rel = path.join('.config', e.name);
      if (CONFIG_MACHINE_LOCAL.has(e.name)) {
        skipped.push({ entry: toPosix(rel), reason: 'belongs to this machine' });
      } else if (e.isDirectory()) {
        for (const f of listFiles(path.join(configDir, e.name), root, CONFIG_SKIPPED_NAMES)) {
          files.push(copyPrivate(path.join(root, f), path.join(outDir, f), f));
        }
      } else if (e.isFile()) {
        files.push(copyPrivate(path.join(configDir, e.name), path.join(outDir, rel), rel));
      }
    }
  }

  const copiedTop = new Set<string>(['data.db', '.config', ...CONTENT_DIRS, ...CONTENT_FILES]);
  for (const name of fs.readdirSync(root).sort()) {
    if (copiedTop.has(name)) continue;
    if (/^data\.db-(wal|shm)$/.test(name)) continue;
    skipped.push({
      entry: name,
      reason:
        SKIP_REASONS[name] ??
        (name.startsWith('data.db') ? 'an older database copy' : 'not a known part of a home'),
    });
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    source: { root, homeDir: os.homedir(), hostname: os.hostname(), platform: process.platform },
    database,
    files,
    skipped,
  };
  const manifestPath = path.join(outDir, BACKUP_MANIFEST);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return manifest;
}

export function readBackupManifest(dir: string): BackupManifest {
  const file = path.join(dir, BACKUP_MANIFEST);
  if (!fs.existsSync(file)) throw new Error(`No ${BACKUP_MANIFEST} in ${dir}.`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format ${manifest.format} (expected ${BACKUP_FORMAT_VERSION}).`);
  }
  return manifest;
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
}

/**
 * Check that the files under `dir` match `manifest`: every listed file exists
 * with its size and checksum, the database passes quick_check, and its row
 * counts equal the counts taken at backup time.
 */
export function verifyFilesAgainstManifest(dir: string, manifest: BackupManifest): VerifyResult {
  const problems: string[] = [];
  for (const f of manifest.files) {
    const p = path.join(dir, ...f.path.split('/'));
    if (!fs.existsSync(p)) {
      problems.push(`missing ${f.path}`);
      continue;
    }
    const size = fs.statSync(p).size;
    if (size !== f.size) {
      problems.push(`${f.path}: size ${size}, expected ${f.size}`);
      continue;
    }
    if (sha256File(p) !== f.sha256) problems.push(`${f.path}: checksum mismatch`);
  }
  const dbPath = path.join(dir, 'data.db');
  if (fs.existsSync(dbPath) && !problems.some((p) => p.startsWith('data.db'))) {
    const facts = databaseFacts(dbPath);
    if (facts.quickCheck !== 'ok') problems.push(`data.db quick_check: ${facts.quickCheck}`);
    for (const [table, n] of Object.entries(manifest.database.rowCounts)) {
      if (facts.rowCounts[table] !== n) {
        problems.push(`data.db ${table}: ${facts.rowCounts[table] ?? 'missing'} rows, expected ${n}`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export function verifyHomeBackup(dir: string): VerifyResult {
  return verifyFilesAgainstManifest(dir, readBackupManifest(dir));
}

export interface RestoreOptions {
  backupDir: string;
  /** Target root. It must not contain a database yet. */
  root: string;
}

/**
 * Restore a verified backup into `root`, then verify the restored files the
 * same way. Refuses a root that already has a database, so a restore never
 * overwrites a home.
 */
export function restoreHomeBackup(opts: RestoreOptions): BackupManifest {
  const backupDir = path.resolve(opts.backupDir);
  const root = path.resolve(opts.root);
  const manifest = readBackupManifest(backupDir);
  const before = verifyFilesAgainstManifest(backupDir, manifest);
  if (!before.ok) {
    throw new Error(`The backup does not match its manifest:\n  ${before.problems.join('\n  ')}`);
  }
  if (fs.existsSync(path.join(root, 'data.db'))) {
    throw new Error(`${root} already has a database. Restore only into a new root.`);
  }
  mkdirPrivate(root);
  for (const f of manifest.files) {
    const src = path.join(backupDir, ...f.path.split('/'));
    const dest = path.join(root, ...f.path.split('/'));
    mkdirPrivate(path.dirname(dest));
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o600);
  }
  const after = verifyFilesAgainstManifest(root, manifest);
  if (!after.ok) {
    throw new Error(`The restored root does not match the backup:\n  ${after.problems.join('\n  ')}`);
  }
  return manifest;
}
