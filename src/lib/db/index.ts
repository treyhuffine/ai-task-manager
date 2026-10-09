import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs';
import path from 'path';
import { getDbPath, ensureBrainDir, DB_PATH_ENV } from '@/lib/config/paths';
import { assertMayOpenDatabase } from '@/lib/config/role';
import * as schema from './schema';
import { runMigrations, inspectMigrationHistory, migrationsAllowed, PendingMigrationsError, pendingMigrationTags } from './migrate';
import { runtimeRepository } from '@/lib/releases/runtime-identity';
import { acquireDatabaseAccess } from '@/lib/service/maintenance';
import { processState } from '@/lib/process-state';

export type DB = BetterSQLite3Database<typeof schema>;

interface Connection {
  sqlite: Database.Database;
  path: string;
  /** Releases the database-access lease taken when it opened. */
  release: () => void;
}

/**
 * The process's one connection. Next loads this module once per bundle
 * (startup and the WebSocket host, route handlers, the proxy), and each copy
 * used to open, migrate and set up the database again: three connections and
 * three boots' work in one server. Shared here, it opens once.
 */
const connection = processState<{ current: Connection | null }>('db.connection', () => ({ current: null }));

/** This copy's Drizzle wrapper over the shared connection, rebuilt if it changes. */
let wrapper: { sqlite: Database.Database; db: DB } | null = null;

function wrap(sqlite: Database.Database): DB {
  if (wrapper?.sqlite !== sqlite) wrapper = { sqlite, db: drizzle(sqlite, { schema, casing: 'snake_case' }) };
  return wrapper.db;
}

function closeConnection(): void {
  const current = connection.current;
  if (!current) return;
  connection.current = null;
  wrapper = null;
  try {
    current.sqlite.close();
  } finally {
    current.release();
  }
}

/** Whether a connection to this database is already open. Never opens one. */
export function isDatabaseOpen(dbPath: string = getDefaultDbPath()): boolean {
  return connection.current?.path === dbPath && fs.existsSync(dbPath);
}

export function getDefaultDbPath(): string {
  return getDbPath();
}

export function resetDb(): void {
  closeConnection();
}

const EMBEDDINGS_VEC_DEFINITION = 'embedding float[1536] distance_metric=cosine';

// FTS, triggers, sqlite-vec, and seed data that Drizzle can't express
const EXTRA_SQL = `
-- FTS for tasks
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description, body, raw_input, content='tasks', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description, body, raw_input) VALUES (NEW.rowid, NEW.title, NEW.description, NEW.body, NEW.raw_input);
END;
CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, body, raw_input) VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.body, OLD.raw_input);
END;
CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, body, raw_input) VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.body, OLD.raw_input);
  INSERT INTO tasks_fts(rowid, title, description, body, raw_input) VALUES (NEW.rowid, NEW.title, NEW.description, NEW.body, NEW.raw_input);
END;

-- FTS for notes
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, content='notes', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (NEW.rowid, NEW.title, NEW.body);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', OLD.rowid, OLD.title, OLD.body);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', OLD.rowid, OLD.title, OLD.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (NEW.rowid, NEW.title, NEW.body);
END;

-- FTS for stream
CREATE VIRTUAL TABLE IF NOT EXISTS stream_fts USING fts5(raw_text, content='stream', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS stream_ai AFTER INSERT ON stream BEGIN
  INSERT INTO stream_fts(rowid, raw_text) VALUES (NEW.rowid, NEW.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS stream_ad AFTER DELETE ON stream BEGIN
  INSERT INTO stream_fts(stream_fts, rowid, raw_text) VALUES ('delete', OLD.rowid, OLD.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS stream_au AFTER UPDATE ON stream BEGIN
  INSERT INTO stream_fts(stream_fts, rowid, raw_text) VALUES ('delete', OLD.rowid, OLD.raw_text);
  INSERT INTO stream_fts(rowid, raw_text) VALUES (NEW.rowid, NEW.raw_text);
END;

-- FTS for chat transcripts. Deliberately a REGULAR fts5 table (not a
-- content='chat_events' external-content one): we index only message-bearing
-- events (source IN ('user','agent')), and external-content mode requires the
-- 'delete' command to exactly mirror prior inserts — a footgun with conditional
-- indexing. A regular table lets the delete trigger drop by rowid
-- unconditionally (a no-op for rows we never indexed), so the index can never
-- drift. session_id/event_id ride along UNINDEXED so a hit carries enough to
-- group-by-session and deep-link without joining back to chat_events.
-- tool_summary is reserved (empty for now) so indexing tool-call names/args
-- later is additive and needs no reindex of the message rows.
CREATE VIRTUAL TABLE IF NOT EXISTS chat_events_fts USING fts5(
  session_id UNINDEXED,
  event_id UNINDEXED,
  content,
  tool_summary
);

CREATE TRIGGER IF NOT EXISTS chat_events_fts_ai AFTER INSERT ON chat_events
WHEN NEW.source IN ('user', 'agent') AND NEW.content IS NOT NULL AND NEW.content <> ''
BEGIN
  INSERT INTO chat_events_fts(rowid, session_id, event_id, content, tool_summary)
  VALUES (NEW.rowid, NEW.session_id, NEW.id, NEW.content, '');
END;
CREATE TRIGGER IF NOT EXISTS chat_events_fts_ad AFTER DELETE ON chat_events BEGIN
  DELETE FROM chat_events_fts WHERE rowid = OLD.rowid;
END;
CREATE TRIGGER IF NOT EXISTS chat_events_fts_au AFTER UPDATE ON chat_events BEGIN
  DELETE FROM chat_events_fts WHERE rowid = OLD.rowid;
  INSERT INTO chat_events_fts(rowid, session_id, event_id, content, tool_summary)
  SELECT NEW.rowid, NEW.session_id, NEW.id, NEW.content, ''
  WHERE NEW.source IN ('user', 'agent') AND NEW.content IS NOT NULL AND NEW.content <> '';
END;

-- The one-shot backfill of chat_events_fts runs from ensureChatSearchBackfill,
-- only when the index is empty.


-- Entity-links projection spine (docs/entity-links-spec.md §5.1).
-- Pure-SQL revision triggers: bump source_revision whenever link-bearing
-- text changes, so every writer (helpers AND raw SQL) is caught and the DB
-- file stays portable (no JS in triggers). Reconciliation in queries.ts
-- advances links_projected_revision. The AFTER DELETE trigger removes the
-- source's edges and its projection row for every delete path. entity_links
-- and entity_projection_state are Drizzle tables, created by migrate() above
-- before this runs. Guards are null-safe (IS NOT).
CREATE TRIGGER IF NOT EXISTS tasks_entity_projection_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO entity_projection_state (source_type, source_id, source_revision, links_projected_revision, created_at, updated_at)
  VALUES ('task', NEW.id, 1, 0, datetime('now'), datetime('now'))
  ON CONFLICT(source_type, source_id) DO UPDATE SET source_revision = source_revision + 1, updated_at = datetime('now');
END;
CREATE TRIGGER IF NOT EXISTS tasks_entity_projection_au AFTER UPDATE ON tasks
WHEN NEW.body IS NOT OLD.body OR NEW.description IS NOT OLD.description BEGIN
  INSERT INTO entity_projection_state (source_type, source_id, source_revision, links_projected_revision, created_at, updated_at)
  VALUES ('task', NEW.id, 1, 0, datetime('now'), datetime('now'))
  ON CONFLICT(source_type, source_id) DO UPDATE SET source_revision = source_revision + 1, updated_at = datetime('now');
END;
CREATE TRIGGER IF NOT EXISTS tasks_entity_projection_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM entity_links WHERE source_type = 'task' AND source_id = OLD.id;
  DELETE FROM entity_projection_state WHERE source_type = 'task' AND source_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS notes_entity_projection_ai AFTER INSERT ON notes BEGIN
  INSERT INTO entity_projection_state (source_type, source_id, source_revision, links_projected_revision, created_at, updated_at)
  VALUES ('note', NEW.id, 1, 0, datetime('now'), datetime('now'))
  ON CONFLICT(source_type, source_id) DO UPDATE SET source_revision = source_revision + 1, updated_at = datetime('now');
END;
CREATE TRIGGER IF NOT EXISTS notes_entity_projection_au AFTER UPDATE ON notes
WHEN NEW.body IS NOT OLD.body BEGIN
  INSERT INTO entity_projection_state (source_type, source_id, source_revision, links_projected_revision, created_at, updated_at)
  VALUES ('note', NEW.id, 1, 0, datetime('now'), datetime('now'))
  ON CONFLICT(source_type, source_id) DO UPDATE SET source_revision = source_revision + 1, updated_at = datetime('now');
END;
CREATE TRIGGER IF NOT EXISTS notes_entity_projection_ad AFTER DELETE ON notes BEGIN
  DELETE FROM entity_links WHERE source_type = 'note' AND source_id = OLD.id;
  DELETE FROM entity_projection_state WHERE source_type = 'note' AND source_id = OLD.id;
END;

-- Partial index of only-pending projection rows, so read-repair's
-- "source_revision > links_projected_revision" scan is cheap when nothing is
-- pending (the common case). Raw SQL because the drizzle index builder does not
-- express a two-column partial predicate cleanly.
CREATE INDEX IF NOT EXISTS idx_entity_projection_pending
  ON entity_projection_state (source_type, source_id)
  WHERE source_revision > links_projected_revision;

-- Embeddings metadata
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  text_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id);

-- Embeddings vector index (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_vec USING vec0(${EMBEDDINGS_VEC_DEFINITION});

-- Seed singleton user_state row
INSERT OR IGNORE INTO user_state (id) VALUES (1);
`;

/**
 * vec0 tables cannot be altered, and CREATE IF NOT EXISTS leaves databases
 * created before cosine search unchanged. Rebuild the virtual table in one
 * transaction, preserving the metadata-linked rowids and stored vectors.
 *
 * This is intentionally an idempotent runtime migration rather than a Drizzle
 * migration: embeddings_vec is created by EXTRA_SQL after Drizzle migrations
 * run, so a numbered migration cannot reference it on a fresh database.
 */
function ensureCosineEmbeddingIndex(sqlite: Database.Database): void {
  const readDefinition = () =>
    sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'embeddings_vec'")
      .get() as { sql: string | null } | undefined;
  const usesCosine = (sql: string | null | undefined) =>
    !!sql && /distance_metric\s*=\s*['"]?cosine['"]?/i.test(sql);

  const row = readDefinition();

  if (!row?.sql) {
    throw new Error('embeddings_vec was not created during database bootstrap');
  }
  if (usesCosine(row.sql)) return;

  const migrate = sqlite.transaction(() => {
    // Another Ri process may have completed the migration while this
    // connection waited for the writer lock.
    if (usesCosine(readDefinition()?.sql)) return;

    sqlite.exec(`
      CREATE TEMP TABLE embeddings_vec_cosine_backup (
        vector_rowid INTEGER PRIMARY KEY,
        embedding BLOB NOT NULL
      );
      INSERT INTO embeddings_vec_cosine_backup(vector_rowid, embedding)
      SELECT rowid, embedding FROM embeddings_vec;
    `);

    const sourceCount = sqlite.prepare('SELECT COUNT(*) FROM embeddings_vec').pluck().get() as number;
    const backupCount = sqlite
      .prepare('SELECT COUNT(*) FROM embeddings_vec_cosine_backup')
      .pluck()
      .get() as number;
    if (backupCount !== sourceCount) {
      throw new Error(`Failed to stage every embedding vector (${backupCount}/${sourceCount})`);
    }

    sqlite.exec(`
      DROP TABLE embeddings_vec;
      CREATE VIRTUAL TABLE embeddings_vec USING vec0(${EMBEDDINGS_VEC_DEFINITION});

      INSERT INTO embeddings_vec(rowid, embedding)
      SELECT vector_rowid, embedding
      FROM embeddings_vec_cosine_backup
      ORDER BY vector_rowid;
    `);

    const migratedCount = sqlite.prepare('SELECT COUNT(*) FROM embeddings_vec').pluck().get() as number;
    const mismatchedCount = sqlite
      .prepare(
        `SELECT COUNT(*)
         FROM embeddings_vec_cosine_backup backup
         LEFT JOIN embeddings_vec migrated ON migrated.rowid = backup.vector_rowid
         WHERE migrated.rowid IS NULL OR migrated.embedding != backup.embedding`,
      )
      .pluck()
      .get() as number;
    if (migratedCount !== sourceCount || mismatchedCount !== 0) {
      throw new Error(
        `Embedding vector migration validation failed ` +
          `(expected=${sourceCount}, actual=${migratedCount}, mismatched=${mismatchedCount})`,
      );
    }

    sqlite.exec(`
      DROP TABLE embeddings_vec_cosine_backup;
    `);
  });

  migrate.immediate();
}

/**
 * One-shot backfill of the entity-links index for data that predates the
 * projection triggers (an upgrade). Idempotent: skips once any projection row
 * exists (writes/backfill already ran) and skips a fresh DB (triggers +
 * reconcile maintain new writes; read-repair heals raw writes). Cycle-free —
 * uses the raw handle and the pure parser, never queries.ts or getDb().
 * See docs/entity-links-spec.md §10.
 */
/**
 * Fill the chat search index from history, once: when it's empty (a new or
 * imported home), and never again after, since triggers keep it in sync.
 *
 * Checked here rather than with `NOT EXISTS` in the INSERT's WHERE: SQLite
 * evaluated that once but still read every row of `chat_events` to apply it,
 * half a second on every open of a 1.4M-event home, under the write lock.
 */
function ensureChatSearchBackfill(sqlite: Database.Database): void {
  if (sqlite.prepare('SELECT 1 FROM chat_events_fts LIMIT 1').get()) return;
  sqlite.exec(`
    INSERT INTO chat_events_fts(rowid, session_id, event_id, content, tool_summary)
    SELECT rowid, session_id, id, content, ''
    FROM chat_events
    WHERE source IN ('user', 'agent') AND content IS NOT NULL AND content <> ''
  `);
}

function ensureEntityLinksBackfill(sqlite: Database.Database): void {
  // Make any source lacking a projection row DISCOVERABLE by marking it PENDING
  // (source_revision 1 > links_projected_revision 0). Read-repair then does the
  // exact upsert-and-prune reconciliation from the current body on the next
  // supported read — so backfill writes no edges here and can never leave stale
  // ones (docs/entity-links-spec.md §10). Keyed off the MISSING row, so partial
  // upgrades are covered; once every source is tracked both anti-joins are
  // empty and this is a cheap no-op. INSERT..SELECT is atomic per statement.
  sqlite.exec(`
    INSERT OR IGNORE INTO entity_projection_state (source_type, source_id, source_revision, links_projected_revision)
      SELECT 'task', id, 1, 0 FROM tasks
      WHERE NOT EXISTS (
        SELECT 1 FROM entity_projection_state p WHERE p.source_type = 'task' AND p.source_id = tasks.id
      );
    INSERT OR IGNORE INTO entity_projection_state (source_type, source_id, source_revision, links_projected_revision)
      SELECT 'note', id, 1, 0 FROM notes
      WHERE NOT EXISTS (
        SELECT 1 FROM entity_projection_state p WHERE p.source_type = 'note' AND p.source_id = notes.id
      );
  `);
}

/**
 * Bring an open connection up to the app's schema. First the Drizzle
 * migrations in `migrationsFolder` (foreign keys off, verified before commit,
 * left ON after; see runMigrations for why this isn't Drizzle's migrate()),
 * then what migrations can't express: FTS, triggers, sqlite-vec and seed rows.
 *
 * getDb passes the full `drizzle/` folder. scripts/db-rebuild.ts passes the
 * baseline alone, so an old database is refilled at the baseline and every
 * later migration applies the way it does on any boot.
 */
export function initDatabase(sqlite: Database.Database, migrationsFolder: string): void {
  runMigrations(sqlite, migrationsFolder);
  // Derived schema is one repeatable transaction. Failed boot never exposes
  // half-installed triggers/backfills through a cached connection.
  sqlite.transaction(() => {
    sqlite.exec(EXTRA_SQL);
    ensureChatSearchBackfill(sqlite);
    ensureCosineEmbeddingIndex(sqlite);
    ensureEntityLinksBackfill(sqlite);
  }).immediate();
}

export function getDb(dbPath?: string): DB {
  const resolvedPath = dbPath ?? getDefaultDbPath();

  // Reuse the open connection, unless its file was deleted (reset).
  const open = connection.current;
  if (open && open.path === resolvedPath) {
    if (fs.existsSync(resolvedPath)) return wrap(open.sqlite);
    closeConnection();
  }

  // A device connected to a home elsewhere keeps no data of its own. Refuse
  // here, where every connection opens, so no command can quietly start a
  // second home on it or use a database beside a connection record
  // (docs/homes-spec.md §3.1).
  assertMayOpenDatabase(resolvedPath);

  // Default path sits inside brain/ — use the helper so the dir gets created
  // with 0o700 (the db contains all user data). Custom DB_PATH overrides can
  // point anywhere, so we create their parent with the default mode.
  if (process.env[DB_PATH_ENV]) {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } else {
    ensureBrainDir();
  }

  const access = acquireDatabaseAccess(resolvedPath);
  let sqlite: Database.Database;
  try { sqlite = new Database(resolvedPath); } catch (error) { access(); throw error; }
  try {
    sqliteVec.load(sqlite);
    // Migrations come from this code's own install, never the shell's folder:
    // harness commands run in an agent's folder, outside the app, and a
    // checkout's working tree may hold a draft.
    const assetsRoot = process.env.RI_RUNTIME_REPO ??
      (process.env.RI_DESKTOP === '1' ? process.env.RI_DESKTOP_REPO : undefined) ?? runtimeRepository();
    const migrationsFolder = path.resolve(assetsRoot, 'drizzle');
    const history = inspectMigrationHistory(sqlite, migrationsFolder);
    const ownsSchema = history.applied === 0 || migrationsAllowed();
    // Only a starting server (or `pnpm db:migrate`) upgrades an existing home.
    if (!ownsSchema && history.pending.length > 0) {
      throw new PendingMigrationsError(resolvedPath, pendingMigrationTags(migrationsFolder, history.pending.length));
    }
    sqlite.pragma('journal_mode = WAL');
    if (ownsSchema) {
      // A starting server, `pnpm db:migrate`, or a brand-new database.
      initDatabase(sqlite, migrationsFolder);
    } else {
      // Joining a home its server already set up (an agent's `ri agent`, a
      // script): no schema work, so no write lock while that server may be
      // writing. The history check above is read-only. sqlite-vec is loaded
      // above, and foreign keys are on as initDatabase would leave them.
      sqlite.pragma('foreign_keys = ON');
    }
    // A connection to another path, if any, closes once this one is ready.
    closeConnection();
    connection.current = { sqlite, path: resolvedPath, release: access };
    return wrap(sqlite);
  } catch (error) {
    sqlite.close();
    access();
    throw error;
  }
}

export function getRawDb(dbPath?: string): Database.Database {
  // Ensure the DB is initialized
  getDb(dbPath);
  return connection.current!.sqlite;
}
