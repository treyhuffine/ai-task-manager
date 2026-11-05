/**
 * Forward-only schema. Applied migrations are immutable: append a new entry
 * instead of editing one. Policy values (initial page state, via) come from
 * the query layer, never from SQL defaults.
 */
import type { Migration } from "@ri/app-kit/data";

/** Tables whose changes move the view revision. Frozen with migration 1. */
const TRACKED_V1 = ["bookmarks"] as const;
const triggers = (tables: readonly string[]) =>
  tables
    .flatMap((table) =>
      ["INSERT", "UPDATE", "DELETE"].map(
        (event) => `CREATE TRIGGER ${table}_${event.toLowerCase()}_revision AFTER ${event} ON ${table} BEGIN UPDATE bookmarks_meta SET value = value + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'data_revision'; END;`,
      ),
    )
    .join("\n");

const V1 = `
CREATE TABLE bookmarks_meta (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, value INTEGER NOT NULL
);
INSERT INTO bookmarks_meta (id, created_at, updated_at, value) VALUES ('data_revision', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1);

-- seq is the search row's rowid, so it never changes and is never reused.
CREATE TABLE bookmarks (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  url TEXT NOT NULL, url_key TEXT NOT NULL UNIQUE, site TEXT NOT NULL,
  title TEXT NOT NULL, title_source TEXT NOT NULL CHECK (title_source IN ('link','page','given','edited')),
  note TEXT, tags TEXT NOT NULL, saved_at TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('extension','bookmark','bookmarklet','shortcut','chat','added','import','fixture')),
  excerpt TEXT,
  page_state TEXT NOT NULL CHECK (page_state IN ('waiting','read','no_text','gone','needs_browser','failed')),
  page_source TEXT CHECK (page_source IN ('browser','home')),
  page_chars INTEGER NOT NULL, page_at TEXT, page_attempts INTEGER NOT NULL, page_next_at TEXT,
  fictional INTEGER NOT NULL
);
CREATE INDEX bookmarks_saved ON bookmarks (saved_at DESC, id DESC);
CREATE INDEX bookmarks_waiting ON bookmarks (page_next_at) WHERE page_state = 'waiting';
CREATE INDEX bookmarks_page_state ON bookmarks (page_state);

CREATE TABLE bookmark_tags (
  bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE, tag TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (bookmark_id, tag)
) WITHOUT ROWID;
CREATE INDEX bookmark_tags_tag ON bookmark_tags (tag, bookmark_id);

-- The page text lives here, keyed by bookmarks.seq, so a delete removes it with its search row.
CREATE VIRTUAL TABLE bookmarks_fts USING fts5(title, link, note, tags, body, tokenize='unicode61 remove_diacritics 2');

CREATE TABLE import_parts (
  upload_id TEXT NOT NULL, part INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, total INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (upload_id, part)
) WITHOUT ROWID;

CREATE TABLE import_previews (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  digest TEXT NOT NULL, file_name TEXT, format TEXT NOT NULL, items TEXT NOT NULL, skipped INTEGER NOT NULL,
  applied_at TEXT, result TEXT
);
${triggers(TRACKED_V1)}
`;

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: "bookmarks", sql: V1 }];
