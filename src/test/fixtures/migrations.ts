/**
 * Databases as an older build left them, for migration and adoption tests.
 *
 * `migrationsFolderUpTo(tag)` copies the repository's migrations up to and
 * including `tag` into a temp folder with a trimmed journal. `createDatabaseAt
 * (dbPath, tag)` builds a database with exactly those migrations plus the
 * boot-time SQL (FTS, triggers, vector index, seed rows), which is what a
 * home running that build has. Seed it with raw SQL at that schema, close
 * it, then open it through `getDb()` to apply everything newer.
 *
 * Tags come from `drizzle/meta/_journal.json`, e.g. `0001_late_magus`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { initDatabase } from '@/lib/db';

interface JournalEntry {
  idx: number;
  tag: string;
}

const DRIZZLE = path.resolve(process.cwd(), 'drizzle');

export function migrationTags(): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return journal.entries.map((e) => e.tag);
}

export function migrationsFolderUpTo(tag: string): { folder: string; cleanup(): void } {
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  } & Record<string, unknown>;
  const end = journal.entries.findIndex((e) => e.tag === tag);
  if (end === -1) throw new Error(`Unknown migration tag ${tag}. Known: ${migrationTags().join(', ')}`);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-test-migrations-'));
  fs.mkdirSync(path.join(folder, 'meta'));
  const entries = journal.entries.slice(0, end + 1);
  for (const e of entries) fs.copyFileSync(path.join(DRIZZLE, `${e.tag}.sql`), path.join(folder, `${e.tag}.sql`));
  fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }, null, 2));
  return { folder, cleanup: () => fs.rmSync(folder, { recursive: true, force: true }) };
}

/** Build `dbPath` at migration `tag`, closed and ready to seed or upgrade. */
export function createDatabaseAt(dbPath: string, tag: string): void {
  const { folder, cleanup } = migrationsFolderUpTo(tag);
  const sqlite = new Database(dbPath);
  try {
    sqliteVec.load(sqlite);
    sqlite.pragma('journal_mode = WAL');
    initDatabase(sqlite, folder);
  } finally {
    sqlite.close();
    cleanup();
  }
}
