#!/usr/bin/env tsx
/**
 * One-shot backfill for nested-actor attribution on `chat_events`.
 *
 * Claude Code streams a subagent's own events (assistant text, thinking, tool
 * calls, tool results) onto the PARENT session's stream, each tagged with the
 * `tool_use` id of the `Agent`/`Task` call that launched it. agentex forwards
 * that tag as `parentToolCallId`, but the adapter never mapped it onto the
 * column, so every one of those rows looked like the session itself talking
 * to the user.
 *
 * The tag was never lost — it is sitting in each row's `raw` payload. This
 * recovers it into the indexed column so historical transcripts group the
 * same way live ones now do. Tagged rows go back to at least 2026-06-24 in
 * the dev corpus, so this is not scoped to any cutover date.
 *
 * Deliberately raw SQL rather than the query layer: this is a repair of a
 * column that should already have been written, not a semantic write. Going
 * through `insertChatEvent` would re-broadcast every row and re-bump session
 * outcome timestamps, marking hundreds of old sessions unread. It also leaves
 * `updated_at` untouched on purpose — backfilling a derived column is not a
 * modification of the event.
 *
 * Only `external_parent_tool_call_id` is recovered. `external_message_id` is
 * populated going forward by the adapter, but nothing in the tree reads it,
 * and backfilling it costs ~8s of extra write lock and ~44k extra FTS trigger
 * firings to no benefit. Pass `--message-ids` if that ever changes.
 *
 * Writes in batches so the app never waits on a long exclusive lock, and
 * raises `busy_timeout` so a concurrent stream write doesn't fail either way.
 *
 * Idempotent: only fills columns that are currently NULL.
 *
 * Usage:
 *   pnpm backfill:subagents --dry-run       # preview (prod home ~/<app>)
 *   pnpm backfill:subagents                 # apply
 *   FLOW_ROOT=~/flow-dev pnpm backfill:subagents
 *   pnpm backfill:subagents --message-ids   # also recover message ids
 */

import Database from 'better-sqlite3';
import pc from 'picocolors';
import { getDbPath } from '../src/lib/config/paths';

/** Rows per transaction. Small enough that the app never blocks noticeably. */
const BATCH_SIZE = 2000;
/** Wait rather than fail if the app holds the write lock. */
const BUSY_TIMEOUT_MS = 30_000;

interface CountRow {
  n: number;
}

/** Fill one NULL column from its `raw` counterpart, in bounded batches. */
function backfillColumn(
  db: Database.Database,
  column: 'external_parent_tool_call_id' | 'external_message_id',
  rawKey: 'parentToolCallId' | 'messageId',
  label: string,
): number {
  const pending = db
    .prepare<[], CountRow>(
      `select count(*) as n from chat_events
        where ${column} is null and json_extract(raw, '$.${rawKey}') is not null`,
    )
    .get()!.n;
  if (pending === 0) {
    console.log(pc.dim(`  ${label}: nothing to do`));
    return 0;
  }

  // `rowid IN (SELECT ... LIMIT n)` keeps each transaction bounded, so the
  // exclusive lock is held for a fraction of a second at a time instead of
  // ~17 seconds across the whole table.
  const step = db.prepare(
    `update chat_events
        set ${column} = json_extract(raw, '$.${rawKey}')
      where rowid in (
        select rowid from chat_events
         where ${column} is null and json_extract(raw, '$.${rawKey}') is not null
         limit ${BATCH_SIZE}
      )`,
  );
  const runBatch = db.transaction(() => step.run().changes);

  let done = 0;
  for (;;) {
    const changed = runBatch();
    if (changed === 0) break;
    done += changed;
    process.stdout.write(`\r  ${label}: ${done}/${pending}`);
  }
  process.stdout.write(`\r  ${label}: ${done}/${pending}\n`);
  return done;
}

function main() {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');
  const withMessageIds = process.argv.includes('--message-ids');
  const dbPath = getDbPath();

  console.log(pc.bold(`Subagent attribution backfill${dryRun ? pc.yellow(' (dry run)') : ''}`));
  console.log(pc.dim(`  db: ${dbPath}`));
  if (!dryRun && !process.env.FLOW_ROOT && !process.env.FLOW_DB_PATH) {
    // No env override means `getDbPath()` resolved the production home. Say
    // so plainly — running this from a dev shell otherwise looks like a dev
    // operation while it edits real data.
    console.log(pc.yellow('  ⚠ no FLOW_ROOT/FLOW_DB_PATH set — this is the production home.'));
  }

  const db = new Database(dbPath);
  try {
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);

    const pendingParent = db
      .prepare<[], CountRow>(
        `select count(*) as n from chat_events
          where external_parent_tool_call_id is null
            and json_extract(raw, '$.parentToolCallId') is not null`,
      )
      .get()!.n;

    console.log(pc.dim(`  rows needing parent tool call id: ${pendingParent}`));

    if (dryRun) {
      if (pendingParent === 0) {
        console.log(pc.green('  nothing to backfill — already attributed.'));
        return;
      }
      const sample = db
        .prepare<[], { source: string; parent: string; snippet: string | null }>(
          `select source,
                  json_extract(raw, '$.parentToolCallId') as parent,
                  substr(replace(coalesce(content, ''), char(10), ' '), 1, 60) as snippet
             from chat_events
            where external_parent_tool_call_id is null
              and json_extract(raw, '$.parentToolCallId') is not null
            order by created_at desc
            limit 5`,
        )
        .all();
      console.log(pc.dim('  sample:'));
      for (const r of sample) {
        console.log(pc.dim(`    ${r.source.padEnd(12)} ${r.parent}  ${r.snippet ?? ''}`));
      }
      console.log(pc.yellow('  dry run — no changes written.'));
      return;
    }

    const parent = backfillColumn(
      db,
      'external_parent_tool_call_id',
      'parentToolCallId',
      'parent tool call ids',
    );
    const message = withMessageIds
      ? backfillColumn(db, 'external_message_id', 'messageId', 'message ids')
      : 0;

    console.log(pc.green(`  attributed ${parent} nested rows.`));
    if (withMessageIds) console.log(pc.green(`  recovered ${message} message ids.`));
  } finally {
    db.close();
  }
}

main();
