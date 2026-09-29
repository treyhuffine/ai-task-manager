/**
 * Full backup and restore of a Ri data root (src/lib/home/backup.ts).
 *
 *   pnpm tsx scripts/home-backup.ts backup <root> <out-dir>
 *   pnpm tsx scripts/home-backup.ts verify <backup-dir>
 *   pnpm tsx scripts/home-backup.ts restore <backup-dir> <new-root>
 *   pnpm tsx scripts/home-backup.ts dev-copy <restored-root>
 *   pnpm iso <new-root> -- pnpm tsx scripts/home-backup.ts open-check
 *
 * `backup` only reads the source root, and is safe while that home runs.
 * `restore` refuses a root that already has a database. `dev-copy` makes a
 * restored copy safe to boot as a development home (src/lib/home/dev-copy.ts):
 * new credentials, no schedules or outward channels, no native sessions, and
 * every folder path detached. It refuses the production, default dev, and
 * test roots. `open-check` opens
 * the restored database through the app (`getDb()`, which runs migrations and
 * boot-time setup) and reads it through the shared queries. Run it under
 * `pnpm iso` so it can only ever touch the restored root. It does not start a
 * server, the scheduler, or any harness.
 *
 * Backups contain secrets (the host token, connector keys). They are written
 * 0700/0600. Keep them in private storage.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createHomeBackup,
  readBackupManifest,
  restoreHomeBackup,
  verifyHomeBackup,
} from '../src/lib/home/backup';
import { prepareDevelopmentCopy } from '../src/lib/home/dev-copy';
import { isWithin } from '../src/lib/config/dev-isolation';
import { getDevAppRoot, getTestAppRoot } from '../src/lib/config/paths';
import { APP_SHORT_ID } from '../src/constants/app';

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function usage(): never {
  console.error(
    'usage:\n' +
      '  home-backup backup <root> <out-dir>\n' +
      '  home-backup verify <backup-dir>\n' +
      '  home-backup restore <backup-dir> <new-root>\n' +
      '  home-backup dev-copy <restored-root>\n' +
      '  pnpm iso <root> -- pnpm tsx scripts/home-backup.ts open-check',
  );
  process.exit(2);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

  if (cmd === 'backup' && a && b) {
    const manifest = await createHomeBackup({ root: expandHome(a), outDir: expandHome(b) });
    const total = manifest.files.reduce((n, f) => n + f.size, 0);
    console.log(`backed up ${manifest.files.length} files (${mb(total)}) in ${elapsed()}`);
    console.log(`database quick_check: ${manifest.database.quickCheck}`);
    console.log('skipped:');
    for (const s of manifest.skipped) console.log(`  ${s.entry}: ${s.reason}`);
    return;
  }
  if (cmd === 'verify' && a) {
    const result = verifyHomeBackup(expandHome(a));
    if (!result.ok) {
      console.error(`backup does NOT verify (${elapsed()}):`);
      for (const p of result.problems) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log(`backup verifies: every file, checksum and row count matches (${elapsed()})`);
    return;
  }
  if (cmd === 'restore' && a && b) {
    const manifest = restoreHomeBackup({ backupDir: expandHome(a), root: expandHome(b) });
    console.log(
      `restored ${manifest.files.length} files into ${expandHome(b)} and verified them (${elapsed()})`,
    );
    return;
  }
  if (cmd === 'dev-copy' && a) {
    const root = expandHome(a);
    const shared = [path.join(os.homedir(), APP_SHORT_ID), getDevAppRoot(), getTestAppRoot()];
    const hit = shared.find((s) => isWithin(root, s) || isWithin(s, root));
    if (hit) {
      console.error(`Refusing: ${root} overlaps ${hit}. dev-copy is only for a restored copy.`);
      process.exit(1);
    }
    const report = prepareDevelopmentCopy(root);
    console.log(`prepared ${root} as a development copy (${elapsed()})`);
    if (report.config.length) console.log(`  config reset: ${report.config.join(', ')}`);
    if (report.removed.length) console.log(`  removed: ${report.removed.join(', ')}`);
    for (const [k, n] of Object.entries(report.database)) console.log(`  ${k}: ${n}`);
    return;
  }
  if (cmd === 'open-check') {
    // Only meaningful under `pnpm iso`, which pins every path to one root.
    if (!process.env.RI_ROOT || !process.env.RI_DB_PATH) {
      console.error('open-check must run under `pnpm iso <root> -- ...`.');
      process.exit(2);
    }
    const { getDbPath } = await import('../src/lib/config/paths');
    // getDb() creates a database where none exists. That would pass a check
    // meant to prove a restore worked, so require the restored file first.
    if (!fs.existsSync(getDbPath())) {
      console.error(`No database at ${getDbPath()}. Restore into this root first.`);
      process.exit(1);
    }
    const { getDb, resetDb } = await import('../src/lib/db');
    const queries = await import('../src/lib/db/queries');
    getDb();
    const tasks = queries.listTasks({});
    const notes = queries.listNotes({});
    const workspaces = queries.listWorkspaces();
    console.log(`opened ${getDbPath()} through the app in ${elapsed()}`);
    console.log(`  tasks ${tasks.length}, notes ${notes.length}, agents ${workspaces.length}`);
    resetDb();
    return;
  }
  if (cmd === 'manifest' && a) {
    console.log(JSON.stringify(readBackupManifest(expandHome(a)), null, 2));
    return;
  }
  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
