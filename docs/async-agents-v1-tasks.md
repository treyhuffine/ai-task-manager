# Async Agents V1 — Build Checklist

Companion to [`async-agents-v1.md`](./async-agents-v1.md). Each task has acceptance criteria you can check off as you go. Tasks are independent code units — finish one before moving to the next where dependencies are noted.

**How to use this doc:**
- Check the box `[ ]` → `[x]` as you complete each item.
- Top-level checkboxes are tasks (#9–#25 in the task pane). Sub-checkboxes are the concrete steps within.
- Suggested order is roughly top-to-bottom; explicit dependencies noted.
- Open a PR per task (or batch closely-related ones).

**Suggested build sequence:**

```
Lift first:    #26 (executions lift — per docs/executions-spec.md)
Foundation:    #9 (schema) → #10 (scheduler infra) → #19 (orchestrator actions)
Dispatch:      #11 (scheduled) + #12 (manual) — parallel
Telemetry:     #13 (cost) → #14 (artifacts) → #15 (summary)
Triggers:      #16 (webhook) → #17 (budget)
Independent:   #18 (skills) + #24 (decisions) — anytime
Surface:       #20 (UI) → #21 (runs view) → #22 (TopHud) → #23 (CLI)
Polish:        #25 (failure surfacing)
```

Estimated total: **5–7 focused weeks** (lift adds ~1 week to the original 4–6).

---

## #26 — V1: Executions lift (PRE-#9, lands first)

**Goal:** lift workspace artifact state (worktree, branch, PR, takeover) off `chat_sessions` into a new `executions` table. One execution can host many chat_sessions. Solves the persistent-session context-bloat problem and unlocks the "fresh chat, same worktree" pattern for recurring schedules.

**Spec:** [`docs/executions-spec.md`](./executions-spec.md)

**Files:**
- `src/lib/db/schema.ts` — add `executions` table, add `chat_sessions.execution_id`, rename `triggered_by_run_id` → `created_by_run_id` (if it exists at this point) or just use the right name when adding
- `scripts/migrate-executions.ts` — one-shot data migration (per spec §3.1)
- `scripts/check-executions-migration-complete.ts` — pre-flight check before the destructive column-drop migration
- `src/lib/db/queries.ts` — new bridge helper `getChatSessionWithExecution` + named write mutations (per spec §3.3)
- `src/lib/workspaces/*` — switch worktree state reads/writes to use the new helpers
- `src/lib/executor/adapter.ts` — switch worktree resolution to bridge helper
- Action bar handlers (`src/app/api/...`) for commit/push/PR/takeover
- Execution view UI components — read from bridge helper
- Setup card / chat header — use named write helpers for retry

**Steps:**
- [ ] Drizzle migration 1: add `executions` table per `executions-spec.md` §2.1 (workspaces CASCADE on workspace deletion, takeover-token partial unique index, all worktree fields nullable). **No `owning_schedule_id` on executions** — that FK lives on `schedules` (see task #9 / spec §2.3)
- [ ] Drizzle migration 1 cont'd: add `chat_sessions.execution_id` nullable FK with `ON DELETE SET NULL` (preserves transcripts when an execution is hard-deleted as a safety net)
- [ ] Write the bridge helper `getChatSessionWithExecution(id)` in `src/lib/db/queries.ts` per spec §3.3 — returns a flattened shape so existing call sites can swap `getChatSession(id)` → `getChatSessionWithExecution(id)` with no field-name changes
- [ ] Write named write helpers in `queries.ts` per spec §3.3: `markExecutionSetupStarted`, `markExecutionSetupComplete`, `recordExecutionSetupError`, `clearExecutionSetupError`, `setExecutionPR`, `startExecutionTakeover`, `clearExecutionTakeover`, `archiveExecution`, `unarchiveExecution`. These force every write across the boundary explicitly — avoid the "silent write problem" where someone updates `setup_error` on the wrong row
- [ ] Write `scripts/migrate-executions.ts` per spec §3.1 — idempotent, transactional inserts per row, read-back verification, manifest written to `~/flow/backups/executions-migration-<ts>.json`
- [ ] Follow the safe migration sequence in spec §3.2: stop app → `sqlite3 .backup` (NOT `cp` — better-sqlite3 runs WAL) → schema migration → backup → run script → dogfood → backup → destructive column-drop migration
- [ ] Update reads: switch all call sites that read worktree_path / branch_name / base_sha / pr_number / setup_* / takeover_* from `chat_sessions` to `getChatSessionWithExecution`. Grep each column name to find them all
- [ ] Update writes: switch all call sites that write those columns to the named write helpers from above
- [ ] Update UI: action bar, execution view header, takeover flow, file tree, terminal — read worktree state from the bridge helper
- [ ] Write `scripts/check-executions-migration-complete.ts` — grep verifies no consumer still touches the lifted columns on `chat_sessions` directly
- [ ] Drizzle migration 2 (destructive): drop the now-redundant columns from `chat_sessions` (worktree_path, branch_name, base_sha, pr_number, setup_error, setup_started_at, takeover_*). Run last, after the pre-check passes
- [ ] Verify `pnpm ts` passes and existing executions still work end-to-end (start an execution, commit, push, PR, takeover round-trip)

**Acceptance:**
- [ ] All three migrations apply cleanly to a fresh dev brain AND to a brain with existing data
- [ ] Existing execution sessions migrate cleanly (worktree/branch/PR/takeover state preserved per row, verified by read-back in the script)
- [ ] No code reads or writes worktree state from `chat_sessions` directly (grep + check script verify)
- [ ] An end-to-end execution (commit + push + PR + takeover round-trip) works identically post-lift
- [ ] A `chat_session` with `type='execution' AND status='active'` always has `execution_id` set; orchestrator/content chats have it NULL; historical orphaned chats (execution hard-deleted) may have `type='execution'` with `execution_id=NULL` (read-only artifact)
- [ ] Manifest file at `~/flow/backups/executions-migration-<ts>.json` documents every chat session's migration outcome

**Depends on:** nothing (lands first)

**Estimated effort:** ~1 week

**Why before #9:** the dispatch logic in #11 needs to know how executions and chats relate. Writing it after this lift means it's written once with the right shape — refactoring later would be more expensive than landing this first.

---

## #9 — Schema migrations

**Goal:** all V1 schema delta in one Drizzle migration.

**Files:**
- `src/lib/db/schema.ts` (additions per `async-agents-v1.md` §6)
- `drizzle/` (generated migration)

**Steps:**
- [ ] Add `schedules` table (all fields per §6 spec: `target_kind`, `owning_execution_id` (nullable FK to executions, ON DELETE SET NULL), `webhook_*`, `next_run_at`, `last_run_status` as typed enum, `consecutive_failures`). **No `session_strategy` or `persistent_session_id` columns** — dispatch behavior is derived from `kind` + `target_kind` per `docs/executions-spec.md` §6
- [ ] Add **two partial unique indexes** on `schedules` for name uniqueness — *not* a single composite (SQLite NULL handling). One for brain-level (`WHERE workspace_id IS NULL`), one for workspace-scoped (`WHERE workspace_id IS NOT NULL`)
- [ ] Add `runs` table (all fields per §6 spec, including `trigger` enum with `'manual'`, `execution_id` nullable FK to `executions`, `artifact_refs` JSON, simple status enum)
- [ ] Add `runs` indexes: `idx_runs_schedule_status`, `idx_runs_status_started`, `idx_runs_trigger_started`, `idx_runs_execution_status` (for the execution-level mutex check)
- [ ] Add `chat_sessions.created_by_run_id` FK (nullable, `ON DELETE SET NULL`) — the column means "the run that created this chat," not "the run this chat is about." Subsequent iterating runs go through `runs.chat_session_id`. `chat_sessions.execution_id` was already added by task #26 (the executions lift)
- [ ] Add `user_state.monthly_budget_usd` column (nullable real)
- [ ] Run `pnpm db:generate` to create the migration file
- [ ] Run `pnpm db:push` against `~/flow-dev` to verify it applies cleanly
- [ ] Verify Drizzle Studio shows the new tables / columns

**Acceptance:**
- [ ] Migration applies to a fresh dev brain without errors
- [ ] Test: insert two `schedules` rows with `workspace_id=NULL` and same `name` → second insert fails with unique constraint violation
- [ ] Test: insert two `schedules` rows with same `workspace_id` and same `name` → second insert fails
- [ ] Test: insert two `schedules` rows with same name, different `workspace_id` → both succeed

---

## #10 — Scheduler tick infrastructure

**Goal:** the foundation that drives the tick. No dispatch yet — just the plumbing.

**Files:**
- `src/lib/scheduler/lock.ts` — file-based lock
- `src/lib/scheduler/cron.ts` — croner wrapper + `computeNextRun()`
- `src/lib/scheduler/rate-lease.ts` — global semaphore
- `instrumentation.ts` — wire up the tick

**Steps:**
- [ ] `pnpm add croner`
- [ ] Implement `acquireSchedulerLock()` / `releaseSchedulerLock()` using a file at `<brain>/.scheduler.lock` (mode-flag `wx` open, fail-fast if another process holds it)
- [ ] Implement `computeNextRun(schedule, from)` covering all four `kind` values (`cron`, `every`, `at`, `webhook`). Webhook returns `null` (no time-based fires). Standardize on 5-field cron (reject 6-field)
- [ ] Implement `validateCronExpression(expr)` returning `{ valid, error? }`
- [ ] Implement `acquireApiLease()` / `releaseApiLease()` global semaphore (default capacity 4) — used to wrap all `@agentex/agent` invocations
- [ ] Add the 60s tick in `instrumentation.ts` next to the existing health sweep (under the same `if (process.env.NEXT_RUNTIME !== 'nodejs') return;` gate)
- [ ] Tick body: acquire lock → query due schedules (where `enabled=true AND next_run_at <= now`) → for each, **advance `next_run_at` first** (at-most-once) → check active-hours window (skip if outside) → spawn `dispatchRun()` without awaiting → release lock
- [ ] `interval.unref?.()` so the tick doesn't keep the process alive on shutdown

**Acceptance:**
- [ ] `computeNextRun` unit tests: cron, every, at, webhook variants; timezone honored; DST transition
- [ ] Lock unit tests: second `acquireSchedulerLock()` call while held returns null
- [ ] Active-hours unit test: schedule with `active_hours_start='09:00', active_hours_end='17:00'` skipped at 3am
- [ ] At-most-once test: simulate crash between advance and dispatch (kill mid-tick), restart, verify the schedule doesn't re-fire the missed slot
- [ ] Tick log line appears every 60s in dev server output

**Depends on:** #9

---

## #11 — Scheduled runs dispatch path

**Goal:** when the tick says "fire," actually fire something useful.

**Files:**
- `src/lib/scheduler/runner.ts` — `dispatchRun(schedule, triggerCtx)`

**Steps:**
- [ ] Implement `dispatchRun(schedule, { trigger, triggerPayload, scheduledFor })`:
  - **Resolve target execution** (derived per `docs/executions-spec.md` §6, FK lives on schedules):
    - `target_kind='orchestrator'`: no execution, create a fresh `chat_sessions` row (`type='execution'`, `execution_id=NULL`)
    - `target_kind='workspace'` and `kind='at'`: create a new `executions` row (status=active, worktree fields all NULL), then a fresh `chat_sessions` row inside it (`execution_id` set). One-offs do not set `schedule.owning_execution_id`
    - `target_kind='workspace'` and recurring (`cron`/`every`/`interval`): look up `schedule.owning_execution_id` directly from the row. If set AND the execution is `status='active'`, reuse it. If null OR the execution is archived, create a new active execution, set `schedule.owning_execution_id` to it, persist. Then create a fresh `chat_sessions` row inside the execution
  - **Worktree provisioning is lazy.** The execution row is created eagerly with worktree fields NULL. The existing provisioning code (`src/lib/workspaces/*`) kicks in at first dispatch against the execution — it sets `executions.setup_started_at`, runs the clone, sets `worktree_path`/`branch_name`/`base_sha` on success or `setup_error` on failure. Subsequent fires against the same execution skip provisioning entirely (this is the speed payoff of the lift)
  - **Execution-level run mutex check** (per executions-spec §5): before dispatch, query `runs WHERE execution_id = E AND status = 'running'` (uses `idx_runs_execution_status`). If any exists for a workspace target, the new fire defers per the firing schedule's `concurrency_policy`:
    - `skip_if_running`: record the run as `status='skipped'`, `status_reason='execution_busy'`
    - `coalesce_if_active`: append a follow-up message to the active run's chat with a source marker (`[from schedule <name>] ...`) — per V1 open question, may revisit
    - `allow_concurrent`: in V1, treat as `skip_if_running` for workspace targets and log a warning (true parallel execution mutation is a V2 feature)
  - Insert `runs` row with `status='queued'`, `trigger`, `scheduled_for`, `chat_session_id`, `execution_id` (denormalized from the resolved execution; NULL for orchestrator targets)
  - Set `chat_sessions.created_by_run_id` FK back to the new run
  - Schedule-level `concurrency_policy` check still applies for the *same* schedule firing twice (separate from the execution-level mutex)
  - Transition run to `running`, set `started_at`
  - Acquire API lease (from task #10), call `executor.dispatch(chat_session_id, schedule.prompt)`
  - Release lease on completion / error
  - On `result` event: status=`completed`, `finished_at`, populate cost/summary/artifacts (tasks #13/14/15)
  - On error: status=`failed`, `error_message`, `error_code`
- [ ] Handle catch-up: if scheduler picks up a schedule whose `next_run_at` is well past now and `catch_up_policy='run_all'`, fire up to `max_catch_up_runs` times sequentially (capped at 3)
- [ ] On startup, sweep `runs` in `status='running'` from prior process — promote to `failed` with `error_code='process_restart'`

**Acceptance:**
- [ ] Create a recurring workspace schedule → first fire creates a new execution + chat → second fire reuses the execution and creates a *new chat* inside it → both runs share `executions.id` but have distinct `chat_session_id`
- [ ] Create a `kind='at'` workspace schedule → fires create a new execution + chat (one-shot)
- [ ] Create an orchestrator schedule → fires create chats with `execution_id=NULL`
- [ ] `skip_if_running` test: two close-firing schedules with same id → second is `skipped`
- [ ] Crash recovery test: kill server while a run is in `running` → restart → run promoted to `failed`

**Depends on:** #26 (executions lift), #9, #10

---

## #12 — Instrument existing dispatch for manual runs

**Goal:** every chat send creates a `runs` row too. This is what makes `runs` *unified*.

**Files:**
- `src/lib/executor/adapter.ts` (modify existing `dispatch()`)

**Steps:**
- [ ] In `executor.dispatch(sessionId, message)`, after the user `chat_event` is inserted:
  - **Execution-level run mutex (workspace chats only):** if the session has `execution_id IS NOT NULL`, query `runs WHERE execution_id = E AND status = 'running'`. If any exists, reject the dispatch with a clear error returned to the chat UI ("A scheduled run is in flight; try again in a few seconds"). The user's message is *not* persisted as a run (their inputbox content can stay locally so they don't lose it, but the message doesn't enter the chat transcript yet). V1 default per open question — wait-then-drain is a V2 option
  - For chats with `execution_id IS NULL` (orchestrator/content), no mutex check — these don't share a worktree
  - Insert a `runs` row with:
    - `trigger='manual'`
    - `schedule_id=null`
    - `chat_session_id=sessionId`
    - `execution_id` = `chat_session.execution_id` (denormalized; NULL for orchestrator/content)
    - `agent_id` from the session's agent
    - `status='queued'`, then `'running'` when the subprocess actually spawns
- [ ] On terminal `result` event, populate cost/summary/artifacts (tasks #13/14/15) and set `status='completed'`
- [ ] On error: `status='failed'`, error fields
- [ ] Wrap the dispatch in the API lease from task #10 (manual + scheduled now share throughput control)

**Acceptance:**
- [ ] Send a chat message from the UI → confirm a `runs` row appears with `trigger='manual'`
- [ ] On completion, cost/tokens/summary populated identically to scheduled runs
- [ ] Verify `SELECT SUM(cost_usd) FROM runs` matches total spend across manual + scheduled

**Depends on:** #9, #10

---

## #13 — Cost capture from `@agentex/agent` result event

**Goal:** every run accurately reflects what it cost.

**Files:**
- `src/lib/pricing/models.json` — provider/model → cents per MTok
- `src/lib/pricing/models.ts` — loader + cost computation
- `src/lib/executor/adapter.ts` or wherever the result event is handled — capture usage

**Steps:**
- [ ] Create `src/lib/pricing/models.json` with current Anthropic prices for Sonnet/Haiku/Opus across 4.x/4.7. Use the form `{ "anthropic/claude-sonnet-4-6": { input: 300, output: 1500, cached: 30 } }` (cents per million tokens)
- [ ] Implement `costForUsage(model: string, usage: ModelUsage): number` — accepts `@agentex/agent`'s `ModelUsage` shape, returns USD
- [ ] In the dispatch result handler (both #11 and #12), parse `ExecutionResult.usage`/`costUsd`/`model` and write into the run:
  - `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`
  - `cost_usd` (prefer agentex's `costUsd` if non-null, else `costForUsage(model, usage)`)
  - `model`
- [ ] If multiple models were used in the run (subagent at different model), sum across all

**Acceptance:**
- [ ] Run a scheduled job that uses Sonnet → `runs.cost_usd` matches `usage.input_tokens * price + usage.output_tokens * price` within rounding
- [ ] Run a chat that uses Haiku → ditto
- [ ] `SELECT SUM(cost_usd) FROM runs WHERE date(started_at) = date('now')` returns a reasonable today-total

**Depends on:** #9, #11, #12

---

## #14 — Artifact-ref accumulator

**Goal:** every run knows what entities it produced. Inferred, not declared.

**Files:**
- Wherever the orchestrator's tool-use events are handled in the dispatcher

**Steps:**
- [ ] In the dispatch path, maintain an in-memory `Map<runId, ArtifactRef[]>` indexed by the currently-active run
- [ ] On every successful tool-use of a **mutating** registry action (per `Action.mutating === true` in `registry.ts`), push the result's id + kind into the run's accumulator:
  - `create_task` → `{ kind: 'task', id: result.id }`
  - `update_task` → `{ kind: 'task', id: result.id }`
  - `create_note` → `{ kind: 'note', id: result.id }`
  - `create_workspace` → `{ kind: 'workspace', id: result.id }`
  - `update_memory` → `{ kind: 'memory', id: 'MEMORY.md' }` (single sentinel; we can dedupe)
- [ ] Dedupe by `(kind, id)` — multiple updates to the same task = one ref
- [ ] On terminal `result` event, write to `runs.artifact_refs` as JSON, clear the in-memory entry

**Acceptance:**
- [ ] Run a schedule that creates 2 tasks + 1 note → `runs.artifact_refs` = `[{kind:'task',id:'...'},{kind:'task',id:'...'},{kind:'note',id:'...'}]`
- [ ] Run a schedule that updates the same task 3 times → `artifact_refs` has 1 entry, not 3
- [ ] Run a read-only schedule → `artifact_refs` is empty `[]`

**Depends on:** #9, #11, #12

---

## #15 — Summary auto-extract on terminal event

**Goal:** runs have a one-line "what happened" string for the timeline.

**Files:**
- Result event handler in dispatch path

**Steps:**
- [ ] On terminal `result` event, query the last `chat_event` for this session where `role='assistant'`
- [ ] Strip markdown to plaintext (a regex pass is enough — remove `*`, `_`, `#`, code fences, link syntax, leave the text)
- [ ] Take first ~200 chars, trim trailing whitespace, append `…` if truncated
- [ ] Write to `runs.summary`
- [ ] If no assistant message exists (run failed before responding), leave `summary` NULL

**Acceptance:**
- [ ] Successful run → `summary` populated with readable plaintext
- [ ] Failed run before any assistant turn → `summary` is null
- [ ] Long markdown reply → `summary` is clean plaintext under 210 chars with `…`

**Depends on:** #9, #11, #12

---

## #16 — Webhook intake endpoint

**Goal:** external services can trigger schedules.

**Files:**
- `src/app/api/triggers/[public_id]/route.ts`

**Steps:**
- [ ] Implement POST handler:
  - Look up schedule by `webhook_public_id`; 404 if missing or disabled
  - Read raw body (must read as text/buffer before parsing — HMAC is over the raw bytes)
  - Verify `X-Signature` header: HMAC-SHA256 over raw body with stored `webhook_secret_hash` as the key. 401 on mismatch
  - Cap body size at 256KB; 413 if exceeded
  - Parse body as JSON; tolerate non-JSON as a string payload
  - Enqueue a run via the same `dispatchRun()` from task #11 with `trigger='webhook'`, `trigger_payload=parsedBody`
  - Respond 202 with `{ run_id }`
- [ ] Add HMAC signing helper docs in the schedule detail UI ("compute HMAC-SHA256 of your body with this secret, send as `X-Signature`")

**Acceptance:**
- [ ] Curl POST with valid signature → run is created with `trigger='webhook'`, payload available in the prompt context
- [ ] Bad signature → 401, no run created
- [ ] Body > 256KB → 413
- [ ] Disabled schedule → 404

**Depends on:** #9, #11

---

## #17 — Budget guardrails

**Goal:** the system can't burn unlimited Claude credit without surfacing.

**Files:**
- Pre-dispatch check in `runner.ts` and `executor/adapter.ts`
- Settings UI for `monthly_budget_usd`

**Steps:**
- [ ] Implement `currentMonthSpend(): number` — `SUM(cost_usd) FROM runs WHERE started_at >= first-of-current-month-UTC`
- [ ] Implement `budgetGate(): 'ok' | 'warn' | 'block'` based on `user_state.monthly_budget_usd`:
  - Null budget → always `'ok'`
  - <75% → `'ok'`
  - 75–99% → `'warn'`
  - ≥100% → `'block'`
- [ ] In scheduled dispatch (task #11): before `dispatchRun()`, check `budgetGate()`. If `'block'`: set `schedules.enabled=false`, `disabled_reason='budget_exceeded'`, skip dispatch
- [ ] In manual dispatch (task #12): if `'block'` and no `--over-budget` flag (or UI confirmation), return error to the chat surface
- [ ] In-flight runs at the threshold finish naturally — guard only blocks *new* dispatches
- [ ] Add a "Monthly budget" field to the settings UI

**Acceptance:**
- [ ] Set budget = $1; run a few schedules until spend > $1 → next scheduled dispatch is blocked, schedule auto-paused with `disabled_reason='budget_exceeded'`
- [ ] At 75–99%: TopHud shows warning (verified once #22 lands)
- [ ] Null budget → no blocking at any spend level

**Depends on:** #9, #13

---

## #18 — Skills harness-agnostic loading

**Goal:** skills authored in `<brain>/skills/` or `<workspace>/.flow/skills/` work across Claude Code, Codex, OpenClaw.

**Files:**
- Touches `@agentex/agent` integration in `src/lib/executor/adapter.ts`
- Potentially upstream contributions to `@agentex/agent` itself (open a ticket if so)

**Steps:**
- [ ] Audit current `listInstalledSkills()` behavior — exactly what paths does it read, what does it produce?
- [ ] Implement (or extend) so it reads from:
  - Global: `<brain>/skills/<name>/SKILL.md`
  - Workspace: `<workspace>/.flow/skills/<name>/SKILL.md` (when dispatching against a workspace)
- [ ] On dispatch, translate to the harness-specific layout the underlying CLI expects:
  - Claude Code: copy/symlink to `<workspace>/.claude/skills/<name>/SKILL.md` (or `~/.claude/skills/` for global)
  - Codex / OpenClaw: their equivalents
- [ ] Workspace skill overrides global on name collision
- [ ] If the gap is bigger than expected, file a follow-up ticket and ship a minimal version that works on Claude Code first

**Acceptance:**
- [ ] Author a global skill at `~/flow-dev/skills/test-skill/SKILL.md` → orchestrator dispatched against any workspace can invoke it by description
- [ ] Author a workspace skill at `<workspace>/.flow/skills/test-skill/SKILL.md` (same name) → workspace-scoped dispatch sees the workspace version, brain-scoped sees the global
- [ ] Skills appear in the orchestrator's `listInstalledSkills()` inventory at session boot

**Depends on:** none (can ship anytime)

---

## #19 — New orchestrator actions

**Goal:** programmatic + agent-accessible CRUD for schedules + runs.

**Files:**
- `src/lib/orchestrator/registry.ts` (additions)
- `src/lib/db/queries.ts` (shared helpers)

**Steps:**
- [ ] Add Zod schemas for the action params (see §6 of plan for fields)
- [ ] Add actions, each dispatching through `queries.ts`:
  - `list_schedules` — filters: enabled, kind, workspace_id, lane
  - `get_schedule` — by id
  - `create_schedule` — validates cron via `validateCronExpression` from task #10
  - `update_schedule` — partial patch
  - `delete_schedule` — cascade `schedule_runs`
  - `run_schedule` — enqueues a `trigger='manual'` run via the same dispatch path as task #4 (despite the name — "manual" here means "user-initiated immediate," distinct from cron-triggered)
  - `list_runs` — filters: status, schedule_id, agent_id, since
  - `get_run` — by id, includes usage rollup
  - `cancel_run` — best-effort SIGTERM via `@agentex/agent` session, mark `runs.status='failed'`, `status_reason='cancelled'`
  - `list_skills` — returns the merged set from #18
- [ ] Action names are public contract — once shipped, don't rename. Double-check naming before merging

**Acceptance:**
- [ ] Each action callable via CLI: `flow agent <action> [params]`
- [ ] Each action callable via HTTP MCP at `/api/orchestrator/[transport]`
- [ ] `create_schedule` rejects invalid cron expressions
- [ ] `cancel_run` on a running run terminates within 10s

**Depends on:** #9, #10 (for cron validation)

---

## #20 — Schedules CRUD UI

**Goal:** humans create / view / edit schedules without touching the CLI.

**Files:**
- `src/app/(...)/schedules/page.tsx` — list view
- `src/app/(...)/schedules/[id]/page.tsx` — detail view
- `src/app/(...)/schedules/new/page.tsx` — creation form
- `src/components/schedules/*`
- PowerRail addition

**Steps:**
- [ ] List view: cards/rows with name, cadence (humanized), next fire (humanized), last status pill, enabled toggle
- [ ] Detail view: Tiptap prompt editor + next-3-fires preview + recent runs list (links to chat sessions) + edit/pause/delete actions
- [ ] Creation form per §8.3:
  - **What:** name (validated for scope uniqueness), prompt (Tiptap), description
  - **When:** picker for `[Schedule | Every | At | Webhook]`. For Schedule, NL input that compiles to cron — start with a small heuristic parser (`every weekday at 9am`, `daily at 3pm`, `every 30 minutes`) and fall back to a Haiku call if heuristic fails. Show resolved cron + next 3 fire times
  - **Where:** target dropdown (workspace dropdown or "Orchestrator"). Session strategy radio (Persistent / Isolated) with help text. Skills multi-select
  - **Settings:** model override, effort, timeout, active hours (start + end + days)
  - **Save:** preview the next fire, then submit
- [ ] PowerRail: add "Schedules" group per workspace (collapsible), brain-level group at top

**Acceptance:**
- [ ] Create a schedule from the UI → it appears in the list and the PowerRail
- [ ] NL input "every weekday at 9am" → resolves to `0 9 * * 1-5` with next 3 fires shown
- [ ] Pause from the list → `enabled=false` persists, next-fire-at greyed out
- [ ] Delete prompts for confirmation; cascades to `schedule_runs`

**Depends on:** #19

---

## #21 — Runs view extension

**Goal:** scheduled runs surface in the existing executions view, no new screen.

**Files:**
- `src/components/executions/*` (extends `docs/execution-view-spec.md` work)
- Inbox filter components

**Steps:**
- [ ] In the executions list, add a trigger badge per row: `manual` (default, no badge), `cron`, `webhook`, `event`
- [ ] Add filter pills: `all | manual | scheduled | webhook | unread`
- [ ] Bundle group: when multiple unread runs of the same schedule exist, show as "morning-triage · 3 unread" expandable. Expanding shows the individual runs newest-first
- [ ] On the 4-col execution view, when the session has `created_by_run_id` and that run has a `schedule_id`, show a header strip: "Triggered by `<schedule.name>` at `<run.started_at>` · next run `<schedule.next_run_at>`"
- [ ] Clicking the schedule name in the strip → navigates to the schedule detail view

**Acceptance:**
- [ ] Manual chat + scheduled run both appear in the executions list
- [ ] Filter pills correctly narrow each subset
- [ ] Bundled group expands and collapses; individual runs accessible
- [ ] Header strip on scheduled run links to schedule

**Depends on:** #9, #11, #12, #20

---

## #22 — TopHud extension

**Goal:** ambient awareness of system state at all times.

**Files:**
- `src/components/dashboard/top-hud.tsx`

**Steps:**
- [ ] Right-side strip with four indicators (separators between):
  - **Active runs:** count of `runs.status IN ('queued', 'running')` — click → runs view filtered to running
  - **Today's spend:** `SUM(cost_usd) WHERE date(started_at) = date('now')` — click → CLI hint or spend page if shipped
  - **Unread:** existing `unread` count (no new data) — click → inbox
  - **Budget %:** shown only when `monthly_budget_usd` is set AND spend ≥ 50% — click → schedules list (so user can pause if needed). Color-coded: yellow at 75%, red at 100%
- [ ] Live updates via existing TanStack Query invalidation; ~5s poll if no realtime event arrives

**Acceptance:**
- [ ] Start a scheduled run → active-runs count increments
- [ ] Run completes → spend updates within poll interval
- [ ] Budget at 80% → yellow indicator visible

**Depends on:** #13, #17

---

## #23 — CLI surface

**Goal:** everything in the UI is also available from the shell.

**Files:**
- `src/cli/commands/schedule.ts`
- `src/cli/commands/runs.ts`
- `src/cli/commands/spend.ts`
- Wire into `src/cli/index.ts`

**Steps:**
- [ ] `flow schedule create` — flags: `--name`, `--cron`/`--every`/`--at`, `--prompt` (or `--prompt-file`), `--agent`, `--workspace`, `--timezone`, `--skills <list>` (no `--strategy` flag — dispatch behavior is derived from kind + target_kind)
- [ ] `flow schedule list` — pretty table: name, cadence, next, last, enabled
- [ ] `flow schedule show <id-or-name>` — full detail incl. next 5 fires, last 5 runs
- [ ] `flow schedule run <id-or-name> [--wait]` — fire immediately; `--wait` blocks until terminal
- [ ] `flow schedule pause <id-or-name>` / `flow schedule resume <id-or-name>`
- [ ] `flow schedule edit <id-or-name> --prompt ... --cron ...`
- [ ] `flow schedule delete <id-or-name>` — confirm prompt unless `--force`
- [ ] `flow runs [--unread] [--status <s>] [--schedule <id>] [--limit N]`
- [ ] `flow run show <run-id>` — incl. cost, transcript path
- [ ] `flow run cancel <run-id>`
- [ ] `flow spend` — today / week / month totals
- [ ] `flow spend --by agent|schedule` — grouped
- [ ] All commands route through orchestrator actions from task #19

**Acceptance:**
- [ ] Full flow: `flow schedule create … --name test --cron "* * * * *"` → `flow schedule list` shows it → wait 1 min → `flow runs --schedule test` shows the fire → `flow schedule delete test`
- [ ] Name-based lookups work for create/show/edit/delete/run/pause

**Depends on:** #19

---

## #24 — Decisions convention

**Goal:** the AI writes decisions as notes; humans filter them out of the notes list.

**Files:**
- Seed `MEMORY.md` template (in the seed script)
- Notes list filter component

**Steps:**
- [ ] In the seed script that creates a fresh brain, write a starter `<brain>/MEMORY.md` that includes a section: "**Decisions:** when you make a decision of substance during a run, write a note with title `Decision: <topic>` and a body containing context, options considered, the decision, expected consequences."
- [ ] On the notes list view, add a filter chip: `Decisions` (filters where `title LIKE 'Decision:%'`)
- [ ] No schema change

**Acceptance:**
- [ ] Fresh `flow-dev` brain has the decisions section in `MEMORY.md`
- [ ] Manually create a note titled "Decision: use SQLite" → appears in notes list, and when filter chip selected, only Decision-prefixed notes show

**Depends on:** none (independent)

---

## #25 — Failure surfacing

**Goal:** repeated schedule failures don't silently rot.

**Files:**
- Increment logic in dispatch result handler (task #11)
- Banner component on schedule detail page

**Steps:**
- [ ] On run completion with `status='failed'`, increment `schedules.consecutive_failures` for the parent schedule
- [ ] On run completion with `status='completed'`, reset `consecutive_failures=0`
- [ ] On schedule detail view, when `consecutive_failures >= 3`, show persistent banner at top:
  - "This schedule has failed 3 times in a row. Last error: `<schedule.disabled_reason or last_run.error_message>`"
  - Quick actions: **View last failed run** (link), **Pause schedule**, **Reset failure count**
- [ ] Schedule list view shows a warning icon for schedules with `consecutive_failures >= 3`
- [ ] No auto-pause — silent failure is worse than surfaced failure

**Acceptance:**
- [ ] Force 3 consecutive failures (e.g., point a webhook schedule at a prompt that always errors) → banner appears on detail view, warning icon on list view
- [ ] One successful run after that → banner disappears, count resets to 0
- [ ] "Reset failure count" action zeros the counter without changing `enabled`

**Depends on:** #11

---

## Done criteria for V1

When all 18 boxes (including #26 the lift) are checked:

- [ ] Schedule a daily 9am prompt → fires correctly, lands in executions view as unread
- [ ] Manual chat sends still work and create `runs` rows; cost tracking matches reality
- [ ] Webhook POST with HMAC → run fires
- [ ] Budget at $1, schedules running → schedule auto-pauses with banner when exceeded
- [ ] Skills authored at `<brain>/skills/` are available in scheduled runs
- [ ] CLI parity with the UI
- [ ] No regressions in existing chat behavior

Ship as one release. Estimated total effort: 4–6 focused weeks.

---

## Things explicitly deferred (V2+)

Don't pull these into V1 even if they feel close:

- Pre-gate for destructive actions
- Concurrency lanes (only global rate-lease in V1)
- Heartbeat as a primitive (simulate with a 30-min supervisor schedule in V1)
- First native connector (Gmail / Linear) — webhook intake is the V1 substrate
- Notifications table
- Multi-state action protocol (`request_input`, `report_blocked`, `continue_work`)
- Goals entity
- Work queue + `tasks.ai_eligible` flag
- Subagent lineage columns
- Activity timeline as a dedicated page
- `describe_world` orchestrator action
- Self-directed autonomy mode
- `session_strategy` enum / `continuous` chat-persists mode — V1 derives dispatch behavior from `kind` + `target_kind`. Adding a `continuous_chat: boolean` later is a non-breaking additive column.
- Multi-chat-per-execution UI — schema supports it (executions can host many chats); V1 renders only the primary (most-recently-active) chat per execution
- User-visible "Executions" page or CLI verb — executions are an implementation detail of how chats group; not a user-facing primitive

See `async-agents-v1.md` §10–§11 and `executions-spec.md` §8 for V2 / V3+ direction.
