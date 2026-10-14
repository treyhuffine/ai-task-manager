/**
 * Adding `notes.kind` (docs/homes-spec.md §9.7, P8.1) on a Home that has
 * notes, and on one that has none: the consolidated P8 migration adds a
 * nullable column and an index to notes. Every row, rowid, keyword result and link
 * stays as it was, no note is classified by its title, and a second start
 * applies nothing.
 */

import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from './index';
import { runMigrations } from './migrate';

const SOURCE = path.resolve(__dirname, '../../../drizzle');

/** Start at production's 0014, then allow the consolidated P8 migration. */
function stagedMigrations() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-note-kind-migration-'));
  const journal = JSON.parse(fs.readFileSync(path.join(SOURCE, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  const index = journal.entries.findIndex((entry) => entry.tag === '0015_team_shared_context');
  expect(index).toBeGreaterThan(0);
  const entries = journal.entries.slice(0, index + 1);
  fs.mkdirSync(path.join(dir, 'meta'));
  for (const entry of entries) fs.copyFileSync(path.join(SOURCE, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
  const journalFile = path.join(dir, 'meta/_journal.json');
  fs.writeFileSync(journalFile, JSON.stringify({ ...journal, entries: entries.slice(0, -1) }));
  return { dir, allowKind: () => fs.writeFileSync(journalFile, JSON.stringify({ ...journal, entries })) };
}

function open(file: string) {
  const db = new Database(file);
  sqliteVec.load(db);
  db.pragma('foreign_keys = ON');
  return db;
}

it('adds kind to a Home with notes without touching a row, rowid, search result or link', () => {
  const staged = stagedMigrations();
  const file = path.join(staged.dir, 'data.db');
  const db = open(file);
  try {
    // A Home as it stood at production's 0014, with its search tables and triggers.
    initDatabase(db, staged.dir);
    db.exec(`
      INSERT INTO areas(rowid, id, name, status, sort_order) VALUES (5, 'area', 'Work', 'active', 0);
      INSERT INTO notes(rowid, id, title, body, status, area_id) VALUES
        (11, 'plain', 'Launch plan', 'Ship on Friday after the review.', 'active', 'area'),
        (29, 'prefixed', 'Decision: use the billing provider', 'Chosen for its invoices.', 'active', NULL),
        (31, 'archived', NULL, 'An old thought about invoices', 'archived', NULL);
      INSERT INTO notes(rowid, id, title, body, status) VALUES (40, 'linker', 'Links', 'See [[note:plain]]', 'active');
      INSERT INTO entity_links(id, source_type, source_id, target_type, target_id) VALUES ('link', 'note', 'linker', 'note', 'plain');
    `);
    const rows = () => db.prepare('SELECT rowid, * FROM notes ORDER BY rowid').all() as Array<Record<string, unknown>>;
    const before = rows();
    const search = (term: string) => (db.prepare('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rowid').all(term) as Array<{ rowid: number }>).map((r) => r.rowid);
    const invoicesBefore = search('invoices');
    const linksBefore = db.prepare('SELECT source_type, source_id, target_type, target_id FROM entity_links ORDER BY source_id').all();
    expect(invoicesBefore).toEqual([29, 31]);
    expect(linksBefore).toHaveLength(1);

    staged.allowKind();
    expect(runMigrations(db, staged.dir)).toEqual({ applied: 1 });
    // Booting again re-installs the derived search schema and applies nothing.
    initDatabase(db, staged.dir);
    expect(runMigrations(db, staged.dir)).toEqual({ applied: 0 });

    // Every row is as it was, with an empty kind: none is read from a title.
    expect(rows()).toEqual(before.map((row) => ({ ...row, kind: null })));
    expect(search('invoices')).toEqual(invoicesBefore);
    expect(search('billing')).toEqual([29]);
    expect(db.prepare('SELECT source_type, source_id, target_type, target_id FROM entity_links ORDER BY source_id').all()).toEqual(linksBefore);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_notes_kind_status'").get() as { sql: string };
    expect(index.sql).toContain('(`kind`,`status`)');

    // The search triggers still follow the notes after the change.
    db.prepare("UPDATE notes SET body = 'Ship on Monday instead.', kind = 'decision' WHERE id = 'plain'").run();
    expect(search('Monday')).toEqual([11]);
    expect(search('Friday')).toEqual([]);
  } finally {
    db.close();
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});

it('adds kind to an empty Home', () => {
  const staged = stagedMigrations();
  const db = open(path.join(staged.dir, 'data.db'));
  try {
    initDatabase(db, staged.dir);
    staged.allowKind();
    expect(runMigrations(db, staged.dir)).toEqual({ applied: 1 });
    const columns = db.prepare("SELECT name, \"notnull\", dflt_value FROM pragma_table_info('notes') WHERE name = 'kind'").all();
    // Nullable, with no default: the creator writes a kind, the database decides none.
    expect(columns).toEqual([{ name: 'kind', notnull: 0, dflt_value: null }]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    fs.rmSync(staged.dir, { recursive: true, force: true });
  }
});
