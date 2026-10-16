import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrationsFolderUpTo } from '@/test/fixtures/migrations';
import { initDatabase } from './index';
import { inspectMigrationHistory, MigrationCompatibilityError, runMigrations } from './migrate';

const SOURCE = path.resolve(__dirname, '../../../drizzle');
const PRODUCTION_TAG = '0014_opposite_gorgon';
// Already applied to both production Homes. Its identity must never change.
const PRODUCTION_HASH = '2add018924d68bd441c7c3f1eb23a9e0d9f8ed47604d12a04ff157cd192a4bbf';
const PRODUCTION_TIME = 1791848958297;

function rows(db: Database.Database, table: string) {
  return db.prepare(`SELECT rowid, * FROM "${table}" ORDER BY rowid`).all() as Array<Record<string, unknown>>;
}

it.each(['personal', 'team'])('upgrades a populated %s Home after production 0014 without losing titles, rowids or search', (kind) => {
  const previous = migrationsFolderUpTo(PRODUCTION_TAG);
  const db = new Database(':memory:');
  try {
    sqliteVec.load(db);
    initDatabase(db, previous.folder);
    db.exec(`
      INSERT INTO devices(id, name, kind, status) VALUES ('device', 'Fixture Mac', 'computer', 'active');
      INSERT INTO workspaces(id, name, slug, cwd, is_git, files_to_copy, collapsed, skip_live_confirm, browser_enabled, status)
        VALUES ('agent', 'Fixture agent', 'fixture', '/fixture', 0, '[]', 0, 0, 0, 'active');
      INSERT INTO executions(rowid, id, workspace_id, label, label_revision, status)
        VALUES (83, 'execution', 'agent', 'Keep the execution title', 7, 'active');
      INSERT INTO chat_sessions(rowid, id, harness, type, status, permission_mode, execution_id, label, label_source, label_revision)
        VALUES (101, 'chat', 'claude', 'execution', 'active', 'default', 'execution', 'Keep the manual title', 'manual', 9);
      INSERT INTO chat_events(rowid, id, session_id, role, source, content)
        VALUES (251, 'first', 'chat', 'user', 'user', 'Original migration question'),
               (971, 'second', 'chat', 'assistant', 'agent', 'Preserved migration answer');
      INSERT INTO tasks(rowid, id, raw_input, title, body, status)
        VALUES (17, 'task', 'Original request', 'Preserved task', 'Preserved task body', 'todo');
      INSERT INTO notes(rowid, id, task_id, title, body, status)
        VALUES (43, 'note', 'task', 'Decision: keep this title', 'Preserved note body', 'active');
    `);
    db.prepare('INSERT INTO home(id, kind, name, host_device_id) VALUES (?, ?, ?, ?)').run('home', kind, 'Fixture Home', 'device');
    if (kind === 'team') {
      db.exec("INSERT INTO members(id, name, role, status) VALUES ('owner', 'Fixture owner', 'owner', 'active')");
    }
    const preservedTables = ['devices', 'home', 'members', 'workspaces', 'executions', 'chat_sessions', 'tasks'];
    const before = Object.fromEntries(preservedTables.map(table => [table, rows(db, table)]));
    const notes = rows(db, 'notes');
    const events = rows(db, 'chat_events');
    const history = rows(db, '__drizzle_migrations');
    expect(history.at(-1)).toMatchObject({ hash: PRODUCTION_HASH, created_at: PRODUCTION_TIME });
    const search = () => db.prepare("SELECT rowid FROM chat_events_fts WHERE chat_events_fts MATCH 'migration' ORDER BY rowid").pluck().all();
    expect(search()).toEqual([251, 971]);
    const pending = inspectMigrationHistory(db, SOURCE).pending;
    expect(pending.length).toBeGreaterThanOrEqual(1);

    expect(runMigrations(db, SOURCE)).toEqual({ applied: pending.length });
    initDatabase(db, SOURCE);
    expect(runMigrations(db, SOURCE)).toEqual({ applied: 0 });

    for (const table of preservedTables) expect(rows(db, table)).toEqual(before[table]);
    expect(rows(db, 'notes')).toEqual(notes.map(row => ({ ...row, kind: null })));
    expect(rows(db, 'chat_events')).toEqual(events.map(row => ({ ...row, author_member_id: null })));
    expect(rows(db, '__drizzle_migrations').slice(0, history.length)).toEqual(history);
    expect(rows(db, '__drizzle_migrations')).toHaveLength(history.length + pending.length);
    expect(search()).toEqual([251, 971]);
    expect(db.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'preserved'").pluck().all()).toEqual([17]);
    expect(db.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'preserved'").pluck().all()).toEqual([43]);
    for (const table of ['shared_operation_receipts', 'team_ai_settings', 'team_chat_turns']) {
      expect(rows(db, table)).toEqual([]);
    }
    for (const index of ['idx_notes_kind_status', 'idx_chat_events_session_cursor', 'idx_team_chat_turns_message']) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)).toBeDefined();
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  } finally {
    db.close();
    previous.cleanup();
  }
});

it('builds a fresh Home with the same schema as an upgrade through production 0014', () => {
  const previous = migrationsFolderUpTo(PRODUCTION_TAG);
  const fresh = new Database(':memory:');
  const upgraded = new Database(':memory:');
  try {
    runMigrations(upgraded, previous.folder);
    const pending = inspectMigrationHistory(upgraded, SOURCE).pending.length;
    expect(runMigrations(upgraded, SOURCE)).toEqual({ applied: pending });
    runMigrations(fresh, SOURCE);
    const schema = (db: Database.Database) => db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
    expect(schema(fresh)).toEqual(schema(upgraded));
    expect(inspectMigrationHistory(fresh, SOURCE).pending).toEqual([]);
    expect(fresh.pragma('foreign_key_check')).toEqual([]);
  } finally {
    fresh.close();
    upgraded.close();
    previous.cleanup();
  }
});

it('refuses the discarded P8 development history without rewriting its journal or data', () => {
  const previous = migrationsFolderUpTo('0013_team_connection_url');
  const db = new Database(':memory:');
  try {
    runMigrations(db, previous.folder);
    // Exact first migration from the unpublished P8 branch before consolidation.
    db.exec('ALTER TABLE `notes` ADD `kind` text; CREATE INDEX `idx_notes_kind_status` ON `notes` (`kind`,`status`);');
    db.prepare('INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)').run(
      '45e7360480b376c06557d7018640cc0840228a5afc139756689c0076594c31b4', 1791839196929,
    );
    db.exec("INSERT INTO notes(id, title, body, status, kind) VALUES ('old-p8', 'Keep this decision', 'Old development data', 'active', 'decision')");
    const history = rows(db, '__drizzle_migrations');
    const notes = rows(db, 'notes');
    expect(() => runMigrations(db, SOURCE)).toThrow(MigrationCompatibilityError);
    expect(rows(db, '__drizzle_migrations')).toEqual(history);
    expect(rows(db, 'notes')).toEqual(notes);
    expect(db.prepare("SELECT name FROM pragma_table_info('chat_sessions') WHERE name = 'label_source'").all()).toEqual([]);
  } finally {
    db.close();
    previous.cleanup();
  }
});

it('keeps the deployed title migration unchanged and the P8 migration additive', () => {
  const migrations = readMigrationFiles({ migrationsFolder: SOURCE });
  const deployed = migrations.find(migration => migration.folderMillis === PRODUCTION_TIME);
  expect(deployed?.hash).toBe(PRODUCTION_HASH);
  const p8 = migrations[migrations.indexOf(deployed!) + 1];
  expect(p8).toBeDefined();
  for (const statement of p8.sql) {
    expect(statement.trim()).toMatch(/^(CREATE (?:UNIQUE )?(?:TABLE|INDEX)|ALTER TABLE `(?:notes|chat_events)` ADD)\b/);
  }
});


it('adds the authentication choice without selecting API billing for an existing team', () => {
  const previous = migrationsFolderUpTo('0015_team_shared_context');
  const db = new Database(':memory:');
  try {
    runMigrations(db, previous.folder);
    db.exec("INSERT INTO team_ai_settings(id, enabled, harness, provider, model, credential_label, credential_set_at) VALUES ('team', 1, 'claude', 'anthropic', 'sonnet', 'Legacy key', '2026-10-01')");
    const before = rows(db, 'team_ai_settings');
    const history = rows(db, '__drizzle_migrations');
    const pending = inspectMigrationHistory(db, SOURCE).pending.length;
    expect(pending).toBeGreaterThanOrEqual(1);
    expect(runMigrations(db, SOURCE)).toEqual({ applied: pending });
    expect(rows(db, 'team_ai_settings')).toEqual(before.map(row => ({ ...row, auth_mode: null })));
    expect(rows(db, '__drizzle_migrations').slice(0, history.length)).toEqual(history);
    expect(runMigrations(db, SOURCE)).toEqual({ applied: 0 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    previous.cleanup();
  }
});
