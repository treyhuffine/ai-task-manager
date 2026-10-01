import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { inspectMigrationHistory, MigrationCompatibilityError, runMigrations } from './migrate';

interface Entry { idx: number; version: string; when: number; tag: string; breakpoints: boolean }
// Exact historical SQL from 45cc482 / df1e58a. These fixtures do not require
// Git at runtime, and their hashes pin the history that reached other Macs.
const retired = [{
  tag: '0003_large_dark_phoenix', when: 1790787209414,
  hash: '9122b33138438b245b95104dcbe6d4a8370fd908ed797e5dd423e90421038a21',
  sql: 'CREATE TABLE `skill_scopes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` text DEFAULT (datetime(\'now\')) NOT NULL,\n\t`updated_at` text DEFAULT (datetime(\'now\')) NOT NULL,\n\t`name` text NOT NULL,\n\t`workspace_ids` text NOT NULL\n);\n--> statement-breakpoint\nCREATE UNIQUE INDEX `skill_scopes_name_unique` ON `skill_scopes` (`name`);',
}, {
  tag: '0004_harsh_moondragon', when: 1790792118119,
  hash: 'fdc994186026400eeb3fcc9dcfd008aa8c0331d0affb8e2fb52645b3e375afc6',
  sql: 'DROP TABLE `skill_scopes`;',
}];

const migrations = path.resolve(__dirname, '../../../drizzle');
const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8')) as { version: string; dialect: string; entries: Entry[] };
const canonical = journal.entries.slice(0, 4);
let temporary: string;
let db: Database.Database;
let target: string;

function folder(name: string, entries: Entry[], sql = new Map<string, string>()): string {
  const directory = path.join(temporary, name);
  fs.mkdirSync(path.join(directory, 'meta'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) {
    fs.writeFileSync(path.join(directory, `${entry.tag}.sql`), sql.get(entry.tag) ?? fs.readFileSync(path.join(migrations, `${entry.tag}.sql`), 'utf8'));
  }
  return directory;
}

function seed() {
  db.exec(`
    INSERT INTO devices(rowid, id, name, kind, status) VALUES (701, 'device', 'Fixture Mac', 'computer', 'active');
    INSERT INTO home(rowid, id, kind, name, host_device_id) VALUES (709, 'home', 'personal', 'Fixture Home', 'device');
    INSERT INTO api_keys(rowid, id, name, prefix, suffix, hash, env, device_id, role)
      VALUES (733, 'key', 'Fixture host', 'prefix', 'tail', 'fixture-key-hash', 'test', 'device', 'sign_in');
    INSERT INTO tasks(rowid, id, raw_input, title, body, status)
      VALUES (17, 'task', 'Original request', 'Preserved task', 'Preserved task body', 'todo');
    INSERT INTO notes(rowid, id, task_id, title, body, status)
      VALUES (43, 'note', 'task', 'Preserved note', 'Preserved note body', 'active');
    INSERT INTO chat_sessions(rowid, id, harness, type, status, permission_mode, label)
      VALUES (101, 'chat', 'codex', 'task', 'idle', 'ask', 'Preserved chat');
    INSERT INTO chat_events(rowid, id, session_id, role, source, content)
      VALUES (251, 'message', 'chat', 'user', 'user', 'Preserved conversation');
    INSERT INTO user_state(id, name, description) VALUES (1, 'Fixture person', 'Preserved preferences');
    CREATE VIRTUAL TABLE tasks_fts USING fts5(title, description, body, raw_input, content='tasks', content_rowid='rowid');
    CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content='notes', content_rowid='rowid');
    INSERT INTO tasks_fts(rowid, title, description, body, raw_input) SELECT rowid, title, description, body, raw_input FROM tasks;
    INSERT INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes;
  `);
}

function legacy(count: 1 | 2) {
  const old = retired.slice(0, count);
  const entries = [...canonical.slice(0, 3), ...old.map((item, i) => ({ idx: i + 3, version: '6', when: item.when, tag: item.tag, breakpoints: true }))];
  runMigrations(db, folder('legacy', entries, new Map(old.map(item => [item.tag, item.sql]))));
  seed();
  if (count === 1) db.exec("INSERT INTO skill_scopes(rowid, id, name, workspace_ids) VALUES (919, 'scope', 'Do not lose this scope', '[\"saved-agent\"]')");
}

function history(connection = db) {
  return connection.prepare('SELECT rowid, * FROM __drizzle_migrations ORDER BY created_at, rowid').all();
}

function snapshot(connection = db) {
  const tables = ['devices', 'home', 'api_keys', 'tasks', 'notes', 'chat_sessions', 'chat_events'];
  if (connection.prepare("SELECT 1 FROM sqlite_master WHERE name = 'skill_scopes'").get()) tables.push('skill_scopes');
  return {
    rows: Object.fromEntries(tables.map(table => [table, connection.prepare(`SELECT rowid, * FROM "${table}" ORDER BY rowid`).all()])),
    preferences: connection.prepare('SELECT id, created_at, updated_at, name, description FROM user_state').all(),
    schema: connection.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name <> 'user_state' AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all(),
  };
}

function checkSearch() {
  expect(db.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'preserved'").pluck().all()).toEqual([17]);
  expect(db.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'preserved'").pluck().all()).toEqual([43]);
  db.exec("INSERT INTO tasks_fts(tasks_fts, rank) VALUES ('integrity-check', 1); INSERT INTO notes_fts(notes_fts, rank) VALUES ('integrity-check', 1)");
  expect(db.pragma('foreign_key_check')).toEqual([]);
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
}

function appendTarget(sql: string) {
  const entry = { idx: 4, version: '6', when: canonical[3].when + 1, tag: '0004_fixture_next', breakpoints: true };
  return { entry, directory: folder('target-next', [...canonical, entry], new Map([[entry.tag, sql]])) };
}

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-retired-migrations-'));
  db = new Database(path.join(temporary, 'data.db'));
  target = folder('current', canonical);
});
afterEach(() => {
  if (db.open) db.close();
  fs.rmSync(temporary, { recursive: true, force: true });
});

describe('retired skill migration lineage', () => {
  it('pins the historical SQL bytes and the replacement migration used by these fixtures', () => {
    for (const item of retired) expect(createHash('sha256').update(item.sql).digest('hex')).toBe(item.hash);
    const replacement = readMigrationFiles({ migrationsFolder: target })[3];
    expect(replacement.folderMillis).toBe(1790794317732);
    expect(replacement.hash).toBe('24a01a6e012e5935de1a1423011042693569cf997e141bc19c81cf56d3dd4b78');
  });

  it.each([1, 2] as const)('inspects %i retired entries read-only and preserves every existing record through upgrade and restart', count => {
    legacy(count);
    const originalHistory = history();
    const original = snapshot();
    const file = db.name;
    db.close();
    const readonly = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const inspected = inspectMigrationHistory(readonly, target);
      expect(inspected.applied).toBe(3 + count);
      expect(inspected.pending.map(migration => migration.hash)).toEqual([readMigrationFiles({ migrationsFolder: target })[3].hash]);
      expect(history(readonly)).toEqual(originalHistory);
      expect(snapshot(readonly)).toEqual(original);
    } finally { readonly.close(); }
    db = new Database(file, { fileMustExist: true });
    expect(runMigrations(db, target)).toEqual({ applied: 1 });
    expect(snapshot()).toEqual(original);
    expect(history().slice(0, originalHistory.length)).toEqual(originalHistory);
    expect(history()).toHaveLength(4 + count);
    expect(db.prepare('SELECT execution_inactive_after_days FROM user_state').pluck().get()).toBeNull();
    checkSearch();
    db.close();
    db = new Database(file, { fileMustExist: true });
    const upgraded = history();
    expect(inspectMigrationHistory(db, target)).toMatchObject({ applied: 4 + count, pending: [] });
    expect(runMigrations(db, target)).toEqual({ applied: 0 });
    expect(history()).toEqual(upgraded);
    expect(snapshot()).toEqual(original);
    checkSearch();
  });

  it('keeps an ordinary current database on its exact canonical history', () => {
    runMigrations(db, target);
    seed();
    const original = snapshot();
    const originalHistory = history();
    expect(inspectMigrationHistory(db, target)).toMatchObject({ applied: 4, pending: [] });
    expect(runMigrations(db, target)).toEqual({ applied: 0 });
    expect(snapshot()).toEqual(original);
    expect(history()).toEqual(originalHistory);
    checkSearch();
  });

  it.each([1, 2] as const)('applies later canonical migrations once after %i retired entries', count => {
    legacy(count);
    const originalHistory = history();
    const next = appendTarget('ALTER TABLE notes ADD COLUMN later_fixture text;');
    expect(inspectMigrationHistory(db, next.directory).pending).toHaveLength(2);
    expect(runMigrations(db, next.directory)).toEqual({ applied: 2 });
    expect(history().slice(0, originalHistory.length)).toEqual(originalHistory);
    expect(inspectMigrationHistory(db, next.directory)).toMatchObject({ applied: 5 + count, pending: [] });
    expect(runMigrations(db, next.directory)).toEqual({ applied: 0 });
    checkSearch();
  });

  it.each([
    ['changed prefix hash', "UPDATE __drizzle_migrations SET hash = 'tampered' WHERE created_at = 1790728732298"],
    ['changed create hash', `UPDATE __drizzle_migrations SET hash = 'tampered' WHERE created_at = ${retired[0].when}`],
    ['changed create timestamp', `UPDATE __drizzle_migrations SET created_at = created_at + 1 WHERE created_at = ${retired[0].when}`],
    ['changed drop hash', `UPDATE __drizzle_migrations SET hash = 'tampered' WHERE created_at = ${retired[1].when}`],
    ['changed drop timestamp', `UPDATE __drizzle_migrations SET created_at = created_at + 1 WHERE created_at = ${retired[1].when}`],
    ['missing canonical prefix entry', 'DELETE FROM __drizzle_migrations WHERE created_at = 1790120951248'],
    ['drop without create', `DELETE FROM __drizzle_migrations WHERE created_at = ${retired[0].when}`],
    ['duplicate create', `INSERT INTO __drizzle_migrations(hash, created_at) VALUES ('${retired[0].hash}', ${retired[0].when})`],
    ['unknown entry between retired entries', `INSERT INTO __drizzle_migrations(hash, created_at) VALUES ('unknown', ${retired[0].when + 1})`],
    ['future unknown entry', "INSERT INTO __drizzle_migrations(hash, created_at) VALUES ('future', 1999999999999)"],
  ])('refuses %s without modifying data, schema or journal', (_name, sql) => {
    legacy(2);
    db.exec(sql);
    const original = snapshot();
    const originalHistory = history();
    expect(() => inspectMigrationHistory(db, target)).toThrow(MigrationCompatibilityError);
    expect(() => runMigrations(db, target)).toThrow(MigrationCompatibilityError);
    expect(snapshot()).toEqual(original);
    expect(history()).toEqual(originalHistory);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('refuses a gap in the canonical tail after recognized retired entries', () => {
    legacy(1);
    const next = appendTarget('ALTER TABLE notes ADD COLUMN later_fixture text;');
    const last = readMigrationFiles({ migrationsFolder: next.directory })[4];
    db.prepare('INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)').run(last.hash, last.folderMillis);
    const originalHistory = history();
    expect(() => inspectMigrationHistory(db, next.directory)).toThrow(MigrationCompatibilityError);
    expect(() => runMigrations(db, next.directory)).toThrow(MigrationCompatibilityError);
    expect(history()).toEqual(originalHistory);
  });

  it.each(['missing', 'sql', 'timestamp'] as const)('refuses alternate history when the replacement anchor is %s', change => {
    legacy(1);
    let destination = target;
    if (change === 'missing') destination = folder('old-binary', canonical.slice(0, 3));
    if (change === 'sql') fs.appendFileSync(path.join(target, `${canonical[3].tag}.sql`), '\n-- changed historical SQL');
    if (change === 'timestamp') destination = folder('wrong-anchor', canonical.map((entry, i) => i === 3 ? { ...entry, when: entry.when + 1 } : entry));
    const original = snapshot();
    const originalHistory = history();
    expect(() => inspectMigrationHistory(db, destination)).toThrow(MigrationCompatibilityError);
    expect(() => runMigrations(db, destination)).toThrow(MigrationCompatibilityError);
    expect(snapshot()).toEqual(original);
    expect(history()).toEqual(originalHistory);
  });

  it.each([1, 2] as const)('rolls back new schema, journal entries and writes on failure after %i retired entries', count => {
    legacy(count);
    const original = snapshot();
    const originalHistory = history();
    const next = appendTarget("UPDATE notes SET body = 'must roll back';\n--> statement-breakpoint\nINSERT INTO missing_fixture_table VALUES ('fail');");
    expect(() => runMigrations(db, next.directory)).toThrow(/missing_fixture_table/);
    expect(snapshot()).toEqual(original);
    expect(history()).toEqual(originalHistory);
    expect(db.prepare("SELECT name FROM pragma_table_info('user_state') WHERE name = 'execution_inactive_after_days'").get()).toBeUndefined();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    checkSearch();
  });
});
