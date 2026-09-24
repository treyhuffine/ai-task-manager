import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_MANIFEST,
  createHomeBackup,
  readBackupManifest,
  restoreHomeBackup,
  verifyHomeBackup,
} from './backup';

let tmp: string;
let root: string;

function write(rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

/** A small home: a WAL database with rows, content, config, and things a backup leaves out. */
function seedHome() {
  fs.mkdirSync(root, { recursive: true });
  const db = new Database(path.join(root, 'data.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER);
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('base', 1), ('next', 2);
  `);
  const insert = db.prepare('INSERT INTO tasks VALUES (?, ?)');
  for (let i = 0; i < 25; i++) insert.run(`t${i}`, `Task ${i}`);
  // Leave the connection open so rows sit in the WAL, as on a running home.
  write('attachments/019a.png', 'png-bytes');
  write('.archive/old.md', 'archived');
  write('skills/my-skill/SKILL.md', '---\nname: my-skill\n---\n');
  write('MEMORY.md', '# memory');
  write('USER.md', '# me');
  write('SOUL.md', '# voice');
  write('.config/config.json', '{"version":1,"localToken":"ri_live_secret"}');
  write('.config/connectors/key', 'sealing-key');
  write('.config/connectors/locks/a.lock', 'lock');
  write('.config/notifications/vapid.json', '{}');
  write('.config/browser/profiles/agent/Cookies', 'cookies');
  write('.config/tls/leaf.pem', 'cert');
  write('.config/cli-config.json', '{"editor":"cursor"}');
  write('.work/worktrees/x/file', 'scratch');
  write('tasks/t0.md', 'mirror');
  write('data.db.bak-old', 'old copy');
  write('mystery/file.txt', 'unknown');
  return db;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-backup-test-'));
  root = path.join(tmp, 'home');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('createHomeBackup', () => {
  it('copies the database and home content, and names everything it skipped', async () => {
    const live = seedHome();
    const out = path.join(tmp, 'backup');
    const manifest = await createHomeBackup({ root, outDir: out });
    live.close();

    const files = manifest.files.map((f) => f.path).sort();
    expect(files).toEqual(
      [
        '.archive/old.md',
        '.config/config.json',
        '.config/connectors/key',
        '.config/notifications/vapid.json',
        'MEMORY.md',
        'SOUL.md',
        'USER.md',
        'attachments/019a.png',
        'data.db',
        'skills/my-skill/SKILL.md',
      ].sort(),
    );
    expect(manifest.database.rowCounts.tasks).toBe(25);
    expect(manifest.database.migrations).toEqual(['base', 'next']);
    expect(manifest.database.quickCheck).toBe('ok');

    const skipped = Object.fromEntries(manifest.skipped.map((s) => [s.entry, s.reason]));
    expect(skipped['.config/browser']).toMatch(/this machine/);
    expect(skipped['.config/tls']).toMatch(/this machine/);
    expect(skipped['.config/cli-config.json']).toMatch(/this machine/);
    expect(skipped['.work']).toMatch(/regenerable/);
    expect(skipped.tasks).toMatch(/mirror/);
    expect(skipped['data.db.bak-old']).toMatch(/older database/);
    expect(skipped.mystery).toMatch(/not a known part/);
    expect(skipped['data.db-wal']).toBeUndefined();
  });

  it('writes private files and directories', async () => {
    seedHome().close();
    const out = path.join(tmp, 'backup');
    await createHomeBackup({ root, outDir: out });
    expect(mode(out)).toBe(0o700);
    expect(mode(path.join(out, '.config'))).toBe(0o700);
    expect(mode(path.join(out, 'data.db'))).toBe(0o600);
    expect(mode(path.join(out, '.config/config.json'))).toBe(0o600);
    expect(mode(path.join(out, BACKUP_MANIFEST))).toBe(0o600);
  });

  it('never writes to the source root', async () => {
    seedHome().close();
    const before = fs.readdirSync(root).sort();
    await createHomeBackup({ root, outDir: path.join(tmp, 'backup') });
    expect(fs.readdirSync(root).sort()).toEqual(before);
  });

  it('refuses an output inside the root, or one that already has files', async () => {
    seedHome().close();
    await expect(createHomeBackup({ root, outDir: path.join(root, 'backup') })).rejects.toThrow(
      /outside the root/,
    );
    const used = path.join(tmp, 'used');
    fs.mkdirSync(used);
    fs.writeFileSync(path.join(used, 'x'), '');
    await expect(createHomeBackup({ root, outDir: used })).rejects.toThrow(/not empty/);
  });

  it('refuses a folder with no database', async () => {
    fs.mkdirSync(root, { recursive: true });
    await expect(createHomeBackup({ root, outDir: path.join(tmp, 'b') })).rejects.toThrow(
      /No database/,
    );
  });
});

describe('verifyHomeBackup', () => {
  it('passes an untouched backup and catches a changed or missing file', async () => {
    seedHome().close();
    const out = path.join(tmp, 'backup');
    await createHomeBackup({ root, outDir: out });
    expect(verifyHomeBackup(out)).toEqual({ ok: true, problems: [] });

    fs.writeFileSync(path.join(out, 'MEMORY.md'), '# edited!');
    fs.rmSync(path.join(out, 'attachments/019a.png'));
    const result = verifyHomeBackup(out);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/MEMORY\.md/);
    expect(result.problems.join('\n')).toMatch(/missing attachments\/019a\.png/);
  });

  it('rejects an unknown format', async () => {
    seedHome().close();
    const out = path.join(tmp, 'backup');
    await createHomeBackup({ root, outDir: out });
    const m = readBackupManifest(out);
    fs.writeFileSync(path.join(out, BACKUP_MANIFEST), JSON.stringify({ ...m, format: 99 }));
    expect(() => verifyHomeBackup(out)).toThrow(/Unsupported backup format/);
  });
});

describe('restoreHomeBackup', () => {
  it('restores into a new root and verifies what it wrote', async () => {
    seedHome().close();
    const out = path.join(tmp, 'backup');
    await createHomeBackup({ root, outDir: out });
    const target = path.join(tmp, 'restored');
    restoreHomeBackup({ backupDir: out, root: target });

    expect(fs.readFileSync(path.join(target, '.config/config.json'), 'utf8')).toMatch(/localToken/);
    expect(mode(path.join(target, 'data.db'))).toBe(0o600);
    const db = new Database(path.join(target, 'data.db'), { readonly: true });
    expect((db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n).toBe(25);
    db.close();
  });

  it('refuses a root that already has a database', async () => {
    seedHome().close();
    const out = path.join(tmp, 'backup');
    await createHomeBackup({ root, outDir: out });
    expect(() => restoreHomeBackup({ backupDir: out, root })).toThrow(/already has a database/);
  });

  it('refuses a backup that no longer matches its manifest', async () => {
    seedHome().close();
    const out = path.join(tmp, 'backup');
    await createHomeBackup({ root, outDir: out });
    fs.writeFileSync(path.join(out, 'USER.md'), 'tampered');
    expect(() => restoreHomeBackup({ backupDir: out, root: path.join(tmp, 'r') })).toThrow(
      /does not match its manifest/,
    );
    expect(fs.existsSync(path.join(tmp, 'r'))).toBe(false);
  });
});
