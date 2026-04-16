#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cli/index.ts
import { Command } from "commander";

// src/constants/app.ts
var APP_NAME = "Flow";
var APP_SHORT_ID = "flow";

// src/cli/commands/start.ts
import { intro, outro, log, spinner } from "@clack/prompts";
import pc from "picocolors";
import getPort from "get-port";

// src/lib/auth/bootstrap.ts
import os2 from "os";

// src/lib/auth/config-file.ts
import fs2 from "fs";

// src/lib/config/paths.ts
import fs from "fs";
import os from "os";
import path from "path";
var ENV_PREFIX = APP_SHORT_ID.toUpperCase();
function homeDir() {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}
function getUserDataDir() {
  const override = process.env[`${ENV_PREFIX}_DATA_DIR`];
  if (override) return override;
  return path.join(homeDir(), `.${APP_SHORT_ID}`);
}
function getDbPath() {
  const override = process.env[`${ENV_PREFIX}_DB_PATH`];
  if (override) return override;
  return path.join(getUserDataDir(), "data.db");
}
function getConfigPath() {
  return path.join(getUserDataDir(), "config.json");
}
function ensureUserDataDir() {
  const dir = getUserDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
  } else {
    try {
      fs.chmodSync(dir, 448);
    } catch {
    }
  }
  return dir;
}

// src/lib/auth/config-file.ts
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
  ensureUserDataDir();
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
  active_area_id: text("active_area_id").references(() => areas.id),
  active_parent_task_id: text("active_parent_task_id"),
  active_energy: text("active_energy", { enum: ["deep", "light"] }),
  available_minutes: integer("available_minutes"),
  description: text("description").notNull().default(""),
  voice_auto_send: integer("voice_auto_send", { mode: "boolean" }).notNull().default(true),
  voice_model: text("voice_model").notNull().default("local/parakeet-tdt-0.6b-v3"),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`)
});
var areas = sqliteTable("areas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  emoji: text("emoji"),
  image_url: text("image_url"),
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
  source: text("source", { enum: ["capture", "voice", "brain_dump", "chat"] }).notNull().default("capture"),
  status: text("status", { enum: ["pending", "promoted", "dismissed"] }).notNull().default("pending"),
  dismissed_by: text("dismissed_by"),
  promoted_to_type: text("promoted_to_type"),
  promoted_to_id: text("promoted_to_id"),
  promoted_at: text("promoted_at"),
  promotion_pass: text("promotion_pass"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`)
});
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
    enum: ["host", "desktop", "laptop", "phone", "tablet", "cli", "other"]
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
  stream_item_id: text("stream_item_id").references(() => stream.id),
  title: text("title"),
  body: text("body").notNull(),
  url: text("url"),
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
  const dir = path2.dirname(resolvedPath);
  if (!fs3.existsSync(dir)) {
    fs3.mkdirSync(dir, { recursive: true });
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

// src/lib/db/queries.ts
import { eq, and, desc, asc, sql as sql2, inArray, isNull, getTableColumns } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

// src/lib/embeddings/embed.ts
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";

// src/lib/db/queries.ts
function listTasks(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (statuses.length === 1) {
      conditions.push(eq(tasks.status, statuses[0]));
    } else {
      conditions.push(inArray(tasks.status, statuses));
    }
  }
  if (filter.area_id) conditions.push(eq(tasks.area_id, filter.area_id));
  if (filter.parent_id) conditions.push(eq(tasks.parent_id, filter.parent_id));
  if (filter.energy) conditions.push(eq(tasks.energy, filter.energy));
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
  }).from(tasks).where(conditions.length > 0 ? and(...conditions) : void 0).orderBy(...orderClauses).limit(limit).offset(offset).all();
}
function getTask(id) {
  const db = getDb();
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}
function listNotes(filter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.area_id) conditions.push(eq(notes.area_id, filter.area_id));
  if (filter.task_id) conditions.push(eq(notes.task_id, filter.task_id));
  if (filter.status) conditions.push(eq(notes.status, filter.status));
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
  return db.select().from(notes).where(conditions.length > 0 ? and(...conditions) : void 0).orderBy(...orderClauses).limit(limit).offset(offset).all();
}
function getNote(id) {
  const db = getDb();
  return db.select().from(notes).where(eq(notes.id, id)).get();
}
function listAreas(filter = {}) {
  const db = getDb();
  const status = filter.status ?? "active";
  return db.select().from(areas).where(status !== "all" ? eq(areas.status, status) : void 0).orderBy(asc(areas.sort_order)).all();
}
function getArea(id) {
  const db = getDb();
  return db.select().from(areas).where(eq(areas.id, id)).get();
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
  return db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).get();
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
  return `${baseUrl}/#t=${token}`;
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
async function isOurServerRunning(port, token) {
  return (await probeHealth(port, token)).status === "ok";
}
async function probeHealth(port, token) {
  if (!await canConnect(port)) return { status: "offline" };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1e4)
    });
    if (res.status === 401 || res.status === 403) {
      return { status: "unauthorized", httpStatus: res.status };
    }
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

// src/cli/lib/voice.ts
import { spawn as spawn2 } from "child_process";
import path3 from "path";
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
  return path3.resolve(process.cwd(), "modules/parakeet-stt/docker-compose.yml");
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
  intro(pc.bgCyan(pc.black(` ${APP_NAME} `)));
  const preferredPort = Number(opts.port ?? 4224);
  const s = spinner();
  s.start("Bootstrapping auth");
  const info = ensureLocalToken();
  resetDb();
  s.stop(info.created ? "Created new host token" : "Reusing existing token");
  if (await isOurServerRunning(preferredPort, info.plaintext)) {
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
    s.stop(pc.yellow("Voice failed to start \u2014 continuing without voice"));
    log.warn(err instanceof Error ? err.message : String(err));
    return false;
  }
}

// src/cli/commands/pair.ts
import os3 from "os";
import pc2 from "picocolors";

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
  "desktop",
  "laptop",
  "phone",
  "tablet",
  "cli",
  "other"
];
async function pairCommand(opts = {}) {
  if (opts.clearUrl) {
    clearRemoteBaseUrl();
    console.log(pc2.green("Cleared remote base URL."));
    return;
  }
  if (opts.setUrl) {
    try {
      const saved = setRemoteBaseUrl(opts.setUrl);
      console.log(pc2.green(`Saved remote base URL: ${saved}`));
    } catch (err) {
      console.error(pc2.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
    return;
  }
  const deviceType = resolveDeviceType(opts.type);
  if (deviceType === null) {
    console.error(
      pc2.red(
        `Invalid --type "${opts.type}". Must be one of: ${ALLOWED_CLI_TYPES.join(", ")}.`
      )
    );
    process.exit(1);
  }
  const host = ensureLocalToken();
  if (host.created) console.log(pc2.green("Initialized host."));
  const cachedPort = getRunningPort();
  const probe = await probeHealth(cachedPort, host.plaintext);
  if (probe.status === "ok") {
    if (probe.info.port !== cachedPort) setRunningPort(probe.info.port);
  } else {
    printProbeWarning(cachedPort, probe);
  }
  const chosen = chooseBase(opts);
  if (!chosen) {
    console.error(
      pc2.red(
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
    pc2.bold(`${APP_SHORT_ID} pair`) + pc2.dim(` \u2014 created device "${key.name}" (${key.device_type})`)
  );
  console.log();
  console.log(await renderTerminalQr(primaryUrl));
  console.log();
  console.log(pc2.bold(`${chosen.label} (primary):`));
  console.log(`  ${primaryUrl}`);
  if (alternates.length > 0) {
    console.log();
    console.log(pc2.bold("Also reachable at:"));
    const maxUrlLen = Math.max(...alternates.map((a) => a.url.length));
    for (const alt of alternates) {
      const padded = alt.url.padEnd(maxUrlLen, " ");
      console.log(`  ${padded}  ${pc2.dim(`(${alt.label})`)}`);
    }
  }
  console.log();
  console.log(pc2.dim(hintFor(chosen.source, getRemoteBaseUrl())));
  console.log();
  console.log();
  console.log(
    pc2.dim(
      `Rename or revoke this device anytime from Profile \u2192 Devices in the web app.`
    )
  );
  console.log();
  console.log(pc2.bold("Token") + pc2.dim(" (paste into any base URL as `/#t=<token>`):"));
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
        pc2.yellow(
          `! Nothing is listening on port ${port}. URL below assumes that port \u2014 start the server or run \`${APP_SHORT_ID} pair\` again afterward.`
        )
      );
      return;
    case "unreachable":
      console.log(
        pc2.yellow(
          `! Port ${port} is open but /api/health didn't respond (${probe.detail}). If the dev server is still compiling, try again in a few seconds.`
        )
      );
      return;
    case "unauthorized":
      console.log(
        pc2.yellow(
          `! Server on port ${port} rejected the host token (HTTP ${probe.httpStatus}). The token in config may not match the server's database.`
        )
      );
      return;
    case "unknown-app":
      console.log(
        pc2.yellow(
          `! Something is running on port ${port} but it doesn't look like ${APP_SHORT_ID} (${probe.detail}).`
        )
      );
      return;
  }
}

// src/cli/commands/doctor.ts
import fs4 from "fs";
import net2 from "net";
import pc3 from "picocolors";
var defaultPort = Number(process.env.PORT ?? 4224);
var checks = [
  {
    name: "User data directory",
    run: () => {
      const dir = getUserDataDir();
      const exists = fs4.existsSync(dir);
      return { ok: exists || true, detail: dir };
    }
  },
  {
    name: "Database file",
    run: () => {
      const p = getDbPath();
      return {
        ok: fs4.existsSync(p),
        detail: fs4.existsSync(p) ? p : `missing \u2014 will be created on first start (${p})`
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
    const icon = result.ok ? pc3.green("\u2713") : pc3.red("\u2717");
    const detail = result.detail ? pc3.dim(` \u2014 ${result.detail}`) : "";
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
import pc4 from "picocolors";

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
  intro2(pc4.bgCyan(pc4.black(` ${APP_NAME} onboard `)));
  const port = Number(opts.port ?? 4224);
  const s = spinner2();
  s.start("Bootstrapping auth");
  const info = ensureLocalToken();
  resetDb();
  s.stop(info.created ? "Created new host token" : "Reusing existing token");
  const serverRunning = await isOurServerRunning(port, info.plaintext);
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
  const whenLine = at ? pc4.dim(`(onboarded ${at.toLocaleDateString()})`) : "";
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
import pc5 from "picocolors";
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
    console.log(pc5.green("Voice enabled."));
    console.log(pc5.dim("Run `voice start` now, or it will come up on next server start."));
  });
  voice.command("disable").description("Stop auto-starting voice with the server").action(() => {
    setVoiceEnabled(false);
    console.log(pc5.yellow("Voice disabled."));
    console.log(pc5.dim("The sidecar won't start automatically. Run `voice stop` if it's currently running."));
  });
  voice.command("logs").description("Tail voice sidecar logs (Ctrl-C to exit)").action(logsAction);
}
async function statusAction() {
  const ctx = getVoiceContext();
  const [dockerOk, voiceOk] = await Promise.all([isDockerAvailable(), isVoiceReady(ctx)]);
  const pref = getVoiceEnabled();
  console.log();
  row("Preference", pref ? pc5.green("enabled") : pc5.dim("disabled"));
  row("Docker daemon", dockerOk ? pc5.green("running") : pc5.red("not running"));
  row("Voice service", voiceOk ? pc5.green(`ready (${ctx.serviceUrl})`) : pc5.yellow("not responding"));
  console.log();
  if (!pref && !voiceOk) {
    console.log(pc5.dim("\u2192 `voice enable` to turn on, then `voice start`."));
  } else if (pref && !dockerOk) {
    console.log(pc5.dim("\u2192 Start Docker, then `voice start`."));
  } else if (pref && dockerOk && !voiceOk) {
    console.log(pc5.dim("\u2192 `voice start` to bring up the sidecar."));
  } else if (voiceOk) {
    console.log(pc5.dim("\u2192 Everything looks good."));
  }
}
async function startAction() {
  const ctx = getVoiceContext();
  if (await isVoiceReady(ctx)) {
    console.log(pc5.green(`Voice is already running at ${ctx.serviceUrl}`));
    return;
  }
  if (!await isDockerAvailable()) {
    console.error(pc5.red("Docker is not running."));
    console.error(pc5.dim("Start Docker Desktop (or your Docker daemon) and re-run this command."));
    process.exit(1);
  }
  console.log("Starting voice sidecar (this can take several minutes on the first run)\u2026");
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    console.log(pc5.green(`Voice ready at ${ctx.serviceUrl}`));
  } catch (err) {
    console.error(pc5.red("Voice failed to start."));
    console.error(err instanceof Error ? err.message : String(err));
    console.error(pc5.dim("Run `voice logs` to inspect container output."));
    process.exit(1);
  }
}
async function stopAction() {
  const ctx = getVoiceContext();
  if (!await isDockerAvailable()) {
    console.log(pc5.dim("Docker is not running \u2014 nothing to stop."));
    return;
  }
  await stopVoiceService(ctx);
  console.log(pc5.green("Voice stopped."));
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

// src/cli/commands/export.ts
import fs5 from "fs";
import path4 from "path";
import pc6 from "picocolors";

// src/lib/export/markdown.ts
function wikiLink(resolver, type, id) {
  if (!id || !resolver) return null;
  const target = resolver.linkFor(type, id);
  return target ? `[[${target}]]` : null;
}
function slugify(s) {
  return s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
}
function yamlValue(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return "[" + v.map((x) => yamlValue(x)).join(", ") + "]";
  }
  const s = String(v);
  if (/[\r\n]/.test(s) || /^\s|\s$|[:#\-&*!?|>'"%@`,\[\]{}]|^(true|false|null|yes|no|\d)/i.test(s) || s === "") {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
  }
  return s;
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
function taskToMarkdown(task, opts = {}) {
  const frontmatter = buildFrontmatter({
    id: task.id,
    type: "task",
    title: task.title,
    status: task.status,
    area: wikiLink(opts.links, "area", task.area_id) ?? opts.areaName ?? null,
    area_id: task.area_id,
    parent: wikiLink(opts.links, "task", task.parent_id),
    parent_id: task.parent_id,
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
    attachments: task.attachments,
    blocked_on: task.blocked_on,
    blocked_since: task.blocked_since,
    outcome: task.outcome,
    times_deferred: task.times_deferred || null,
    last_progress_at: task.last_progress_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at
  });
  const parts = [frontmatter, "", `# ${task.title}`];
  const description = (task.description ?? "").trim();
  const body = (task.body ?? "").trim();
  const userContext = (task.user_context ?? "").trim();
  if (description) parts.push("", description);
  if (body) parts.push("", body);
  if (userContext) parts.push("", "## Context", "", userContext);
  const content = parts.join("\n") + "\n";
  const filename = `${slugify(task.title) || task.id}.md`;
  return { filename, content };
}
function noteToMarkdown(note, opts = {}) {
  const frontmatter = buildFrontmatter({
    id: note.id,
    type: "note",
    title: note.title,
    status: note.status,
    area: wikiLink(opts.links, "area", note.area_id) ?? opts.areaName ?? null,
    area_id: note.area_id,
    task: wikiLink(opts.links, "task", note.task_id),
    task_id: note.task_id,
    url: note.url,
    context_tags: note.context_tags,
    created_at: note.created_at,
    updated_at: note.updated_at
  });
  const body = (note.body ?? "").trim();
  const titleHeading = note.title ? `# ${note.title}
` : "";
  const content = `${frontmatter}

${titleHeading}${body ? (titleHeading ? "\n" : "") + body + "\n" : ""}`;
  const baseName = note.title ? slugify(note.title) : "";
  const filename = `${baseName || note.id}.md`;
  return { filename, content };
}
function areaToMarkdown(area) {
  const frontmatter = buildFrontmatter({
    id: area.id,
    type: "area",
    name: area.name,
    emoji: area.emoji,
    status: area.status,
    sort_order: area.sort_order,
    description: area.description,
    created_at: area.created_at,
    updated_at: area.updated_at
  });
  const parts = [frontmatter, "", `# ${area.emoji ? area.emoji + " " : ""}${area.name}`];
  if (area.description) parts.push("", area.description);
  if (area.notes) parts.push("", "## Notes", "", area.notes);
  if (area.user_context) parts.push("", "## Context", "", area.user_context);
  const content = parts.join("\n") + "\n";
  const filename = `${slugify(area.name) || area.id}.md`;
  return { filename, content };
}

// src/cli/commands/export.ts
var MAX_EXPORT_ITEMS = 1e5;
function registerExportCommand(program2) {
  program2.command("export").description("Export tasks, notes, and areas as markdown (one-way)").option("-o, --out <path>", "output directory (or file when exporting a single item)").option("--task <id>", "export a single task").option("--note <id>", "export a single note").option("--area <id>", "export a single area").option("--tasks", "bulk: tasks only").option("--notes", "bulk: notes only").option("--areas", "bulk: areas only").option("--include-archived", "include archived items in bulk export").action(exportCommand);
}
async function exportCommand(opts) {
  if (opts.task) {
    const task = getTask(opts.task);
    if (!task) return fail(`Task not found: ${opts.task}`);
    const areasById = buildAreaMap();
    const { filename, content } = taskToMarkdown(task, {
      areaName: areaNameFor(task.area_id, areasById)
    });
    writeSingle(content, filename, opts.out);
    return;
  }
  if (opts.note) {
    const note = getNote(opts.note);
    if (!note) return fail(`Note not found: ${opts.note}`);
    const areasById = buildAreaMap();
    const { filename, content } = noteToMarkdown(note, {
      areaName: areaNameFor(note.area_id, areasById)
    });
    writeSingle(content, filename, opts.out);
    return;
  }
  if (opts.area) {
    const area = getArea(opts.area);
    if (!area) return fail(`Area not found: ${opts.area}`);
    const { filename, content } = areaToMarkdown(area);
    writeSingle(content, filename, opts.out);
    return;
  }
  const noFlags = !opts.tasks && !opts.notes && !opts.areas;
  const wantTasks = opts.tasks || noFlags;
  const wantNotes = opts.notes || noFlags;
  const wantAreas = opts.areas || noFlags;
  const outDir = path4.resolve(opts.out ?? defaultOutDir());
  fs5.mkdirSync(outDir, { recursive: true });
  const noteStatuses = opts.includeArchived ? ["active", "archived"] : ["active"];
  const taskStatuses = opts.includeArchived ? ["active", "done", "archived"] : ["active", "done"];
  const allAreas = wantAreas ? listAreas({ status: "all" }) : [];
  const allTasks = wantTasks ? listTasks({ status: [...taskStatuses], limit: MAX_EXPORT_ITEMS }) : [];
  const allNotes = wantNotes ? noteStatuses.flatMap((status) => listNotes({ status, limit: MAX_EXPORT_ITEMS })) : [];
  const registry = buildLinkRegistry({ tasks: allTasks, notes: allNotes, areas: allAreas });
  const resolver = {
    linkFor: (type, id) => registry.get(registryKey(type, id)) ?? null
  };
  let taskCount = 0;
  let noteCount = 0;
  let areaCount = 0;
  if (wantAreas) {
    const dir = path4.join(outDir, "areas");
    fs5.mkdirSync(dir, { recursive: true });
    const used = /* @__PURE__ */ new Set();
    for (const a of allAreas) {
      const { filename, content } = areaToMarkdown(a);
      const finalName = uniqueName(filename, a.id, used);
      fs5.writeFileSync(path4.join(dir, finalName), content, "utf8");
      areaCount++;
    }
  }
  if (wantTasks) {
    const dir = path4.join(outDir, "tasks");
    fs5.mkdirSync(dir, { recursive: true });
    const areasById = new Map(allAreas.map((a) => [a.id, a]));
    for (const t of allTasks) {
      const { content } = taskToMarkdown(t, {
        areaName: areaNameFor(t.area_id, areasById),
        links: resolver
      });
      const filename = mustGet(registry, registryKey("task", t.id)).split("/").pop() + ".md";
      fs5.writeFileSync(path4.join(dir, filename), content, "utf8");
      taskCount++;
    }
  }
  if (wantNotes) {
    const dir = path4.join(outDir, "notes");
    fs5.mkdirSync(dir, { recursive: true });
    const areasById = new Map(allAreas.map((a) => [a.id, a]));
    for (const n of allNotes) {
      const { content } = noteToMarkdown(n, {
        areaName: areaNameFor(n.area_id, areasById),
        links: resolver
      });
      const filename = mustGet(registry, registryKey("note", n.id)).split("/").pop() + ".md";
      fs5.writeFileSync(path4.join(dir, filename), content, "utf8");
      noteCount++;
    }
  }
  console.log(pc6.green("Export complete."));
  console.log(pc6.dim(`  ${outDir}`));
  if (wantAreas) console.log(`  ${areaCount} area${areaCount === 1 ? "" : "s"}`);
  if (wantTasks) console.log(`  ${taskCount} task${taskCount === 1 ? "" : "s"}`);
  if (wantNotes) console.log(`  ${noteCount} note${noteCount === 1 ? "" : "s"}`);
  countWarning("tasks", taskCount);
  countWarning("notes", noteCount);
}
function registryKey(type, id) {
  return `${type}:${id}`;
}
function buildLinkRegistry(data) {
  const reg = /* @__PURE__ */ new Map();
  assignFilenames("area", data.areas, (a) => a.name || a.id, reg);
  assignFilenames("task", data.tasks, (t) => t.title, reg);
  assignFilenames("note", data.notes, (n) => n.title ?? "", reg);
  return reg;
}
function assignFilenames(type, records, nameOf, reg) {
  const dir = `${type}s`;
  const used = /* @__PURE__ */ new Set();
  for (const r of records) {
    const base = slugify(nameOf(r)) || r.id;
    let candidate = base;
    if (used.has(candidate)) candidate = `${base}-${r.id.slice(-6)}`;
    used.add(candidate);
    reg.set(registryKey(type, r.id), `${dir}/${candidate}`);
  }
}
function buildAreaMap() {
  const map = /* @__PURE__ */ new Map();
  for (const a of listAreas({ status: "all" })) map.set(a.id, a);
  return map;
}
function areaNameFor(id, map) {
  if (!id) return null;
  return map.get(id)?.name ?? null;
}
function defaultOutDir() {
  const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return path4.join(getUserDataDir(), "exports", `${APP_SHORT_ID}-export-${ts}`);
}
function writeSingle(content, defaultName, out) {
  if (!out) {
    process.stdout.write(content);
    return;
  }
  const resolved = path4.resolve(out);
  let target = resolved;
  if (fs5.existsSync(resolved) && fs5.statSync(resolved).isDirectory()) {
    target = path4.join(resolved, defaultName);
  } else {
    fs5.mkdirSync(path4.dirname(resolved), { recursive: true });
  }
  fs5.writeFileSync(target, content, "utf8");
  console.log(pc6.green("Wrote"), pc6.dim(target));
}
function uniqueName(preferred, id, used) {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const ext = path4.extname(preferred);
  const base = preferred.slice(0, -ext.length);
  const suffixed = `${base}-${id.slice(-6)}${ext}`;
  used.add(suffixed);
  return suffixed;
}
function mustGet(m, k) {
  const v = m.get(k);
  if (v === void 0) throw new Error(`registry missing entry: ${String(k)}`);
  return v;
}
function countWarning(label, count) {
  if (count >= MAX_EXPORT_ITEMS) {
    console.warn(
      pc6.yellow(`! ${label} export hit the ${MAX_EXPORT_ITEMS} cap \u2014 results may be truncated.`)
    );
  }
}
function fail(message) {
  console.error(pc6.red(message));
  process.exit(1);
}

// src/cli/index.ts
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
registerExportCommand(program);
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
