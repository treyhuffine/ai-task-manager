#!/usr/bin/env tsx
/**
 * `pnpm backup [run|install|uninstall|status]`: nightly backups of the home
 * (src/lib/home/daily-backup.ts, docs/environments.md).
 *
 *   pnpm backup             back up now
 *   pnpm backup install     run it every night at 03:30 (a launchd job)
 *   pnpm backup uninstall   stop the nightly job (backups are kept)
 *   pnpm backup status      the job, and the backups on disk
 *
 * Backs up the production home (`~/ri`, or whatever RI_ROOT names) into
 * `~/ri-backups/daily` (RI_BACKUP_DIR), keeping the newest 7. Safe while Ri
 * runs: the home is only read.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppRoot } from '../src/lib/config/paths';
import {
  DAILY_BACKUP_KEEP,
  DAILY_BACKUP_LABEL,
  dailyBackupDir,
  dailyBackupPlist,
  listDailyBackups,
  runDailyBackup,
} from '../src/lib/home/daily-backup';

const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${DAILY_BACKUP_LABEL}.plist`);
const logPath = path.join(dailyBackupDir(), 'backup.log');
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const uid = process.getuid?.() ?? 501;

function launchctl(args: string[]): string {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? '');
  }
}

async function run() {
  const root = getAppRoot();
  console.log(`${new Date().toISOString()} backing up ${root}`);
  const result = await runDailyBackup({ root });
  console.log(`${new Date().toISOString()} done in ${result.seconds}s: ${result.dir}`);
  console.log(`  database ${gb(result.databaseBytes)} (${path.basename(result.database)}), everything ${gb(result.totalBytes)}`);
  for (const old of result.pruned) console.log(`  removed ${path.basename(old)} (keeping ${DAILY_BACKUP_KEEP})`);
}

function install() {
  if (process.platform !== 'darwin') throw new Error('The nightly job uses launchd, so it needs macOS.');
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const content = dailyBackupPlist({ node: process.execPath, repo: process.cwd(), home: os.homedir(), log: logPath });
  launchctl(['bootout', `gui/${uid}/${DAILY_BACKUP_LABEL}`]);
  fs.writeFileSync(plistPath, content);
  const out = launchctl(['bootstrap', `gui/${uid}`, plistPath]);
  if (out.trim()) console.log(out.trim());
  console.log(`Installed ${plistPath}. Ri's home is backed up every night at 03:30 into ${dailyBackupDir()}.`);
  console.log(`Log: ${logPath}`);
}

function uninstall() {
  launchctl(['bootout', `gui/${uid}/${DAILY_BACKUP_LABEL}`]);
  fs.rmSync(plistPath, { force: true });
  console.log(`Removed the nightly job. The backups in ${dailyBackupDir()} are kept.`);
}

function status() {
  const loaded = launchctl(['print', `gui/${uid}/${DAILY_BACKUP_LABEL}`]);
  console.log(`Nightly job: ${fs.existsSync(plistPath) && /state = /.test(loaded) ? 'installed (03:30)' : 'not installed (pnpm backup install)'}`);
  const backups = listDailyBackups(dailyBackupDir());
  console.log(`Backups in ${dailyBackupDir()}: ${backups.length}`);
  for (const dir of backups) {
    const files = fs.readdirSync(dir);
    const db = files.find((f) => f.startsWith('data.db'));
    const size = db ? fs.statSync(path.join(dir, db)).size : 0;
    console.log(`  ${path.basename(dir)}  ${db ?? 'no database'}  ${gb(size)}`);
  }
}

const cmd = process.argv[2] ?? 'run';
const commands: Record<string, () => unknown> = { run, install, uninstall, status };
if (!commands[cmd]) {
  console.error('usage: pnpm backup [run|install|uninstall|status]');
  process.exit(2);
}
Promise.resolve(commands[cmd]!()).catch((err) => {
  console.error(`${new Date().toISOString()} backup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
