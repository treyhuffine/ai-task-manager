import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { serviceIdentity } from './paths';
import { createSnapshot, listSnapshots, pruneSnapshots, readSnapshot, restoreSnapshot, snapshotChanges, snapshotRoot, SnapshotSpaceError, SNAPSHOT_RETENTION_MS } from './snapshot';

const FROM = 'a'.repeat(64);
const TO = 'b'.repeat(64);
let root: string;
let database: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-snapshot-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  fs.mkdirSync(path.join(root, 'home/.config/integrations'), { recursive: true });
  fs.mkdirSync(path.join(root, 'home/.config/browser/Default'), { recursive: true });
  fs.writeFileSync(path.join(root, 'home/.config/config.json'), '{"version":"before"}');
  fs.writeFileSync(path.join(root, 'home/.config/integrations/store.json'), 'secret');
  fs.writeFileSync(path.join(root, 'home/.config/browser/Default/Cookies'), 'big profile');
  database = path.join(root, 'home/data.db');
  const db = new Database(database);
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT, updated_at TEXT DEFAULT (datetime('now'))); CREATE TABLE chat_events (id INTEGER PRIMARY KEY, content TEXT);");
  db.prepare("INSERT INTO notes (body) VALUES ('first')").run();
  db.close();
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

const rows = (table = 'notes') => {
  const db = new Database(database, { readonly: true });
  try { return db.prepare(`SELECT body FROM ${table} ORDER BY id`).pluck().all(); } finally { db.close(); }
};
const write = (body: string) => { const db = new Database(database); try { db.prepare('INSERT INTO notes (body) VALUES (?)').run(body); } finally { db.close(); } };

/** A writer that commits, then dies with its writes still in the log. */
async function killWriterAfterCommits(bodies: string[]) {
  const script = `const D = require('better-sqlite3'); const db = new D(${JSON.stringify(database)});
db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0');
for (const body of ${JSON.stringify(bodies)}) db.prepare('INSERT INTO notes (body) VALUES (?)').run(body);
process.stdout.write('committed'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['-e', script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on('data', chunk => { if (String(chunk).includes('committed')) resolve(); });
    child.once('exit', code => reject(new Error(`writer exited ${code}`)));
  });
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  expect(fs.statSync(`${database}-wal`).size).toBeGreaterThan(0);
}

it('includes writes a killed writer left in the log, and puts them all back on restore', async () => {
  await killWriterAfterCommits(['in the log 1', 'in the log 2']);
  const directory = await createSnapshot({ from: FROM, to: TO });
  write('written by the new release');
  fs.writeFileSync(path.join(root, 'home/.config/config.json'), '{"version":"after"}');
  await restoreSnapshot(directory);
  expect(rows()).toEqual(['first', 'in the log 1', 'in the log 2']);
  expect(fs.readFileSync(path.join(root, 'home/.config/config.json'), 'utf8')).toBe('{"version":"before"}');
  // The failed database is set aside in the snapshot, not deleted.
  expect(fs.existsSync(path.join(directory, 'failed/data.db'))).toBe(true);
});

it('saves the config folder without the agent browser profile or live locks', async () => {
  fs.writeFileSync(path.join(root, 'home/.config/config.json.lock.sqlite'), 'lock');
  const manifest = readSnapshot(await createSnapshot({ from: FROM, to: TO }));
  expect(manifest.config).toEqual(['config.json', 'integrations/store.json']);
  if (process.platform === 'darwin') expect(manifest.cloned).toBe(true);
});

it('finishes a restore that was interrupted between its renames', async () => {
  const directory = await createSnapshot({ from: FROM, to: TO });
  write('after the snapshot');
  // Simulate a crash right after the failed database moved aside.
  fs.mkdirSync(path.join(directory, 'failed'), { recursive: true });
  fs.renameSync(database, path.join(directory, 'failed/data.db'));
  expect(fs.existsSync(database)).toBe(false);
  await restoreSnapshot(directory);
  expect(rows()).toEqual(['first']);
  // Running it again once it is complete changes nothing.
  await restoreSnapshot(directory);
  expect(rows()).toEqual(['first']);
});

it('waits for disk space instead of starting an update it might not finish', async () => {
  await expect(createSnapshot({ from: FROM, to: TO, margin: Number.MAX_SAFE_INTEGER })).rejects.toBeInstanceOf(SnapshotSpaceError);
  expect(fs.readdirSync(snapshotRoot())).toEqual([]);
});

it('keeps one snapshot per Home, for at most 7 days, unless something still needs it', async () => {
  const now = Date.now();
  const old = await createSnapshot({ from: FROM, to: TO, now: now - 2000 });
  const latest = await createSnapshot({ from: FROM, to: TO, now: now - 1000 });
  expect(listSnapshots().map(entry => entry.directory)).toEqual([latest]);
  expect(fs.existsSync(old)).toBe(false);
  expect(pruneSnapshots({ now: now + SNAPSHOT_RETENTION_MS + 1000, keep: [latest] })).toEqual([]);
  expect(pruneSnapshots({ now: now + SNAPSHOT_RETENTION_MS + 1000 })).toEqual([latest]);
});

it('counts what a rollback would lose', async () => {
  const directory = await createSnapshot({ from: FROM, to: TO });
  write('new note');
  const db = new Database(database);
  db.prepare("INSERT INTO chat_events (content) VALUES ('a'), ('b'), ('c')").run();
  db.close();
  expect(snapshotChanges(readSnapshot(directory), serviceIdentity().database)).toEqual({ messages: 3, chats: 0, tasks: 0, notes: 1 });
});
