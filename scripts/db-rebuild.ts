/**
 * Rebuild a database from the current migrations and refill it from an old
 * one.
 *
 *   pnpm tsx scripts/db-rebuild.ts --in-place <app-root>/data.db
 *   pnpm tsx scripts/db-rebuild.ts --from <old.db> --to <new.db>
 *
 * Used when the migration history is collapsed into a fresh baseline. Every
 * existing database then has to be rebuilt, because its migration journal no
 * longer matches. Booting new code against an old database stops with
 * `MigrationHistoryError` (src/lib/db/migrate.ts), which names this script.
 *
 * It reads exactly one old history, SOURCE_BASELINE below, and checks that
 * before doing anything: a database already on the current baseline, or on
 * an older history, is refused with what to do instead.
 *
 * --in-place is the cutover: with the app stopped, it refuses to run while
 * anything still holds the file open, snapshots it to
 * <app-root>/snapshots/pre-rebuild-<stamp>/data.db, rebuilds from the
 * snapshot, and swaps the rebuilt file in only if every check passes. The
 * original moves next to the snapshot as live-original.db, untouched.
 *
 * --from/--to is the rehearsal: rebuild a copy, verify, swap nothing. It never
 * writes to --from and refuses to overwrite --to.
 *
 * 1. Build --to at the baseline: the first migration in drizzle/ alone, then
 *    the boot-time SQL (triggers, FTS, vector tables), through the app's own
 *    `initDatabase`. Later migrations wait for step 5, so this never has to
 *    know what they change.
 * 2. Drop the app's SQL triggers, so the bulk copy doesn't fire FTS or
 *    link-projection side effects.
 * 3. Attach --from (read only in practice: nothing but SELECTs touch it, and
 *    its size and mtime are checked at the end) and copy every table the two schemas share,
 *    column by column, keeping every rowid (the FTS indexes key on rowid).
 *    A column only the new schema has must come from DERIVED, or be nullable,
 *    or have a default. A column or table only the old schema has must be
 *    listed in DROPPED_*. Anything unexpected aborts the rebuild.
 * 4. Copy the sqlite-vec embedding rows.
 * 5. Reopen through `getDb`, exactly like a boot: it applies every migration
 *    after the baseline, reinstalls triggers and backfills chat_events_fts.
 *    Then rebuild the external-content FTS indexes.
 * 6. Verify: row counts and a row-by-row digest (rowid included) of every
 *    copied table, derived-column distributions, embeddings, FTS integrity,
 *    foreign keys, integrity_check, and the migration journal.
 *
 * The CHANGES block is specific to one rebuild: old history to the current
 * baseline. Rewrite it for the next collapse, never for a later migration.
 */
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { getDb, getRawDb, initDatabase, resetDb } from '../src/lib/db';

// ─── CHANGES (2026-09-22, docs/agents-view-spec.md Phase 1) ───────────────
// The `agents` table goes away. Chats, triggers and runs store their engine
// directly in `harness`. The unused `tasks.heartbeat_days` goes too.

// The history this rebuild reads: the one-migration baseline from the
// 2026-09-10 collapse (1fb95b9), as recorded in `__drizzle_migrations`.
const SOURCE_BASELINE = {
  tag: '0000_stale_expediter',
  hash: '599a14d13a42c0372f79f2cbc0d9c61467c75663e0c6e4b99c805d24a787adad',
};

const DROPPED_TABLES = ['agents'];
const DROPPED_COLUMNS: Record<string, string[]> = {
  chat_sessions: ['agent_id'],
  triggers: ['agent_id'],
  runs: ['agent_id'],
  tasks: ['heartbeat_days'],
};
// No ELSE: an agent row that's missing, or an engine outside HarnessId,
// yields NULL, the NOT NULL column rejects it, and the rebuild aborts.
const HARNESS_FROM_AGENT = `(
  SELECT CASE a.harness
    WHEN 'claude_code' THEN 'claude'
    WHEN 'claude' THEN 'claude'
    WHEN 'codex' THEN 'codex'
    WHEN 'cursor' THEN 'cursor'
    WHEN 'opencode' THEN 'opencode'
  END
  FROM old.agents AS a WHERE a.id = o.agent_id
)`;
const DERIVED: Record<string, Record<string, string>> = {
  chat_sessions: { harness: HARNESS_FROM_AGENT },
  triggers: { harness: HARNESS_FROM_AGENT },
  runs: { harness: HARNESS_FROM_AGENT },
};
// Dropped columns that must be empty, so dropping them loses nothing.
const MUST_BE_EMPTY: Record<string, string[]> = { tasks: ['heartbeat_days'] };

// ─── Plumbing ─────────────────────────────────────────────────────────────

const USAGE = 'usage: db-rebuild.ts --in-place <db> | --from <old.db> --to <new.db>';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value) throw new Error(USAGE);
  return path.resolve(value.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

interface Column { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }

function columns(db: Database.Database, schema: string, table: string): Column[] {
  return db.prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?, ?)`).all(table, schema) as Column[];
}

/** Plain tables to copy: excludes virtual tables, their shadow tables, and SQLite/Drizzle internals. */
function plainTables(db: Database.Database, schema: string): string[] {
  const rows = db
    .prepare(`SELECT name, sql FROM ${schema}.sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name: string; sql: string | null }>;
  const virtual = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(r.sql ?? '')).map((r) => r.name);
  return rows
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_') && n !== '__drizzle_migrations')
    .filter((n) => !virtual.includes(n) && !virtual.some((v) => n.startsWith(`${v}_`)))
    .sort();
}

/** True when the table's rowid is an alias for an INTEGER PRIMARY KEY (copying the column copies the rowid). */
function rowidIsAliased(cols: Column[], createSql: string): boolean {
  if (/WITHOUT ROWID/i.test(createSql)) return true;
  const pk = cols.filter((c) => c.pk > 0);
  return pk.length === 1 && pk[0].type.toUpperCase() === 'INTEGER';
}

function digest(db: Database.Database, sql: string): string {
  const hash = crypto.createHash('sha256');
  for (const row of db.prepare(sql).raw().iterate() as Iterable<unknown[]>) {
    for (const v of row) {
      if (v === null) hash.update('\u0000N');
      else if (Buffer.isBuffer(v)) hash.update('\u0000B').update(v);
      else hash.update(`\u0000${typeof v}:${String(v)}`);
    }
    hash.update('\u0001');
  }
  return hash.digest('hex').slice(0, 16);
}

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');

/**
 * Refuse a source that isn't on SOURCE_BASELINE, before anything is written.
 * Only reads the journal.
 */
function checkSourceHistory(file: string): void {
  const db = new Database(file, { fileMustExist: true });
  try {
    const hasJournal = db.prepare(`SELECT count(*) FROM sqlite_master WHERE name = '__drizzle_migrations'`).pluck().get() as number;
    const rows = hasJournal
      ? (db.prepare(`SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at`).all() as Array<{ hash: string; created_at: number }>)
      : [];
    const current = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    if (rows.length > 0 && rows[0].hash === current[0]?.hash) {
      throw new Error(`${file} is already on the current baseline. There is nothing to rebuild: start the app as usual.`);
    }
    if (rows.length === 1 && rows[0].hash === SOURCE_BASELINE.hash) return;
    const last = rows.at(-1);
    throw new Error(
      [
        `${file} is not on the history this rebuild reads (the ${SOURCE_BASELINE.tag} baseline from 2026-09-10).`,
        `  recorded: ${rows.length} migration(s)${last ? `, the last from ${new Date(Number(last.created_at)).toISOString().slice(0, 10)}` : ''}`,
        rows.length > 1
          ? `It predates the 2026-09-10 collapse, so it needs that move first. Nothing was changed.`
          : `Nothing was changed.`,
      ].join('\n'),
    );
  } finally {
    db.close();
  }
}

/**
 * Create `to` at the baseline: the first migration in drizzle/ and nothing
 * after it, then the boot-time SQL, the way a fresh install looked before any
 * later migration existed.
 */
function buildAtBaseline(to: string): { tag: string } {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const baseline = journal.entries[0];
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-baseline-'));
  try {
    fs.mkdirSync(path.join(folder, 'meta'));
    fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: [baseline] }));
    fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${baseline.tag}.sql`), path.join(folder, `${baseline.tag}.sql`));
    const db = new Database(to);
    sqliteVec.load(db);
    try {
      initDatabase(db, folder);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  return { tag: baseline.tag };
}

// ─── Rebuild ──────────────────────────────────────────────────────────────

/** Rebuild `to` from `from` and verify it. Returns the report; `failures` empty means safe to use. */
function rebuild(from: string, to: string): { report: Record<string, unknown>; failures: string[] } {
  if (!fs.existsSync(from)) throw new Error(`--from does not exist: ${from}`);
  if (fs.existsSync(to)) throw new Error(`--to already exists, refusing to overwrite: ${to}`);
  if (from === to) throw new Error('--from and --to must differ');
  checkSourceHistory(from);
  const started = Date.now();
  const report: Record<string, unknown> = { from, to };
  const fromStat = fs.statSync(from);
  const failures: string[] = [];

  // 1. Fresh schema at the baseline. Later migrations apply in step 5.
  report.builtAt = buildAtBaseline(to).tag;

  const db = new Database(to);
  sqliteVec.load(db);
  db.pragma('journal_mode = DELETE'); // bulk load into an empty file; WAL comes back on the app's first open
  db.pragma('synchronous = OFF');
  db.pragma('foreign_keys = OFF');
  // This SQLite build has URI filenames off, so no `?mode=ro`. The source is
  // only ever SELECTed from; step 6 confirms the file is untouched.
  db.prepare(`ATTACH DATABASE ? AS old`).run(from);

  // 2. No side effects while copying. getDb reinstalls these in step 5.
  const triggers = db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'trigger'`).pluck().all() as string[];
  for (const t of triggers) db.exec(`DROP TRIGGER main.${q(t)}`);

  // 3. Plan the copy, then refuse anything unexpected before writing a row.
  const newTables = plainTables(db, 'main');
  const oldTables = plainTables(db, 'old');
  const onlyOld = oldTables.filter((t) => !newTables.includes(t));
  const onlyNew = newTables.filter((t) => !oldTables.includes(t));
  const unexpectedDrops = onlyOld.filter((t) => !DROPPED_TABLES.includes(t));
  if (unexpectedDrops.length) throw new Error(`old tables missing from the new schema, not in DROPPED_TABLES: ${unexpectedDrops.join(', ')}`);
  report.droppedTables = onlyOld;
  report.newEmptyTables = onlyNew;

  for (const [table, cols] of Object.entries(MUST_BE_EMPTY)) {
    for (const col of cols) {
      const n = db.prepare(`SELECT count(*) FROM old.${q(table)} WHERE ${q(col)} IS NOT NULL`).pluck().get() as number;
      if (n > 0) throw new Error(`old.${table}.${col} holds ${n} values but is being dropped`);
    }
  }

  const plans = newTables.filter((t) => oldTables.includes(t)).map((table) => {
    const newCols = columns(db, 'main', table);
    const oldCols = columns(db, 'old', table).map((c) => c.name);
    const derived = DERIVED[table] ?? {};
    const dropped = oldCols.filter((c) => !newCols.some((n) => n.name === c));
    const unexpected = dropped.filter((c) => !(DROPPED_COLUMNS[table] ?? []).includes(c));
    if (unexpected.length) throw new Error(`${table}: old columns not in the new schema and not in DROPPED_COLUMNS: ${unexpected.join(', ')}`);
    const targets: string[] = [];
    const sources: string[] = [];
    const copied: string[] = [];
    for (const c of newCols) {
      if (derived[c.name]) {
        targets.push(q(c.name));
        sources.push(derived[c.name]);
      } else if (oldCols.includes(c.name)) {
        targets.push(q(c.name));
        sources.push(`o.${q(c.name)}`);
        copied.push(c.name);
      } else if (c.notnull && c.dflt_value === null && c.pk === 0) {
        throw new Error(`${table}.${c.name} is new, NOT NULL, has no default, and nothing in DERIVED fills it`);
      }
    }
    const createSql = db.prepare(`SELECT sql FROM main.sqlite_master WHERE name = ?`).pluck().get(table) as string;
    const keepRowid = !rowidIsAliased(newCols, createSql);
    return { table, targets, sources, copied, keepRowid, derived: Object.keys(derived) };
  });

  db.exec('BEGIN');
  try {
    for (const p of plans) {
      db.exec(`DELETE FROM main.${q(p.table)}`); // e.g. the user_state row EXTRA_SQL seeds
      const targets = p.keepRowid ? ['rowid', ...p.targets] : p.targets;
      const sources = p.keepRowid ? ['o.rowid', ...p.sources] : p.sources;
      db.exec(`INSERT INTO main.${q(p.table)} (${targets.join(', ')}) SELECT ${sources.join(', ')} FROM old.${q(p.table)} AS o`);
    }
    // 4. Vector index rows (the virtual table, not its shadow tables).
    db.exec(`INSERT INTO main.embeddings_vec (rowid, embedding) SELECT rowid, embedding FROM old.embeddings_vec`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // 6a. Verify the copy itself, before anything else touches the file.
  const tableReport: Record<string, unknown> = {};
  for (const p of plans) {
    const orderBy = p.keepRowid ? 'rowid' : p.copied.map(q).join(', ');
    const cols = [...(p.keepRowid ? ['rowid'] : []), ...p.copied.map(q)].join(', ');
    const oldCount = db.prepare(`SELECT count(*) FROM old.${q(p.table)}`).pluck().get() as number;
    const newCount = db.prepare(`SELECT count(*) FROM main.${q(p.table)}`).pluck().get() as number;
    const oldDigest = digest(db, `SELECT ${cols} FROM old.${q(p.table)} ORDER BY ${orderBy}`);
    const newDigest = digest(db, `SELECT ${cols} FROM main.${q(p.table)} ORDER BY ${orderBy}`);
    const ok = oldCount === newCount && oldDigest === newDigest;
    if (!ok) failures.push(`${p.table}: rows ${oldCount} → ${newCount}, digest ${oldDigest} → ${newDigest}`);
    tableReport[p.table] = { rows: newCount, digest: newDigest, ok, ...(p.derived.length ? { derived: p.derived } : {}) };
  }
  report.tables = tableReport;

  const harness: Record<string, unknown> = {};
  for (const table of Object.keys(DERIVED)) {
    const before = db.prepare(`SELECT a.harness AS h, count(*) AS n FROM old.${q(table)} o JOIN old.agents a ON a.id = o.agent_id GROUP BY 1 ORDER BY 1`).all() as Array<{ h: string; n: number }>;
    const after = db.prepare(`SELECT harness AS h, count(*) AS n FROM main.${q(table)} GROUP BY 1 ORDER BY 1`).all() as Array<{ h: string; n: number }>;
    const expected = new Map<string, number>();
    for (const { h, n } of before) {
      const mapped = h === 'claude_code' ? 'claude' : h;
      expected.set(mapped, (expected.get(mapped) ?? 0) + n);
    }
    const ok = after.length === expected.size && after.every(({ h, n }) => expected.get(h) === n);
    if (!ok) failures.push(`${table}.harness distribution ${JSON.stringify(after)} ≠ old agents ${JSON.stringify(before)}`);
    harness[table] = { before, after, ok };
  }
  report.harness = harness;

  const vecOld = digest(db, `SELECT rowid, embedding FROM old.embeddings_vec ORDER BY rowid`);
  const vecNew = digest(db, `SELECT rowid, embedding FROM main.embeddings_vec ORDER BY rowid`);
  const vecCount = db.prepare(`SELECT count(*) FROM main.embeddings_vec`).pluck().get() as number;
  if (vecOld !== vecNew) failures.push(`embeddings_vec digest ${vecOld} → ${vecNew}`);
  report.embeddingsVec = { rows: vecCount, ok: vecOld === vecNew };

  // Compare counters for tables both files have (including sqlite-vec's
  // internal ones). The old file may carry counters for dropped tables.
  const allNew = db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table'`).pluck().all() as string[];
  const allOld = db.prepare(`SELECT name FROM old.sqlite_master WHERE type = 'table'`).pluck().all() as string[];
  const inBoth = (r: { name: string }) => allNew.includes(r.name) && allOld.includes(r.name);
  const seqOld = (db.prepare(`SELECT name, seq FROM old.sqlite_sequence ORDER BY name`).all() as Array<{ name: string }>).filter(inBoth);
  const seqNew = (db.prepare(`SELECT name, seq FROM main.sqlite_sequence ORDER BY name`).all() as Array<{ name: string }>).filter(inBoth);
  const seqOk = JSON.stringify(seqOld) === JSON.stringify(seqNew);
  if (!seqOk) failures.push(`sqlite_sequence ${JSON.stringify(seqOld)} → ${JSON.stringify(seqNew)}`);
  report.sqliteSequence = { ok: seqOk };

  const oldChatFts = db.prepare(`SELECT count(*) FROM old.chat_events_fts`).pluck().get() as number;
  db.exec('DETACH DATABASE old');
  db.close();

  // 5. Reopen the way the app does: applies every migration after the
  //    baseline, reinstalls triggers, backfills chat_events_fts, re-runs the
  //    idempotent bootstrap. Then rebuild the external-content FTS indexes
  //    from their (rowid-preserved) tables.
  getDb(to);
  const app = getRawDb(to);
  for (const fts of ['tasks_fts', 'notes_fts', 'stream_fts']) app.exec(`INSERT INTO ${fts}(${fts}) VALUES('rebuild')`);

  // 6b. Verify the finished file.
  const ftsReport: Record<string, unknown> = {};
  for (const [fts, source] of [['tasks_fts', 'tasks'], ['notes_fts', 'notes'], ['stream_fts', 'stream'], ['chat_events_fts', null]] as const) {
    try {
      app.exec(`INSERT INTO ${fts}(${fts}) VALUES('integrity-check')`);
      const docs = app.prepare(`SELECT count(*) FROM ${fts}_docsize`).pluck().get() as number;
      const expected = source
        ? (app.prepare(`SELECT count(*) FROM ${source}`).pluck().get() as number)
        : oldChatFts;
      if (docs !== expected) failures.push(`${fts}: ${docs} indexed rows, expected ${expected}`);
      ftsReport[fts] = { rows: docs, ok: docs === expected };
    } catch (err) {
      failures.push(`${fts}: ${String(err)}`);
      ftsReport[fts] = { ok: false };
    }
  }
  report.fts = ftsReport;

  const restoredTriggers = app.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`).pluck().all() as string[];
  const missingTriggers = triggers.filter((t) => !restoredTriggers.includes(t));
  if (missingTriggers.length) failures.push(`triggers not reinstalled: ${missingTriggers.join(', ')}`);
  report.triggers = { count: restoredTriggers.length, ok: missingTriggers.length === 0 };

  const fk = app.pragma('foreign_key_check') as unknown[];
  if (fk.length) failures.push(`${fk.length} foreign-key violations`);
  const integrity = app.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') failures.push(`integrity_check: ${integrity}`);
  const journal = app.prepare(`SELECT hash, created_at FROM "__drizzle_migrations"`).all();
  const expectedMigrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length;
  if (journal.length !== expectedMigrations) failures.push(`expected ${expectedMigrations} migrations recorded, found ${journal.length}`);
  report.foreignKeys = { violations: fk.length };
  report.integrity = integrity;
  report.migrations = journal;
  resetDb();

  const fromAfter = fs.statSync(from);
  if (fromAfter.size !== fromStat.size || fromAfter.mtimeMs !== fromStat.mtimeMs) {
    failures.push(`--from changed during the rebuild (size ${fromStat.size} → ${fromAfter.size})`);
  }
  report.fromUntouched = fromAfter.size === fromStat.size && fromAfter.mtimeMs === fromStat.mtimeMs;

  report.seconds = Math.round((Date.now() - started) / 1000);
  report.failures = failures;
  return { report, failures };
}

const SIDECARS = ['', '-wal', '-shm'];

/** PIDs holding the database (or its WAL) open, via lsof. Empty when nothing does. */
function holders(db: string): string[] {
  try {
    const out = execFileSync('lsof', ['-t', ...SIDECARS.map((s) => db + s).filter((f) => fs.existsSync(f))], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split('\n').filter(Boolean))];
  } catch {
    return []; // lsof exits 1 when no process has the files open
  }
}

async function inPlace(db: string): Promise<void> {
  if (!fs.existsSync(db)) throw new Error(`no database at ${db}`);
  const rebuilt = `${db}.rebuilt`;
  if (SIDECARS.some((s) => fs.existsSync(rebuilt + s))) throw new Error(`${rebuilt} already exists. Remove it and retry.`);
  const pids = holders(db);
  if (pids.length) {
    throw new Error(`${db} is still open (pid ${pids.join(', ')}). Stop the app first (Ctrl-C the terminal running it, or \`ri stop\`).`);
  }
  checkSourceHistory(db); // before a multi-gigabyte snapshot, not after

  // Snapshot through SQLite's backup API: a consistent page copy that folds in
  // the WAL and keeps every rowid (VACUUM INTO can renumber rowids).
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const dir = path.join(path.dirname(db), 'snapshots', `pre-rebuild-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = path.join(dir, 'data.db');
  console.error(`Snapshotting ${db} → ${snapshot}`);
  const live = new Database(db, { fileMustExist: true });
  await live.backup(snapshot);
  live.close();
  const snap = new Database(snapshot, { fileMustExist: true });
  const check = snap.pragma('quick_check', { simple: true });
  snap.close();
  if (check !== 'ok') throw new Error(`snapshot quick_check failed: ${check}. Live database untouched.`);

  console.error(`Rebuilding from the snapshot → ${rebuilt}`);
  const { report, failures } = rebuild(snapshot, rebuilt);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error(`\nREBUILD FAILED VERIFICATION (${failures.length}). Live database untouched. ${rebuilt} is left for inspection.`);
    process.exit(1);
  }

  // Re-check right before the swap: nothing may have opened the file since.
  const late = holders(db);
  if (late.length) throw new Error(`${db} was opened during the rebuild (pid ${late.join(', ')}). Live database untouched.`);
  for (const s of SIDECARS) if (fs.existsSync(db + s)) fs.renameSync(db + s, path.join(dir, `live-original.db${s}`));
  for (const s of SIDECARS) if (fs.existsSync(rebuilt + s)) fs.renameSync(rebuilt + s, db + s);

  console.error([
    '',
    `Rebuilt and swapped in (${report.seconds}s). Start the app as usual.`,
    `  snapshot:  ${snapshot}`,
    `  original:  ${path.join(dir, 'live-original.db')}`,
    `Rollback: stop the app, then  mv "${path.join(dir, 'live-original.db')}" "${db}"  and check out the commit before the rebuild.`,
  ].join('\n'));
}

async function main() {
  const target = arg('in-place');
  if (target) return inPlace(target);
  const from = arg('from');
  const to = arg('to');
  if (!from || !to) throw new Error(USAGE);
  const { report, failures } = rebuild(from, to);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error(`\nREBUILD FAILED VERIFICATION (${failures.length}). ${to} is left for inspection. Do not swap it in.`);
    process.exit(1);
  }
  console.error(`\nRebuild verified in ${report.seconds}s: ${to}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
