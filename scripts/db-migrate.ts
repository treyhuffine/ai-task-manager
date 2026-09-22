/**
 * `pnpm db:migrate`: apply pending migrations to the configured database the
 * same way app boot does (`getDb`), then exit.
 *
 * Deliberately not `drizzle-kit migrate`. better-sqlite3 opens every
 * connection with foreign keys ON, and drizzle-kit's runner applies migrations
 * inside one transaction where SQLite ignores `PRAGMA foreign_keys=OFF`. A
 * migration that rebuilds a table would then cascade into its children (a
 * `chat_sessions` rebuild deletes every chat message). `runMigrations` in
 * src/lib/db/migrate.ts is the one safe path, so this script uses it.
 *
 * Targets `RI_DB_PATH` / `RI_ROOT` like the app. Run it with the app stopped.
 */
import { getDb, getDefaultDbPath, getRawDb, resetDb } from '../src/lib/db';

const dbPath = getDefaultDbPath();
getDb(dbPath);
const applied = getRawDb(dbPath)
  .prepare('SELECT count(*) AS n FROM "__drizzle_migrations"')
  .get() as { n: number };
resetDb();
console.log(`Migrated ${dbPath} (${applied.n} migrations recorded)`);
