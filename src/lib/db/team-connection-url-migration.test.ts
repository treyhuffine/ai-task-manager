import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from './migrate';

it('renames saved team URLs without changing rowids, connection state or shared work', () => {
  const source = path.resolve(__dirname, '../../../drizzle');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-team-url-migration-'));
  const db = new Database(':memory:');
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    const rename = journal.entries.findIndex(entry => entry.tag === '0013_team_connection_url');
    expect(rename).toBeGreaterThan(0);
    const entries = journal.entries.slice(0, rename + 1);
    fs.mkdirSync(path.join(dir, 'meta'));
    for (const entry of entries) {
      fs.copyFileSync(path.join(source, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
    }
    const journalFile = path.join(dir, 'meta/_journal.json');
    fs.writeFileSync(journalFile, JSON.stringify({ ...journal, entries: entries.slice(0, -1) }));
    db.pragma('foreign_keys = ON');
    runMigrations(db, dir);
    db.exec(`
      INSERT INTO team_connections(rowid, id, created_at, updated_at, name, address, member_id, member_name, role, status, last_synced_at, last_error, last_error_at)
        VALUES (17, 'active-team', '2026-10-08 10:00:00', '2026-10-09 12:00:00', 'Acme', 'https://team.example.com', 'maya', 'Maya', 'member', 'active', '2026-10-09T12:00:00Z', NULL, NULL),
               (901, 'old-team', '2026-10-07 10:00:00', '2026-10-09 13:00:00', 'Previous team', 'https://old.example.com', 'maya-old', 'Maya', 'owner', 'disconnected', '2026-10-08T12:00:00Z', 'Team unavailable', '2026-10-08T13:00:00Z');
      INSERT INTO tasks(rowid, id, raw_input, title, body, status, source_team_id, source_task_id, source_state, source)
        VALUES (43, 'task', 'Keep this task', 'Keep this task', 'Shared task body', 'todo', 'active-team', 'team-task', 'active', '{}');
      INSERT INTO notes(rowid, id, title, body, status, source_team_id, source_note_id, source_state, source)
        VALUES (73, 'note', 'Keep this note', 'Shared note body', 'active', 'active-team', 'team-note', 'active', '{}');
    `);
    const rows = (table: string) => db.prepare(`SELECT rowid, * FROM "${table}" ORDER BY rowid`).all() as Array<Record<string, unknown>>;
    const connections = rows('team_connections');
    const tasks = rows('tasks');
    const notes = rows('notes');
    const history = rows('__drizzle_migrations');
    fs.writeFileSync(journalFile, JSON.stringify({ ...journal, entries }));

    expect(runMigrations(db, dir)).toEqual({ applied: 1 });
    const expectedConnections = connections.map(({ address, ...row }) => ({ ...row, url: address }));
    expect(rows('team_connections')).toEqual(expectedConnections);
    expect(rows('tasks')).toEqual(tasks);
    expect(rows('notes')).toEqual(notes);
    expect(rows('__drizzle_migrations').slice(0, history.length)).toEqual(history);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');

    // A second server start keeps the renamed connections and all their links.
    expect(runMigrations(db, dir)).toEqual({ applied: 0 });
    expect(rows('team_connections')).toEqual(expectedConnections);
    expect(rows('tasks')).toEqual(tasks);
    expect(rows('notes')).toEqual(notes);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
