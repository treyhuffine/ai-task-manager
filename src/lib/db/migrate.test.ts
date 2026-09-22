import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MigrationForeignKeyError, runMigrations } from './migrate';

/**
 * runMigrations exists because Drizzle's migrator applies migrations inside a
 * transaction with foreign keys ON, where a table rebuild cascades into its
 * children. These tests pin the three properties that matter: rebuilds don't
 * cascade, new dangling references roll back, and bookkeeping stays
 * interchangeable with Drizzle's own runner.
 */

let dir: string;
let sqlite: Database.Database;
let entries: Array<{ tag: string; sql: string }>;

function writeMigrations() {
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
  const journal = {
    version: '7',
    dialect: 'sqlite',
    entries: entries.map((e, idx) => ({
      idx,
      version: '6',
      when: 1_000_000 + idx,
      tag: e.tag,
      breakpoints: true,
    })),
  };
  fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const e of entries) fs.writeFileSync(path.join(dir, `${e.tag}.sql`), e.sql);
}

function addMigration(tag: string, statements: string[]) {
  entries.push({ tag, sql: statements.join('\n--> statement-breakpoint\n') });
  writeMigrations();
}

const BASE = [
  `CREATE TABLE parent (id text PRIMARY KEY NOT NULL, obsolete text)`,
  `CREATE TABLE child (
     id text PRIMARY KEY NOT NULL,
     parent_id text NOT NULL REFERENCES parent(id) ON DELETE CASCADE
   )`,
  `INSERT INTO parent (id, obsolete) VALUES ('p1', 'x'), ('p2', 'y')`,
  `INSERT INTO child (id, parent_id) VALUES ('c1', 'p1'), ('c2', 'p1'), ('c3', 'p2')`,
];

// The shape drizzle-kit emits for a SQLite rebuild, PRAGMAs included. The
// PRAGMAs are no-ops inside the migration transaction, which is the point.
const REBUILD_PARENT = [
  `PRAGMA foreign_keys=OFF`,
  `CREATE TABLE __new_parent (id text PRIMARY KEY NOT NULL)`,
  `INSERT INTO __new_parent (rowid, id) SELECT rowid, id FROM parent`,
  `DROP TABLE parent`,
  `ALTER TABLE __new_parent RENAME TO parent`,
  `PRAGMA foreign_keys=ON`,
];

function foreignKeysOn(): boolean {
  return (sqlite.pragma('foreign_keys', { simple: true }) as number) === 1;
}

function appliedCount(): number {
  return (sqlite.prepare('SELECT count(*) AS n FROM "__drizzle_migrations"').get() as { n: number }).n;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-migrate-'));
  sqlite = new Database(path.join(dir, 'test.db'));
  sqlite.pragma('foreign_keys = ON');
  entries = [];
  addMigration('0000_base', BASE);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('runMigrations', () => {
  it('rebuilds a parent table without cascading into its children', () => {
    runMigrations(sqlite, dir);
    const rowidsBefore = sqlite.prepare('SELECT rowid, id FROM parent ORDER BY id').all();

    addMigration('0001_rebuild', REBUILD_PARENT);
    expect(runMigrations(sqlite, dir)).toEqual({ applied: 1 });

    expect(sqlite.prepare('SELECT id FROM child ORDER BY id').pluck().all()).toEqual(['c1', 'c2', 'c3']);
    expect(sqlite.prepare('SELECT rowid, id FROM parent ORDER BY id').all()).toEqual(rowidsBefore);
    const columns = sqlite.prepare(`SELECT name FROM pragma_table_info('parent')`).pluck().all();
    expect(columns).toEqual(['id']);
  });

  it('shows why: the same rebuild under Drizzle\'s migrator deletes the children', () => {
    // Guards the premise. If Drizzle ever stops cascading here, runMigrations
    // can go back to being a plain migrate() call.
    runMigrations(sqlite, dir);
    addMigration('0001_rebuild', REBUILD_PARENT);

    drizzleMigrate(drizzle(sqlite), { migrationsFolder: dir });

    expect(sqlite.prepare('SELECT count(*) FROM child').pluck().get()).toBe(0);
  });

  it('rolls back a migration that leaves a dangling reference', () => {
    runMigrations(sqlite, dir);
    addMigration('0001_orphan', [`DELETE FROM parent WHERE id = 'p2'`]);

    expect(() => runMigrations(sqlite, dir)).toThrow(MigrationForeignKeyError);

    expect(sqlite.prepare('SELECT id FROM parent ORDER BY id').pluck().all()).toEqual(['p1', 'p2']);
    expect(appliedCount()).toBe(1);
    expect(foreignKeysOn()).toBe(true);
  });

  it('does not block on violations that predate the migration', () => {
    runMigrations(sqlite, dir);
    sqlite.pragma('foreign_keys = OFF');
    sqlite.prepare(`INSERT INTO child (id, parent_id) VALUES ('c4', 'gone')`).run();
    sqlite.pragma('foreign_keys = ON');

    addMigration('0001_add_column', [`ALTER TABLE child ADD note text`]);
    expect(runMigrations(sqlite, dir)).toEqual({ applied: 1 });
  });

  it('leaves foreign keys on whether or not anything was pending', () => {
    sqlite.pragma('foreign_keys = OFF');
    runMigrations(sqlite, dir);
    expect(foreignKeysOn()).toBe(true);

    sqlite.pragma('foreign_keys = OFF');
    expect(runMigrations(sqlite, dir)).toEqual({ applied: 0 });
    expect(foreignKeysOn()).toBe(true);
  });

  it('keeps bookkeeping interchangeable with Drizzle\'s own runner', () => {
    runMigrations(sqlite, dir);
    addMigration('0001_add_column', [`ALTER TABLE child ADD note text`]);
    runMigrations(sqlite, dir);

    // Drizzle sees everything as applied and does nothing (re-running the
    // ADD COLUMN would throw on the duplicate column).
    expect(() => drizzleMigrate(drizzle(sqlite), { migrationsFolder: dir })).not.toThrow();
    expect(appliedCount()).toBe(2);

    // And the reverse: a database Drizzle migrated is picked up where it left off.
    addMigration('0002_add_another', [`ALTER TABLE child ADD other text`]);
    drizzleMigrate(drizzle(sqlite), { migrationsFolder: dir });
    expect(runMigrations(sqlite, dir)).toEqual({ applied: 0 });
  });
});
