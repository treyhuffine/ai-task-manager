/**
 * Only a starting server (or `pnpm db:migrate`) upgrades an existing home's
 * database (src/lib/db/migrate.ts). Anything else that opens it, like an
 * agent's `ri agent` command from a checkout holding a draft migration,
 * refuses and changes nothing. A brand-new database is always set up.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { getDb, resetDb } from './index';
import { allowMigrations, migrationsAllowed, PendingMigrationsError } from './migrate';

const DRAFT_TAG = '9999_draft_probe';
let home: TestHome;
let repo: string;
const saved = { repo: process.env.RI_RUNTIME_REPO, allowed: false };

/** A copy of this checkout's migrations plus one draft, as an agent might leave it. */
function repoWithDraft(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-migration-policy-'));
  fs.cpSync(path.resolve('drizzle'), path.join(dir, 'drizzle'), { recursive: true });
  const journalPath = path.join(dir, 'drizzle/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number; when: number; tag: string }> };
  const last = journal.entries.at(-1)!;
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag: DRAFT_TAG });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  fs.writeFileSync(path.join(dir, 'drizzle', `${DRAFT_TAG}.sql`), 'CREATE TABLE `draft_probe` (`id` integer PRIMARY KEY NOT NULL);\n');
  return dir;
}

function inspect(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      applied: (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n,
      draftTable: Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'draft_probe'").get()),
    };
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  saved.allowed = migrationsAllowed();
  allowMigrations(false);
  home = await createTestHome({ prefix: 'ri-migration-policy-' });
  resetDb();
  repo = repoWithDraft();
  process.env.RI_RUNTIME_REPO = repo;
});

afterEach(async () => {
  if (saved.repo === undefined) delete process.env.RI_RUNTIME_REPO;
  else process.env.RI_RUNTIME_REPO = saved.repo;
  allowMigrations(saved.allowed);
  await home.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('who may migrate an existing home', () => {
  it('refuses a pending migration outside a server start, and changes nothing', () => {
    const before = inspect(home.dbPath);
    expect(() => getDb()).toThrow(PendingMigrationsError);
    try {
      getDb();
    } catch (err) {
      expect((err as PendingMigrationsError).pending).toEqual([DRAFT_TAG]);
      expect((err as Error).message).toContain('restart Ri');
      expect((err as Error).message).toContain('Nothing was changed');
    }
    expect(inspect(home.dbPath)).toEqual(before);
    expect(before.draftTable).toBe(false);
  });

  it('applies it when the process starts the server', () => {
    const before = inspect(home.dbPath);
    allowMigrations();
    getDb();
    resetDb();
    expect(inspect(home.dbPath)).toEqual({ applied: before.applied + 1, draftTable: true });
  });

  it('always sets up a brand-new database', () => {
    resetDb();
    fs.rmSync(home.dbPath, { force: true });
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${home.dbPath}${suffix}`, { force: true });
    getDb();
    resetDb();
    expect(inspect(home.dbPath).draftTable).toBe(true);
  });
});
