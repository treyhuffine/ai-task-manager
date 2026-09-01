#!/usr/bin/env tsx
/**
 * Normalize existing task statuses to the canonical lifecycle vocabulary
 * (`consider | todo | in_progress | done | archived`). This is the ONE place
 * legacy `active` bytes are rewritten to `todo` on disk — it is deliberately a
 * standalone package command, never a database migration (schema migrations
 * only make the new model representable; they must not rewrite task data).
 *
 *   pnpm backfill:lifecycle                 # dry-run (default) against the resolved data root
 *   pnpm backfill:lifecycle -- --apply      # actually write, after a snapshot
 *   FLOW_ROOT=~/flow-dev pnpm backfill:lifecycle -- --apply
 *
 * Safety (single-user profile — no resumable-receipt ledger, but still safe):
 *   - Dry-run is the default. Nothing is written without --apply.
 *   - --apply first copies data.db (+ -wal/-shm) and the tasks mirror to a
 *     timestamped snapshot under <root>/.backups so a bad run is reversible by
 *     restoring both together.
 *   - Idempotent: canonical rows are no-ops, a second run reports zero pending.
 *   - Only `active` is auto-mapped (-> todo). Any OTHER non-canonical value is
 *     reported and the run refuses to apply until it is mapped explicitly.
 *   - Preserves ids, rowids, sort keys, parents, areas, completions, recurrence,
 *     blockers, attachments, and every timestamp (raw SQL never fires Drizzle's
 *     updatedAt $onUpdate). Backfilled rows keep lifecycle age unknown.
 *   - After the DB write, forces the markdown mirror to re-render each changed
 *     task, then verifies PRAGMA integrity_check, foreign_key_check, the FTS
 *     row count, and a zero-pending re-scan.
 *
 * Rollback: stop the app, restore <root>/data.db and the tasks mirror from the
 * snapshot together, restart the matching binary, and re-verify both.
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { getRawDb } from '../src/lib/db';
import { syncEntity } from '../src/lib/export/mirror';
import { getDbPath, getAppRoot } from '../src/lib/config/paths';
import { TASK_STATUSES } from '../src/lib/tasks/lifecycle';

const CANONICAL = new Set<string>(TASK_STATUSES);
const LEGACY_MAP: Record<string, string> = { active: 'todo' };

const apply = process.argv.includes('--apply');
const db = getRawDb();
const dbPath = getDbPath();
const root = getAppRoot();

function tally(rows: { status: string; c: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.c;
  return out;
}

/** A status is unknown if it is neither canonical nor a known legacy alias. */
function isUnknown(status: string): boolean {
  return !CANONICAL.has(status) && !(status in LEGACY_MAP);
}

// ── Scan ──────────────────────────────────────────────────────

const liveStatuses = tally(
  db.prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status').all() as { status: string; c: number }[],
);

const snapshotStatuses = tally(
  db
    .prepare(
      `SELECT json_extract(snapshot, '$.status') AS status, COUNT(*) AS c
       FROM entity_versions WHERE entity_type = 'task' AND status IS NOT NULL GROUP BY status`,
    )
    .all() as { status: string; c: number }[],
);

// Mirror frontmatter statuses (best-effort scan of the tasks dir + archive).
function scanMirrorStatuses(): Record<string, number> {
  const out: Record<string, number> = {};
  const dirs = [path.join(root, 'tasks'), path.join(root, '.archive', 'tasks')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      const m = text.match(/^status:\s*["']?([a-z_]+)["']?\s*$/m);
      const status = m?.[1];
      if (status) out[status] = (out[status] ?? 0) + 1;
    }
  }
  return out;
}
const mirrorStatuses = scanMirrorStatuses();

const legacyTaskIds = (
  db.prepare(`SELECT id FROM tasks WHERE status NOT IN (${[...CANONICAL].map(() => '?').join(',')})`).all(...CANONICAL) as {
    id: string;
  }[]
).map((r) => r.id);

const allSeen = new Set<string>([
  ...Object.keys(liveStatuses),
  ...Object.keys(snapshotStatuses),
  ...Object.keys(mirrorStatuses),
]);
const unknowns = [...allSeen].filter(isUnknown);

// ── Report ────────────────────────────────────────────────────

console.log(pc.bold('\nTask lifecycle backfill'));
console.log(`  data root: ${pc.cyan(root)}`);
console.log(`  database:  ${dbPath}`);
if (!process.env.FLOW_ROOT && !process.env.FLOW_DB_PATH) {
  console.log(pc.yellow('  ! No FLOW_ROOT / FLOW_DB_PATH set — this is the PRODUCTION home.'));
}
console.log(`  mode:      ${apply ? pc.red('APPLY (will write)') : pc.green('dry-run (default)')}`);

const fmt = (m: Record<string, number>) =>
  Object.entries(m)
    .map(([s, c]) => `${CANONICAL.has(s) ? s : pc.yellow(s)}=${c}`)
    .join('  ') || '(none)';

console.log('\n  live task statuses:      ', fmt(liveStatuses));
console.log('  version snapshot status: ', fmt(snapshotStatuses));
console.log('  mirror frontmatter:      ', fmt(mirrorStatuses));

const pendingRows = legacyTaskIds.length;
const pendingSnapshots = Object.entries(snapshotStatuses)
  .filter(([s]) => !CANONICAL.has(s))
  .reduce((n, [, c]) => n + c, 0);
const pendingMirror = Object.entries(mirrorStatuses)
  .filter(([s]) => !CANONICAL.has(s))
  .reduce((n, [, c]) => n + c, 0);

console.log(pc.bold('\n  pending changes:'));
console.log(`    task rows:        ${pendingRows}`);
console.log(`    version snapshots:${pendingSnapshots}`);
console.log(`    mirror files:     ${pendingMirror}`);
if (legacyTaskIds.length) console.log(`    task ids: ${legacyTaskIds.slice(0, 20).join(', ')}${legacyTaskIds.length > 20 ? ' ...' : ''}`);

if (unknowns.length) {
  console.log(pc.red(`\n  ✗ Unknown non-canonical statuses found: ${unknowns.join(', ')}`));
  console.log(pc.red('    Only `active` is auto-mapped (-> todo). Map these explicitly before applying.'));
  if (apply) process.exit(1);
}

if (pendingRows === 0 && pendingSnapshots === 0 && pendingMirror === 0) {
  console.log(pc.green('\n  ✓ Nothing to do. Everything is already canonical.\n'));
  process.exit(0);
}

if (!apply) {
  console.log(pc.green('\n  Dry-run complete. Re-run with --apply to write (a snapshot is taken first).\n'));
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────

// 1. Snapshot db + mirror together.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(root, '.backups', `lifecycle-backfill-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  const src = dbPath + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, path.basename(src)));
}
function copyDir(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}
copyDir(path.join(root, 'tasks'), path.join(backupDir, 'tasks'));
copyDir(path.join(root, '.archive', 'tasks'), path.join(backupDir, 'archive-tasks'));
console.log(`\n  snapshot: ${pc.cyan(backupDir)}`);

// 2. Rewrite the bytes in one transaction (raw SQL — preserves rowid + updatedAt).
const txn = db.transaction(() => {
  db.prepare(`UPDATE tasks SET status = 'todo' WHERE status = 'active'`).run();
  db.prepare(
    `UPDATE entity_versions SET snapshot = json_set(snapshot, '$.status', 'todo')
     WHERE entity_type = 'task' AND json_extract(snapshot, '$.status') = 'active'`,
  ).run();
});
txn();
console.log(`  rewrote ${pendingRows} task rows and ${pendingSnapshots} version snapshots (active -> todo)`);

// 3. Force the mirror to re-render each changed task, then verify.
(async () => {
  for (const id of legacyTaskIds) await syncEntity('task', id);

  const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all().length;
  const taskCount = (db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c;
  const ftsCount = (db.prepare('SELECT COUNT(*) AS c FROM tasks_fts').get() as { c: number }).c;
  const stillPending = (db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status = 'active'`).get() as { c: number }).c;
  const stillPendingSnap = (
    db.prepare(
      `SELECT COUNT(*) AS c FROM entity_versions WHERE entity_type='task' AND json_extract(snapshot,'$.status')='active'`,
    ).get() as { c: number }
  ).c;

  console.log(pc.bold('\n  verification:'));
  console.log(`    integrity_check:     ${integrity === 'ok' ? pc.green('ok') : pc.red(integrity)}`);
  console.log(`    foreign_key_check:   ${fkViolations === 0 ? pc.green('0 violations') : pc.red(fkViolations + ' violations')}`);
  console.log(`    tasks vs tasks_fts:  ${taskCount === ftsCount ? pc.green(`${taskCount} == ${ftsCount}`) : pc.red(`${taskCount} != ${ftsCount}`)}`);
  console.log(`    remaining active:    ${stillPending === 0 && stillPendingSnap === 0 ? pc.green('0 rows, 0 snapshots') : pc.red(`${stillPending} rows, ${stillPendingSnap} snapshots`)}`);

  const ok = integrity === 'ok' && fkViolations === 0 && taskCount === ftsCount && stillPending === 0 && stillPendingSnap === 0;
  if (ok) {
    console.log(pc.green('\n  ✓ Backfill complete and verified.\n'));
  } else {
    console.log(pc.red('\n  ✗ Verification FAILED. Restore data.db and the tasks mirror from the snapshot above.\n'));
    process.exit(1);
  }
})();
