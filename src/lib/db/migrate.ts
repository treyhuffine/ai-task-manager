import type Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';

/**
 * Apply pending Drizzle migrations with foreign-key enforcement OFF, verify
 * every link before committing, then turn enforcement back on. Always leaves
 * the connection with `foreign_keys = ON`, whether or not anything ran.
 *
 * Why this replaces `migrate()` from `drizzle-orm/better-sqlite3/migrator`:
 * Drizzle wraps every pending migration in one transaction, and SQLite ignores
 * `PRAGMA foreign_keys` inside a transaction. So the `PRAGMA foreign_keys=OFF`
 * that drizzle-kit emits around a table rebuild is a silent no-op, and with
 * enforcement on, the rebuild's `DROP TABLE` runs an implicit DELETE that fires
 * every child's ON DELETE action. Rebuilding `chat_sessions` that way would
 * cascade-delete every `chat_events` row. Turning enforcement off before the
 * transaction opens is SQLite's documented procedure for schema changes
 * (https://sqlite.org/lang_altertable.html#otheralter), and the
 * `foreign_key_check` before COMMIT keeps it honest: a migration that leaves a
 * dangling reference rolls back instead of landing.
 *
 * Bookkeeping is identical to Drizzle's (same `__drizzle_migrations` table,
 * hash, and `created_at = folderMillis` comparison), so databases migrated by
 * either runner stay interchangeable, including `pnpm db:migrate`.
 */
export function runMigrations(
  sqlite: Database.Database,
  migrationsFolder: string,
): { applied: number } {
  const migrations = readMigrationFiles({ migrationsFolder });

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
  const last = sqlite
    .prepare(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at: number | string } | undefined;
  const pending = migrations.filter(
    (m) => !last || Number(last.created_at) < m.folderMillis,
  );
  if (pending.length === 0) {
    sqlite.pragma('foreign_keys = ON');
    return { applied: 0 };
  }

  // Must run outside a transaction, or SQLite ignores it.
  sqlite.pragma('foreign_keys = OFF');
  try {
    // Violations that already existed are not this migration's fault, and
    // failing boot on them would brick an install over old damage. Only new
    // ones block the commit.
    const before = new Set(checkForeignKeys(sqlite).map(violationKey));

    sqlite.exec('BEGIN');
    try {
      for (const migration of pending) {
        for (const statement of migration.sql) sqlite.exec(statement);
        sqlite
          .prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
          .run(migration.hash, migration.folderMillis);
      }
      const introduced = checkForeignKeys(sqlite).filter((v) => !before.has(violationKey(v)));
      if (introduced.length > 0) throw new MigrationForeignKeyError(introduced);
      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
  return { applied: pending.length };
}

export interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

function checkForeignKeys(sqlite: Database.Database): ForeignKeyViolation[] {
  return sqlite.pragma('foreign_key_check') as ForeignKeyViolation[];
}

function violationKey(v: ForeignKeyViolation): string {
  return `${v.table}\u0000${v.rowid}\u0000${v.parent}\u0000${v.fkid}`;
}

export class MigrationForeignKeyError extends Error {
  constructor(public violations: ForeignKeyViolation[]) {
    const sample = violations
      .slice(0, 10)
      .map((v) => `${v.table} rowid ${v.rowid} → ${v.parent}`)
      .join('; ');
    super(
      `Migration rolled back: it would leave ${violations.length} broken foreign-key ` +
        `reference(s). ${sample}${violations.length > 10 ? '; …' : ''}`,
    );
    this.name = 'MigrationForeignKeyError';
  }
}
