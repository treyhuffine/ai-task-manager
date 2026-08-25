#!/usr/bin/env tsx
/**
 * One-shot cleanup: collapse task calendar-date fields to bare `YYYY-MM-DD`.
 *
 * `tasks.hardDeadline` and `tasks.resurfaceAfter` are *calendar dates*, not
 * instants — "Aug 25" means Aug 25 on the user's local calendar, no time, no
 * zone. Older code stored them as full timestamps, which is the "I set today,
 * it shows yesterday" bug: a date rendered through a timezone-aware `Date`
 * lands on the previous day in any negative-offset zone. The app now stores and
 * reads these as bare `YYYY-MM-DD` (see `src/lib/dates.ts`). This fixes up rows
 * written before that change so both formats stop coexisting.
 *
 * Two legacy shapes exist, and they normalize differently:
 *
 *   1. Date-picker values pinned to UTC midnight, e.g. `2026-08-25T00:00:00.000Z`.
 *      These came from `new Date('2026-08-25').toISOString()`, so the UTC date
 *      part IS exactly the day the user picked → take the date part verbatim.
 *
 *   2. Real instants with a wall-clock time, e.g. a snooze serialized via
 *      `date.toISOString()` from local time. Here the day the user meant is the
 *      *local* date of that instant → convert through the local timezone.
 *
 * Slicing every value blindly would reintroduce an off-by-one for shape #2, so
 * the two are handled separately. The script runs on the user's own machine, in
 * the same timezone the snooze was created in, which is what makes #2 recoverable.
 *
 * Idempotent — a value already `YYYY-MM-DD` (or unparseable) is left untouched,
 * so re-running finds nothing to do.
 *
 * Usage:
 *   pnpm fix:task-dates --dry-run              # preview (prod home ~/<app>)
 *   pnpm fix:task-dates                        # apply
 *   FLOW_ROOT=~/flow-dev pnpm fix:task-dates   # against the dev home
 */

import pc from 'picocolors';
import { getRawDb } from '../src/lib/db';
import { getAppRoot, getDbPath } from '../src/lib/config/paths';

const BARE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/;

/**
 * The calendar date a stored value was meant to represent, as `YYYY-MM-DD`.
 * Returns null when the value is already bare (nothing to do) or unparseable
 * (leave it alone rather than guess).
 */
function normalize(value: string): string | null {
  if (BARE.test(value)) return null;

  // Shape #1: UTC-midnight from a date picker — the date part is the answer.
  const midnight = UTC_MIDNIGHT.exec(value);
  if (midnight) return midnight[1];

  // Shape #2: a real instant — the user meant its local calendar date.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface TaskDateRow {
  id: string;
  title: string | null;
  hard_deadline: string | null;
  resurface_after: string | null;
}

interface Change {
  id: string;
  title: string | null;
  field: 'hardDeadline' | 'resurfaceAfter';
  column: 'hard_deadline' | 'resurface_after';
  from: string;
  to: string;
}

function main() {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');

  console.log(pc.bold(`Normalize task calendar dates${dryRun ? pc.yellow(' (dry run)') : ''}`));
  console.log(pc.dim(`  home: ${getAppRoot()}`));
  console.log(pc.dim(`  db:   ${getDbPath()}`));
  console.log();

  const db = getRawDb();

  const rows = db
    .prepare(`
      SELECT id, title, hard_deadline, resurface_after
      FROM tasks
      WHERE hard_deadline IS NOT NULL OR resurface_after IS NOT NULL
    `)
    .all() as TaskDateRow[];

  const changes: Change[] = [];
  for (const row of rows) {
    const deadline = row.hard_deadline ? normalize(row.hard_deadline) : null;
    if (deadline && deadline !== row.hard_deadline) {
      changes.push({
        id: row.id,
        title: row.title,
        field: 'hardDeadline',
        column: 'hard_deadline',
        from: row.hard_deadline!,
        to: deadline,
      });
    }
    const resurface = row.resurface_after ? normalize(row.resurface_after) : null;
    if (resurface && resurface !== row.resurface_after) {
      changes.push({
        id: row.id,
        title: row.title,
        field: 'resurfaceAfter',
        column: 'resurface_after',
        from: row.resurface_after!,
        to: resurface,
      });
    }
  }

  if (changes.length === 0) {
    console.log(pc.green('  Nothing to do — every task date is already YYYY-MM-DD.'));
    return;
  }

  for (const change of changes) {
    const title = change.title ?? '(untitled)';
    const shifted = change.from.slice(0, 10) !== change.to;
    const arrow = `${pc.red(change.from)} ${pc.dim('->')} ${pc.green(change.to)}`;
    // Flag rows where the day actually moved (shape #2), not just a trimmed suffix.
    const mark = shifted ? pc.yellow(' (day recovered from local time)') : '';
    console.log(`  ${pc.dim(change.field + ':')} ${arrow}${mark}  ${pc.dim(title)}`);
  }
  console.log();
  console.log(`  ${pc.bold(String(changes.length))} field(s) across ${new Set(changes.map((c) => c.id)).size} task(s)`);

  if (dryRun) {
    console.log(pc.yellow('  Dry run — nothing written.'));
    return;
  }

  const updateDeadline = db.prepare(`UPDATE tasks SET hard_deadline = ? WHERE id = ?`);
  const updateResurface = db.prepare(`UPDATE tasks SET resurface_after = ? WHERE id = ?`);

  // `updated_at` is deliberately left alone: this is a storage-format cleanup,
  // not a user edit, and bumping it would reorder recency-sorted lists.
  db.transaction(() => {
    for (const change of changes) {
      if (change.column === 'hard_deadline') updateDeadline.run(change.to, change.id);
      else updateResurface.run(change.to, change.id);
    }
  })();

  console.log(pc.green(`  Normalized ${changes.length} field(s).`));
  console.log(pc.dim('  Reload the app to pick this up.'));
}

main();
