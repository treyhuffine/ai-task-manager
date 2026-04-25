#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cli/index.ts
import { Command } from "commander";

// src/constants/app.ts
var APP_NAME = "Flow";
var APP_SHORT_ID = "flow";
var PAIRING_TOKEN_FRAGMENT_KEY = "token";

// src/lib/config/paths.ts
import fs from "fs";
import os from "os";
import path from "path";

// src/lib/config/claude-md-template.ts
function renderAppRootClaudeMd() {
  return `# Orchestrator session

You are operating ${APP_NAME} \u2014 a productivity system combining tasks, notes,
and a curated daily deck. This directory is the app's data root: config, the
SQLite database, the markdown mirror, and attachments live here.

## How to operate

Interact through the orchestrator surface \u2014 never by editing files here
directly. Direct edits bypass embeddings, the markdown mirror, and attachment
derivation. The UI and search rely on those invariants; corrupting them is
silent and only surfaces later.

- **MCP tools** (preferred): \`describe_paths\`, \`describe_schema\`,
  \`list_tasks\`, \`get_task\`, \`create_task\`, \`update_task\`,
  \`complete_task\`, \`list_notes\`, \`get_note\`, \`create_note\`.
- **CLI fallback**: \`${APP_SHORT_ID} agent <action> [params]\`. Output is JSON.

The \`orchestrator\` skill has the full conventions (status values, energy,
effort, task-vs-note, title style, error envelope). Load it before acting if
you haven't already.

## This is an orchestrator session, not a dev session

Reasoning about what ${APP_NAME} can do \u2192 use the orchestrator skill. If a
capability you need isn't exposed, say so \u2014 don't invent a workaround by
reaching into the filesystem.

Debugging or extending ${APP_NAME} itself \u2192 start a new session in the
source repo; that's a different role with different conventions.
`;
}

// src/lib/config/paths.ts
var ENV_PREFIX = APP_SHORT_ID.toUpperCase();
var APP_ROOT_ENV = `${ENV_PREFIX}_ROOT`;
var BRAIN_PATH_ENV = `${ENV_PREFIX}_BRAIN_PATH`;
var DB_PATH_ENV = `${ENV_PREFIX}_DB_PATH`;
function homeDir() {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}
function getAppRoot() {
  const override = process.env[APP_ROOT_ENV];
  if (override) return override;
  return path.join(homeDir(), `.${APP_SHORT_ID}`);
}
function getDevAppRoot() {
  return path.join(homeDir(), `.${APP_SHORT_ID}-dev`);
}
function getBrainDir() {
  const override = process.env[BRAIN_PATH_ENV];
  if (override) return override;
  return path.join(getAppRoot(), "brain");
}
function getDbPath() {
  const override = process.env[DB_PATH_ENV];
  if (override) return override;
  return path.join(getBrainDir(), "data.db");
}
function getConfigPath() {
  return path.join(getAppRoot(), "config.json");
}
function getAttachmentsDir() {
  return path.join(getBrainDir(), "attachments");
}
function getTmpDir() {
  return path.join(getAppRoot(), "tmp");
}
function ensureAppRoot() {
  const dir = getAppRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
  } else {
    try {
      fs.chmodSync(dir, 448);
    } catch {
    }
  }
  const claudeMdPath = path.join(dir, "CLAUDE.md");
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, renderAppRootClaudeMd(), { mode: 384 });
  }
  return dir;
}
function ensureBrainDir() {
  ensureAppRoot();
  const dir = getBrainDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
  }
  return dir;
}
function migrateLegacyLayoutToBrain() {
  if (process.env[BRAIN_PATH_ENV] || process.env[DB_PATH_ENV]) {
    return { migrated: false, moved: [] };
  }
  const appRoot = getAppRoot();
  const brainDir = getBrainDir();
  if (fs.existsSync(brainDir)) {
    return { migrated: false, moved: [] };
  }
  const legacyDb = path.join(appRoot, "data.db");
  if (!fs.existsSync(legacyDb)) {
    return { migrated: false, moved: [] };
  }
  fs.mkdirSync(brainDir, { recursive: true, mode: 448 });
  const moved = [];
  const candidates = [
    "data.db",
    "data.db-wal",
    "data.db-shm",
    "tasks",
    "notes",
    "areas",
    "stream",
    "attachments",
    ".archive",
    "README.md"
  ];
  for (const name of candidates) {
    const src = path.join(appRoot, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(brainDir, name);
    try {
      fs.renameSync(src, dest);
      moved.push(name);
    } catch (err) {
      console.warn(`[paths] migrateLegacyLayoutToBrain: failed to move ${name}:`, err);
    }
  }
  return { migrated: moved.length > 0, moved };
}

// src/cli/commands/start.ts
import { intro, outro, log, spinner } from "@clack/prompts";
import pc2 from "picocolors";
import getPort from "get-port";

// src/lib/auth/bootstrap.ts
import os2 from "os";

// src/lib/auth/config-file.ts
import fs2 from "fs";
function getAuthConfigPath() {
  return getConfigPath();
}
function readAuthConfig() {
  const p = getAuthConfigPath();
  if (!fs2.existsSync(p)) return null;
  try {
    const raw = fs2.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      localToken: parsed.localToken ?? null,
      tunnelUrl: parsed.tunnelUrl ?? null,
      onboardedAt: parsed.onboardedAt ?? null,
      voiceEnabled: parsed.voiceEnabled ?? null,
      lastPort: parsed.lastPort ?? null
    };
  } catch (err) {
    console.error("[auth] failed to read config.json:", err);
    return null;
  }
}
function writeAuthConfig(config) {
  ensureAppRoot();
  const existing = readAuthConfig();
  const pick = (key) => (key in config ? config[key] : existing?.[key]) ?? null;
  const next = {
    version: 1,
    localToken: pick("localToken"),
    tunnelUrl: pick("tunnelUrl"),
    onboardedAt: pick("onboardedAt"),
    voiceEnabled: pick("voiceEnabled"),
    lastPort: pick("lastPort")
  };
  const p = getAuthConfigPath();
  fs2.writeFileSync(p, JSON.stringify(next, null, 2) + "\n", { mode: 384 });
  try {
    fs2.chmodSync(p, 384);
  } catch {
  }
  return next;
}

// src/lib/auth/tokens.ts
import { createHash } from "crypto";
import { customAlphabet } from "nanoid";
var TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
var TOKEN_LENGTH = 40;
var randomToken = customAlphabet(TOKEN_ALPHABET, TOKEN_LENGTH);
function getTokenEnv() {
  return process.env.AUTH_TOKEN_ENV === "test" ? "test" : "live";
}
function generateToken(env = getTokenEnv()) {
  const random = randomToken();
  const plaintext = `${APP_SHORT_ID}_${env}_${random}`;
  return {
    plaintext,
    prefix: random.slice(0, 6),
    suffix: random.slice(-4),
    hash: hashToken(plaintext),
    env
  };
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// src/lib/db/index.ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sqliteVec from "sqlite-vec";
import fs3 from "fs";
import path2 from "path";

// src/lib/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  apiKeys: () => apiKeys,
  areas: () => areas,
  decks: () => decks,
  notes: () => notes,
  stream: () => stream,
  taskCompletions: () => taskCompletions,
  tasks: () => tasks,
  userState: () => userState
});
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
var userState = sqliteTable("user_state", {
  id: integer("id").primaryKey(),
  name: text("name"),
  active_area_id: text("active_area_id").references(() => areas.id),
  active_parent_task_id: text("active_parent_task_id"),
  active_energy: text("active_energy", { enum: ["deep", "light"] }),
  available_minutes: integer("available_minutes"),
  description: text("description").notNull().default(""),
  voice_auto_send: integer("voice_auto_send", { mode: "boolean" }).notNull().default(true),
  voice_model: text("voice_model").notNull().default("local/parakeet-tdt-0.6b-v3"),
  default_agent_harness: text("default_agent_harness", { enum: ["claude", "codex"] }),
  default_agent_model: text("default_agent_model"),
  onboarded_at: text("onboarded_at"),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`)
});
var areas = sqliteTable("areas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  emoji: text("emoji"),
  attachments: text("attachments", { mode: "json" }).$type().default([]),
  notes: text("notes"),
  user_context: text("user_context"),
  status: text("status", { enum: ["active", "inactive", "archived"] }).notNull().default("active"),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`)
});
var stream = sqliteTable("stream", {
  id: text("id").primaryKey(),
  raw_text: text("raw_text").notNull(),
  /** Which in-app surface/flow produced the item. Decoupled from media type. */
  source: text("source", { enum: ["capture", "chat", "webhook"] }).notNull().default("capture"),
  /** Original media format. Voice/image items were transcribed/OCR'd into `raw_text`. */
  media: text("media", { enum: ["text", "voice", "image"] }).notNull().default("text"),
  /** How the item entered the system. `internal` = user action in the app. */
  origin: text("origin", { enum: ["internal", "webhook", "api"] }).notNull().default("internal"),
  /** External system that sent it (e.g. `pocket`). Null when origin='internal'. */
  external_source: text("external_source"),
  /** Upstream id for dedupe on at-least-once deliveries. Null when origin='internal'. */
  external_id: text("external_id"),
  /** Full inbound payload for audit/replay. Null when origin='internal'. */
  external_payload: text("external_payload"),
  status: text("status", { enum: ["pending", "promoted", "dismissed"] }).notNull().default("pending"),
  dismissed_by: text("dismissed_by"),
  promoted_to_type: text("promoted_to_type"),
  promoted_to_id: text("promoted_to_id"),
  promoted_at: text("promoted_at"),
  promotion_pass: text("promotion_pass"),
  /** Files attached to this stream item (e.g. raw audio when transcription
   *  failed or no STT provider was available). Derived on write from any
   *  references present in `raw_text`. */
  attachments: text("attachments", { mode: "json" }).$type().default([]),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`)
}, (table) => [
  index("stream_external_id_idx").on(table.external_source, table.external_id)
]);
var tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  parent_id: text("parent_id").references(() => tasks.id),
  area_id: text("area_id").references(() => areas.id),
  raw_input: text("raw_input").notNull(),
  stream_item_id: text("stream_item_id").references(() => stream.id),
  title: text("title").notNull(),
  description: text("description"),
  body: text("body"),
  user_context: text("user_context"),
  ai_context: text("ai_context"),
  outcome: text("outcome"),
  heartbeat_days: integer("heartbeat_days"),
  last_progress_at: text("last_progress_at"),
  energy: text("energy", { enum: ["deep", "light"] }),
  effort: text("effort", { enum: ["trivial", "small", "medium", "large", "epic"] }),
  estimated_minutes: integer("estimated_minutes"),
  context_tags: text("context_tags", { mode: "json" }).$type().default([]),
  hard_deadline: text("hard_deadline"),
  reminder_at: text("reminder_at"),
  resurface_after: text("resurface_after"),
  attachments: text("attachments", { mode: "json" }).$type().default([]),
  status: text("status", { enum: ["active", "done", "archived"] }).notNull().default("active"),
  sort_key: text("sort_key"),
  blocked_on: text("blocked_on"),
  blocked_since: text("blocked_since"),
  recurrence: text("recurrence"),
  next_recurrence_at: text("next_recurrence_at"),
  target_frequency: integer("target_frequency"),
  times_deferred: integer("times_deferred").notNull().default(0),
  last_surfaced_at: text("last_surfaced_at"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  completed_at: text("completed_at"),
  last_viewed_at: text("last_viewed_at")
}, (table) => [
  index("idx_tasks_status").on(table.status),
  index("idx_tasks_area_id").on(table.area_id),
  index("idx_tasks_parent_id").on(table.parent_id),
  index("idx_tasks_sort_key").on(table.sort_key),
  index("idx_tasks_status_sort").on(table.status, table.sort_key)
]);
var taskCompletions = sqliteTable("task_completions", {
  id: text("id").primaryKey(),
  task_id: text("task_id").notNull().references(() => tasks.id),
  completed_at: text("completed_at").notNull().default(sql`(datetime('now'))`),
  note: text("note")
}, (table) => [
  index("idx_task_completions_task_id").on(table.task_id)
]);
var decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  context: text("context"),
  context_tags: text("context_tags", { mode: "json" }).$type().default([]),
  framing: text("framing"),
  items: text("items", { mode: "json" }).$type().notNull().default([]),
  alternatives: text("alternatives", { mode: "json" }).$type().notNull().default([]),
  search_context: text("search_context"),
  model: text("model"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`)
});
var apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  device_type: text("device_type", {
    enum: ["host", "computer", "phone", "tablet", "service", "other"]
  }).notNull().default("other"),
  prefix: text("prefix").notNull(),
  suffix: text("suffix").notNull(),
  hash: text("hash").notNull().unique(),
  env: text("env", { enum: ["live", "test"] }).notNull().default("live"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  expires_at: text("expires_at"),
  last_used_at: text("last_used_at"),
  last_used_ip: text("last_used_ip"),
  last_used_user_agent: text("last_used_user_agent"),
  revoked_at: text("revoked_at"),
  revoked_reason: text("revoked_reason")
}, (table) => [
  index("idx_api_keys_hash").on(table.hash),
  index("idx_api_keys_prefix").on(table.prefix),
  index("idx_api_keys_revoked").on(table.revoked_at)
]);
var notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  area_id: text("area_id").references(() => areas.id),
  task_id: text("task_id").references(() => tasks.id),
  title: text("title"),
  body: text("body").notNull(),
  url: text("url"),
  attachments: text("attachments", { mode: "json" }).$type().default([]),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  context_tags: text("context_tags", { mode: "json" }).$type().default([]),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  last_viewed_at: text("last_viewed_at")
}, (table) => [
  index("idx_notes_area_id").on(table.area_id),
  index("idx_notes_task_id").on(table.task_id),
  index("idx_notes_status").on(table.status)
]);

// src/lib/db/index.ts
var dbInstance = null;
var rawInstance = null;
var currentPath = null;
function getDefaultDbPath() {
  return getDbPath();
}
function resetDb() {
  if (rawInstance) {
    rawInstance.close();
    rawInstance = null;
    dbInstance = null;
    currentPath = null;
  }
}
var EXTRA_SQL = `
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
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_vec USING vec0(embedding float[1536]);

-- Seed singleton user_state row
INSERT OR IGNORE INTO user_state (id) VALUES (1);
`;
function getDb(dbPath) {
  const resolvedPath = dbPath ?? getDefaultDbPath();
  if (dbInstance && currentPath === resolvedPath) {
    if (!fs3.existsSync(resolvedPath)) {
      rawInstance?.close();
      rawInstance = null;
      dbInstance = null;
      currentPath = null;
    } else {
      return dbInstance;
    }
  }
  if (process.env[DB_PATH_ENV]) {
    const dir = path2.dirname(resolvedPath);
    if (!fs3.existsSync(dir)) {
      fs3.mkdirSync(dir, { recursive: true });
    }
  } else {
    ensureBrainDir();
  }
  const sqlite = new Database(resolvedPath);
  sqliteVec.load(sqlite);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  rawInstance = sqlite;
  dbInstance = drizzle(sqlite, { schema: schema_exports });
  const migrationsFolder = path2.resolve(process.cwd(), "drizzle");
  migrate(dbInstance, { migrationsFolder });
  sqlite.exec(EXTRA_SQL);
  currentPath = resolvedPath;
  return dbInstance;
}
function getRawDb(dbPath) {
  getDb(dbPath);
  return rawInstance;
}

// src/lib/db/queries.ts
import { eq as eq2, and as and2, desc, asc, sql as sql2, inArray, isNull, getTableColumns } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

// src/lib/embeddings/embed.ts
import { createHash as createHash2 } from "crypto";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
function computeContentHash(text2) {
  return createHash2("sha256").update(text2).digest("hex");
}
function buildEmbeddingText(entityType, entity) {
  const labeled = (pairs) => pairs.filter((p) => Boolean(p[1])).map(([label, value]) => `${label}: ${value}`).join("\n");
  switch (entityType) {
    case "task": {
      const t = entity;
      return labeled([
        ["Title", t.title],
        ["Description", t.description],
        ["Outcome", t.outcome],
        ["Body", t.body],
        ["Context", t.user_context]
      ]);
    }
    case "note": {
      const n = entity;
      return labeled([
        ["Title", n.title],
        ["Body", n.body]
      ]);
    }
    case "stream": {
      const s = entity;
      return s.raw_text;
    }
  }
}
var MAX_CHARS = 28e3;
function truncate(text2) {
  return text2.length <= MAX_CHARS ? text2 : text2.slice(0, MAX_CHARS);
}
async function generateEmbedding(text2) {
  const result = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: truncate(text2)
  });
  return result.embedding;
}
async function upsertEmbedding(entityType, entityId, textContent) {
  if (!textContent.trim()) return;
  if (!process.env.OPENAI_API_KEY) return;
  const db = getRawDb();
  const hash = computeContentHash(textContent);
  const existing = db.prepare("SELECT id, content_hash FROM embeddings WHERE entity_type = ? AND entity_id = ?").get(entityType, entityId);
  if (existing && existing.content_hash === hash) {
    return;
  }
  const vector = await generateEmbedding(textContent);
  const embedding = new Float32Array(vector);
  if (existing) {
    db.prepare(
      "UPDATE embeddings SET content_hash = ?, text_content = ?, created_at = datetime('now') WHERE id = ?"
    ).run(hash, textContent, existing.id);
    db.prepare("DELETE FROM embeddings_vec WHERE rowid = ?").run(BigInt(existing.id));
    db.prepare("INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)").run(
      BigInt(existing.id),
      embedding
    );
  } else {
    const info = db.prepare(
      "INSERT INTO embeddings (entity_type, entity_id, content_hash, text_content) VALUES (?, ?, ?, ?)"
    ).run(entityType, entityId, hash, textContent);
    db.prepare("INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)").run(
      BigInt(info.lastInsertRowid),
      embedding
    );
  }
}

// src/lib/export/mirror/sync.ts
import { and, eq } from "drizzle-orm";

// src/lib/export/mirror/config.ts
import path3 from "path";
var ENV_PREFIX2 = APP_SHORT_ID.toUpperCase();
var MIRROR_DISABLED_ENV = `${ENV_PREFIX2}_MIRROR_DISABLED`;
var ENTITY_TYPES = ["task", "note", "area", "stream"];
function isMirrorEnabled() {
  return process.env[MIRROR_DISABLED_ENV] !== "1";
}
function typeDir(type) {
  return path3.join(getBrainDir(), `${type}s`);
}
function tmpDir(type) {
  return path3.join(typeDir(type), ".tmp");
}
function archiveDir(type) {
  return path3.join(getBrainDir(), ".archive", `${type}s`);
}

// src/lib/export/mirror/fs.ts
import fs4 from "fs";
import fsp from "fs/promises";
import path4 from "path";

// src/lib/export/markdown.ts
import slugifyLib from "@sindresorhus/slugify";

// src/lib/attachments/derive.ts
var ATTACHMENT_REF_RE = /\/api\/attachments\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g;
function extractReferencedFileNames(body) {
  if (!body) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const match of body.matchAll(ATTACHMENT_REF_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
function deriveAttachments(input) {
  const priorByName = /* @__PURE__ */ new Map();
  for (const a of input.prior ?? []) priorByName.set(a.file_name, a);
  const uploadsByName = /* @__PURE__ */ new Map();
  for (const a of input.newUploads ?? []) uploadsByName.set(a.file_name, a);
  const referenced = extractReferencedFileNames(input.body);
  const out = [];
  for (const name of referenced) {
    const prior = priorByName.get(name);
    if (prior) {
      out.push(prior);
      continue;
    }
    const upload = uploadsByName.get(name);
    if (upload) {
      out.push(upload);
      continue;
    }
    out.push({
      file_name: name,
      original_name: name,
      mime_type: "application/octet-stream",
      size: 0,
      uploaded_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return out;
}
function rewriteAttachmentsForMirror(body) {
  if (!body) return "";
  return body.replace(/\/api\/attachments\//g, "../attachments/");
}

// src/lib/export/markdown.ts
function slugify(s) {
  return slugifyLib(s, { lowercase: true, decamelize: false }).slice(0, 80);
}

// src/lib/export/mirror/render.ts
var SLUG_MAX = 60;
var HEADER_COMMENTS = [
  `<!-- Managed by ${APP_SHORT_ID}. Edits here are overwritten on next sync. -->`,
  `<!-- To modify: use the app, an MCP tool, or write SQL directly. -->`
].join("\n");
function mirrorFilename(nameOrTitle, id) {
  const base = slugify(nameOrTitle ?? "").slice(0, SLUG_MAX);
  return base ? `${base}--${id}.md` : `${id}.md`;
}
function mirrorLinkPath(type, nameOrTitle, id) {
  const filename = mirrorFilename(nameOrTitle, id);
  const stem = filename.slice(0, -3);
  return `${type}s/${stem}`;
}
function parseMirrorFilename(filename) {
  if (!filename.endsWith(".md")) return null;
  const stem = filename.slice(0, -3);
  const lastSep = stem.lastIndexOf("--");
  if (lastSep === -1) {
    return { slug: null, id: stem };
  }
  return { slug: stem.slice(0, lastSep), id: stem.slice(lastSep + 2) };
}
function wikiLink(resolver, type, id) {
  if (!id || !resolver) return null;
  const target = resolver.linkFor(type, id);
  return target ? `[[${target}]]` : null;
}
function yamlValue(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return "[" + v.map((x) => yamlValue(x)).join(", ") + "]";
  }
  if (typeof v === "object") {
    const entries = Object.entries(v).filter(([, val]) => val !== void 0).map(([key, val]) => `${key}: ${yamlValue(val)}`);
    return "{" + entries.join(", ") + "}";
  }
  const s = String(v);
  if (/[\r\n]/.test(s) || /^\s|\s$|[:#\-&*!?|>'"%@`,\[\]{}]|^(true|false|null|yes|no|\d)/i.test(s) || s === "") {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
  }
  return s;
}
function attachmentsForFrontmatter(attachments) {
  if (!attachments || attachments.length === 0) return null;
  return attachments.map(({ uploaded_at, ...rest }) => rest);
}
function buildFrontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === void 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}
function renderTask(task, opts = {}) {
  const frontmatter = buildFrontmatter({
    id: task.id,
    type: "task",
    title: task.title,
    status: task.status,
    area: wikiLink(opts.links, "area", task.area_id),
    area_id: task.area_id,
    area_name: opts.areaName ?? null,
    parent: wikiLink(opts.links, "task", task.parent_id),
    parent_id: task.parent_id,
    parent_title: opts.parentTitle ?? null,
    energy: task.energy,
    effort: task.effort,
    estimated_minutes: task.estimated_minutes,
    heartbeat_days: task.heartbeat_days,
    hard_deadline: task.hard_deadline,
    resurface_after: task.resurface_after,
    reminder_at: task.reminder_at,
    recurrence: task.recurrence,
    next_recurrence_at: task.next_recurrence_at,
    target_frequency: task.target_frequency,
    context_tags: task.context_tags,
    attachments: attachmentsForFrontmatter(task.attachments),
    blocked_on: task.blocked_on,
    blocked_since: task.blocked_since,
    outcome: task.outcome,
    times_deferred: task.times_deferred || null,
    last_progress_at: task.last_progress_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    managed_by: APP_SHORT_ID
  });
  const description = rewriteAttachmentsForMirror(task.description ?? "").trim();
  const body = rewriteAttachmentsForMirror(task.body ?? "").trim();
  const userContext = (task.user_context ?? "").trim();
  const parts = [frontmatter, "", HEADER_COMMENTS, "", `# ${task.title}`];
  if (description) parts.push("", description);
  if (body) parts.push("", body);
  if (userContext) parts.push("", "## Context", "", userContext);
  return {
    filename: mirrorFilename(task.title, task.id),
    content: parts.join("\n") + "\n"
  };
}
function renderNote(note, opts = {}) {
  const sources = opts.sources ?? [];
  const sourceIds = sources.map((s) => s.id);
  const sourceLinks = opts.links ? sources.map((s) => opts.links.linkFor("stream", s.id)).filter((x) => x !== null).map((p) => `[[${p}]]`) : [];
  const frontmatter = buildFrontmatter({
    id: note.id,
    type: "note",
    title: note.title,
    status: note.status,
    area: wikiLink(opts.links, "area", note.area_id),
    area_id: note.area_id,
    area_name: opts.areaName ?? null,
    task: wikiLink(opts.links, "task", note.task_id),
    task_id: note.task_id,
    task_title: opts.taskTitle ?? null,
    url: note.url,
    context_tags: note.context_tags,
    attachments: attachmentsForFrontmatter(note.attachments),
    sources: sourceLinks.length > 0 ? sourceLinks : null,
    source_ids: sourceIds.length > 0 ? sourceIds : null,
    created_at: note.created_at,
    updated_at: note.updated_at,
    managed_by: APP_SHORT_ID
  });
  const parts = [frontmatter, "", HEADER_COMMENTS];
  if (note.title) parts.push("", `# ${note.title}`);
  const body = rewriteAttachmentsForMirror(note.body ?? "").trim();
  if (body) parts.push("", body);
  if (sources.length > 0) {
    parts.push("", "## Sources", "");
    for (const s of sources) {
      const heading = streamSourceHeading(s, opts.links);
      parts.push(`### ${heading}`);
      const rawText = rewriteAttachmentsForMirror(s.raw_text ?? "");
      const quoted = rawText.split("\n").map((line) => `> ${line}`).join("\n");
      parts.push("", quoted, "");
    }
  }
  return {
    filename: mirrorFilename(note.title, note.id),
    content: parts.join("\n").replace(/\n+$/, "") + "\n"
  };
}
function streamSourceHeading(s, links) {
  const date = (s.created_at ?? "").slice(0, 19).replace("T", " ");
  const source = s.source ?? "capture";
  const label = `${source} \u2014 ${date}`.trim();
  const target = links?.linkFor("stream", s.id);
  return target ? `[[${target}|${label}]]` : label;
}
function renderArea(area, _opts = {}) {
  const frontmatter = buildFrontmatter({
    id: area.id,
    type: "area",
    name: area.name,
    status: area.status,
    emoji: area.emoji,
    sort_order: area.sort_order,
    description: area.description,
    attachments: attachmentsForFrontmatter(area.attachments),
    created_at: area.created_at,
    updated_at: area.updated_at,
    managed_by: APP_SHORT_ID
  });
  const parts = [
    frontmatter,
    "",
    HEADER_COMMENTS,
    "",
    `# ${area.emoji ? area.emoji + " " : ""}${area.name}`
  ];
  if (area.description) parts.push("", area.description);
  if (area.notes) parts.push("", "## Notes", "", area.notes);
  if (area.user_context) parts.push("", "## Context", "", area.user_context);
  return {
    filename: mirrorFilename(area.name, area.id),
    content: parts.join("\n") + "\n"
  };
}
function renderStream(s, opts = {}) {
  const promotedLink = s.promoted_to_type && s.promoted_to_id ? wikiLink(opts.links, s.promoted_to_type, s.promoted_to_id) : null;
  const frontmatter = buildFrontmatter({
    id: s.id,
    type: "stream",
    source: s.source,
    status: s.status,
    promoted_to: promotedLink,
    promoted_to_type: s.promoted_to_type,
    promoted_to_id: s.promoted_to_id,
    promoted_to_title: opts.promotedToTitle ?? null,
    promoted_at: s.promoted_at,
    dismissed_by: s.dismissed_by,
    attachments: attachmentsForFrontmatter(s.attachments),
    created_at: s.created_at,
    managed_by: APP_SHORT_ID
  });
  const parts = [frontmatter, "", HEADER_COMMENTS, "", rewriteAttachmentsForMirror(s.raw_text ?? "").trim()];
  const firstLine = (s.raw_text ?? "").split("\n")[0]?.trim() ?? "";
  const slug = firstLine.length > 0 ? firstLine.slice(0, 40) : "";
  return {
    filename: mirrorFilename(slug, s.id),
    content: parts.join("\n").replace(/\n+$/, "") + "\n"
  };
}

// src/lib/export/mirror/fs.ts
function ensureDirs() {
  ensureBrainDir();
  for (const t of ENTITY_TYPES) {
    fs4.mkdirSync(typeDir(t), { recursive: true });
    fs4.mkdirSync(tmpDir(t), { recursive: true });
    fs4.mkdirSync(archiveDir(t), { recursive: true });
  }
}
async function findByIdInType(type, id) {
  const dir = typeDir(type);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const matches = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (!name.endsWith(".md")) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed?.id === id) matches.push(path4.join(dir, name));
  }
  return matches;
}
async function findByIdInArchive(type, id) {
  const dir = archiveDir(type);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const matches = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed?.id === id) matches.push(path4.join(dir, name));
  }
  return matches;
}
async function writeEntityFile(type, id, finalFilename, content) {
  const dir = typeDir(type);
  const tmp = path4.join(tmpDir(type), `${id}.tmp`);
  const finalPath = path4.join(dir, finalFilename);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(tmpDir(type), { recursive: true });
  await fsp.writeFile(tmp, content, "utf8");
  const existing = await findByIdInType(type, id);
  for (const p of existing) {
    if (p === finalPath) continue;
    await fsp.rm(p).catch(() => void 0);
  }
  const archived = await findByIdInArchive(type, id);
  for (const p of archived) {
    await fsp.rm(p).catch(() => void 0);
  }
  await fsp.rename(tmp, finalPath);
  return finalPath;
}
async function archiveEntityFile(type, id, filename, content) {
  for (const p of await findByIdInType(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
  const dest = path4.join(archiveDir(type), filename);
  for (const p of await findByIdInArchive(type, id)) {
    if (p === dest) continue;
    await fsp.rm(p).catch(() => void 0);
  }
  await fsp.mkdir(archiveDir(type), { recursive: true });
  await fsp.writeFile(dest, content, "utf8");
}
async function deleteEntityFile(type, id) {
  for (const p of await findByIdInType(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
  for (const p of await findByIdInArchive(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
}
async function listIdsInType(type) {
  const dir = typeDir(type);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const ids = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (!name.endsWith(".md")) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed) ids.push(parsed.id);
  }
  return ids;
}
async function readUpdatedAt(filePath) {
  try {
    const head = await fsp.readFile(filePath, "utf8");
    const slice = head.slice(0, 2048);
    const match = slice.match(/^updated_at:\s*("?)([^"\n]+)\1/m);
    if (!match) return null;
    return match[2].trim();
  } catch {
    return null;
  }
}

// src/lib/export/mirror/sync.ts
var MutationContext = class {
  constructor() {
    this.refs = /* @__PURE__ */ new Set();
  }
  add(type, id) {
    this.refs.add(`${type}:${id}`);
  }
  addMany(type, ids) {
    for (const id of ids) this.refs.add(`${type}:${id}`);
  }
  entries() {
    return Array.from(this.refs).map((ref) => {
      const sep = ref.indexOf(":");
      return [ref.slice(0, sep), ref.slice(sep + 1)];
    });
  }
  get size() {
    return this.refs.size;
  }
};
function syncEntity(type, id) {
  if (!isMirrorEnabled()) return Promise.resolve();
  const ctx = new MutationContext();
  ctx.add(type, id);
  return syncBatch(ctx);
}
async function syncBatch(ctx) {
  if (!isMirrorEnabled()) return;
  if (ctx.size === 0) return;
  try {
    const expanded = expandCascades(ctx);
    await Promise.all(
      expanded.entries().map(async ([type, id]) => {
        try {
          await syncOne(type, id);
        } catch (err) {
          console.warn(`[mirror] sync failed: ${type}:${id}`, err);
        }
      })
    );
  } catch (err) {
    console.warn("[mirror] syncBatch failed", err);
  }
}
function expandCascades(ctx) {
  const out = new MutationContext();
  for (const [type, id] of ctx.entries()) {
    out.add(type, id);
  }
  const db = getDb();
  for (const [type, id] of ctx.entries()) {
    if (type === "stream") {
      const row2 = db.select().from(stream).where(eq(stream.id, id)).get();
      if (row2?.promoted_to_type === "note" && row2.promoted_to_id) {
        out.add("note", row2.promoted_to_id);
      }
      continue;
    }
    if (type === "area") {
      const refTasks = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.area_id, id)).all();
      out.addMany("task", refTasks.map((r) => r.id));
      const refNotes = db.select({ id: notes.id }).from(notes).where(eq(notes.area_id, id)).all();
      out.addMany("note", refNotes.map((r) => r.id));
      continue;
    }
    if (type === "task") {
      const childTasks = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parent_id, id)).all();
      out.addMany("task", childTasks.map((r) => r.id));
      const refNotes = db.select({ id: notes.id }).from(notes).where(eq(notes.task_id, id)).all();
      out.addMany("note", refNotes.map((r) => r.id));
      const refStreams = db.select({ id: stream.id }).from(stream).where(and(eq(stream.promoted_to_id, id), eq(stream.promoted_to_type, "task"))).all();
      out.addMany("stream", refStreams.map((r) => r.id));
      continue;
    }
    if (type === "note") {
      const refStreams = db.select({ id: stream.id }).from(stream).where(and(eq(stream.promoted_to_id, id), eq(stream.promoted_to_type, "note"))).all();
      out.addMany("stream", refStreams.map((r) => r.id));
      continue;
    }
  }
  return out;
}
async function syncOne(type, id) {
  const db = getDb();
  if (type === "task") {
    const row2 = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row2) {
      await deleteEntityFile("task", id);
      return;
    }
    await writeTask(row2);
    return;
  }
  if (type === "note") {
    const row2 = db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row2) {
      await deleteEntityFile("note", id);
      return;
    }
    await writeNote(row2);
    return;
  }
  if (type === "area") {
    const row2 = db.select().from(areas).where(eq(areas.id, id)).get();
    if (!row2) {
      await deleteEntityFile("area", id);
      return;
    }
    await writeArea(row2);
    return;
  }
  if (type === "stream") {
    const row2 = db.select().from(stream).where(eq(stream.id, id)).get();
    if (!row2) {
      await deleteEntityFile("stream", id);
      return;
    }
    await writeStream(row2);
    return;
  }
}
function createLinkResolver() {
  const db = getDb();
  return {
    linkFor(type, id) {
      if (type === "task") {
        const row2 = db.select().from(tasks).where(eq(tasks.id, id)).get();
        return row2 ? mirrorLinkPath("task", row2.title, row2.id) : null;
      }
      if (type === "note") {
        const row2 = db.select().from(notes).where(eq(notes.id, id)).get();
        return row2 ? mirrorLinkPath("note", row2.title, row2.id) : null;
      }
      if (type === "area") {
        const row2 = db.select().from(areas).where(eq(areas.id, id)).get();
        return row2 ? mirrorLinkPath("area", row2.name, row2.id) : null;
      }
      if (type === "stream") {
        const row2 = db.select().from(stream).where(eq(stream.id, id)).get();
        if (!row2) return null;
        const firstLine = (row2.raw_text ?? "").split("\n")[0]?.trim().slice(0, 40) ?? "";
        return mirrorLinkPath("stream", firstLine, row2.id);
      }
      return null;
    }
  };
}
async function writeTask(task) {
  const db = getDb();
  const area = task.area_id ? db.select().from(areas).where(eq(areas.id, task.area_id)).get() : void 0;
  const parent = task.parent_id ? db.select().from(tasks).where(eq(tasks.id, task.parent_id)).get() : void 0;
  const { filename, content } = renderTask(task, {
    areaName: area?.name ?? null,
    parentTitle: parent?.title ?? null,
    links: createLinkResolver()
  });
  if (task.status === "archived") {
    await archiveEntityFile("task", task.id, filename, content);
  } else {
    await writeEntityFile("task", task.id, filename, content);
  }
}
async function writeNote(note) {
  const db = getDb();
  const area = note.area_id ? db.select().from(areas).where(eq(areas.id, note.area_id)).get() : void 0;
  const task = note.task_id ? db.select().from(tasks).where(eq(tasks.id, note.task_id)).get() : void 0;
  const sources = db.select().from(stream).where(
    and(
      eq(stream.promoted_to_id, note.id),
      eq(stream.promoted_to_type, "note"),
      eq(stream.status, "promoted")
    )
  ).all();
  const { filename, content } = renderNote(note, {
    areaName: area?.name ?? null,
    taskTitle: task?.title ?? null,
    sources,
    links: createLinkResolver()
  });
  if (note.status === "archived") {
    await archiveEntityFile("note", note.id, filename, content);
  } else {
    await writeEntityFile("note", note.id, filename, content);
  }
}
async function writeArea(area) {
  const { filename, content } = renderArea(area);
  if (area.status === "archived") {
    await archiveEntityFile("area", area.id, filename, content);
  } else {
    await writeEntityFile("area", area.id, filename, content);
  }
}
async function writeStream(s) {
  const db = getDb();
  let promotedToTitle = null;
  if (s.promoted_to_id && s.promoted_to_type) {
    if (s.promoted_to_type === "note") {
      const n = db.select().from(notes).where(eq(notes.id, s.promoted_to_id)).get();
      promotedToTitle = n?.title ?? null;
    } else if (s.promoted_to_type === "task") {
      const t = db.select().from(tasks).where(eq(tasks.id, s.promoted_to_id)).get();
      promotedToTitle = t?.title ?? null;
    }
  }
  const { filename, content } = renderStream(s, {
    promotedToTitle,
    links: createLinkResolver()
  });
  if (s.status === "dismissed") {
    await archiveEntityFile("stream", s.id, filename, content);
  } else {
    await writeEntityFile("stream", s.id, filename, content);
  }
}

// src/lib/export/mirror/readme.ts
import fs5 from "fs/promises";
import path5 from "path";
var README_FILENAME = "README.md";
function readmeContent() {
  return `# ${APP_NAME} Brain

Your ${APP_NAME} data lives in this folder. \`data.db\` is the source of
truth; the markdown files alongside it are a live, always-current mirror
written by the app.

## Live mirror (derived \u2014 don't hand-edit)

- \`tasks/\` \u2014 one file per task
- \`notes/\` \u2014 one file per note
- \`areas/\` \u2014 one file per area
- \`stream/\` \u2014 one file per captured stream item
- \`attachments/\` \u2014 uploaded files (images, PDFs, voice memos) referenced by
  the entities above. Markdown bodies link here via \`../attachments/\u2026\`
- \`.archive/\` \u2014 archived or merged-away entities; orphan attachments also
  move to \`.archive/attachments/\` when no entity references them anymore

These files update automatically as you use the app. **Edits here are
overwritten on the next sync.** To make changes, use:

- the ${APP_NAME} app
- the MCP tools exposed by ${APP_NAME}
- direct SQL against the database

## Source of truth

- \`data.db\` \u2014 the SQLite database. Everything else in this folder is
  derived from it.

## Why mirror at all?

Your data lives on your disk as plain markdown alongside the database. You can:

- grep it, back it up, commit it to git (gitignore \`data.db*\` and
  \`attachments/\` to keep the repo to portable text)
- open it in Obsidian, VS Code, or any editor
- feed the folder to any LLM for context
- keep reading it even if ${APP_NAME} itself goes away

Portability and observability without giving up the engineering properties of a
real database.

## Filename format

\`{slug}--{uuid}.md\` \u2014 the slug is cosmetic, the UUID is the stable identity.
A double-hyphen separator distinguishes slug hyphens from hyphens inside the
UUID. The ID is always the part after the last \`--\`.

## Configuration

- \`${BRAIN_PATH_ENV}\` \u2014 point the brain directory somewhere else
- \`${MIRROR_DISABLED_ENV}=1\` \u2014 turn the markdown mirror off (db only)

## Force a sync

Run \`${APP_SHORT_ID} export\` to force a full sync (useful after a crash or
if you suspect drift).
`;
}
async function ensureReadme() {
  const target = path5.join(getBrainDir(), README_FILENAME);
  try {
    await fs5.access(target);
  } catch {
    await fs5.mkdir(getBrainDir(), { recursive: true });
    await fs5.writeFile(target, readmeContent(), "utf8");
  }
}

// src/lib/export/mirror/attachments-gc.ts
import fs6 from "fs";
import fsp2 from "fs/promises";
import path6 from "path";
function archiveAttachmentsDir() {
  return path6.join(getBrainDir(), ".archive", "attachments");
}
function ensureAttachmentsDirsExist() {
  fs6.mkdirSync(getAttachmentsDir(), { recursive: true });
  fs6.mkdirSync(archiveAttachmentsDir(), { recursive: true });
}
function collectReferencedFileNames() {
  const db = getDb();
  const out = /* @__PURE__ */ new Set();
  const push = (rows) => {
    for (const r of rows) {
      for (const a of r.attachments ?? []) out.add(a.file_name);
    }
  };
  push(db.select({ attachments: tasks.attachments }).from(tasks).all());
  push(db.select({ attachments: notes.attachments }).from(notes).all());
  push(db.select({ attachments: areas.attachments }).from(areas).all());
  push(db.select({ attachments: stream.attachments }).from(stream).all());
  return out;
}
async function sweepAttachments() {
  const start = Date.now();
  ensureAttachmentsDirsExist();
  const referenced = collectReferencedFileNames();
  const dir = getAttachmentsDir();
  let entries;
  try {
    entries = await fsp2.readdir(dir);
  } catch {
    return { referenced: referenced.size, onDisk: 0, archived: 0, elapsedMs: Date.now() - start };
  }
  let archived = 0;
  let onDisk = 0;
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    onDisk++;
    if (referenced.has(name)) continue;
    const src = path6.join(dir, name);
    const dest = path6.join(archiveAttachmentsDir(), name);
    try {
      await fsp2.rename(src, dest);
      archived++;
    } catch (err) {
      if (err.code === "EXDEV") {
        await fsp2.copyFile(src, dest);
        await fsp2.unlink(src);
        archived++;
        continue;
      }
      console.warn(`[mirror] orphan attachment archive failed: ${name}`, err);
    }
  }
  return {
    referenced: referenced.size,
    onDisk,
    archived,
    elapsedMs: Date.now() - start
  };
}

// src/lib/export/mirror/reconcile.ts
async function reconcileAll() {
  if (!isMirrorEnabled()) {
    return {
      synced: 0,
      skipped: 0,
      orphaned: 0,
      attachments: { referenced: 0, onDisk: 0, archived: 0, elapsedMs: 0 },
      elapsedMs: 0
    };
  }
  const start = Date.now();
  ensureDirs();
  await ensureReadme();
  const db = getDb();
  let synced = 0;
  let skipped = 0;
  const dbTasks = db.select().from(tasks).all();
  const dbTaskIds = /* @__PURE__ */ new Set();
  for (const t of dbTasks) {
    dbTaskIds.add(t.id);
    const current = await findByIdInType("task", t.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= t.updated_at) {
        skipped++;
        continue;
      }
    }
    await writeTask(t);
    synced++;
  }
  const dbNotes = db.select().from(notes).all();
  const dbNoteIds = /* @__PURE__ */ new Set();
  for (const n of dbNotes) {
    dbNoteIds.add(n.id);
    const current = await findByIdInType("note", n.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= n.updated_at) {
        skipped++;
        continue;
      }
    }
    await writeNote(n);
    synced++;
  }
  const dbAreas = db.select().from(areas).all();
  const dbAreaIds = /* @__PURE__ */ new Set();
  for (const a of dbAreas) {
    dbAreaIds.add(a.id);
    const current = await findByIdInType("area", a.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= a.updated_at) {
        skipped++;
        continue;
      }
    }
    await writeArea(a);
    synced++;
  }
  const dbStreams = db.select().from(stream).all();
  const dbStreamIds = /* @__PURE__ */ new Set();
  for (const s of dbStreams) {
    dbStreamIds.add(s.id);
    await writeStream(s);
    synced++;
  }
  let orphaned = 0;
  const checks2 = [
    ["task", dbTaskIds],
    ["note", dbNoteIds],
    ["area", dbAreaIds],
    ["stream", dbStreamIds]
  ];
  for (const [type, knownIds] of checks2) {
    const fileIds = await listIdsInType(type);
    for (const id of fileIds) {
      if (!knownIds.has(id)) {
        orphaned++;
        console.warn(`[mirror] orphaned file (no DB row): ${type}:${id}`);
      }
    }
  }
  const attachments = await sweepAttachments();
  const elapsedMs = Date.now() - start;
  return { synced, skipped, orphaned, attachments, elapsedMs };
}

// src/lib/export/mirror/timer.ts
var INTERVAL_MS = 15 * 60 * 1e3;

// src/lib/db/queries.ts
function listTasks(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (statuses.length === 1) {
      conditions.push(eq2(tasks.status, statuses[0]));
    } else {
      conditions.push(inArray(tasks.status, statuses));
    }
  }
  if (filter.area_id) conditions.push(eq2(tasks.area_id, filter.area_id));
  if (filter.parent_id) conditions.push(eq2(tasks.parent_id, filter.parent_id));
  if (filter.energy) conditions.push(eq2(tasks.energy, filter.energy));
  if (filter.q) conditions.push(sql2`${tasks.title} LIKE ${"%" + filter.q + "%"}`);
  const limit = filter.limit ?? 1e4;
  const offset = filter.offset ?? 0;
  const orderClauses = (() => {
    switch (filter.order_by) {
      case "last_viewed_at":
        return [sql2`last_viewed_at DESC NULLS LAST`, desc(tasks.created_at)];
      case "hard_deadline":
        return [sql2`hard_deadline ASC NULLS LAST`, desc(tasks.created_at)];
      case "created_at":
        return [desc(tasks.created_at)];
      case "updated_at":
        return [desc(tasks.updated_at)];
      default:
        return [sql2`sort_key ASC NULLS LAST`, desc(tasks.created_at)];
    }
  })();
  return db.select({
    ...getTableColumns(tasks),
    subtask_count: sql2`(SELECT COUNT(*) FROM tasks t2 WHERE t2.parent_id = ${sql2.raw('"tasks"."id"')})`.as("subtask_count"),
    subtask_preview: sql2`(SELECT GROUP_CONCAT(t3.title, '|||') FROM (SELECT title FROM tasks t3 WHERE t3.parent_id = ${sql2.raw('"tasks"."id"')} LIMIT 4) t3)`.as("subtask_preview")
  }).from(tasks).where(conditions.length > 0 ? and2(...conditions) : void 0).orderBy(...orderClauses).limit(limit).offset(offset).all();
}
function getTask(id) {
  const db = getDb();
  return db.select().from(tasks).where(eq2(tasks.id, id)).get();
}
function taskAttachmentText(description, body) {
  return `${description ?? ""}
${body ?? ""}`;
}
function createTask(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const attachments = deriveAttachments({
    body: taskAttachmentText(input.description, input.body),
    prior: [],
    newUploads: input.attachments ?? []
  });
  const row2 = db.insert(tasks).values({
    ...input,
    raw_input: input.raw_input ?? input.title,
    id: uuidv7(),
    status: input.status ?? "active",
    context_tags: input.context_tags ?? [],
    attachments,
    times_deferred: 0,
    created_at: now,
    updated_at: now
  }).returning().get();
  void upsertEmbedding("task", row2.id, buildEmbeddingText("task", row2));
  void syncEntity("task", row2.id);
  return row2;
}
function updateTask(id, input) {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq2(tasks.id, id)).get();
  if (!existing) return null;
  const bodyChanged = Object.prototype.hasOwnProperty.call(input, "body");
  const descriptionChanged = Object.prototype.hasOwnProperty.call(input, "description");
  const attachmentsHint = input.attachments;
  const attachments = bodyChanged || descriptionChanged || attachmentsHint !== void 0 ? deriveAttachments({
    body: taskAttachmentText(
      descriptionChanged ? input.description : existing.description,
      bodyChanged ? input.body : existing.body
    ),
    prior: existing.attachments ?? [],
    newUploads: attachmentsHint ?? []
  }) : void 0;
  const row2 = db.update(tasks).set({
    ...input,
    ...attachments !== void 0 ? { attachments } : {},
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq2(tasks.id, id)).returning().get();
  void upsertEmbedding("task", row2.id, buildEmbeddingText("task", row2));
  void syncEntity("task", row2.id);
  return row2;
}
function completeTask(id, note) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq2(tasks.id, id)).get();
  if (!task) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (task.recurrence) {
    db.insert(taskCompletions).values({
      id: uuidv7(),
      task_id: id,
      completed_at: now,
      note: note ?? null
    }).run();
    const nextDate = computeNextRecurrence(task.recurrence, now);
    const updated = db.update(tasks).set({ next_recurrence_at: nextDate, last_progress_at: now, updated_at: now }).where(eq2(tasks.id, id)).returning().get();
    void syncEntity("task", updated.id);
    return { task: updated, recurring: true, next_recurrence_at: nextDate };
  } else {
    const updated = db.update(tasks).set({ status: "done", completed_at: now, updated_at: now }).where(eq2(tasks.id, id)).returning().get();
    db.insert(taskCompletions).values({
      id: uuidv7(),
      task_id: id,
      completed_at: now,
      note: note ?? null
    }).run();
    void syncEntity("task", updated.id);
    return { task: updated, recurring: false };
  }
}
function computeNextRecurrence(recurrence, fromDate) {
  const date = new Date(fromDate);
  const lower = recurrence.toLowerCase();
  if (lower.includes("daily") || lower === "1d") {
    date.setDate(date.getDate() + 1);
  } else if (lower.includes("weekly") || lower === "1w") {
    date.setDate(date.getDate() + 7);
  } else if (lower.includes("monthly") || lower === "1m") {
    date.setMonth(date.getMonth() + 1);
  } else if (lower.includes("yearly") || lower === "1y") {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    const match = lower.match(/^(\d+)d$/);
    if (match) {
      date.setDate(date.getDate() + parseInt(match[1], 10));
    } else {
      date.setDate(date.getDate() + 7);
    }
  }
  return date.toISOString();
}
function listNotes(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.area_id) conditions.push(eq2(notes.area_id, filter.area_id));
  if (filter.task_id) conditions.push(eq2(notes.task_id, filter.task_id));
  if (filter.status) conditions.push(eq2(notes.status, filter.status));
  const limit = filter.limit ?? 1e4;
  const offset = filter.offset ?? 0;
  const orderClauses = (() => {
    switch (filter.order_by) {
      case "created_at":
        return [desc(notes.created_at)];
      case "updated_at":
        return [desc(notes.updated_at)];
      default:
        return [sql2`last_viewed_at DESC NULLS LAST`, desc(notes.created_at)];
    }
  })();
  return db.select().from(notes).where(conditions.length > 0 ? and2(...conditions) : void 0).orderBy(...orderClauses).limit(limit).offset(offset).all();
}
function getNote(id) {
  const db = getDb();
  return db.select().from(notes).where(eq2(notes.id, id)).get();
}
function createNote(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const attachments = deriveAttachments({
    body: input.body ?? "",
    prior: [],
    newUploads: input.attachments ?? []
  });
  const row2 = db.insert(notes).values({
    ...input,
    id: uuidv7(),
    status: input.status ?? "active",
    context_tags: input.context_tags ?? [],
    attachments,
    created_at: now,
    updated_at: now
  }).returning().get();
  void upsertEmbedding("note", row2.id, buildEmbeddingText("note", row2));
  void syncEntity("note", row2.id);
  return row2;
}
function createApiKey(input) {
  const db = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const token = generateToken(input.env ?? "live");
  const key = db.insert(apiKeys).values({
    ...input,
    id: uuidv7(),
    prefix: token.prefix,
    suffix: token.suffix,
    hash: token.hash,
    env: token.env,
    device_type: input.device_type ?? "other",
    created_at: now,
    updated_at: now
  }).returning().get();
  return { key, token };
}
function findApiKeyByHash(hash) {
  const db = getDb();
  return db.select().from(apiKeys).where(eq2(apiKeys.hash, hash)).get();
}

// src/lib/auth/port.ts
var DEFAULT_PORT = 4224;
function getRunningPort() {
  const env = process.env.PORT;
  if (env && Number.isFinite(Number(env))) return Number(env);
  const saved = readAuthConfig()?.lastPort;
  if (saved && Number.isFinite(saved)) return saved;
  return DEFAULT_PORT;
}
function setRunningPort(port) {
  writeAuthConfig({ lastPort: port });
}

// src/lib/auth/bootstrap.ts
function getLocalBaseUrl() {
  return `http://localhost:${getRunningPort()}`;
}
function getLanIp() {
  const nets = os2.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net3 of nets[name] ?? []) {
      if (net3.family === "IPv4" && !net3.internal) return net3.address;
    }
  }
  return null;
}
function getLanBaseUrl() {
  const ip = getLanIp();
  return ip ? `http://${ip}:${getRunningPort()}` : null;
}
function buildPairingUrl(token, baseUrl = getLocalBaseUrl()) {
  return `${baseUrl}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${token}`;
}
function getRemoteBaseUrl() {
  return readAuthConfig()?.tunnelUrl ?? null;
}
function setRemoteBaseUrl(raw) {
  const normalized = normalizeBaseUrl(raw);
  writeAuthConfig({ tunnelUrl: normalized });
  return normalized;
}
function clearRemoteBaseUrl() {
  writeAuthConfig({ tunnelUrl: null });
}
function normalizeBaseUrl(raw) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Base URL cannot be empty");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  return `${parsed.protocol}//${parsed.host}`;
}
function ensureLocalToken() {
  const existing = readAuthConfig();
  if (existing?.localToken) {
    const row2 = findApiKeyByHash(hashToken(existing.localToken));
    if (row2 && !row2.revoked_at) {
      return {
        plaintext: existing.localToken,
        pairingUrl: buildPairingUrl(existing.localToken),
        created: false
      };
    }
  }
  const { token } = createApiKey({
    name: `${os2.hostname()} (host)`,
    device_type: "host",
    description: "Auto-generated local host token"
  });
  writeAuthConfig({ localToken: token.plaintext });
  return {
    plaintext: token.plaintext,
    pairingUrl: buildPairingUrl(token.plaintext),
    created: true
  };
}

// src/lib/config/voice.ts
function getVoiceEnabled() {
  return readAuthConfig()?.voiceEnabled === true;
}
function setVoiceEnabled(enabled) {
  writeAuthConfig({ voiceEnabled: enabled });
}

// src/cli/lib/server.ts
import { spawn } from "child_process";
import net from "net";
import { createRequire } from "module";
var require2 = createRequire(import.meta.url);
function startNextServer(opts) {
  const nextBin = require2.resolve("next/dist/bin/next");
  const subcommand = opts.dev ? "dev" : "start";
  return spawn(process.execPath, [nextBin, subcommand, "-p", String(opts.port)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PORT: String(opts.port) }
  });
}
async function waitForServer(port, timeoutMs = 3e4) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start on port ${port} within ${timeoutMs}ms`);
}
function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}
async function isOurServerRunning(port) {
  return (await probeHealth(port)).status === "ok";
}
async function probeHealth(port) {
  if (!await canConnect(port)) return { status: "offline" };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      return { status: "unknown-app", detail: `HTTP ${res.status}` };
    }
    const body = await res.json();
    if (typeof body.port !== "number" || typeof body.app !== "string") {
      return { status: "unknown-app", detail: "health response missing fields" };
    }
    return { status: "ok", info: { ok: body.ok ?? true, app: body.app, port: body.port } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: "unreachable", detail };
  }
}

// src/cli/lib/browser.ts
import open from "open";
async function openBrowser(url) {
  await open(url);
}

// src/cli/commands/skills.ts
import fs7 from "fs";
import path7 from "path";
import { fileURLToPath } from "url";
import pc from "picocolors";
async function loadAgentex() {
  return import("@agentex/agent");
}
var ALLOW_GLOBAL_INSTALL = false;
var __dirname = path7.dirname(fileURLToPath(import.meta.url));
function findPackageRoot(startDir) {
  let dir = startDir;
  while (dir !== path7.parse(dir).root) {
    if (fs7.existsSync(path7.join(dir, "package.json"))) return dir;
    dir = path7.dirname(dir);
  }
  throw new Error(`Could not find package.json walking up from ${startDir}`);
}
var SKILLS_ROOT = path7.join(findPackageRoot(__dirname), "skills");
var SHIPPED_SKILLS = ["orchestrator"];
function skillDirs() {
  return SHIPPED_SKILLS.map((name) => path7.join(SKILLS_ROOT, name));
}
async function installWorkspaceSkills() {
  const { installSkills } = await loadAgentex();
  return installSkills(skillDirs(), {
    location: "workspace",
    cwd: getAppRoot()
  });
}
function registerSkillsCommand(program2) {
  const skills = program2.command("skills").description("Install and manage the skills this app ships for agent sessions");
  skills.command("install").description(
    "Symlink shipped skills into the app data dir (<app-root>/.claude/skills and <app-root>/.agents/skills). Pass --global to symlink into ~/.claude/skills/ and ~/.agents/skills/ (shared with other agents, gated)."
  ).option("--global", "Install into the user-level ~/.claude/skills and ~/.agents/skills instead of the app data dir").action(async (opts) => {
    const { installSkills } = await loadAgentex();
    const isGlobal = !!opts.global;
    if (isGlobal && !ALLOW_GLOBAL_INSTALL) {
      console.error(
        pc.yellow(
          "--global is disabled. It would symlink into ~/.claude/skills/ and ~/.agents/skills/,\nshared with your other agents and skill packs.\n"
        )
      );
      console.error(
        "To enable, flip ALLOW_GLOBAL_INSTALL to true in src/cli/commands/skills.ts and rebuild."
      );
      console.error(pc.dim(`
Would have symlinked:`));
      for (const dir of skillDirs()) console.error(pc.dim(`  ${dir}`));
      process.exit(1);
    }
    const result = isGlobal ? await installSkills(skillDirs(), { location: "global" }) : await installSkills(skillDirs(), { location: "workspace", cwd: getAppRoot() });
    for (const e of result.entries) {
      const tag = e.status === "created" ? pc.green("+") : e.status === "skipped" ? pc.dim("\xB7") : e.status === "conflict" ? pc.yellow("!") : pc.red("\xD7");
      console.log(`  ${tag} ${e.target}/${e.skillName}  ${pc.dim(e.targetPath)}`);
      if (e.error) console.log(`      ${pc.red(e.error)}`);
    }
    console.log(
      pc.dim(
        `
installed=${result.installed} skipped=${result.skipped} conflicts=${result.conflicts} errors=${result.errors}`
      )
    );
    if (result.conflicts > 0) {
      console.log(
        pc.yellow(
          `
Some targets already exist pointing elsewhere. Remove them manually and re-run, or run \`${APP_SHORT_ID} skills remove\` first if they are ours.`
        )
      );
    }
  });
  skills.command("remove").description("Remove shipped-skill symlinks from the app data dir. Pass --global to target ~/.claude and ~/.agents.").option("--global", "Remove from the user-level ~/.claude/skills and ~/.agents/skills").action(async (opts) => {
    const { removeSkills } = await loadAgentex();
    const result = opts.global ? await removeSkills(skillDirs(), { location: "global" }) : await removeSkills(skillDirs(), { location: "workspace", cwd: getAppRoot() });
    for (const e of result.entries) {
      const tag = e.status === "removed" ? pc.green("-") : e.status === "not_found" ? pc.dim("\xB7") : e.status === "conflict" ? pc.yellow("!") : pc.red("\xD7");
      console.log(`  ${tag} ${e.target}/${e.skillName}  ${pc.dim(e.targetPath)}`);
    }
    console.log(pc.dim(`
removed=${result.removed}`));
  });
  skills.command("list").description("List skills installed in the two standard channels. Pass --global for ~/.claude and ~/.agents.").option("--global", "List from the user-level ~/.claude/skills and ~/.agents/skills").action(async (opts) => {
    const { listInstalledSkills } = await loadAgentex();
    const installed = opts.global ? await listInstalledSkills({ location: "global" }) : await listInstalledSkills({ location: "workspace", cwd: getAppRoot() });
    for (const [channel, entries] of Object.entries(installed)) {
      console.log(pc.bold(channel));
      if (entries.length === 0) {
        console.log(pc.dim("  (none)"));
        continue;
      }
      for (const s of entries) {
        const tag = s.isSymlink ? pc.green("\u2197") : pc.dim("\xB7");
        console.log(`  ${tag} ${s.name}  ${pc.dim(s.sourcePath ?? "?")}`);
      }
    }
  });
}

// src/cli/lib/voice.ts
import { spawn as spawn2 } from "child_process";
import path8 from "path";
var VOICE_URL = process.env.LOCAL_SPEECH_TO_TEXT_URL ?? "http://localhost:5092";
var DEFAULT_SERVICE = "parakeet-cpu";
function getVoiceContext(overrideService) {
  return {
    serviceUrl: VOICE_URL,
    composeFile: resolveComposeFile(),
    service: overrideService ?? DEFAULT_SERVICE
  };
}
function resolveComposeFile() {
  const override = process.env.FLOW_VOICE_COMPOSE;
  if (override) return override;
  return path8.resolve(process.cwd(), "modules/parakeet-stt/docker-compose.yml");
}
async function isDockerAvailable() {
  return new Promise((resolve) => {
    const child = spawn2("docker", ["info"], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
async function isVoiceReady(ctx = getVoiceContext()) {
  try {
    const res = await fetch(`${ctx.serviceUrl}/health`, {
      signal: AbortSignal.timeout(1e3)
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function startVoiceService(ctx = getVoiceContext()) {
  await runDockerCompose(["-f", ctx.composeFile, "up", "-d", ctx.service]);
}
async function stopVoiceService(ctx = getVoiceContext()) {
  await runDockerCompose(["-f", ctx.composeFile, "stop", ctx.service]).catch(() => {
  });
}
async function waitForVoiceReady(ctx = getVoiceContext(), timeoutMs = 18e4) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isVoiceReady(ctx)) return;
    await new Promise((r) => setTimeout(r, 1e3));
  }
  throw new Error(`Voice service did not become ready within ${timeoutMs}ms`);
}
function runDockerCompose(args) {
  return new Promise((resolve, reject) => {
    const child = spawn2("docker", ["compose", ...args], {
      stdio: ["ignore", "inherit", "inherit"]
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

// src/cli/commands/start.ts
async function startCommand(opts) {
  if (opts.dev && !process.env[APP_ROOT_ENV]) {
    process.env[APP_ROOT_ENV] = getDevAppRoot();
  }
  intro(pc2.bgCyan(pc2.black(` ${APP_NAME} `)));
  if (opts.dev) {
    log.info(pc2.dim(`Data root: ${process.env[APP_ROOT_ENV]}`));
  }
  const preferredPort = Number(opts.port ?? 4224);
  const s = spinner();
  s.start("Bootstrapping auth");
  const info = ensureLocalToken();
  resetDb();
  s.stop(info.created ? "Created new host token" : "Reusing existing token");
  try {
    const result = await installWorkspaceSkills();
    if (result.installed > 0) {
      log.success(`Installed ${result.installed} skill symlink(s) in the app data dir`);
    }
  } catch (err) {
    log.warn(`Skill auto-install skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (await isOurServerRunning(preferredPort)) {
    const url2 = info.pairingUrl;
    log.success(`Already running at http://localhost:${preferredPort}`);
    if (opts.open) await openBrowser(url2);
    outro(opts.open ? "Opened in browser" : `Open: ${url2}`);
    return;
  }
  const voiceWanted = opts.voice ?? getVoiceEnabled();
  let voiceStarted = false;
  if (voiceWanted) {
    voiceStarted = await bringUpVoice(s);
  }
  const port = await getPort({ port: preferredPort });
  if (port !== preferredPort) {
    log.warn(`Port ${preferredPort} in use \u2014 using ${port}`);
  }
  process.env.PORT = String(port);
  setRunningPort(port);
  s.start(opts.dev ? "Starting dev server" : "Starting server");
  const child = startNextServer({ port, dev: opts.dev });
  child.on("error", (err) => {
    log.error(`Server failed to start: ${err.message}`);
    process.exit(1);
  });
  await waitForServer(port);
  s.stop(`Server ready at http://localhost:${port}`);
  const url = info.pairingUrl;
  if (opts.open) {
    await openBrowser(url);
    log.success(`Opened ${url}`);
  } else {
    log.info(`Open: ${url}`);
  }
  outro("Press Ctrl-C to stop");
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!child.killed) child.kill(signal);
    if (voiceStarted) {
      await stopVoiceService().catch(() => {
      });
    }
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await new Promise((resolve) => {
    child.on("exit", () => resolve());
  });
}
async function bringUpVoice(s) {
  const ctx = getVoiceContext();
  if (await isVoiceReady(ctx)) {
    log.info("Voice already running \u2014 reusing existing container");
    return false;
  }
  if (!await isDockerAvailable()) {
    log.warn("Voice enabled, but Docker is not running \u2014 continuing without voice");
    return false;
  }
  s.start("Starting voice sidecar (Parakeet)");
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    s.stop(`Voice ready at ${ctx.serviceUrl}`);
    return true;
  } catch (err) {
    s.stop(pc2.yellow("Voice failed to start \u2014 continuing without voice"));
    log.warn(err instanceof Error ? err.message : String(err));
    return false;
  }
}

// src/cli/commands/pair.ts
import os3 from "os";
import pc3 from "picocolors";

// src/cli/lib/qr.ts
import QRCode from "qrcode";
async function renderTerminalQr(text2) {
  return QRCode.toString(text2, {
    type: "terminal",
    small: true,
    margin: 1,
    errorCorrectionLevel: "L"
  });
}

// src/cli/commands/pair.ts
var BASE_URL_EXAMPLE = `https://${APP_SHORT_ID}.example.com`;
var ALLOWED_CLI_TYPES = [
  "computer",
  "phone",
  "tablet",
  "service",
  "other"
];
async function pairCommand(opts = {}) {
  if (opts.clearUrl) {
    clearRemoteBaseUrl();
    console.log(pc3.green("Cleared remote base URL."));
    return;
  }
  if (opts.setUrl) {
    try {
      const saved = setRemoteBaseUrl(opts.setUrl);
      console.log(pc3.green(`Saved remote base URL: ${saved}`));
    } catch (err) {
      console.error(pc3.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
    return;
  }
  const deviceType = resolveDeviceType(opts.type);
  if (deviceType === null) {
    console.error(
      pc3.red(
        `Invalid --type "${opts.type}". Must be one of: ${ALLOWED_CLI_TYPES.join(", ")}.`
      )
    );
    process.exit(1);
  }
  const host = ensureLocalToken();
  if (host.created) console.log(pc3.green("Initialized host."));
  const cachedPort = getRunningPort();
  const probe = await probeHealth(cachedPort);
  if (probe.status === "ok") {
    if (probe.info.port !== cachedPort) setRunningPort(probe.info.port);
  } else {
    printProbeWarning(cachedPort, probe);
  }
  const chosen = chooseBase(opts);
  if (!chosen) {
    console.error(
      pc3.red(
        `No LAN address available on this machine. Try without \`--lan\`, or pass \`--local\` for localhost.`
      )
    );
    process.exit(1);
  }
  const name = (opts.name ?? "").trim() || defaultDeviceName();
  const { key, token } = createApiKey({
    name,
    device_type: deviceType,
    description: `Paired via \`${APP_SHORT_ID} pair\` from ${os3.hostname()}`
  });
  const primaryUrl = buildPairingUrl(token.plaintext, chosen.base);
  const alternates = gatherAlternates(chosen, token.plaintext);
  console.log();
  console.log(
    pc3.bold(`${APP_SHORT_ID} pair`) + pc3.dim(` \u2014 created device "${key.name}" (${key.device_type})`)
  );
  console.log();
  console.log(await renderTerminalQr(primaryUrl));
  console.log(pc3.bold(`${chosen.label} (primary):`));
  console.log(`  ${primaryUrl}`);
  if (alternates.length > 0) {
    console.log();
    console.log(pc3.bold("Also reachable at:"));
    const maxUrlLen = Math.max(...alternates.map((a) => a.url.length));
    for (const alt of alternates) {
      const padded = alt.url.padEnd(maxUrlLen, " ");
      console.log(`  ${padded}  ${pc3.dim(`(${alt.label})`)}`);
    }
  }
  console.log();
  console.log(pc3.dim(hintFor(chosen.source, getRemoteBaseUrl())));
  console.log();
  console.log(
    pc3.dim(
      `Rename or revoke this device anytime from the Devices sheet in the web app's top bar.`
    )
  );
  console.log();
  console.log(pc3.bold("Token") + pc3.dim(` (paste into any base URL as \`/#${PAIRING_TOKEN_FRAGMENT_KEY}=<token>\`):`));
  console.log(`  ${token.plaintext}`);
  console.log();
}
function gatherAlternates(primary, token) {
  const normalize = (u) => u.replace(/\/+$/, "");
  const seen = /* @__PURE__ */ new Set([normalize(primary.base)]);
  const all = [
    { label: "Remote", base: getRemoteBaseUrl() },
    { label: "Same network", base: getLanBaseUrl() },
    { label: "This machine", base: getLocalBaseUrl() }
  ];
  const out = [];
  for (const entry of all) {
    if (!entry.base) continue;
    const key = normalize(entry.base);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: entry.label, url: buildPairingUrl(token, entry.base) });
  }
  return out;
}
function defaultDeviceName() {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `Paired device (${date})`;
}
function resolveDeviceType(raw) {
  if (!raw) return "other";
  const lower = raw.toLowerCase();
  return ALLOWED_CLI_TYPES.includes(lower) ? lower : null;
}
function chooseBase(opts) {
  if (opts.local) {
    return { label: "This machine", base: getLocalBaseUrl(), source: "local" };
  }
  if (opts.lan) {
    const lan2 = getLanBaseUrl();
    if (!lan2) return null;
    return { label: "Same network", base: lan2, source: "lan" };
  }
  const tunnel = getRemoteBaseUrl();
  if (tunnel) {
    return { label: "Remote", base: tunnel, source: "tunnel" };
  }
  const lan = getLanBaseUrl();
  if (lan) {
    return { label: "Same network", base: lan, source: "lan" };
  }
  return { label: "This machine", base: getLocalBaseUrl(), source: "local" };
}
function hintFor(source, tunnel) {
  switch (source) {
    case "tunnel":
      return `Using saved remote URL. Switch with \`--lan\` / \`--local\`, change with \`--set-url <url>\`, or forget with \`--clear-url\`.`;
    case "lan":
      if (!tunnel) {
        return `No remote URL saved \u2014 using your LAN address. Set one with \`${APP_SHORT_ID} pair --set-url ${BASE_URL_EXAMPLE}\` to pair off-network devices.`;
      }
      return `Using LAN address (overriding saved remote URL). Run without \`--lan\` to use the remote URL.`;
    case "local":
      if (!tunnel) {
        return `Only localhost is usable from this machine. Set a remote URL with \`${APP_SHORT_ID} pair --set-url ${BASE_URL_EXAMPLE}\` for off-network pairing.`;
      }
      return `Using localhost (overriding saved remote URL). Run without \`--local\` to use the remote URL.`;
  }
}
function printProbeWarning(port, probe) {
  switch (probe.status) {
    case "offline":
      console.log(
        pc3.yellow(
          `! Nothing is listening on port ${port}. URL below assumes that port \u2014 start the server or run \`${APP_SHORT_ID} pair\` again afterward.`
        )
      );
      return;
    case "unreachable":
      console.log(
        pc3.yellow(
          `! Port ${port} is open but /api/health didn't respond (${probe.detail}). If the dev server is still compiling, try again in a few seconds.`
        )
      );
      return;
    case "unknown-app":
      console.log(
        pc3.yellow(
          `! Something is running on port ${port} but it doesn't look like ${APP_SHORT_ID} (${probe.detail}).`
        )
      );
      return;
  }
}

// src/cli/commands/doctor.ts
import fs8 from "fs";
import net2 from "net";
import pc4 from "picocolors";
var defaultPort = Number(process.env.PORT ?? 4224);
var checks = [
  {
    name: "App root directory",
    run: () => {
      const dir = getAppRoot();
      const exists = fs8.existsSync(dir);
      return { ok: exists || true, detail: dir };
    }
  },
  {
    name: "Database file",
    run: () => {
      const p = getDbPath();
      return {
        ok: fs8.existsSync(p),
        detail: fs8.existsSync(p) ? p : `missing \u2014 will be created on first start (${p})`
      };
    }
  },
  {
    name: "Pairing token",
    run: () => {
      const config = readAuthConfig();
      return {
        ok: !!config?.localToken,
        detail: config?.localToken ? "present" : "missing \u2014 run the `pair` command"
      };
    }
  },
  {
    name: `Default port available (${defaultPort})`,
    run: async () => {
      const free = await isPortFree(defaultPort);
      return {
        ok: free,
        detail: free ? "free" : `port ${defaultPort} is in use`
      };
    }
  },
  {
    name: "Voice (Parakeet STT)",
    run: async () => {
      const wanted = getVoiceEnabled();
      if (!wanted) return { ok: true, detail: "disabled in config" };
      if (await isVoiceReady()) return { ok: true, detail: "running" };
      if (!await isDockerAvailable()) {
        return { ok: false, detail: "enabled, but Docker daemon is not running" };
      }
      return { ok: true, detail: "enabled, will start on server launch" };
    }
  }
];
async function doctorCommand() {
  let allOk = true;
  for (const check of checks) {
    const result = await run(check);
    if (!result.ok) allOk = false;
    const icon = result.ok ? pc4.green("\u2713") : pc4.red("\u2717");
    const detail = result.detail ? pc4.dim(` \u2014 ${result.detail}`) : "";
    console.log(`${icon} ${check.name}${detail}`);
  }
  process.exit(allOk ? 0 : 1);
}
async function run(check) {
  try {
    return await check.run();
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net2.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

// src/cli/commands/onboard.ts
import { intro as intro2, outro as outro2, log as log2, confirm, select, isCancel, spinner as spinner2 } from "@clack/prompts";
import pc5 from "picocolors";

// src/lib/config/onboarded.ts
function getIsOnboarded() {
  const config = readAuthConfig();
  return !!config?.onboardedAt;
}
function markOnboarded() {
  writeAuthConfig({ onboardedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function getOnboardedAt() {
  const config = readAuthConfig();
  if (!config?.onboardedAt) return null;
  const d = new Date(config.onboardedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

// src/cli/commands/onboard.ts
async function onboardCommand(opts) {
  intro2(pc5.bgCyan(pc5.black(` ${APP_NAME} onboard `)));
  const port = Number(opts.port ?? 4224);
  const s = spinner2();
  s.start("Bootstrapping auth");
  const info = ensureLocalToken();
  resetDb();
  s.stop(info.created ? "Created new host token" : "Reusing existing token");
  const serverRunning = await isOurServerRunning(port);
  const alreadyOnboarded = getIsOnboarded();
  if (!alreadyOnboarded || opts.force) {
    if (opts.force && alreadyOnboarded) {
      log2.info("Re-running setup (--force)");
    }
    await runWizard();
    markOnboarded();
    log2.success("Setup complete");
    const startNow = await confirm({
      message: serverRunning ? "Server is already running. Open it now?" : "Start the server now?",
      initialValue: true
    });
    if (isCancel(startNow) || !startNow) {
      outro2("All set \u2014 run the default command anytime to start.");
      return;
    }
    if (serverRunning) {
      await openBrowser(info.pairingUrl);
      outro2(`Opened http://localhost:${port}`);
      return;
    }
    outro2("Starting server\u2026");
    await startCommand({ port: String(port), open: true, pair: false });
    return;
  }
  const at = getOnboardedAt();
  const whenLine = at ? pc5.dim(`(onboarded ${at.toLocaleDateString()})`) : "";
  log2.info(`You're already set up ${whenLine}`);
  const options = [];
  if (serverRunning) {
    options.push({ value: "open", label: "Open in browser", hint: `http://localhost:${port}` });
  } else {
    options.push({ value: "start", label: "Start the server" });
  }
  options.push({ value: "update", label: "Update configuration" });
  options.push({ value: "cancel", label: "Cancel" });
  const action = await select({
    message: "What would you like to do?",
    options
  });
  if (isCancel(action) || action === "cancel") {
    outro2("No changes.");
    return;
  }
  if (action === "open") {
    await openBrowser(info.pairingUrl);
    outro2(`Opened http://localhost:${port}`);
    return;
  }
  if (action === "start") {
    outro2("Starting server\u2026");
    await startCommand({ port: String(port), open: true, pair: false });
    return;
  }
  if (action === "update") {
    await runWizard();
    markOnboarded();
    log2.success("Configuration updated");
    const followUp = await confirm({
      message: serverRunning ? "Server is running with the previous config. Open it?" : "Start the server now?",
      initialValue: true
    });
    if (isCancel(followUp) || !followUp) {
      outro2("Done.");
      return;
    }
    if (serverRunning) {
      await openBrowser(info.pairingUrl);
      outro2(`Opened http://localhost:${port}`);
      return;
    }
    outro2("Starting server\u2026");
    await startCommand({ port: String(port), open: true, pair: false });
  }
}
async function runWizard() {
  const dockerOk = await isDockerAvailable();
  const currentPref = getVoiceEnabled();
  const voiceMsg = dockerOk ? "Enable voice (local speech-to-text via Docker/Parakeet)?" : "Enable voice? Docker is not running \u2014 voice will stay off until you start it.";
  const voice = await confirm({
    message: voiceMsg,
    initialValue: dockerOk ? currentPref || currentPref === null : false
  });
  if (isCancel(voice)) {
    throw new Error("Setup cancelled");
  }
  setVoiceEnabled(!!voice);
  if (voice && !dockerOk) {
    log2.info("Voice is enabled \u2014 start Docker before running the server to activate it.");
  }
}

// src/cli/commands/voice.ts
import { spawn as spawn3 } from "child_process";
import pc6 from "picocolors";
function registerVoiceCommand(program2) {
  const voice = program2.command("voice").description("Manage the voice (speech-to-text) sidecar");
  voice.command("status", { isDefault: true }).description("Show voice service status").action(statusAction);
  voice.command("start").description("Start the voice sidecar").action(startAction);
  voice.command("stop").description("Stop the voice sidecar (keeps model cache)").action(stopAction);
  voice.command("restart").description("Restart the voice sidecar").action(async () => {
    await stopAction();
    await startAction();
  });
  voice.command("enable").description("Remember to auto-start voice with the server").action(() => {
    setVoiceEnabled(true);
    console.log(pc6.green("Voice enabled."));
    console.log(pc6.dim("Run `voice start` now, or it will come up on next server start."));
  });
  voice.command("disable").description("Stop auto-starting voice with the server").action(() => {
    setVoiceEnabled(false);
    console.log(pc6.yellow("Voice disabled."));
    console.log(pc6.dim("The sidecar won't start automatically. Run `voice stop` if it's currently running."));
  });
  voice.command("logs").description("Tail voice sidecar logs (Ctrl-C to exit)").action(logsAction);
}
async function statusAction() {
  const ctx = getVoiceContext();
  const [dockerOk, voiceOk] = await Promise.all([isDockerAvailable(), isVoiceReady(ctx)]);
  const pref = getVoiceEnabled();
  console.log();
  row("Preference", pref ? pc6.green("enabled") : pc6.dim("disabled"));
  row("Docker daemon", dockerOk ? pc6.green("running") : pc6.red("not running"));
  row("Voice service", voiceOk ? pc6.green(`ready (${ctx.serviceUrl})`) : pc6.yellow("not responding"));
  console.log();
  if (!pref && !voiceOk) {
    console.log(pc6.dim("\u2192 `voice enable` to turn on, then `voice start`."));
  } else if (pref && !dockerOk) {
    console.log(pc6.dim("\u2192 Start Docker, then `voice start`."));
  } else if (pref && dockerOk && !voiceOk) {
    console.log(pc6.dim("\u2192 `voice start` to bring up the sidecar."));
  } else if (voiceOk) {
    console.log(pc6.dim("\u2192 Everything looks good."));
  }
}
async function startAction() {
  const ctx = getVoiceContext();
  if (await isVoiceReady(ctx)) {
    console.log(pc6.green(`Voice is already running at ${ctx.serviceUrl}`));
    return;
  }
  if (!await isDockerAvailable()) {
    console.error(pc6.red("Docker is not running."));
    console.error(pc6.dim("Start Docker Desktop (or your Docker daemon) and re-run this command."));
    process.exit(1);
  }
  console.log("Starting voice sidecar (this can take several minutes on the first run)\u2026");
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    console.log(pc6.green(`Voice ready at ${ctx.serviceUrl}`));
  } catch (err) {
    console.error(pc6.red("Voice failed to start."));
    console.error(err instanceof Error ? err.message : String(err));
    console.error(pc6.dim("Run `voice logs` to inspect container output."));
    process.exit(1);
  }
}
async function stopAction() {
  const ctx = getVoiceContext();
  if (!await isDockerAvailable()) {
    console.log(pc6.dim("Docker is not running \u2014 nothing to stop."));
    return;
  }
  await stopVoiceService(ctx);
  console.log(pc6.green("Voice stopped."));
}
function logsAction() {
  const ctx = getVoiceContext();
  return new Promise((resolve, reject) => {
    const child = spawn3(
      "docker",
      ["compose", "-f", ctx.composeFile, "logs", "-f", ctx.service],
      { stdio: "inherit" }
    );
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`logs exited with code ${code}`)));
    child.on("error", reject);
  });
}
function row(label, value) {
  console.log(`  ${label.padEnd(15)} ${value}`);
}

// src/cli/commands/snapshot.ts
import pc7 from "picocolors";

// src/lib/export/snapshot.ts
import fsp4 from "fs/promises";
import fs9 from "fs";
import path10 from "path";

// src/lib/backup/index.ts
import fsp3 from "fs/promises";
import path9 from "path";
async function backupDb(destPath) {
  await fsp3.mkdir(path9.dirname(destPath), { recursive: true });
  const db = getRawDb();
  await db.backup(destPath);
}

// src/lib/export/snapshot.ts
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/:/g, "-").replace(/\.\d+/, "");
}
async function createSnapshot(opts = {}) {
  const outRoot = opts.outRoot ?? path10.join(getAppRoot(), "snapshots");
  const dir = path10.resolve(opts.outDir ?? path10.join(outRoot, `${APP_SHORT_ID}-snapshot-${timestamp()}`));
  await fsp4.mkdir(dir, { recursive: true });
  const dbDest = path10.join(dir, "data.db");
  await backupDb(dbDest);
  const dbStat = await fsp4.stat(dbDest);
  const mirrorDest = path10.join(dir, "mirror");
  await fsp4.mkdir(mirrorDest, { recursive: true });
  const brain = getBrainDir();
  let mirrorFileCount = 0;
  for (const type of ENTITY_TYPES) {
    const src = path10.join(brain, `${type}s`);
    if (!fs9.existsSync(src)) continue;
    const dest = path10.join(mirrorDest, `${type}s`);
    await fsp4.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
    mirrorFileCount += await countMd(dest);
  }
  const archiveSrc = path10.join(brain, ".archive");
  if (fs9.existsSync(archiveSrc)) {
    const archiveDest = path10.join(mirrorDest, ".archive");
    await fsp4.cp(archiveSrc, archiveDest, { recursive: true, force: true, errorOnExist: false });
    mirrorFileCount += await countMd(archiveDest);
  }
  await fsp4.writeFile(path10.join(dir, "README.md"), restoreReadme(), "utf8");
  return { dir, dbBytes: dbStat.size, mirrorFileCount };
}
function restoreReadme() {
  return `# ${APP_SHORT_ID} snapshot

Created: ${(/* @__PURE__ */ new Date()).toISOString()}

## Contents

- \`data.db\` \u2014 consistent SQLite dump
- \`mirror/\` \u2014 markdown copy of tasks, notes, areas, stream, .archive
  at the time of this snapshot. Wiki-linked in Obsidian-compatible format.

## Restore

1. Stop ${APP_SHORT_ID}.
2. Copy \`data.db\` \u2192 \`<brain>/data.db\` (replaces the live DB).
3. Start ${APP_SHORT_ID}. The markdown mirror regenerates on the next write
   via reconcile.

Note: attachments are **not** in this snapshot. For full restoration
including binary files, restore attachments separately from your cloud
backup (with S3 versioning if you need point-in-time).
`;
}
async function countMd(dir) {
  let count = 0;
  async function walk(d) {
    const entries = await fsp4.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path10.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".tmp")) continue;
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        count++;
      }
    }
  }
  await walk(dir);
  return count;
}

// src/cli/commands/snapshot.ts
function registerSnapshotCommand(program2) {
  program2.command("snapshot").description("Write a local, dated snapshot (DB + markdown) to <app-root>/snapshots/").option("-o, --out <path>", "custom output directory (bypasses dated-folder convention)").action(async (opts) => {
    const reconcile = await reconcileAll();
    if (reconcile.synced > 0) {
      console.log(pc7.dim(`Flushed mirror: ${reconcile.synced} synced, ${reconcile.skipped} skipped.`));
    }
    const result = await createSnapshot({ outDir: opts.out });
    console.log(pc7.green("Snapshot complete."));
    console.log(pc7.dim(`  ${result.dir}`));
    console.log(`  db: ${formatBytes(result.dbBytes)}`);
    console.log(`  mirror: ${result.mirrorFileCount} markdown files`);
  });
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// src/cli/commands/commit.ts
import pc8 from "picocolors";

// src/lib/git/commit.ts
import fs10 from "fs";
import path11 from "path";
import { execFileSync } from "child_process";
var GITIGNORE_ENTRIES = [
  "# Managed by " + APP_SHORT_ID + ". Database and binary files are not tracked.",
  "data.db",
  "data.db-wal",
  "data.db-shm",
  "attachments/"
];
function commitBrain() {
  const dir = ensureBrainDir();
  if (!fs10.existsSync(path11.join(dir, ".git"))) {
    run2("git", ["init", "--quiet", "--initial-branch=main"], dir);
  }
  ensureGitignore(dir);
  run2("git", ["add", "."], dir);
  const dirty = hasStagedChanges(dir);
  if (!dirty) {
    return { dir, committed: false };
  }
  const message = `${APP_SHORT_ID}: ${(/* @__PURE__ */ new Date()).toISOString()}`;
  run2("git", ["commit", "--quiet", "--no-gpg-sign", "-m", message], dir);
  const sha = run2("git", ["rev-parse", "--short", "HEAD"], dir).trim();
  return { dir, committed: true, sha, message };
}
function ensureGitignore(dir) {
  const file = path11.join(dir, ".gitignore");
  const expected = GITIGNORE_ENTRIES.join("\n") + "\n";
  if (!fs10.existsSync(file)) {
    fs10.writeFileSync(file, expected, "utf8");
    return;
  }
  const existing = fs10.readFileSync(file, "utf8");
  const lines = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = GITIGNORE_ENTRIES.filter((e) => !e.startsWith("#") && !lines.has(e));
  if (missing.length > 0) {
    const appended = existing.replace(/\n*$/, "\n") + missing.join("\n") + "\n";
    fs10.writeFileSync(file, appended, "utf8");
  }
}
function hasStagedChanges(dir) {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: dir, stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}
function run2(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

// src/cli/commands/commit.ts
function registerCommitCommand(program2) {
  program2.command("commit").description("Flush the mirror and git-commit the brain dir (init git if needed)").action(async () => {
    const reconcile = await reconcileAll();
    if (reconcile.synced > 0) {
      console.log(pc8.dim(`Flushed mirror: ${reconcile.synced} synced, ${reconcile.skipped} skipped.`));
    }
    const result = commitBrain();
    if (!result.committed) {
      console.log(pc8.dim("No changes since last commit."));
      return;
    }
    console.log(pc8.green("Committed."));
    console.log(pc8.dim(`  ${result.sha}  ${result.message}`));
    console.log(pc8.dim(`  in ${result.dir}`));
  });
}

// src/cli/commands/export.ts
import pc9 from "picocolors";
import fs11 from "fs/promises";
function registerExportCommand(program2) {
  const exportCmd = program2.command("export").description("Force a full sync of the live markdown mirror").action(async () => {
    if (!isMirrorEnabled()) {
      console.error(pc9.yellow(`Export mirror is disabled (${MIRROR_DISABLED_ENV}=1)`));
      process.exit(1);
    }
    console.log(pc9.dim(`Syncing mirror at ${getBrainDir()}\u2026`));
    const stats = await reconcileAll();
    console.log(pc9.green("Sync complete."));
    console.log(`  synced:   ${stats.synced}`);
    console.log(`  skipped:  ${stats.skipped}`);
    if (stats.orphaned > 0) {
      console.log(pc9.yellow(`  orphaned: ${stats.orphaned}  (files on disk with no DB row)`));
    }
    console.log(pc9.dim(`  elapsed:  ${stats.elapsedMs}ms`));
  });
  exportCmd.command("path").description("Print the brain directory").action(() => {
    console.log(getBrainDir());
  });
  exportCmd.command("status").description("Show mirror file counts per type").action(async () => {
    const root = getBrainDir();
    console.log(pc9.dim(`Brain: ${root}`));
    console.log(pc9.dim(`Enabled: ${isMirrorEnabled() ? "yes" : "no"}`));
    for (const type of ["tasks", "notes", "areas", "stream"]) {
      const count = await countMdFiles(`${root}/${type}`);
      console.log(`  ${type.padEnd(8)} ${count}`);
    }
  });
}
async function countMdFiles(dir) {
  try {
    const entries = await fs11.readdir(dir);
    return entries.filter((e) => !e.startsWith(".") && e.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

// src/cli/commands/agent.ts
import fs13 from "fs";

// src/lib/orchestrator/registry.ts
import fs12 from "fs";
import { z } from "zod";

// src/lib/orchestrator/types.ts
var ActionError = class extends Error {
  constructor(code, message, suggestion) {
    super(message);
    this.code = code;
    this.suggestion = suggestion;
    this.name = "ActionError";
  }
  toJSON() {
    return { error: this.code, message: this.message, suggestion: this.suggestion };
  }
};
function defineAction(action) {
  return action;
}

// src/lib/orchestrator/registry.ts
var taskStatus = z.enum(["active", "done", "archived"]);
var taskEnergy = z.enum(["deep", "light"]);
var taskEffort = z.enum(["trivial", "small", "medium", "large", "epic"]);
var noteStatus = z.enum(["active", "archived"]);
var taskCreateShape = {
  title: z.string().min(1),
  description: z.string().optional(),
  body: z.string().optional(),
  area_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  status: taskStatus.optional(),
  energy: taskEnergy.nullable().optional(),
  effort: taskEffort.nullable().optional(),
  estimated_minutes: z.number().int().positive().nullable().optional(),
  hard_deadline: z.string().nullable().optional(),
  reminder_at: z.string().nullable().optional(),
  recurrence: z.string().nullable().optional(),
  context_tags: z.array(z.string()).optional(),
  user_context: z.string().nullable().optional(),
  outcome: z.string().nullable().optional()
};
var noteCreateShape = {
  title: z.string().optional(),
  body: z.string().min(1),
  url: z.string().nullable().optional(),
  area_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  status: noteStatus.optional(),
  context_tags: z.array(z.string()).optional()
};
var describe_paths = defineAction({
  name: "describe_paths",
  description: "Print the resolved on-disk paths the app uses (app root, brain dir, db, config). Reflects <APP>_ROOT / <APP>_BRAIN_PATH / <APP>_DB_PATH env overrides.",
  params: {},
  handler: () => ({
    app_root: getAppRoot(),
    brain_dir: getBrainDir(),
    db_path: getDbPath(),
    config_path: getConfigPath(),
    attachments_dir: getAttachmentsDir(),
    tmp_dir: getTmpDir(),
    db_exists: fs12.existsSync(getDbPath())
  })
});
var describe_schema = defineAction({
  name: "describe_schema",
  description: "Return the Drizzle schema source as text. Read-only reference for agents proposing new actions \u2014 lets an agent ground itself in the real column shape without arbitrary SQL access.",
  params: {},
  handler: () => {
    const schemaPath = __require.resolve("@/lib/db/schema");
    const src = fs12.readFileSync(schemaPath, "utf8");
    return { path: schemaPath, source: src };
  }
});
var list_tasks_action = defineAction({
  name: "list_tasks",
  description: "List tasks with optional filters (status, area, parent, energy, text search).",
  params: {
    status: z.union([taskStatus, z.array(taskStatus)]).optional(),
    area_id: z.string().nullable().optional(),
    parent_id: z.string().nullable().optional(),
    energy: taskEnergy.optional(),
    q: z.string().optional(),
    limit: z.number().int().positive().max(1e3).optional(),
    offset: z.number().int().nonnegative().optional(),
    order_by: z.enum(["sort_key", "last_viewed_at", "hard_deadline", "created_at", "updated_at"]).optional()
  },
  handler: (_ctx, input) => listTasks(input)
});
var get_task_action = defineAction({
  name: "get_task",
  description: "Fetch a single task by id.",
  params: { id: z.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const task = getTask(id);
    if (!task) throw new ActionError("not_found", `Task not found: ${id}`);
    return task;
  }
});
var create_task_action = defineAction({
  name: "create_task",
  description: "Create a task. Embeddings + markdown mirror are updated automatically.",
  params: taskCreateShape,
  mutating: true,
  handler: (_ctx, input) => createTask(input)
});
var update_task_action = defineAction({
  name: "update_task",
  description: "Update a task by id. All fields optional; unspecified fields keep their value.",
  params: {
    id: z.string().min(1),
    ...Object.fromEntries(
      Object.entries(taskCreateShape).map(([k, v]) => [k, v.optional()])
    )
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input;
    const row2 = updateTask(id, rest);
    if (!row2) throw new ActionError("not_found", `Task not found: ${id}`);
    return row2;
  }
});
var complete_task_action = defineAction({
  name: "complete_task",
  description: "Mark a task complete. Recurring tasks roll to the next occurrence instead of closing.",
  params: {
    id: z.string().min(1),
    note: z.string().optional()
  },
  mutating: true,
  cli: { positional: ["id"] },
  handler: (_ctx, { id, note }) => {
    const result = completeTask(id, note);
    if (!result) throw new ActionError("not_found", `Task not found: ${id}`);
    return result;
  }
});
var list_notes_action = defineAction({
  name: "list_notes",
  description: "List notes with optional filters (area, linked task, status).",
  params: {
    area_id: z.string().nullable().optional(),
    task_id: z.string().nullable().optional(),
    status: noteStatus.optional(),
    limit: z.number().int().positive().max(1e3).optional(),
    offset: z.number().int().nonnegative().optional(),
    order_by: z.enum(["last_viewed_at", "created_at", "updated_at"]).optional()
  },
  handler: (_ctx, input) => listNotes(input)
});
var get_note_action = defineAction({
  name: "get_note",
  description: "Fetch a single note by id.",
  params: { id: z.string().min(1) },
  cli: { positional: ["id"] },
  handler: (_ctx, { id }) => {
    const note = getNote(id);
    if (!note) throw new ActionError("not_found", `Note not found: ${id}`);
    return note;
  }
});
var create_note_action = defineAction({
  name: "create_note",
  description: "Create a note. Embeddings + markdown mirror are updated automatically.",
  params: noteCreateShape,
  mutating: true,
  handler: (_ctx, input) => createNote(input)
});
var actions = [
  describe_paths,
  describe_schema,
  list_tasks_action,
  get_task_action,
  create_task_action,
  update_task_action,
  complete_task_action,
  list_notes_action,
  get_note_action,
  create_note_action
];

// src/lib/orchestrator/dispatch.ts
import { z as z2 } from "zod";
function findAction(name) {
  return actions.find((a) => a.name === name);
}
async function runAction(name, rawInput, ctx) {
  const action = findAction(name);
  if (!action) {
    return {
      ok: false,
      action: name,
      error: { code: "unknown_action", message: `Unknown action: ${name}` }
    };
  }
  const schema = z2.object(action.params);
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      action: name,
      error: {
        code: "invalid_params",
        message: "Parameter validation failed",
        issues: parsed.error.issues
      }
    };
  }
  try {
    const result = await action.handler(ctx, parsed.data);
    return { ok: true, action: name, result };
  } catch (err) {
    if (err instanceof ActionError) {
      return {
        ok: false,
        action: name,
        error: { code: err.code, message: err.message, suggestion: err.suggestion }
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action: name,
      error: { code: "internal_error", message }
    };
  }
}

// src/cli/commands/agent.ts
function registerAgentCommand(program2) {
  const agent = program2.command("agent").description(
    `Agent orchestrator surface. Typed, auto-generated CLI twin of the orchestrator MCP.`
  );
  for (const action of actions) {
    const positional = action.cli?.positional ?? [];
    const positionalSet = new Set(positional);
    const posArgs = positional.map((p) => `<${p}>`).join(" ");
    const cmd = agent.command(`${action.name}${posArgs ? " " + posArgs : ""}`).description(action.description).option(
      "--input <json-or-@file>",
      'Full input as JSON. "@-" reads stdin; "@path.json" reads a file. Merged on top of flag/positional values.'
    );
    for (const [paramName, paramSchema] of Object.entries(action.params)) {
      if (positionalSet.has(paramName)) continue;
      const flag = `--${paramName.replace(/_/g, "-")}`;
      cmd.option(`${flag} <value>`, describeParam(paramSchema));
    }
    cmd.action(async (...args) => {
      const cmdInstance = args[args.length - 1];
      const opts = cmdInstance.opts();
      const positionalValues = args.slice(0, positional.length);
      const input = {};
      positional.forEach((name, i) => {
        if (positionalValues[i] !== void 0) input[name] = positionalValues[i];
      });
      for (const [paramName, paramSchema] of Object.entries(action.params)) {
        if (positionalSet.has(paramName)) continue;
        const flagKey = paramName.replace(/_/g, "");
        const camel = paramName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const raw = opts[camel] ?? opts[flagKey];
        if (raw === void 0) continue;
        input[paramName] = coerceFlag(raw, paramSchema);
      }
      if (opts.input) {
        const blob = readInputBlob(opts.input);
        Object.assign(input, blob);
      }
      const envelope = await runAction(action.name, input, { remote: false });
      if (!envelope.ok) {
        process.stderr.write(JSON.stringify(envelope, null, 2) + "\n");
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(envelope.result, null, 2) + "\n");
    });
  }
  return agent;
}
function readInputBlob(ref) {
  const raw = ref === "@-" ? fs13.readFileSync(0, "utf8") : ref.startsWith("@") ? fs13.readFileSync(ref.slice(1), "utf8") : ref;
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must be a JSON object");
  }
  return parsed;
}
function coerceFlag(raw, schema) {
  const def = unwrap(schema);
  const typeName = def._def?.typeName;
  if (typeName === "ZodNumber") return Number(raw);
  if (typeName === "ZodBoolean") return raw === "true" || raw === "1";
  if (typeName === "ZodArray" || typeName === "ZodObject" || typeName === "ZodUnion") {
    try {
      return JSON.parse(raw);
    } catch {
      return typeName === "ZodArray" ? raw.split(",").map((s) => s.trim()) : raw;
    }
  }
  return raw;
}
function unwrap(schema) {
  const inner = schema._def?.innerType;
  return inner ? unwrap(inner) : schema;
}
function describeParam(schema) {
  const def = unwrap(schema);
  const typeName = def._def?.typeName;
  const hint = typeName === "ZodArray" ? "array \u2014 JSON or comma-separated" : typeName === "ZodObject" ? "object \u2014 JSON" : typeName === "ZodNumber" ? "number" : typeName === "ZodBoolean" ? "boolean" : typeName === "ZodEnum" ? `enum: ${(def.options ?? []).join("|")}` : "string";
  return hint;
}

// src/cli/index.ts
var migration = migrateLegacyLayoutToBrain();
if (migration.migrated) {
  console.log(`[paths] migrated legacy layout \u2192 brain/ (${migration.moved.join(", ")})`);
}
var program = new Command();
program.name(APP_SHORT_ID).description(`${APP_NAME} \u2014 productivity for humans and agents`).version("0.0.1");
program.command("start", { isDefault: true }).description(`Start ${APP_NAME} and open the app`).option("-p, --port <number>", "port to bind", "4224").option("--no-open", "do not launch the browser").option("--pair", "open the pairing URL even if already paired").option("--dev", "run the server in dev mode (next dev) instead of production").option("--voice", "start the voice sidecar (overrides saved preference)").option("--no-voice", "skip the voice sidecar (overrides saved preference)").action(startCommand);
program.command("onboard").description("Run first-run setup (or re-configure an existing install)").option("-p, --port <number>", "port to probe for an already-running instance", "4224").option("--force", "run the full wizard even if already onboarded").action(onboardCommand);
program.command("pair").description("Mint a new device key and print its pairing URL + QR").option("-n, --name <name>", "label for the new device (shown in web UI)").option(
  "-t, --type <type>",
  "device type: desktop | laptop | phone | tablet | cli | other"
).option("--lan", "use the LAN IP instead of the remote URL").option("--local", "use localhost instead of the remote URL").option("--set-url <url>", "save a public/tunnel base URL for off-network pairing").option("--clear-url", "forget the saved public/tunnel base URL").action(pairCommand);
program.command("doctor").description("Run diagnostic checks").action(doctorCommand);
registerVoiceCommand(program);
registerSnapshotCommand(program);
registerCommitCommand(program);
registerExportCommand(program);
registerAgentCommand(program);
registerSkillsCommand(program);
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
