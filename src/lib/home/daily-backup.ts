/**
 * Nightly backups of the production home (docs/environments.md).
 *
 * Each run is a full `createHomeBackup` (backup.ts): a consistent copy of the
 * database taken while the home keeps running, attachments, persona and
 * memory, skills, and the config a restored home needs, with a checksum per
 * file. The database copy is then compressed with zstd (gzip when zstd isn't
 * installed), since an uncompressed week of a 9 GB home would fill the disk.
 * The newest `keep` backups are kept, older ones removed. Only folders this
 * module made (`ri-<stamp>` with a manifest) are ever removed.
 *
 * Nothing here opens the home through `getDb()`, so a backup never migrates
 * or writes the database it copies.
 *
 * Restore: decompress `data.db.zst` (`zstd -d`), check it with
 * `pnpm tsx scripts/home-backup.ts verify <dir>`, then restore into a fresh
 * root with `... restore <dir> <new-root>`, or, with Ri stopped, put the
 * decompressed `data.db` in place of the home's own.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKUP_MANIFEST, createHomeBackup } from './backup';

export const DAILY_BACKUP_KEEP = 7;
export const DAILY_BACKUP_LABEL = 'app.ri.home-backup';
const NAME = /^ri-\d{8}-\d{6}$/;

export interface DailyBackupResult {
  dir: string;
  /** The compressed database file, or `data.db` when nothing could compress it. */
  database: string;
  databaseBytes: number;
  totalBytes: number;
  seconds: number;
  pruned: string[];
}

/** Default folder for nightly backups: `~/ri-backups/daily`, or `RI_BACKUP_DIR`. */
export function dailyBackupDir(): string {
  return path.resolve(process.env.RI_BACKUP_DIR ?? path.join(os.homedir(), 'ri-backups', 'daily'));
}

function stamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `ri-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** The first of zstd or gzip on PATH (or the common Homebrew folders). */
function findCompressor(): { command: string; args: string[]; ext: string } | null {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const executable = (file: string) => {
    try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
  };
  const find = (name: string) => dirs.filter(Boolean).map((dir) => path.join(dir, name)).find(executable);
  const zstd = find('zstd');
  if (zstd) return { command: zstd, args: ['-q', '-T0', '-6', '--rm'], ext: '.zst' };
  const gzip = find('gzip');
  if (gzip) return { command: gzip, args: ['-6'], ext: '.gz' };
  return null;
}

function dirBytes(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return total;
}

/** This module's backups in `dir`, newest first. */
export function listDailyBackups(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => NAME.test(name) && fs.existsSync(path.join(dir, name, BACKUP_MANIFEST)))
    .sort()
    .reverse()
    .map((name) => path.join(dir, name));
}

/** Remove all but the newest `keep` backups. Returns what was removed. */
export function pruneDailyBackups(dir: string, keep = DAILY_BACKUP_KEEP): string[] {
  const old = listDailyBackups(dir).slice(Math.max(keep, 1));
  for (const backup of old) fs.rmSync(backup, { recursive: true, force: true });
  return old;
}

export async function runDailyBackup(opts: { root: string; dir?: string; keep?: number; now?: Date }): Promise<DailyBackupResult> {
  const started = Date.now();
  const dir = path.resolve(opts.dir ?? dailyBackupDir());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const final = path.join(dir, stamp(opts.now ?? new Date()));
  // Written under a temporary name and renamed when complete, so a backup
  // cut short never counts as one, and is never what pruning keeps.
  const partial = `${final}.partial`;
  fs.rmSync(partial, { recursive: true, force: true });
  try {
    await createHomeBackup({ root: opts.root, outDir: partial });
    let database = path.join(partial, 'data.db');
    const compressor = findCompressor();
    if (compressor) {
      execFileSync(compressor.command, [...compressor.args, database], { stdio: ['ignore', 'ignore', 'pipe'] });
      database = `${database}${compressor.ext}`;
      // gzip removes its input itself, zstd does with --rm.
      fs.rmSync(path.join(partial, 'data.db'), { force: true });
      fs.chmodSync(database, 0o600);
    }
    fs.renameSync(partial, final);
    database = path.join(final, path.basename(database));
    const pruned = pruneDailyBackups(dir, opts.keep ?? DAILY_BACKUP_KEEP);
    return {
      dir: final,
      database,
      databaseBytes: fs.statSync(database).size,
      totalBytes: dirBytes(final),
      seconds: Math.round((Date.now() - started) / 1000),
      pruned,
    };
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  }
}

/** The launchd job that runs the backup every night at 03:30. */
export function dailyBackupPlist(opts: { node: string; repo: string; home: string; log: string; hour?: number; minute?: number }): string {
  const x = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const args = [opts.node, path.join(opts.repo, 'node_modules/tsx/dist/cli.mjs'), path.join(opts.repo, 'scripts/backup-home.ts'), 'run'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${DAILY_BACKUP_LABEL}</string>
<key>ProgramArguments</key><array>${args.map((a) => `<string>${x(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${x(opts.repo)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${x(opts.home)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${opts.hour ?? 3}</integer><key>Minute</key><integer>${opts.minute ?? 30}</integer></dict>
<key>StandardOutPath</key><string>${x(opts.log)}</string>
<key>StandardErrorPath</key><string>${x(opts.log)}</string>
</dict></plist>
`;
}
