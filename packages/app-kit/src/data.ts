/**
 * Durable building blocks for app backends that keep records in the host-provided
 * data directory with Node's built-in SQLite (`openAppDatabase` in the SDK):
 * forward-only migrations, opaque list cursors, app data scopes for scoped
 * callers, a bounded job queue for ingestion and enrichment, content-addressed
 * evidence files, settings and error redaction.
 *
 * Everything here is synchronous SQLite work inside the caller's transaction
 * boundaries. Nothing starts a timer or a background loop.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { AppError, type AppPrincipal } from "./contract.js";
import type { AppInvocation } from "./sdk.js";

/** The subset of `node:sqlite`'s DatabaseSync these helpers use. */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SqlValue[]): Record<string, unknown> | undefined;
    all(...params: SqlValue[]): Record<string, unknown>[];
  };
  readonly isTransaction: boolean;
}
export type SqlValue = string | number | bigint | null | Uint8Array;

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Run `work` in one immediate transaction, or join the caller's. */
export function transaction<T>(db: SqlDatabase, work: () => T): T {
  if (db.isTransaction) return work();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

// ─── Migrations ──────────────────────────────────────────────────────────────

export interface Migration {
  version: number;
  name: string;
  sql: string;
}
/**
 * Apply forward-only migrations. Applied migrations are immutable: a changed
 * checksum or a version newer than this package stops the app instead of
 * guessing, which protects data written by a later version.
 */
export function migrate(db: SqlDatabase, migrations: readonly Migration[]) {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new AppError("app_failed", "App migrations must be numbered 1, 2, 3 in order");
  });
  db.exec(
    "CREATE TABLE IF NOT EXISTS app_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = db.prepare("SELECT version, checksum FROM app_schema_migrations ORDER BY version").all() as { version: number; checksum: string }[];
  for (const row of applied) {
    const known = migrations[Number(row.version) - 1];
    if (!known) throw new AppError("conflict", "This app's data was written by a newer version of the app. Update the app to open it");
    if (sha256(known.sql) !== row.checksum) throw new AppError("app_failed", `App migration ${row.version} changed after it was applied`);
  }
  const done: number[] = [];
  for (const migration of migrations.slice(applied.length)) {
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO app_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
        migration.version,
        migration.name,
        sha256(migration.sql),
        nowIso(),
      );
    });
    done.push(migration.version);
  }
  return { applied: done, version: migrations.length };
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/** Common list input: an opaque cursor and a limit (default 50, maximum 100). */
export const listInputShape = {
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
};
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function decodeCursor<T>(schema: z.ZodType<T>, cursor: string | undefined | null): T | null {
  if (!cursor) return null;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new AppError("invalid_input", "This list position expired. Reload the list");
  }
}
/** Split `limit + 1` fetched rows into a page and the next cursor. */
export function pageOf<T>(rows: T[], limit: number, keyOf: (row: T) => unknown) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null };
}
/** A typed write result: either saved, or a conflict carrying the current record to compare. */
export function writeResultSchema<T extends z.ZodType>(record: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("saved"), record }).strict(),
    z.object({ status: z.literal("conflict"), current: record, message: z.string().max(300) }).strict(),
  ]);
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function createSettings(db: SqlDatabase) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, value TEXT NOT NULL)",
  );
  return {
    get<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
      if (!row) return fallback;
      const parsed = schema.safeParse(JSON.parse(String(row.value)));
      return parsed.success ? parsed.data : fallback;
    },
    set(key: string, value: unknown) {
      const time = nowIso();
      db.prepare(
        "INSERT INTO app_settings (key, created_at, updated_at, value) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).run(key, time, time, JSON.stringify(value));
    },
    remove(key: string) {
      db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
    },
  };
}

// ─── Scopes ──────────────────────────────────────────────────────────────────

/** Source keys are app-defined strings. Account sources use this form. */
export const accountSource = (account: string) => `account:${account}`;
export type Operation = "read" | "write";
export type AccessScope =
  | { kind: "owner"; actorId: string }
  | {
      kind: "sources";
      actorId: string;
      scopeRef: string | null;
      sources: ReadonlySet<string>;
      operations: ReadonlySet<Operation>;
    };
export function allows(scope: AccessScope, source: string | null | undefined): boolean {
  return scope.kind === "owner" || (!!source && scope.sources.has(source));
}
/** True when every source of a mixed record is allowed. Callers that can project field by field use `allows` per field instead. */
export function allowsAll(scope: AccessScope, sources: Iterable<string>): boolean {
  if (scope.kind === "owner") return true;
  for (const source of sources) if (!scope.sources.has(source)) return false;
  return true;
}
/**
 * A stable key for what a reader may see. Cache any derived value (a briefing,
 * a count, a summary) under this key plus its evidence revisions, so a broad
 * owner result is never served to a narrower chat.
 */
export function scopeFingerprint(scope: AccessScope): string {
  return scope.kind === "owner" ? "owner" : sha256(JSON.stringify([...scope.sources].sort()));
}
export interface ScopeRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  actorId: string;
  label: string;
  sources: string[];
  operations: Operation[];
  revokedAt: string | null;
}
const scopeRow = (row: Record<string, unknown>): ScopeRecord => ({
  id: String(row.id),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  actorId: String(row.actor_id),
  label: String(row.label),
  sources: JSON.parse(String(row.sources)),
  operations: JSON.parse(String(row.operations)),
  revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
});
const actorPattern = /^(chat|workspace|job|background|owner-ui|fixture):[^\s]{1,128}$/;
/**
 * App data scopes for callers that are not the owner. The owner creates one in
 * the app's account-access view (`create_scope`), Ri saves its reference in the
 * caller's grant, and every later invocation receives that reference from the
 * host. A scope is immutable: changing access creates a new one.
 */
export function createScopeStore(db: SqlDatabase, instanceId: () => string) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS app_data_scopes (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, instance_id TEXT NOT NULL, actor_id TEXT NOT NULL, label TEXT NOT NULL, sources TEXT NOT NULL, operations TEXT NOT NULL, revoked_at TEXT)",
  );
  return {
    create(input: { actorId: string; label: string; sources: string[]; operations: Operation[] }): ScopeRecord {
      if (!actorPattern.test(input.actorId) || input.actorId.startsWith("owner-ui:") || input.actorId.startsWith("fixture:"))
        throw new AppError("invalid_input", "Choose a chat, agent or scheduled caller for this access");
      const sources = [...new Set(input.sources)].sort();
      const operations = [...new Set(input.operations)].sort() as Operation[];
      if (!sources.length) throw new AppError("invalid_input", "Choose at least one account or collection to share");
      if (!operations.length || operations.some((op) => op !== "read" && op !== "write"))
        throw new AppError("invalid_input", "Choose what this caller may do");
      if (sources.length > 200) throw new AppError("invalid_input", "Share at most 200 sources with one caller");
      const id = randomUUID(), time = nowIso();
      db.prepare(
        "INSERT INTO app_data_scopes (id, created_at, updated_at, instance_id, actor_id, label, sources, operations, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      ).run(id, time, time, instanceId(), input.actorId, input.label.slice(0, 200), JSON.stringify(sources), JSON.stringify(operations));
      return this.get(id)!;
    },
    get(id: string): ScopeRecord | null {
      const row = db.prepare("SELECT * FROM app_data_scopes WHERE id = ? AND instance_id = ?").get(id, instanceId());
      return row ? scopeRow(row) : null;
    },
    list(): ScopeRecord[] {
      return db.prepare("SELECT * FROM app_data_scopes WHERE instance_id = ? ORDER BY created_at DESC LIMIT 200").all(instanceId()).map(scopeRow);
    },
    revoke(id: string) {
      const time = nowIso();
      db.prepare("UPDATE app_data_scopes SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ? AND instance_id = ?").run(time, time, id, instanceId());
    },
    /** Remove a deleted source from every scope so a later identical key never inherits old access. */
    forgetSource(source: string) {
      // Every matching scope, not a page of them, in one transaction.
      transaction(db, () => {
        const rows = db.prepare("SELECT * FROM app_data_scopes WHERE instance_id = ? AND instr(sources, ?) > 0").all(instanceId(), JSON.stringify(source)).map(scopeRow);
        const time = nowIso();
        for (const scope of rows) {
          if (!scope.sources.includes(source)) continue;
          db.prepare("UPDATE app_data_scopes SET sources = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(scope.sources.filter((item) => item !== source)), time, scope.id);
        }
      });
    },
    /**
     * The data this invocation may use for `operation`. The owner's view and an
     * isolated preview see everything. A schedule sees only its own granted
     * accounts. A chat or agent needs the scope its current grant selected,
     * created for that exact caller, unrevoked and allowing the operation.
     */
    resolve(invocation: Pick<AppInvocation, "principal" | "access">, operation: Operation): AccessScope {
      const principal: AppPrincipal = invocation.principal;
      const actorId = `${principal.kind}:${principal.id}`;
      if (principal.kind === "owner-ui" || principal.kind === "fixture") return { kind: "owner", actorId };
      const access = invocation.access;
      if (!access || access.actorId !== actorId)
        throw new AppError("forbidden", "This caller's app access could not be verified");
      if (principal.kind === "job" || principal.kind === "background")
        return {
          kind: "sources",
          actorId,
          scopeRef: null,
          sources: new Set(access.accounts.map((item) => accountSource(item.account))),
          operations: new Set<Operation>(["read", "write"]),
        };
      if (!access.scopeRef)
        throw new AppError("forbidden", "The owner has not chosen which records this chat may use. Ask them to choose account access for it");
      const scope = this.get(access.scopeRef);
      if (!scope || scope.actorId !== actorId)
        throw new AppError("forbidden", "This access belongs to a different caller");
      if (scope.revokedAt) throw new AppError("revoked", "The owner removed this caller's access");
      if (!scope.operations.includes(operation))
        throw new AppError("forbidden", operation === "write" ? "This caller may read but not change these records" : "This caller may not read these records");
      return { kind: "sources", actorId, scopeRef: scope.id, sources: new Set(scope.sources), operations: new Set(scope.operations) };
    },
  };
}
export type ScopeStore = ReturnType<typeof createScopeStore>;

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type JobState = "pending" | "running" | "paused" | "failed";
export interface JobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: string;
  sourceKey: string;
  state: JobState;
  attempts: number;
  nextEligibleAt: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  idempotent: boolean;
}
const jobRow = (row: Record<string, unknown>): JobRecord => ({
  id: String(row.id),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  kind: String(row.kind),
  sourceKey: String(row.source_key),
  state: String(row.state) as JobState,
  attempts: Number(row.attempts),
  nextEligibleAt: String(row.next_eligible_at),
  lastRunAt: row.last_run_at === null ? null : String(row.last_run_at),
  lastSuccessAt: row.last_success_at === null ? null : String(row.last_success_at),
  lastError: row.last_error === null ? null : String(row.last_error),
  idempotent: Number(row.idempotent) === 1,
});
/**
 * One persistent job per (kind, source). A step claims the fairest due job,
 * does one bounded unit of work and finishes it as pending again (more work
 * now, or after an idle interval) or failed with a redacted reason. No loop
 * lives here: the host's schedule or a human's Continue runs each step.
 */
export function createJobQueue(db: SqlDatabase, options: { now?: () => Date } = {}) {
  const clock = options.now ?? (() => new Date());
  const stamp = () => clock().toISOString();
  db.exec(`CREATE TABLE IF NOT EXISTS app_jobs (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    kind TEXT NOT NULL, source_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','running','paused','failed')),
    attempts INTEGER NOT NULL, next_eligible_at TEXT NOT NULL,
    last_run_at TEXT, last_success_at TEXT, last_error TEXT, idempotent INTEGER NOT NULL,
    UNIQUE (kind, source_key));
  CREATE INDEX IF NOT EXISTS app_jobs_due ON app_jobs (state, next_eligible_at);`);
  createSettings(db);
  const get = (id: string) => {
    const row = db.prepare("SELECT * FROM app_jobs WHERE id = ?").get(id);
    return row ? jobRow(row) : null;
  };
  return {
    /** Create the job if missing. An existing paused or failed job keeps its state. */
    ensure(kind: string, sourceKey: string, options: { idempotent: boolean; eligibleAt?: string }): JobRecord {
      const time = stamp();
      db.prepare(
        "INSERT INTO app_jobs (id, created_at, updated_at, kind, source_key, state, attempts, next_eligible_at, last_run_at, last_success_at, last_error, idempotent) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?) ON CONFLICT(kind, source_key) DO NOTHING",
      ).run(randomUUID(), time, time, kind, sourceKey, options.eligibleAt ?? time, options.idempotent ? 1 : 0);
      return jobRow(db.prepare("SELECT * FROM app_jobs WHERE kind = ? AND source_key = ?").get(kind, sourceKey)!);
    },
    get,
    find(kind: string, sourceKey: string) {
      const row = db.prepare("SELECT * FROM app_jobs WHERE kind = ? AND source_key = ?").get(kind, sourceKey);
      return row ? jobRow(row) : null;
    },
    list(sourcePrefix?: string): JobRecord[] {
      return (sourcePrefix
        ? db.prepare("SELECT * FROM app_jobs WHERE source_key LIKE ? ORDER BY kind, source_key LIMIT 500").all(`${sourcePrefix}%`)
        : db.prepare("SELECT * FROM app_jobs ORDER BY kind, source_key LIMIT 500").all()
      ).map(jobRow);
    },
    /**
     * The next due job. Kinds alternate when several have work, so enrichment
     * cannot starve ingestion, and within a kind the source that ran longest
     * ago goes first, so a large mailbox cannot starve another account.
     */
    next(now: string, options: { kinds?: string[]; sources?: ReadonlySet<string> } = {}): JobRecord | null {
      const due = db
        .prepare("SELECT * FROM app_jobs WHERE state = 'pending' AND next_eligible_at <= ? ORDER BY COALESCE(last_run_at, '') ASC, created_at ASC, id ASC LIMIT 200")
        .all(now)
        .map(jobRow)
        .filter((job) => (!options.kinds || options.kinds.includes(job.kind)) && (!options.sources || options.sources.has(job.sourceKey)));
      if (!due.length) return null;
      const settings = createSettings(db);
      const lastKind = settings.get("jobs.lastKind", z.string(), "");
      return due.find((job) => job.kind !== lastKind) ?? due[0];
    },
    claim(id: string): JobRecord {
      return transaction(db, () => {
        const job = get(id);
        if (!job || job.state !== "pending") throw new AppError("conflict", "This background step is no longer pending");
        const time = stamp();
        db.prepare("UPDATE app_jobs SET state = 'running', attempts = attempts + 1, last_run_at = ?, updated_at = ? WHERE id = ?").run(time, time, id);
        createSettings(db).set("jobs.lastKind", job.kind);
        return get(id)!;
      });
    },
    /** Finish a successful step. `more` keeps it immediately eligible, otherwise it waits `idleMs`. */
    finish(id: string, options: { more: boolean; idleMs?: number; now?: Date }) {
      const now = options.now ?? clock();
      const next = options.more ? now.toISOString() : new Date(now.getTime() + (options.idleMs ?? 0)).toISOString();
      db.prepare(
        "UPDATE app_jobs SET state = CASE WHEN state = 'running' THEN 'pending' ELSE state END, attempts = 0, last_error = NULL, last_success_at = ?, next_eligible_at = ?, updated_at = ? WHERE id = ?",
      ).run(now.toISOString(), next, now.toISOString(), id);
    },
    /** Record a failure. Retryable failures back off exponentially (1 minute to 1 hour) for up to 8 attempts. */
    fail(id: string, error: unknown, options: { retryable: boolean; now?: Date }) {
      const job = get(id);
      if (!job) return;
      const now = options.now ?? clock();
      const retry = options.retryable && job.attempts < 8;
      const delay = Math.min(3_600_000, 60_000 * 2 ** Math.max(0, job.attempts - 1));
      db.prepare(
        "UPDATE app_jobs SET state = CASE WHEN state = 'paused' THEN 'paused' WHEN ? THEN 'pending' ELSE 'failed' END, last_error = ?, next_eligible_at = ?, updated_at = ? WHERE id = ?",
      ).run(retry ? 1 : 0, redact(error), new Date(now.getTime() + delay).toISOString(), now.toISOString(), id);
    },
    pause(sourceKey: string) {
      db.prepare("UPDATE app_jobs SET state = 'paused', updated_at = ? WHERE source_key = ?").run(stamp(), sourceKey);
    },
    /** Resume paused or failed jobs for a source and make them eligible now. */
    resume(sourceKey: string) {
      const time = stamp();
      db.prepare("UPDATE app_jobs SET state = 'pending', attempts = 0, next_eligible_at = ?, updated_at = ? WHERE source_key = ? AND state IN ('paused','failed')").run(time, time, sourceKey);
    },
    /** Make a pending job eligible now, for a human's Continue. */
    wake(id: string) {
      const time = stamp();
      db.prepare("UPDATE app_jobs SET next_eligible_at = ?, updated_at = ? WHERE id = ? AND state = 'pending'").run(time, time, id);
    },
    remove(sourceKey: string) {
      db.prepare("DELETE FROM app_jobs WHERE source_key = ?").run(sourceKey);
    },
    /**
     * After a restart a running step was interrupted. Idempotent steps resume
     * from their committed checkpoint, others wait for the human.
     */
    recover() {
      const time = stamp();
      db.prepare("UPDATE app_jobs SET state = 'pending', next_eligible_at = ?, updated_at = ? WHERE state = 'running' AND idempotent = 1").run(time, time);
      db.prepare("UPDATE app_jobs SET state = 'failed', last_error = 'Interrupted by a restart. Continue to retry', updated_at = ? WHERE state = 'running' AND idempotent = 0").run(time);
    },
    counts(): Record<JobState, number> {
      const result: Record<JobState, number> = { pending: 0, running: 0, paused: 0, failed: 0 };
      for (const row of db.prepare("SELECT state, COUNT(*) AS count FROM app_jobs GROUP BY state").all()) result[String(row.state) as JobState] = Number(row.count);
      return result;
    },
  };
}
export type JobQueue = ReturnType<typeof createJobQueue>;

// ─── Evidence files ──────────────────────────────────────────────────────────

/**
 * Large imported content (documents, message bodies) lives in app-owned files
 * named by their SHA-256 digest, so a repeated import stores one copy.
 */
export function createBlobStore(directory: string) {
  const root = path.resolve(directory);
  const file = (digest: string) => {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new AppError("invalid_input", "Invalid evidence reference");
    return path.join(root, digest.slice(0, 2), digest);
  };
  return {
    put(data: string | Uint8Array): { digest: string; size: number } {
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      const digest = sha256(bytes), target = file(digest);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${randomUUID()}.tmp`;
        fs.writeFileSync(temporary, bytes, { mode: 0o600 });
        fs.renameSync(temporary, target);
      }
      return { digest, size: bytes.byteLength };
    },
    read(digest: string): Buffer | null {
      try {
        return fs.readFileSync(file(digest));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    readText(digest: string): string | null {
      return this.read(digest)?.toString("utf8") ?? null;
    },
    has(digest: string) {
      return fs.existsSync(file(digest));
    },
    remove(digest: string) {
      fs.rmSync(file(digest), { force: true });
    },
  };
}
export type BlobStore = ReturnType<typeof createBlobStore>;

// ─── Text and errors ─────────────────────────────────────────────────────────

/** A short reason safe for logs and the Sources screen: no addresses, tokens or URLs. */
export function redact(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "The step failed";
  return raw
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[address]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
/** Bound text for storage or a model, cutting at a word boundary. */
export function boundText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const room = Math.max(1, max - 1);
  const cut = text.slice(0, room);
  const space = cut.lastIndexOf(" ");
  return { text: `${(space >= room / 2 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated: true };
}
/** The caller as stored with authored records and decisions. */
export function actorOf(invocation: Pick<AppInvocation, "principal">): string {
  return `${invocation.principal.kind}:${invocation.principal.id}`;
}
