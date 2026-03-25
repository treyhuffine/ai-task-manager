import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

let dbInstance: DB | null = null;
let rawInstance: Database.Database | null = null;
let currentPath: string | null = null;

export function getDefaultDbPath(): string {
  return process.env.EON_DB_PATH ?? path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? '.',
    '.eon',
    'data.db'
  );
}

export function resetDb(): void {
  if (rawInstance) {
    rawInstance.close();
    rawInstance = null;
    dbInstance = null;
    currentPath = null;
  }
}

export function getDb(dbPath?: string): DB {
  const resolvedPath = dbPath ?? getDefaultDbPath();

  // Invalidate cached connection if the db file was deleted (reset)
  if (dbInstance && currentPath === resolvedPath) {
    if (!fs.existsSync(resolvedPath)) {
      rawInstance?.close();
      rawInstance = null;
      dbInstance = null;
      currentPath = null;
    } else {
      return dbInstance;
    }
  }

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(resolvedPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Run raw SQL for schema init (CREATE TABLE IF NOT EXISTS + FTS + triggers)
  const schemaPath = path.resolve(process.cwd(), 'src/lib/db/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    sqlite.exec(schemaSql);
  }

  rawInstance = sqlite;
  dbInstance = drizzle(sqlite, { schema });
  currentPath = resolvedPath;
  return dbInstance;
}
