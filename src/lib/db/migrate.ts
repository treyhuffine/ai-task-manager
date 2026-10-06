import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { processState } from '@/lib/process-state';

/**
 * Who may apply migrations to an existing home. The server applies them when
 * it starts (instrumentation.ts), as do `ri start`, which opens the database
 * before it launches the server, and `pnpm db:migrate`. Any other process that
 * opens a database with migrations still to apply refuses and changes nothing
 * (`PendingMigrationsError`). An agent's `ri agent` command, run from a
 * checkout that holds a new or draft migration, must not upgrade a running
 * home's database underneath it: a home's schema changes only when it starts
 * (docs/environments.md). A brand-new database is always set up.
 */
const migrationPolicy = processState('db.migration-policy', () => ({ allowed: false }));

/** Let this process apply pending migrations. Call before the database opens. */
export function allowMigrations(allowed = true): void {
  migrationPolicy.allowed = allowed;
}

export function migrationsAllowed(): boolean {
  return migrationPolicy.allowed;
}

export class PendingMigrationsError extends Error {
  constructor(public dbPath: string, public pending: string[]) {
    const count = pending.length === 1 ? 'one database change' : `${pending.length} database changes`;
    super(
      `This code has ${count} that ${pending.length === 1 ? "isn't" : "aren't"} applied to ${dbPath} yet (${pending.join(', ')}). ` +
        `Ri applies database changes when it starts, so restart Ri to apply ${pending.length === 1 ? 'it' : 'them'}. Nothing was changed.`,
    );
    this.name = 'PendingMigrationsError';
  }
}

/** The tags of the last `count` migrations in a folder, for messages. */
export function pendingMigrationTags(migrationsFolder: string, count: number): string[] {
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
    return journal.entries.slice(journal.entries.length - count).map((entry) => entry.tag);
  } catch {
    return [`${count} migration${count === 1 ? '' : 's'}`];
  }
}

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
  if (sqlite.inTransaction) throw new Error('Migrations require a connection outside a transaction');
  let applied = 0;
  // Must run outside a transaction, or SQLite ignores it.
  sqlite.pragma('foreign_keys = OFF');
  try {
    // Serialize competing CLI/server boots BEFORE reading the journal. A
    // process waiting for this lock must see what the previous owner applied.
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const { pending } = inspectMigrationHistory(sqlite, migrationsFolder);
      // The link check compares before and after applying, so with nothing to
      // apply it can't find anything. Skip both scans then: each reads every
      // row of every table with a foreign key (half a second warm and up to
      // ten cold on a 9 GB home), under this write lock, on every server boot
      // and every `ri agent` command.
      const checking = pending.length > 0;
      // Violations that already existed are not this migration's fault, and
      // failing boot on them would brick an install over old damage. Only new
      // ones block the commit.
      const before = checking ? new Set(checkForeignKeys(sqlite).map(violationKey)) : new Set<string>();

      sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric
      )`);
      for (const migration of pending) {
        for (const statement of migration.sql) sqlite.exec(statement);
        sqlite
          .prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
          .run(migration.hash, migration.folderMillis);
      }
      if (checking) {
        const introduced = checkForeignKeys(sqlite).filter((v) => !before.has(violationKey(v)));
        if (introduced.length > 0) throw new MigrationForeignKeyError(introduced);
      }
      sqlite.exec('COMMIT');
      applied = pending.length;
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
  return { applied };
}

/** Read-only compatibility check. An applied history must be an exact prefix
 * of this binary's history or its explicitly recognized retired lineage,
 * including every hash, not just its last timestamp. Safe for an update
 * preflight opened with fileMustExist + readonly. */
export function inspectMigrationHistory(sqlite: Database.Database, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  for (let i = 0; i < migrations.length; i++) {
    if (!Number.isSafeInteger(migrations[i].folderMillis) ||
        (i > 0 && migrations[i].folderMillis <= migrations[i - 1].folderMillis)) {
      throw new MigrationCompatibilityError('Release migration timestamps are not strictly increasing');
    }
  }
  const hasJournal = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  const applied = hasJournal
    ? sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, rowid').all() as Array<{ hash: string; created_at: number | string }>
    : [];
  if (hasAppTables(sqlite) && (applied.length === 0 ||
      (migrations[0] && Number(applied[0].created_at) < migrations[0].folderMillis))) {
    throw new MigrationHistoryError(sqlite.name);
  }
  const retired = retiredSkillScopeHistory(migrations, applied);
  const expectedHistory = [...migrations.slice(0, 3), ...retired, ...migrations.slice(3)];
  for (let i = 0; i < applied.length; i++) {
    const expected = expectedHistory[i];
    if (!expected || Number(applied[i].created_at) !== expected.folderMillis || applied[i].hash !== expected.hash) {
      throw new MigrationCompatibilityError(`Database migration ${i + 1} does not match this release. Use the matching or newer Ri release. No migration was applied.`);
    }
  }
  return { applied: applied.length, pending: migrations.slice(applied.length - retired.length) };
}

interface MigrationIdentity { hash: string; folderMillis: number }
interface AppliedMigration { hash: string; created_at: number | string }

/**
 * 25a3208 removed two already-used migrations, then ba98e4f reused 0003.
 * Recognize only that exact alternative ancestry. Keep the original journal
 * rows, so this is a forward-compatible history, not a journal repair. A Home
 * that ran only CREATE keeps its unused skill_scopes table and every row.
 * Never replay the retired DROP, even when that table happens to be empty.
 * Normal releases remain append-only. Unknown/gapped histories still fail.
 */
function retiredSkillScopeHistory(
  migrations: MigrationIdentity[], applied: AppliedMigration[],
): MigrationIdentity[] {
  const replacement = {
    folderMillis: 1790794317732,
    hash: '24a01a6e012e5935de1a1423011042693569cf997e141bc19c81cf56d3dd4b78',
  };
  const create = {
    folderMillis: 1790787209414,
    hash: '9122b33138438b245b95104dcbe6d4a8370fd908ed797e5dd423e90421038a21',
  };
  const drop = {
    folderMillis: 1790792118119,
    hash: 'fdc994186026400eeb3fcc9dcfd008aa8c0331d0affb8e2fb52645b3e375afc6',
  };
  const matches = (row: AppliedMigration | undefined, expected: MigrationIdentity) =>
    row?.hash === expected.hash && Number(row.created_at) === expected.folderMillis;
  // An older/different release must not gain access merely because it knows
  // these old hashes. The replacement and every preceding prefix row must
  // still match, and later migrations must still form an exact prefix.
  if (migrations[3]?.hash !== replacement.hash ||
      migrations[3]?.folderMillis !== replacement.folderMillis || !matches(applied[3], create)) return [];
  return matches(applied[4], drop) ? [create, drop] : [create];
}

export class MigrationCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationCompatibilityError';
  }
}

function hasAppTables(sqlite: Database.Database): boolean {
  const n = sqlite
    .prepare(`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`)
    .pluck()
    .get() as number;
  return n > 0;
}

/**
 * The database predates the current migration baseline. Nothing was changed.
 * `scripts/db-rebuild.ts` moves it over: a fresh schema, every row copied
 * with its rowid, verified before it is swapped in.
 */
export class MigrationHistoryError extends Error {
  constructor(public dbPath: string) {
    super(
      [
        `This database was built on an older migration history, one that has since been collapsed into a new baseline, so the current schema can't be applied to it. Nothing was changed.`,
        `  database: ${dbPath}`,
        `Rebuild it once, with the app stopped:`,
        `  pnpm tsx scripts/db-rebuild.ts --in-place ${dbPath}`,
        `To rehearse first without touching it:`,
        `  pnpm tsx scripts/db-rebuild.ts --from ${dbPath} --to /tmp/ri-rebuild-check.db`,
      ].join('\n'),
    );
    this.name = 'MigrationHistoryError';
  }
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
