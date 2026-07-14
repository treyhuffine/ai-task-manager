import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs';
import path from 'path';
import { getDbPath, ensureBrainDir, DB_PATH_ENV } from '@/lib/config/paths';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

let dbInstance: DB | null = null;
let rawInstance: Database.Database | null = null;
let currentPath: string | null = null;

export function getDefaultDbPath(): string {
  return getDbPath();
}

export function resetDb(): void {
  if (rawInstance) {
    rawInstance.close();
    rawInstance = null;
    dbInstance = null;
    currentPath = null;
  }
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

-- One-shot idempotent backfill: fills only when the index is empty, so it runs
-- once for pre-existing + imported history and never duplicates on later boots
-- (triggers keep it in sync from here on).
INSERT INTO chat_events_fts(rowid, session_id, event_id, content, tool_summary)
SELECT rowid, session_id, id, content, ''
FROM chat_events
WHERE source IN ('user', 'agent') AND content IS NOT NULL AND content <> ''
  AND NOT EXISTS (SELECT 1 FROM chat_events_fts LIMIT 1);

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
    // Another Flow process may have completed the migration while this
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

  const sqlite = new Database(resolvedPath);
  sqliteVec.load(sqlite);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  rawInstance = sqlite;
  dbInstance = drizzle(sqlite, { schema, casing: 'snake_case' });

  // Drizzle migrations — creates/alters tables defined in schema.ts
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  migrate(dbInstance, { migrationsFolder });

  // FTS, triggers, sqlite-vec, and seed data
  sqlite.exec(EXTRA_SQL);
  ensureCosineEmbeddingIndex(sqlite);

  currentPath = resolvedPath;
  return dbInstance;
}

export function getRawDb(dbPath?: string): Database.Database {
  // Ensure the DB is initialized
  getDb(dbPath);
  return rawInstance!;
}
