/**
 * One-shot data migration for the executions lift (docs/executions-spec.md §3).
 *
 * Backfills an `executions` row for every existing `type='execution'` chat
 * session, copying the durable git/worktree/PR/takeover state forward, then
 * points the chat at it via `chat_sessions.execution_id`.
 *
 * Properties:
 *   - Idempotent: re-running skips chats that already have an execution_id.
 *   - Atomic per row: the execution insert + chat update happen inside one
 *     transaction, so a mid-row crash can't leave an orphaned execution.
 *   - Verifying: each migrated execution is read back and every lifted
 *     field is compared to the source row; a mismatch aborts loudly.
 *   - Auditable: writes a JSON manifest to `<app-root>/backups/`.
 *
 * Run it AFTER the schema migration (the `executions` table + the
 * `chat_sessions.execution_id` column must exist). `getDb()` auto-applies
 * pending Drizzle migrations on first call, so simply invoking this script
 * brings the schema current before backfilling.
 *
 * Targets the database resolved from FLOW_ROOT (see src/lib/config/paths.ts):
 *   - prod:  ~/<app-short-id>/brain/data.db           (no FLOW_ROOT)
 *   - dev:   FLOW_ROOT=$HOME/<app-short-id>-dev  pnpm tsx scripts/migrate-executions.ts
 *
 * Follow the backup-and-migrate sequence in docs/executions-spec.md §3.2
 * before running this against real data.
 */

import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import { chatSessions, executions } from '@/lib/db/schema';
import { getAppRoot } from '@/lib/config/paths';

type ManifestEntry =
  | { chat_session_id: string; execution_id: string; status: 'migrated' | 'already_migrated' }
  | { chat_session_id: string; status: 'skipped_no_workspace' };

// Lifted columns whose values must round-trip exactly from the source chat
// row into the new execution row.
const LIFTED_FIELDS = [
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
] as const;

function migrate(): void {
  // First getDb() call auto-applies pending Drizzle migrations, so the
  // executions table + execution_id column exist by the time we query.
  const db = getDb();

  const sessions = db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.type, 'execution'))
    .all();

  const manifest: ManifestEntry[] = [];

  for (const s of sessions) {
    // Idempotency: already migrated (re-run, or created post-lift).
    if (s.execution_id) {
      manifest.push({ chat_session_id: s.id, execution_id: s.execution_id, status: 'already_migrated' });
      continue;
    }

    // Skip only when there's genuinely no workspace anchor. A null
    // worktree_path is legitimate (pending git provision, or non-git).
    if (!s.workspace_id) {
      manifest.push({ chat_session_id: s.id, status: 'skipped_no_workspace' });
      continue;
    }

    const executionId = uuidv7();

    // Atomic: insert the execution + point the chat at it in one tx. A
    // throw inside rolls both back, and a rerun re-attempts the row.
    db.transaction((tx) => {
      tx.insert(executions)
        .values({
          id: executionId,
          workspace_id: s.workspace_id!,
          label: s.label, // copy the visible name forward
          worktree_path: s.worktree_path, // may be null — fine
          branch_name: s.branch_name,
          base_sha: s.base_sha,
          pr_number: s.pr_number,
          setup_error: s.setup_error,
          setup_started_at: s.setup_started_at,
          takeover_started_at: s.takeover_started_at,
          takeover_base_sha: s.takeover_base_sha,
          takeover_branch: s.takeover_branch,
          takeover_token: s.takeover_token,
          takeover_token_expires_at: s.takeover_token_expires_at,
          // Preserve archive state from the source chat — don't silently
          // revive a dead work artifact.
          status: s.status === 'archived' ? 'archived' : 'active',
          archived_at: s.status === 'archived' ? (s.archived_at ?? s.started_at) : null,
          created_at: s.started_at ?? new Date().toISOString(),
          updated_at: s.started_at ?? new Date().toISOString(),
        })
        .run();

      tx.update(chatSessions)
        .set({ execution_id: executionId })
        .where(eq(chatSessions.id, s.id))
        .run();
    });

    // Read back and verify outside the tx — catches a column-name typo
    // in the insert path early instead of silently dropping data.
    const verified = db.select().from(executions).where(eq(executions.id, executionId)).get();
    if (!verified) {
      throw new Error(`Verification failed: execution ${executionId} not found after insert (chat ${s.id})`);
    }
    for (const field of LIFTED_FIELDS) {
      const got = (verified as Record<string, unknown>)[field];
      const want = (s as Record<string, unknown>)[field];
      if (got !== want) {
        throw new Error(
          `Verification failed: ${field} mismatch for chat_session ${s.id} ` +
            `(execution has ${JSON.stringify(got)}, chat had ${JSON.stringify(want)})`,
        );
      }
    }

    manifest.push({ chat_session_id: s.id, execution_id: executionId, status: 'migrated' });
  }

  // getAppRoot() respects FLOW_ROOT, so backups land beside the brain dir
  // for whichever environment we're targeting (never inside brain/, which
  // is user-content territory). Node doesn't expand ~ — build the path.
  const backupsDir = path.join(getAppRoot(), 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const manifestPath = path.join(backupsDir, `executions-migration-${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const migrated = manifest.filter((m) => m.status === 'migrated').length;
  const already = manifest.filter((m) => m.status === 'already_migrated').length;
  const skipped = manifest.filter((m) => m.status === 'skipped_no_workspace').length;

  console.log(`[migrate-executions] done — ${migrated} migrated, ${already} already migrated, ${skipped} skipped (no workspace)`);
  console.log(`[migrate-executions] manifest: ${manifestPath}`);
}

migrate();
