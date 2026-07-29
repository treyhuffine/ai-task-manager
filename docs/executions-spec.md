# Executions as a Separate Primitive

Status: spec, lands before async-agents-v1 implementation begins
Date: 2026-05-26

---

## TL;DR

Lift execution-flavored columns off `chat_sessions` into a new `executions` table. A chat session optionally belongs to an execution (`execution_id` FK, nullable). An execution can have many chats.

What this enables:
- **The "fresh chat, same worktree" pattern** for recurring scheduled work — solves the persistent-session context-bloat problem.
- Side conversations and review threads against the same git artifact.
- Cleaner data model: chat_sessions stops being overloaded with git/worktree state.

What we're not doing:
- No user-visible "Executions" page in v1 (deferred). Executions are an implementation detail of how chats group.
- No multi-chat UI in v1 (deferred). Schema supports it; UI surfaces it later.
- No hard-deletes in product code — archive only. The destructive FK cascades are safety nets, not the happy path.

The work lands **before** the async-agents-v1 dispatch task, because the dispatch logic needs to know how executions and chats relate.

---

## Implementation status (landed 2026-05-26)

The non-destructive half of this spec is **implemented and verified** (typecheck clean, full test suite 277/277 green, end-to-end migration verified on an isolated DB).

**Landed:**
- `executions` table + `chat_sessions.execution_id` (Drizzle migration `0018_nosy_lily_hollister.sql`, additive only — legacy columns retained).
- Query-layer bridge: `getChatSessionWithExecution` (read) + named write helpers (`markExecutionSetupStarted/Complete`, `record/clearExecutionSetupError`, `setExecutionPR`, `start/clearExecutionTakeover`, `archive/unarchiveExecution`) + `createExecutionWithChat` (eager, atomic) + `findChatSessionByTakeoverToken` + `listStuckBootstrapExecutions`. `listChatSessions`/`listRailSessions`/`listHistorySessions` flatten the execution.
- All server consumers rewired (dispatch, workspace provisioning, every `/api/sessions/[id]/*` git route, both `/api/takeover/[token]/*` routes, executor adapter `resolveCwd`/`dispatch`, reconcile reaper). Client reads unchanged at runtime (server serializes the flattened shape); client response types now extend `ChatSessionWithExecution`.
- `scripts/migrate-executions.ts` (idempotent backfill) + `scripts/check-executions-migration-complete.ts` (go/no-go gate).

**Implementation notes / deviations from the prose above:**
- The bridge and migration are **synchronous** (this codebase's better-sqlite3 + Drizzle layer is sync); the `async`/`await` in §3.1 and §3.3 below is illustrative.
- Migration backups land in `getAppRoot()/backups` (respects `FLOW_ROOT`), not a hardcoded `~/flow/.work/backups`.
- `chat_sessions.workspace_id` ↔ `executions.workspace_id` consistency (§2.2, §10) is guaranteed **by construction** in `createExecutionWithChat` (both set from one param) rather than a runtime assert.
- **Worktree provisioning timing:** the manual workspace path (`dispatchExecutionSession`, used by the "new session" button) provisions the worktree **eagerly** at chat creation — preserved existing behavior, so the git UI goes straight to "setting up." The "not started → setting up" split in §5 is a target model; the data model (and the bare `createExecutionSession` path) support it, but the manual button stays eager. Truly-lazy manual provisioning is a deferred UX change, not part of this lift.
- **The client may pick the session id.** `POST /api/workspaces/:id/sessions` accepts an optional `sessionId` (validated as a UUID, rejected with 400 otherwise) and `dispatchExecutionSession` uses it in place of minting one. This exists so the launcher can navigate to the new execution before the create resolves rather than holding a spinner through a round-trip that queues behind the app's open SSE streams. `src/lib/executions/start-execution.ts` is the single client entry point, and `pending-launch.ts` is how `useSession` is taught to wait out the window where the row does not exist yet. Every other session endpoint (stream, events, runtime-status, reconcile) already tolerates an unknown id, so only the session read needed teaching.
- **No half-migrated runtime fallback.** Single-user, no backward-compat: the migration runs with the app stopped, so the app only ever boots against a fully-migrated DB. The bridge treats the execution as the sole source of truth (no fallback to the still-present legacy columns).

**Deferred to async-agents-v1 (per §8), not in this lift:** `runs.execution_id`, `schedules.owning_execution_id`, `chat_sessions.created_by_run_id`, removal of `session_strategy`, the execution-level run mutex (§5), and the kind/target_kind dispatch resolution (§6) — all depend on the `runs`/`schedules` tables that don't exist yet. Per-chat takeover association (so the resume handoff lands in the exact initiating chat under multi-chat) is also deferred — v1 is 1:1 so "most-recently-active chat" is correct today.

**Follow-up (drop the old columns):** the data backfill stays a one-shot **script** (`scripts/migrate-executions.ts`) — no hand-written SQL in the migration files. When ready, optionally run `scripts/check-executions-migration-complete.ts` as a sanity check, then remove the lifted fields from `src/lib/db/schema.ts` (+ the `history-view.test.ts` mock) and `pnpm db:generate` for a clean **generated** drop migration. Client/bridge types already model the post-drop shape, so the drop is a clean schema-only change.

---

## 1. Why now

Two problems converging:

**(a) `chat_sessions` is overloaded.** It carries two distinct lifecycles:
- **Durable work artifact** (worktree, branch, base_sha, takeover state, PR linkage, setup state)
- **Per-conversation state** (external_session_id, transcript_path, permission_mode, model/effort, unread machinery)

These have different lifecycles. The git artifact survives across multiple conversations; the conversation is a single work session against it.

**(b) Async-agents-v1's "persistent session" has a context-bloat problem.** Persistent sessions grow forever; Claude Code's auto-compaction is the only safety net. The honest fix is to keep the work artifact persistent but start fresh chats — which requires this split.

Doing the lift now (before the dispatch path is wired) is meaningfully cheaper than doing it later, because the dispatch logic gets written once with the right shape rather than refactored.

---

## 2. Schema shape

### 2.1 New table: `executions`

```ts
export const executions = sqliteTable('executions', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().default('local'),

  // What this execution is anchored to. Required — executions are
  // workspace work artifacts. Orchestrator/content chats don't have
  // executions (their chat_sessions.execution_id is NULL).
  //
  // CASCADE: workspace deletion takes its executions with it. The
  // transitive cascade to chats is broken at chat_sessions.execution_id
  // (SET NULL) so transcripts survive the workspace deletion as
  // orphaned-but-readable history.
  workspace_id: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),

  // Optional label. Most executions don't need one; recurring schedule
  // executions might be labeled "morning-triage" etc. for the UI.
  label: text('label'),

  // Durable git state — lifted from chat_sessions. All nullable
  // because executions exist before worktree provisioning completes
  // (and non-git workspaces never get these set).
  worktree_path: text('worktree_path'),
  branch_name: text('branch_name'),
  base_sha: text('base_sha'),

  // PR linkage — lifted from chat_sessions
  pr_number: integer('pr_number'),

  // Worktree provisioning state — lifted from chat_sessions
  setup_error: text('setup_error'),
  setup_started_at: text('setup_started_at'),

  // Takeover lifecycle — lifted from chat_sessions
  takeover_started_at: text('takeover_started_at'),
  takeover_base_sha: text('takeover_base_sha'),
  takeover_branch: text('takeover_branch'),
  takeover_token: text('takeover_token'),
  takeover_token_expires_at: text('takeover_token_expires_at'),

  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),

  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  archived_at: text('archived_at'),
}, (table) => [
  index('idx_executions_workspace_status').on(table.workspace_id, table.status),
  uniqueIndex('uniq_executions_takeover_token')
    .on(table.takeover_token)
    .where(sql`${table.takeover_token} IS NOT NULL`),
]);
```

**No `owning_schedule_id` on this table.** Ownership lives on the schedules table — see §2.3.

### 2.2 Changes to `chat_sessions`

**Removed columns** (move to `executions`):
- `worktree_path`, `branch_name`, `base_sha`
- `pr_number`
- `setup_error`, `setup_started_at`
- `takeover_*` (all 5)

**Kept on chat_sessions** (per-conversation state):
- `external_session_id`, `external_transcript_path`, `external_sync_offset`, `external_sync_last_event_id`
- `permission_mode`, `model`, `effort`, `pre_plan_mode`
- `scratch_pad`
- `last_outcome_event_at`, `last_viewed_at`, `unread_marker_at`
- `surface_kind`, `surface_ref` (for content chats)
- `created_by_run_id` — **renamed** from the previously-proposed `triggered_by_run_id`. The column means "the run that created this chat," not "the run this chat is about." A chat can host multiple subsequent runs (initial → iterate → re-iterate); those are tracked via `runs.chat_session_id`, not by overloading this field.

**Kept and made redundant-but-useful** (denormalization for query convenience):
- `workspace_id` — stays on chat_sessions. Should match the execution's workspace_id when execution_id is set. Query-layer assert enforces.

**New column:**
- `execution_id: text('execution_id').references(() => executions.id, { onDelete: 'set null' })` — nullable. NULL for content and orchestration chats. NOT NULL for type='execution' chats.
- **`onDelete: 'set null'`** is deliberate: if an execution is ever hard-deleted, the chats survive as orphaned-but-readable transcripts. Product code never hard-deletes executions (archive only); this is a safety net.

**`type` discriminator:** stays. Useful for queries and existing code paths. Don't bother dropping.

**Invariant on `execution_id`:** active execution chats have `execution_id IS NOT NULL`. Two exceptions:
- *Historical* chats whose execution was hard-deleted (e.g., the workspace was deleted) — the `ON DELETE SET NULL` cascade nulls the FK to preserve the transcript; `type='execution'` stays as a historical marker. These chats are read-only artifacts.
- *Pending* chats mid-creation are vanishingly rare in practice because execution + chat are created together (§5), but if a crash happens between the two inserts, an orphan can exist briefly. The migration uses a transaction (§3.1) to prevent this for the lift; the live dispatch path should too.

So the precise invariant is: `type='execution' AND status='active' AND execution NOT hard-deleted` → `execution_id IS NOT NULL`. Orphaned historical rows are allowed.

### 2.3 Schedule ↔ execution ownership

For recurring schedules that want "fresh chat, same execution" semantics, the schedule needs to know which execution it owns. The FK lives on the schedules table (defined in async-agents-v1):

```ts
// In schedules table (async-agents-v1 schema):
owning_execution_id: text('owning_execution_id')
  .references(() => executions.id, { onDelete: 'set null' }),
```

This direction (schedule → execution) is intentional:
- An execution is a durable artifact; it can be referenced by many schedules. (Morning-triage and evening-summary writing into the same workspace artifact is plausible.)
- A schedule is a rule; it accumulates into at most one execution.
- No unique constraint needed — many schedules → one execution falls out for free.
- Cleanup is cleaner: deleting a schedule doesn't orphan an execution that other schedules still use.

When a recurring workspace schedule fires:
1. Look up `schedule.owning_execution_id`. If set AND the execution is `status='active'`, reuse it.
2. Otherwise: create a new execution, set `schedule.owning_execution_id`, continue.
3. Create a new `chat_session` with `execution_id = execution.id` and dispatch.

If `owning_execution_id` points to an archived execution, treat it as if NULL — create a new active execution. Archived = "do not reuse this work artifact." (See §6.)

For user-initiated executions, no schedule owns the execution.

For one-off (`kind='at'`) schedules, `owning_execution_id` stays NULL — one-offs never set it. History links from the schedule to what it ran flow through `runs.execution_id` (the run row records which execution it fired against). The schedule itself archives after firing; the run + execution + chat live on as historical artifacts.

---

## 3. Migration

Single-user data, my own. Doesn't need Drizzle migration ceremony — a one-shot Node script in `scripts/migrate-executions.ts`. But it does need to be safe.

### 3.1 The script

Idempotent, verifies as it goes, writes a manifest. Each row's insert + chat update happens inside a single transaction so a mid-row crash can't leave an orphan execution:

```ts
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

async function migrate() {
  const sessions = await db.select().from(chatSessions)
    .where(eq(chatSessions.type, 'execution'));

  const manifest = [];

  for (const s of sessions) {
    // Idempotency: already migrated
    if (s.execution_id) {
      manifest.push({ chat_session_id: s.id, execution_id: s.execution_id, status: 'already_migrated' });
      continue;
    }

    // Skip only if there's genuinely no workspace anchor. Null
    // worktree_path is legitimate — could be a pending git session
    // mid-provisioning or a non-git workspace.
    if (!s.workspace_id) {
      manifest.push({ chat_session_id: s.id, status: 'skipped_no_workspace' });
      continue;
    }

    const executionId = uuidv7();

    // Transactional: insert execution + update chat_session in one
    // atomic block via Drizzle's transaction callback. If anything
    // throws inside, both writes roll back and a rerun will see no
    // execution_id and try again.
    await db.transaction(async (tx) => {
      await tx.insert(executions).values({
        id: executionId,
        workspace_id: s.workspace_id,
        label: s.label,                                    // copy the visible name forward
        worktree_path: s.worktree_path,                    // may be null — fine
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
        // Preserve archive state from the source chat. If a chat was
        // archived, its execution is archived too — we're not silently
        // reviving dead work artifacts.
        status: s.status === 'archived' ? 'archived' : 'active',
        archived_at: s.status === 'archived' ? (s.archived_at ?? s.started_at) : null,
        created_at: s.started_at ?? new Date().toISOString(),
        updated_at: s.started_at ?? new Date().toISOString(),
      });

      await tx.update(chatSessions)
        .set({ execution_id: executionId })
        .where(eq(chatSessions.id, s.id));
    });

    // Read back and verify outside the transaction (cheap, catches
    // any column-name typo in the insert path early)
    const verified = db.select().from(executions)
      .where(eq(executions.id, executionId)).get();
    const fieldsToCheck = [
      'worktree_path', 'branch_name', 'base_sha', 'pr_number',
      'setup_error', 'setup_started_at',
      'takeover_started_at', 'takeover_base_sha', 'takeover_branch',
      'takeover_token', 'takeover_token_expires_at',
    ];
    for (const field of fieldsToCheck) {
      if (verified[field] !== s[field]) {
        throw new Error(`Verification failed: ${field} mismatch for chat_session ${s.id}`);
      }
    }

    manifest.push({ chat_session_id: s.id, execution_id: executionId, status: 'migrated' });
  }

  // Path expansion: Node doesn't expand ~ in fs paths. Build the path
  // properly and ensure the directory exists.
  const backupsDir = path.join(os.homedir(), 'flow', 'backups');
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.writeFile(
    path.join(backupsDir, `executions-migration-${Date.now()}.json`),
    JSON.stringify(manifest, null, 2),
  );
}
```

### 3.2 Safe migration sequence

```bash
# 1. Stop the app (Ctrl-C any running `pnpm dev` / `flow start`)

# 2. Backup before schema migration
mkdir -p ~/flow/.work/backups
sqlite3 ~/flow/data.db \
  ".backup ~/flow/.work/backups/data.db.pre-executions-schema-$(date +%Y%m%d-%H%M%S)"

# 3. Apply schema migration (add executions table + chat_sessions.execution_id)
pnpm db:migrate

# 4. Backup before running the data script
sqlite3 ~/flow/data.db \
  ".backup ~/flow/.work/backups/data.db.pre-executions-script-$(date +%Y%m%d-%H%M%S)"

# 5. Run the migration script
pnpm tsx scripts/migrate-executions.ts

# 6. Start the app, dogfood for a few days

# 7. Backup before destructive migration (column drops)
sqlite3 ~/flow/data.db \
  ".backup ~/flow/.work/backups/data.db.pre-executions-drop-$(date +%Y%m%d-%H%M%S)"

# 8. Pre-check
pnpm tsx scripts/check-executions-migration-complete.ts

# 9. Apply destructive migration (drop legacy columns)
pnpm db:migrate
```

Backups land in `~/flow/.work/backups/` (machine-local scratch — never synced, safe to delete). Use `sqlite3 .backup` (not raw `cp`) because better-sqlite3 runs in WAL mode and naive cp can miss un-checkpointed writes in the `-wal` sidecar.

Recovery for any step: `cp ~/flow/.work/backups/data.db.<tag> ~/flow/data.db && rm ~/flow/data.db-{wal,shm}`.

### 3.3 Query-layer bridge — reads AND writes

Reads are the visible problem (every `session.worktree_path` access has to flow through the joined shape). Writes are the *silent* problem: it's very easy to forget that updating `setup_error` now means writing to the execution row, not the chat row. To prevent code from accidentally preserving old write paths, introduce a complete read+write bridge in `src/lib/db/queries.ts`.

**Read helper** (flattened shape, drop-in for existing call sites):

```ts
export async function getChatSessionWithExecution(id: string) {
  const row = await db
    .select({
      ...getTableColumns(chatSessions),
      execution: getTableColumns(executions),
    })
    .from(chatSessions)
    .leftJoin(executions, eq(chatSessions.execution_id, executions.id))
    .where(eq(chatSessions.id, id))
    .get();

  if (!row) return null;

  return {
    ...row,
    worktree_path: row.execution?.worktree_path ?? null,
    branch_name: row.execution?.branch_name ?? null,
    base_sha: row.execution?.base_sha ?? null,
    pr_number: row.execution?.pr_number ?? null,
    setup_error: row.execution?.setup_error ?? null,
    setup_started_at: row.execution?.setup_started_at ?? null,
    takeover_started_at: row.execution?.takeover_started_at ?? null,
    // ... rest of takeover_* etc
  };
}
```

Existing consumers in dispatch, action routes, setup cards, headers, file tree, terminal, takeover, etc. switch from `getChatSession(id)` to `getChatSessionWithExecution(id)` — a one-line change per call site — and keep reading the same field names.

**Write helpers** (named per-mutation, to force callers across the boundary):

```ts
// Setup / provisioning
markExecutionSetupStarted(executionId: string)
markExecutionSetupComplete(executionId: string, params: { worktree_path: string; branch_name: string; base_sha: string })
recordExecutionSetupError(executionId: string, error: string)
clearExecutionSetupError(executionId: string)  // on retry

// PR linkage
setExecutionPR(executionId: string, prNumber: number | null)

// Takeover lifecycle (all five columns move together)
startExecutionTakeover(executionId: string, params: { token: string; branch: string; base_sha: string; expires_at: string })
clearExecutionTakeover(executionId: string)

// Archive / unarchive (cascades to chats in product code, not at DB level)
archiveExecution(executionId: string)
unarchiveExecution(executionId: string)
```

Call sites that must be updated to use these:

| Concern | File / surface | Helper |
|---|---|---|
| Worktree provisioning | `src/lib/workspaces/*` | `markExecutionSetupStarted`, `markExecutionSetupComplete`, `recordExecutionSetupError` |
| Setup retry | Setup card / chat header | `clearExecutionSetupError` + provisioning helpers above |
| PR open / link | Action bar handlers | `setExecutionPR` |
| Takeover start | Takeover endpoint | `startExecutionTakeover` |
| Takeover resume / cancel | Takeover endpoint | `clearExecutionTakeover` |
| Archive | Action bar / settings | `archiveExecution` (cascades to chats in queries layer) |

This is the rigorous way to do the lift: every read path goes through the bridge helper, every write path goes through a named mutation. The migration completes when no consumer still touches `chat_sessions.worktree_path` etc. directly — `grep` confirms this before the destructive column-drop migration.

---

## 4. How chats relate to executions

**One-to-many.** One execution has many chats; one chat belongs to at most one execution.

**The "primary" chat of an execution** (when UI needs to default-select one):
- Most recently active by `last_outcome_event_at`
- Where `status='active'` (not archived)
- **Primary chat is a default, not the only addressable chat.** Run-history links and any UI that names a specific chat (e.g., "view the run from morning-triage that fired Tuesday") always open the exact `runs.chat_session_id`. The primary-chat rule only governs what to show when the user navigates *to the execution* without a more specific target.

**Chat lifecycle within an execution:**
- New chats always go to the same execution unless the user explicitly forks (deferred)
- Archiving a chat doesn't archive the execution
- Archiving the execution archives all its chats (cascade in product code, not DB-level)

**Cross-references that already exist:**
- `runs.chat_session_id` (per async-agents-v1) — a run targets a specific chat.
- `runs.workspace_id` — denormalized for queries.
- New: `runs.execution_id` — denormalized, populated at dispatch time. Lets us roll up cost per execution cheaply.

---

## 5. Execution lifecycle

The shape was implicit in earlier drafts; making it explicit:

**Created eagerly when a chat opens. Worktree provisioned lazily at first dispatch.** The two are deliberately separate.

When the user clicks "new chat" in a workspace (or a schedule fires for the first time):
1. In a transaction: create the **execution row** with `workspace_id` set; `worktree_path`, `branch_name`, `base_sha` all NULL; `status='active'`. Create the **chat_session row** with `execution_id` pointing to it.
2. The execution exists as a known-but-unprovisioned artifact. UI shows the chat in a "not started" state — distinct from "setting up" (see below).

When the first run against the execution actually starts:
1. The provisioning code (existing — `src/lib/workspaces/*`) writes `setup_started_at` on the execution and begins. UI shows "setting up."
2. On success: write `worktree_path`, `branch_name`, `base_sha` to the execution. UI shows the running state.
3. On failure: write `setup_error`. UI shows "setup failed" with retry.

The four distinct UI states the lifecycle implies. Note the `is_git` split — non-git workspaces never have a worktree to provision, so they're ready as soon as they exist.

| State | Indicators | Meaning |
|---|---|---|
| Not started | `setup_started_at IS NULL AND worktree_path IS NULL AND setup_error IS NULL` (git only) | Git workspace chat exists; nothing has run yet |
| Setting up | `setup_started_at IS NOT NULL AND worktree_path IS NULL AND setup_error IS NULL` (git only) | First dispatch in flight; worktree provisioning is happening |
| Ready | `!workspace.is_git OR worktree_path IS NOT NULL` | Either non-git (always ready — agent operates from `workspace.cwd`) or git with worktree provisioned |
| Setup failed | `setup_error IS NOT NULL` (git only) | Provisioning errored; user can retry |

The readiness predicate is the canonical check anywhere the UI or dispatch path asks "can a run start here." Non-git executions skip the not-started → setting-up → ready transitions entirely; they're born ready. The execution's `worktree_path` stays NULL for non-git, and dispatch reads `workspace.cwd` directly when `!workspace.is_git`.

This matches today's behavior (the chat row exists before provisioning; worktree_path is NULL until setup completes). The lift moves the columns and makes the distinction between "haven't tried yet" and "trying" explicit.

**Subsequent chats in the same execution skip provisioning entirely.** That's the entire point of the split.

**Archive behavior:**
- Archiving an execution sets `status='archived'`, `archived_at`. Product code never hard-deletes.
- Archiving cascades to all the execution's chats (set their status to archived too).
- Schedules with `owning_execution_id` pointing at an archived execution treat it as if NULL: the next fire creates a fresh active execution and updates `owning_execution_id`. "Archived" means "do not reuse this work artifact."
- The archived execution row, its chats, and their transcripts are preserved as history — visible in archive views, hidden from default queries.

**In-flight runs at the moment of archival:** allowed to complete normally. The run finalizer just doesn't trigger any new chat activity.

**Workspace hard-deletion** (rare, destructive, opt-in): cascades through `executions.workspace_id` (CASCADE) and removes the executions. The chats survive as orphaned (`execution_id` set to NULL by the SET NULL on the chat_sessions FK). Transcripts preserved as historical record without their git artifact context.

**Execution-level run concurrency.** Because many schedules can point at one execution, two schedules could fire into the same execution at the same time — and both would mutate the same worktree concurrently. The schedule-level `concurrency_policy` only protects against the *same* schedule firing twice; it doesn't protect against *different* schedules sharing an execution.

V1 rule: **at most one workspace run per execution may be in `running` status at any time.** Enforced at dispatch:

- Before dispatch, check `runs WHERE execution_id = E AND status = 'running'`. If any exist, the new fire defers per the firing schedule's `concurrency_policy`:
  - `skip_if_running` → record the run as `status='skipped'`, `status_reason='execution_busy'`
  - `coalesce_if_active` → append a follow-up message to the active run's chat (or the schedule's intended chat — open question, decide at build time)
  - `allow_concurrent` → in V1, treat as `skip_if_running` for workspace targets and log a warning that the policy isn't honored at the execution level. Genuine parallelism per execution is a v2 feature when we know what semantics we want.

Manual sends from the chat UI are **not** gated by this mutex. Concurrent sends are a first-class feature: a follow-up reuses the chat's cached AgentSession (the same subprocess) and rides the provider's native queue (Claude drains it as a `<system-reminder>` on the next tool result; Codex merges it into the active turn). Gating them on a `running` run rejected the user's own in-flight `trigger='manual'` turn — and the rejection text misattributed it to a scheduled run, since the check never inspected the blocker's trigger. The mutex above is scoped to *scheduled* dispatch (schedule-vs-schedule worktree contention), which always spawns its own fresh chat/subprocess. Cross-process contention between a scheduled run and a concurrent manual send against the same worktree is a known, accepted gap in V1 (rare in practice; a narrower different-chat guard or coalesce is the V2 option if it bites).

The mutex check is a cheap indexed query; `runs(execution_id, status)` index makes it constant-time.

---

## 6. How dispatch resolves executions

V1 has **no `session_strategy` enum**. Behavior is derived from `schedules.kind` and `schedules.target_kind`. Three deterministic branches:

```
if target_kind == 'orchestrator':
    no execution (orchestrator chats have execution_id=NULL)
    create a new chat_session each fire
elif kind == 'at':
    create a new execution + new chat_session each fire
    one-off schedule; no owning_execution_id to update
else:  # recurring workspace (cron / every / interval)
    look up schedule.owning_execution_id
    if pointer is null OR the execution is archived:
        create a new active execution, set schedule.owning_execution_id
        first dispatch will provision the worktree
    else:
        reuse the existing active execution
        (worktree already provisioned; branch is wherever the last run left it)
    create a new chat_session inside it
```

**Why this is the right default for V1:**

- Recurring workspace work wants the *artifact* (worktree, branch, PR) to persist while keeping the *conversation* bounded. Branch persists, commits stack up across fires, PR keeps iterating; fresh chat each fire means the agent reads CLAUDE.md and MEMORY.md, not a 200-turn history.
- One-off schedules (`kind='at'`) genuinely want everything fresh — nothing to reuse.
- Orchestrator schedules don't have a workspace artifact to preserve — fresh chat each fire is the only sensible default.

This matches what OpenClaw, Hermes, Paperclip, GBrain, and Claude Code Routines all do: fresh sessions per run, artifacts persist via files.

**What we explicitly don't support in V1:**

- **"Continuous" mode** (reuse both execution *and* chat across fires) is not exposed. It's a foot-gun — conversations grow forever, Claude's compaction does opaque work, early-fire context loses fidelity. If a real use case emerges in V2, add a `continuous_chat` boolean on `schedules`; existing schedules stay on derived behavior, new schedules can opt in. Pure additive change.
- **"New execution per fire" on recurring schedules.** There's no clean workaround — the user wanting this should create the schedule as `kind='at'` and have something else re-create it, or accept that recurring workspace schedules accumulate. If a real use case emerges, add the knob in v2.

**Adding configurability back in V2 is non-breaking:** new nullable column, existing rows fall through to derived behavior. We're deferring the knob until we have data on whether it's wanted.

---

## 7. UX hierarchy for execution state (deferred, captured)

When multiple chats exist per execution, the execution surface needs a way to roll up state. **Deferred from v1 implementation but captured here so the schema supports it.**

V1 chat states:
- `active` — a run is in flight right now (existing in-process tracking)
- `unread` — `last_outcome_event_at > last_viewed_at`
- `idle` — no in-flight run, no unread
- `archived` — hidden by default

**Priority order (highest attention → lowest):** active > unread > idle > archived.

**Rollup rule:** execution's displayed state = highest-priority state among its non-archived chats. Plus a small count badge if multiple chats are in non-idle states (e.g., "execution has 3 unread chats" → "+3").

**V2 addition:** when the multi-state action protocol lands (`needs_input`, `blocked`), `needs_input` slots in above `active` in the priority order. `blocked` slots between unread and idle.

No schema changes needed for any of this. The query is "for execution E, return chats grouped by state, sorted by priority." Cheap. Build when UI surfaces multi-chat-per-execution.

---

## 8. Impact on async-agents-v1

The build order grows by one task at the beginning, and three existing tasks change.

### New task (lands before async-agents-v1 task #9)

**Executions lift** (new pre-#9, tracked as task #26 in the task pane)
- Add `executions` table per §2.1
- Add `chat_sessions.execution_id` FK (nullable, ON DELETE SET NULL)
- The renamed `chat_sessions.created_by_run_id` (vs old `triggered_by_run_id`) lands with task #9's schema migration, not here — they're independent additions
- Run `scripts/migrate-executions.ts` (idempotent, per §3.1)
- Add `getChatSessionWithExecution` bridge helper + named write mutations in `queries.ts` (per §3.3)
- Update consumers to use the bridge helper and named writes: `src/lib/workspaces/*`, `src/lib/executor/adapter.ts`, action bar handlers, execution view UI, takeover endpoint, setup card retry
- Pre-check script `check-executions-migration-complete.ts` verifies no consumer still reads/writes lifted columns directly
- Follow-up Drizzle migration: drop the lifted columns from `chat_sessions`
- **Estimated effort:** ~1 week.

### Changes to existing tasks

**Task #9 (schema migrations)** — additions:
- Add `runs.execution_id` (nullable FK to executions, populated for workspace-target runs)
- Add `runs(execution_id, status)` index for the execution-level mutex check
- Add `schedules.owning_execution_id` (nullable FK to executions, ON DELETE SET NULL) — see §2.3
- Add `chat_sessions.created_by_run_id` (renamed from `triggered_by_run_id`)
- **Remove** `schedules.session_strategy` from the original V1 design — behavior is now derived from `kind` + `target_kind` per §6

**Task #11 (scheduled-run dispatch path)** — meaningful changes:
- Resolve target execution before chat creation, branching on `kind` and `target_kind` per §6
- For recurring workspace schedules, the lookup is `schedule.owning_execution_id` (direct FK on the row already loaded) — not a query against the executions table
- Worktree provisioning is lazy — kicked off at first dispatch against the execution (§5), not when the execution row is first created
- Enforce the execution-level run mutex (§5) — check `runs WHERE execution_id = E AND status = 'running'` before dispatching, defer per schedule's `concurrency_policy`

**Task #21 (runs view extension)** — small additions:
- Trigger badge in the chat header still shows schedule provenance (via `created_by_run_id` chain to schedule)
- The execution view UI reads worktree/branch/PR from `executions` via the bridge helper from §3.3
- Multi-chat-per-execution UI deferred — V1 renders the primary chat (most-recently-active non-archived) per §4

**Task #12 (instrument manual dispatch to create runs row)** — affected:
- For workspace chats (`execution_id IS NOT NULL`), populate `runs.execution_id` on insert
- Manual sends are **not** gated by the execution-level run mutex (§5) — concurrent sends ride the provider's native queue (see §5 note). The mutex applies to scheduled dispatch only.
- For orchestrator/content chats (`execution_id IS NULL`), no execution_id population, no mutex

All other tasks (#10, #13–#20, #22–#25) are unaffected by the executions lift specifically.

### Updated total effort estimate

- Original: 4–6 weeks
- With executions lift: 5–7 weeks

The extra week buys: cleaner data model, fix for the persistent-session context-bloat problem, foundation for multi-chat-per-execution patterns when wanted.

---

## 9. What we explicitly don't build (yet)

Putting these in writing so they don't sneak back in:

1. **A user-visible "Executions" tab or page.** Executions surface through the existing 4-col execution view. No separate navigation primitive.
2. **A CLI verb for executions** (`flow execution list/show`). Keep CLI on chats and runs.
3. **Forking executions** (duplicate this execution with a new branch). Maybe useful eventually; not now.
4. **Cross-execution chat references.** A chat belongs to at most one execution. No multi-execution chats.
5. **Execution-level cost rollup as its own surface.** Rollup is computable from `runs.execution_id`, surfaced in the schedule detail page or the activity timeline. Not a separate page.
6. **Hard-delete in product code.** Archive only. The destructive FK cascades are safety nets, not the happy path.
7. **Execution-level standing instructions.** No `EXECUTION.md` file. The execution shares the workspace's CLAUDE.md and the brain's MEMORY.md; that's enough.
8. **Multi-chat UI in v1.** Schema supports it; the actual chat selector / tab strip is deferred. V1 shows the primary chat per the rules in §4.
9. **Continuous chat mode** for recurring schedules. Foot-gun, not built. See §6.

---

## 10. Tradeoffs we accept

- **More indirection in the data model.** Every read of "what worktree does this chat belong to" is now a join. The bridge helper in §3.3 absorbs this for migration purposes; long-term, joins are cheap in SQLite.
- **One-time migration cost.** ~1 week of work for the lift + script + consumer updates + bridge helper.
- **Asymmetric cascade rules.** `workspaces.id → executions.workspace_id` is CASCADE (workspace deletion takes its work artifacts). `executions.id → chat_sessions.execution_id` is SET NULL (orphan, preserve transcripts). The asymmetry is deliberate: transcripts are the historical record, work artifacts are not.
- **Redundant `chat_sessions.workspace_id`** that mirrors `executions.workspace_id` for chats with `execution_id`. Worth keeping for query convenience. Query-layer assert enforces consistency.
- **No `continuous` mode means some niche use cases require schedule-prompt workarounds.** Acceptable for v1; revisit if patterns emerge.

---

## 11. Open questions

1. **Default `permission_mode` / `model` / `effort` when the user creates a chat against an existing execution (UI deferred).** Probably inherit from the most-recent chat in that execution for continuity. Decide at UI build time.

2. **What if a user manually pushes to the branch of an execution outside the app?** The execution's `base_sha` becomes stale. Same problem as today; no worse. Out of scope.

3. **Execution renaming / labeling.** `executions.label` is optional and probably never user-set in v1. If multi-chat-per-execution becomes common, users might want to label executions. Defer until needed.

4. **Coalesce-into-which-chat under execution-level concurrency.** When schedule A fires while schedule B (different schedule, same execution) has a `running` run, and A's `concurrency_policy = coalesce_if_active`, do we append A's prompt to B's active chat, or to a chat that A "owns" if any? Probably: append to the active run's chat (the agent is there, the worktree is in a known state), but flag the source schedule in the appended message so it's distinguishable in the transcript. Decide at build time.

---

## 12. The one-line version

> Lift the worktree / branch / PR / takeover columns off `chat_sessions` into a new `executions` table. A chat belongs to at most one execution. Schedules own executions via `schedules.owning_execution_id` (many-to-one). Recurring workspace schedules reuse the owned execution, fresh chat each fire (derived from kind + target_kind, no enum). Cascade chain breaks at chats to preserve transcripts. Lands before async-agents-v1 dispatch.

Everything else is variations on that theme.
