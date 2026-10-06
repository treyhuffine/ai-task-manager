import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { resetDb } from '@/lib/db';
import { DAILY_BACKUP_LABEL, dailyBackupPlist, listDailyBackups, pruneDailyBackups, runDailyBackup } from './daily-backup';
import { BACKUP_MANIFEST } from './backup';

let home: TestHome;
let out: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-daily-backup-' });
  q.createTask({ title: 'Survives the backup' });
  resetDb();
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-daily-backup-out-'));
});

afterEach(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  await home.cleanup();
});

describe('nightly backups', () => {
  it('writes a full, compressed backup of the home', async () => {
    const result = await runDailyBackup({ root: home.root, dir: out, now: new Date(2026, 9, 6, 3, 30, 0) });
    expect(path.basename(result.dir)).toBe('ri-20261006-033000');
    expect(fs.existsSync(path.join(result.dir, BACKUP_MANIFEST))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, '.config/config.json'))).toBe(true);
    // Compressed when a compressor is around, and the plain copy is gone.
    expect(path.basename(result.database)).toMatch(/^data\.db(\.zst|\.gz)?$/);
    expect(fs.existsSync(path.join(result.dir, 'data.db'))).toBe(path.basename(result.database) === 'data.db');
    expect(fs.readdirSync(out).some((name) => name.endsWith('.partial'))).toBe(false);
  });

  it('leaves the home it copies alone', async () => {
    // What a copy could leave behind is next to the database. (The markdown
    // mirror writes into the root on its own schedule, so the whole listing
    // isn't stable.)
    const databaseFiles = () => fs.readdirSync(home.root).filter((name) => name.startsWith('data.db')).sort();
    const before = databaseFiles();
    await runDailyBackup({ root: home.root, dir: out });
    expect(databaseFiles()).toEqual(before);
    const db = new Database(home.dbPath, { readonly: true });
    try {
      expect((db.prepare("SELECT count(*) AS n FROM tasks WHERE title = 'Survives the backup'").get() as { n: number }).n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('keeps the newest backups and removes only its own', () => {
    for (const day of ['01', '02', '03', '04']) {
      const dir = path.join(out, `ri-202610${day}-033000`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, BACKUP_MANIFEST), '{}');
    }
    fs.mkdirSync(path.join(out, 'something-else'));
    fs.mkdirSync(path.join(out, 'ri-20261005-033000.partial'));
    const removed = pruneDailyBackups(out, 2).map((p) => path.basename(p));
    expect(removed).toEqual(['ri-20261002-033000', 'ri-20261001-033000']);
    expect(listDailyBackups(out).map((p) => path.basename(p))).toEqual(['ri-20261004-033000', 'ri-20261003-033000']);
    expect(fs.existsSync(path.join(out, 'something-else'))).toBe(true);
  });

  it('runs every night from launchd', () => {
    const plist = dailyBackupPlist({ node: '/opt/node', repo: '/repo', home: '/Users/me', log: '/Users/me/ri-backups/daily/backup.log' });
    expect(plist).toContain(`<string>${DAILY_BACKUP_LABEL}</string>`);
    expect(plist).toContain('<string>/opt/node</string><string>/repo/node_modules/tsx/dist/cli.mjs</string><string>/repo/scripts/backup-home.ts</string><string>run</string>');
    expect(plist).toContain('<key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer>');
  });
});
