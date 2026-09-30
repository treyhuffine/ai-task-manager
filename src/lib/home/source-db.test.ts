import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copySourceDatabase, hasSidecars, withSourceDatabase } from './source-db';

let tmp: string;
let dbPath: string;

function makeDb(rows: number): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (n INTEGER)');
  const insert = db.prepare('INSERT INTO t VALUES (?)');
  for (let i = 0; i < rows; i++) insert.run(i);
  return db;
}

const count = (db: Database.Database) =>
  (db.prepare('SELECT count(*) AS n FROM t').get() as { n: number }).n;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-source-db-test-'));
  dbPath = path.join(tmp, 'data.db');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('withSourceDatabase', () => {
  it('reads a stopped database without creating sidecar files', () => {
    makeDb(3).close();
    expect(hasSidecars(dbPath)).toBe(false);
    expect(withSourceDatabase(dbPath, count)).toBe(3);
    expect(fs.readdirSync(tmp)).toEqual(['data.db']);
  });

  it('reads the latest writes of an open database', () => {
    const live = makeDb(5);
    expect(hasSidecars(dbPath)).toBe(true);
    expect(withSourceDatabase(dbPath, count)).toBe(5);
    live.close();
  });
});

describe('copySourceDatabase', () => {
  it('copies a stopped database without touching its folder', async () => {
    makeDb(4).close();
    const dest = path.join(tmp, 'out', 'data.db');
    await copySourceDatabase(dbPath, dest);
    expect(fs.readdirSync(tmp).sort()).toEqual(['data.db', 'out']);
    const copy = new Database(dest, { readonly: true });
    expect(count(copy)).toBe(4);
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    copy.close();
    expect(fs.readdirSync(path.join(tmp, 'out'))).toEqual(['data.db']);
  });

  it('copies rows that are still in the WAL of a running database', async () => {
    const live = makeDb(7);
    const dest = path.join(tmp, 'out', 'data.db');
    await copySourceDatabase(dbPath, dest);
    live.close();
    const copy = new Database(dest, { readonly: true });
    expect(count(copy)).toBe(7);
    copy.close();
  });
});
