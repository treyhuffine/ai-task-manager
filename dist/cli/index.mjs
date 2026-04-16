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
      voiceEnabled: parsed.voiceEnabled ?? null
    };
  } catch (err) {
    console.error("[auth] failed to read config.json:", err);
    return null;
  }
}
function writeAuthConfig(config) {
  ensureUserDataDir();
  const existing = readAuthConfig();
  const next = {
    version: 1,
    localToken: config.localToken ?? existing?.localToken ?? null,
    tunnelUrl: config.tunnelUrl ?? existing?.tunnelUrl ?? null,
    onboardedAt: config.onboardedAt ?? existing?.onboardedAt ?? null,
    voiceEnabled: config.voiceEnabled ?? existing?.voiceEnabled ?? null
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

// src/lib/auth/bootstrap.ts
function getLocalBaseUrl() {
  const port = process.env.PORT ?? "4224";
  return `http://localhost:${port}`;
}
function buildPairingUrl(token, baseUrl = getLocalBaseUrl()) {
  return `${baseUrl}/#t=${token}`;
}
function ensureLocalToken() {
  const existing = readAuthConfig();
  if (existing?.localToken) {
    const row = findApiKeyByHash(hashToken(existing.localToken));
    if (row && !row.revoked_at) {
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
  if (!await canConnect(port)) return false;
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1e3)
    });
    return res.ok;
  } catch {
    return false;
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
import pc2 from "picocolors";
function pairCommand() {
  const info = ensureLocalToken();
  if (info.created) {
    console.log(pc2.green("Created new host token."));
  }
  console.log(info.pairingUrl);
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

// src/cli/index.ts
var program = new Command();
program.name(APP_SHORT_ID).description(`${APP_NAME} \u2014 productivity for humans and agents`).version("0.0.1");
program.command("start", { isDefault: true }).description(`Start ${APP_NAME} and open the app`).option("-p, --port <number>", "port to bind", "4224").option("--no-open", "do not launch the browser").option("--pair", "open the pairing URL even if already paired").option("--dev", "run the server in dev mode (next dev) instead of production").option("--voice", "start the voice sidecar (overrides saved preference)").option("--no-voice", "skip the voice sidecar (overrides saved preference)").action(startCommand);
program.command("onboard").description("Run first-run setup (or re-configure an existing install)").option("-p, --port <number>", "port to probe for an already-running instance", "4224").option("--force", "run the full wizard even if already onboarded").action(onboardCommand);
program.command("pair").description("Print the pairing URL (creates a token if missing)").action(pairCommand);
program.command("doctor").description("Run diagnostic checks").action(doctorCommand);
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
