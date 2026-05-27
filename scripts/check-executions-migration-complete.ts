/**
 * Go/no-go gate for the destructive half of the executions lift —
 * dropping the legacy git/worktree/PR/takeover columns off chat_sessions
 * (docs/executions-spec.md §3.2 step 8, §3.3).
 *
 * Two independent checks; both must pass before the drop migration:
 *
 *   1. DATA — every active `type='execution'` chat has an `execution_id`.
 *      A null here means the backfill (scripts/migrate-executions.ts) hasn't
 *      run or a chat was created through a path that skipped eager creation.
 *      Dropping columns with un-backfilled rows would lose their state.
 *
 *   2. CODE — no consumer still reads/writes the lifted columns through the
 *      `chatSessions.<column>` Drizzle accessor. Reads must flow through
 *      `getChatSessionWithExecution` (flattened) and writes through the
 *      named execution helpers, so the columns are dead before they're
 *      dropped. (Prose mentions of `chat_sessions.<col>` in comments use the
 *      snake_case table name and are intentionally not matched.)
 *
 * Exits non-zero with a report when either check fails. Targets the DB
 * resolved from FLOW_ROOT, same as the migration script.
 */

import { execSync } from 'node:child_process';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';

const LIFTED_COLUMNS = [
  'worktree_path',
  'branch_name',
  'base_sha',
  'pr_number',
  'setup_error',
  'setup_started_at',
  'takeover_started_at',
  'takeover_base_sha',
  'takeover_branch',
  'takeover_token',
  'takeover_token_expires_at',
];

/**
 * Execution chats that never got an execution_id — across ALL statuses,
 * not just active. The backfill migrates archived execution chats too
 * (preserving their archive state), so an archived chat with execution_id
 * NULL is just as much a data-loss risk at column-drop time as an active
 * one. We match exactly what the backfill targets: type='execution' with a
 * workspace anchor. (Workspace-less execution chats are intentionally
 * skipped by the backfill, so a NULL execution_id there is expected.)
 */
function findUnmigratedChats(): string[] {
  const db = getDb();
  const rows = db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.type, 'execution'),
        isNotNull(chatSessions.workspace_id),
        isNull(chatSessions.execution_id),
      ),
    )
    .all();
  return rows.map((r) => r.id);
}

/** Lines in src/ that still touch a lifted column via the Drizzle accessor. */
function findDirectColumnRefs(): string[] {
  const pattern = `chatSessions\\.(${LIFTED_COLUMNS.join('|')})`;
  // `|| true` so a no-match (grep exit 1) doesn't throw — that's the
  // success case. Restricted to src/, so the migration + this script
  // (which live in scripts/) are naturally excluded.
  const out = execSync(`grep -rEn "${pattern}" src/ || true`, {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function main(): void {
  let ok = true;

  const unmigrated = findUnmigratedChats();
  if (unmigrated.length > 0) {
    ok = false;
    console.error(`✗ ${unmigrated.length} workspace-anchored execution chat(s) (any status) still have execution_id = NULL:`);
    for (const id of unmigrated) console.error(`    - ${id}`);
    console.error('  → run `pnpm tsx scripts/migrate-executions.ts` first.\n');
  } else {
    console.log('✓ every workspace-anchored execution chat has an execution_id');
  }

  const refs = findDirectColumnRefs();
  if (refs.length > 0) {
    ok = false;
    console.error(`✗ ${refs.length} direct chatSessions.<lifted-column> reference(s) remain — route reads through getChatSessionWithExecution and writes through the execution helpers before dropping columns:`);
    for (const r of refs) console.error(`    ${r}`);
    console.error('');
  } else {
    console.log('✓ no consumer reads/writes the lifted chat_sessions columns directly');
  }

  if (!ok) {
    console.error('NOT safe to drop the legacy columns yet.');
    process.exit(1);
  }

  console.log(
    '\n✅ Safe to drop the legacy chat_sessions columns ' +
      '(worktree_path, branch_name, base_sha, pr_number, setup_error, setup_started_at, takeover_*).',
  );
}

main();
