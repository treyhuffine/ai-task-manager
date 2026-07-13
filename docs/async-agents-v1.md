# Async Agents — V1

> **The plan.** Ship the smallest substrate that lets the AI act when the human isn't at the keyboard. Schedules trigger work, runs record what happened, the rest of the app already knows how to display executions.
>
> **Status.** Final V1 design, synthesized from two parallel design passes. Locks the V1 surface. Heartbeat, connectors, pre-gate, lanes, goals all deferred to V2 — none require revisiting V1.

---

## TL;DR

V1 ships **scheduled tasks**. One new tick, two new tables, one new column.

- **Schedules** — cron / interval / at / webhook triggers that dispatch a prompt against a workspace or the orchestrator
- **One 60s tick** in `instrumentation.ts`, file-locked, advances `next_run_at` before dispatch
- **Runs** — one row per execution; status enum kept simple (`queued | running | completed | failed | skipped`)
- **Scheduled runs surface as executions** in the existing 4-col view with a trigger badge — no new UI tab
- **Review = existing unread machinery** — `last_outcome_event_at` > `last_viewed_at` is the inbox; no new state
- **Skills** at harness-agnostic paths (`<brain>/skills/`, `<workspace>/.flow/skills/`); executor adapter handles per-provider translation
- **Webhook intake** at `/api/triggers/:public_id` with HMAC-SHA256
- **Cost capture + budget guardrails** from `@agentex/agent`'s `result` event
- **Decisions as notes** — no new entity

That's it. No connectors. No heartbeat. No pre-gate. No lanes. No context engine.

What this is not:
- A pipeline DSL
- A separate review-gate state machine
- A heartbeat reflex (V2)
- A Redis/BullMQ queue
- An Anthropic Routines host
- A context-injection layer (see §6)
- A native connector marketplace
- A multi-state action protocol (V2+)

---

## 1. The bet

The app is good at synchronous work: you sit at the keyboard, AI helps you build / write / debug. That's the co-pilot.

Next inflection isn't a smarter co-pilot — it's **co-worker**: AI with presence and the ability to act when you're not at the laptop. The autonomy axis runs by *who initiates*:

| Tier             | Initiation                                                                  | Status                          |
|------------------|-----------------------------------------------------------------------------|---------------------------------|
| Co-pilot         | Human starts every interaction. AI responds.                                | Default (existing behavior)     |
| Co-worker        | AI wakes on schedule, executes a prompt, surfaces output.                   | V1 substrate · V2 turns it on   |
| Self-directed    | AI wakes, reads world state, decides what's valuable, acts.                 | V3+ — needs goals + world model |

V1 ships scheduled initiation. The human authors the schedule; the AI does the work. That's the smallest step from co-pilot toward co-worker. Heartbeat (V2) is what makes it real *presence* — until then, the AI only wakes when a schedule says to.

---

## 2. What Claude Code gives us, what we build

The boundary we hold. Everything Claude Code does well → we author markdown / config instead of building infrastructure.

| Concern                                | Claude Code provides                                | We build                                               |
|----------------------------------------|-----------------------------------------------------|--------------------------------------------------------|
| Agent loop, tool calling               | Yes (via `@agentex/agent`)                          | Nothing                                                |
| Subagent spawning                      | Yes (Agent tool)                                    | `.md` files when needed                                |
| Skill selection                        | Yes (description-matching auto-load)                | `SKILL.md` files                                       |
| Hierarchical skill resolution          | Yes natively                                        | Author the files; executor adapter places them         |
| Per-tool permissions                   | Yes (interactive prompts; SDK callback)             | Existing unread surface handles run-level review       |
| Context compaction                     | Yes (automatic)                                     | Critical state goes in `MEMORY.md` / workspace `CLAUDE.md` |
| Session resume                         | Yes                                                 | Capture `sessionId`; Claude does the rest              |
| Reading `MEMORY.md` / `CLAUDE.md`      | Yes (Claude Code) + existing pattern (our agents)   | Author content over time                               |
| Cost & token usage per turn            | Yes (`ExecutionResult.usage`, `costUsd`)            | Persist what's emitted                                 |
| Hooks                                  | Yes                                                 | Use for activity-log persistence                       |
| Scheduling on self-hosted infra        | **No** (Routines is Anthropic-hosted)               | Our scheduler                                          |
| Webhook intake                         | **No**                                              | `/api/triggers/:public_id`                             |
| Domain model (tasks/notes/...)         | **No**                                              | Drizzle schema, query layer                            |
| Cost rollup per schedule/agent         | **No** (Admin API is org-level)                     | Roll up from per-run captures                          |
| Budget guardrails                      | **No**                                              | `monthly_budget_usd` + warn/pause                      |

**Key consequence:** the agent already has access to `MEMORY.md` and the workspace's `CLAUDE.md` through Claude Code's native file reads, plus all our domain entities through the existing action registry. We do not pre-bake a "world snapshot" and inject it on every dispatch. See §6.

---

## 3. What we already have

| Capability                                  | Where                                              | Status                                            |
|---------------------------------------------|----------------------------------------------------|---------------------------------------------------|
| Typed orchestrator action registry          | `src/lib/orchestrator/registry.ts`                 | 15 actions, dispatch via `queries.ts`             |
| Multi-provider executor                     | `src/lib/executor/adapter.ts` (`@agentex/agent`)   | Claude Code, Codex, OpenClaw                      |
| Per-turn message queue                      | `chat_events.queued_at` + drain loop               | Shipped                                           |
| 60s background health sweep                 | `instrumentation.ts:86-105`                        | Reconcile + redispatch                            |
| Session reconcile from JSONL                | `executor/reconcile.ts`                            | Shipped                                           |
| Skills inventory at session boot            | `adapter.ts` + `listInstalledSkills()`             | Partial — needs completion for our paths          |
| Execution view (4-col)                      | `docs/execution-view-spec.md`                      | In-flight                                         |
| Cost & usage per turn                       | `@agentex/agent` `ModelUsage`                      | Available, not surfaced                           |
| Workspace + worktree                        | `src/lib/workspaces`                               | Shipped                                           |
| Brain `MEMORY.md`                           | Existing memory pattern                            | Agents already read/write                         |
| Workspace `CLAUDE.md`                       | Claude Code convention                             | Picked up natively                                |
| Unread machinery                            | `chat_sessions.last_outcome_event_at` / `last_viewed_at` | Shipped                                     |
| Attachments                                 | `/api/attachments`                                 | Shipped                                           |

Gaps for V1: scheduler tick, `schedules` + `runs` tables, one new FK on `chat_sessions`, webhook endpoint, cost capture + budget, harness-agnostic skill loading.

---

## 4. V1 architecture

### 4.1 The system tick

Single 60s tick in `src/lib/scheduler/runner.ts`, started when the Next.js server boots:

```ts
const TICK_INTERVAL_MS = 60_000;

setInterval(async () => {
  const lock = await acquireSchedulerLock();    // file-based
  if (!lock) return;
  try {
    const now = new Date();
    const due = await db.select().from(schedules)
      .where(and(
        eq(schedules.enabled, true),
        lte(schedules.next_run_at, now.toISOString()),
      ));

    for (const s of due) {
      // Advance next_run_at FIRST (at-most-once semantics)
      const next = computeNextRun(s, now);
      await db.update(schedules).set({ next_run_at: next }).where(eq(schedules.id, s.id));

      // Spawn the run — don't await
      void dispatchRun(s, { trigger: s.kind, scheduledFor: now });
    }
  } finally {
    await releaseSchedulerLock(lock);
  }
}, TICK_INTERVAL_MS);
```

Properties:
- **Tick is code; rows are data.** A broken schedule row doesn't break the tick — only that row fails to fire.
- **At-most-once.** `next_run_at` advances *before* dispatch. A crash mid-run leaves a `runs` row in `running`; on boot it gets marked `failed` with reason `process_restart` by the existing health sweep.
- **One process, one tick, one file lock.** No worker pool. No Redis.
- **Global API throttle.** A single semaphore around `executor.dispatch()` caps Anthropic API concurrency (default 4). Prevents 429s when multiple schedules + manual runs collide.

When V2 adds heartbeat, `processHeartbeats()` becomes a sibling call inside this same tick. No tick redesign.

### 4.2 Schedules

A `schedules` row is "fire under these conditions." User-editable.

| Kind     | Meaning                                                            |
|----------|--------------------------------------------------------------------|
| `at`     | Fire once at an absolute time, then archive                        |
| `every`  | Fire every N seconds, with optional active hours                   |
| `cron`   | Fire on a cron expression in a timezone                            |
| `webhook`| Fire when POST hits `/api/triggers/:public_id` with valid HMAC     |

Each schedule has: `prompt`, `agent_id`, `target_kind` (`workspace` or `orchestrator`), optional `workspace_id`, `concurrency_policy`, `catch_up_policy`, `enabled`, plus kind-specific config.

**No `session_strategy` enum.** Dispatch behavior is derived from `kind` + `target_kind` per `docs/executions-spec.md` §5: orchestrator schedules get a fresh chat each fire, one-off (`kind='at'`) workspace schedules get a fresh execution + chat each fire, recurring workspace schedules reuse the schedule's owning execution and create a fresh chat inside it. The artifact (worktree, branch, PR) persists; the conversation is bounded per fire. If a `continuous` (chat-persists) mode becomes a real use case in V2, it's added as an additive nullable column with no migration pain.

**`agent_id` default (form-level, not schema-level):** when `target_kind='orchestrator'`, default to the orchestrator agent. When `target_kind='workspace'`, default to the workspace's bound executor agent. User can override per schedule.

**`name` uniqueness:** unique-within-scope, where brain-level (workspace_id IS NULL) is its own scope. Implemented as **two partial unique indexes**, not a single composite, because SQLite treats NULLs in unique indexes as distinct — a plain `UNIQUE(workspace_id, name)` would silently allow duplicate brain-level names. CLI commands (`flow schedule pause morning-triage`) use name within scope; ids are the canonical reference but names are the human handle. See §6 for the exact index syntax.

**Concurrency policy** (when a previous run is still active):
- `forbid_concurrent` — skip this fire
- `coalesce_if_active` (default) — append as a follow-up message to the active run
- `allow_concurrent` — spawn a new run

**Catch-up policy** (when the process was down at fire time):
- `skip_missed` (default)
- `run_all` — fire once per missed window, capped at 3

**Active hours:** optional `active_hours_start` / `active_hours_end` (HH:MM in timezone) for "only fire during business hours." Heartbeat will use this heavily when it ships; V1 schedules can opt in.

### 4.3 Runs

A `runs` row is "this execution happened (or is happening)." **Unified across all dispatch sources.**

Every `executor.dispatch()` call creates a `runs` row, whether the dispatch came from:
- The scheduler tick (`trigger='cron'|'every'|'at'`)
- A webhook hit (`trigger='webhook'`)
- A user message in the existing chat UI (`trigger='manual'`)
- An internal event the scheduler picks up later (`trigger='event'`, V2+)

This is critical for cost rollup, budget guardrails, and the activity timeline to be *honest* — if we only tracked scheduled work, manual chat would be invisible to spend tracking and the budget would lie. Unified means every Anthropic-token-burning execution is one row, regardless of who kicked it off.

Status enum (V1, deliberately simple): `queued | running | completed | failed | skipped`.

Each run gets a `chat_session` (existing table, `type='execution'`). The orchestrator runs inside it. `runs` holds metadata (trigger, status, cost, timing, summary, artifact refs); `chat_events` holds the transcript.

**Why runs separate from sessions:**
- A session may host multiple runs (initial → iterate → re-iterate = three runs on the same session)
- Aggregations need a per-execution row
- Trigger metadata has nowhere clean on the session

**Provenance:** new column `chat_sessions.created_by_run_id` (nullable FK) records the run that created the chat. "Created by," not "triggered by" — a chat hosts many subsequent runs (initial → iterate → re-iterate) but only one creator. Subsequent runs are tracked via `runs.chat_session_id`, not by mutating this field. NULL for chats the user created directly without a run kicking them off.

**Execution linkage:** new column `chat_sessions.execution_id` (nullable FK to `executions`, ON DELETE SET NULL) lands as part of the pre-#9 executions lift (see `docs/executions-spec.md`). Workspace-scope chats have it set; orchestrator/content chats have it NULL. `runs.execution_id` is the denormalized version on runs for cheap per-execution cost rollups.

**Execution-level run mutex:** at most one workspace run per execution may be in `status='running'` at any time. Because many schedules can point at one execution (via `schedules.owning_execution_id`), the schedule-level `concurrency_policy` isn't enough — two different schedules sharing an execution could otherwise mutate the same worktree concurrently. Dispatch checks `runs WHERE execution_id = E AND status = 'running'` before starting; scheduled dispatches fall back to the firing schedule's `concurrency_policy`, manual dispatches reject in V1 (see open questions). See `docs/executions-spec.md` §5.

**Review surface:** existing unread machinery. When a run completes, the chat session sits with the AI's last message; `last_outcome_event_at` updates; existing inbox queries (`last_outcome_event_at > last_viewed_at`) pick it up. User reads, replies if they want, archives if they don't. No new status, no new agent actions.

**Summary population (V1):** auto-extract from the last assistant message at run completion (first ~200 chars). Future versions may add an explicit `set_run_summary` agent-only action when we want the agent to write a deliberate summary distinct from its closing message.

**Artifact refs:** `runs.artifact_refs` JSON column captures what the run produced — `[{kind:'task', id:'...'}, {kind:'note', id:'...'}]`. **Inferred by the dispatcher, not declared by the agent.** When the orchestrator calls entity-mutating registry actions (`create_task`, `update_task`, `create_note`, `update_memory`, ...) during the run, the dispatcher accumulates the resulting ids into the run's refs. Lower surface area for the agent to mess up; agents that don't think about telemetry still produce correct timelines.

**Dispatch behavior (derived, no enum):**
- `target_kind='orchestrator'`: no execution, fresh `chat_sessions` row each fire
- `target_kind='workspace'` + `kind='at'`: new execution + new chat each fire (one-off, nothing to reuse)
- `target_kind='workspace'` + recurring (`cron`/`every`/`interval`): reuse the schedule's owning execution (via `schedule.owning_execution_id` — direct FK lookup, no join), create a fresh chat inside it each fire. If the FK is NULL or points to an archived execution, create a new active execution and persist back

Every scheduled fire creates a new `chat_sessions` row. Multiple chats per execution accumulate over time (V1 UI shows the most-recent active chat as primary; multi-chat UI deferred). Recurring runs group in the executions list by `schedule_id` ("weekly-retro · 4 runs" affordance) — same workspace artifact, distinct conversations.

See `docs/executions-spec.md` §5 for the full reasoning.

### 4.4 Skills — harness-agnostic

The app runs on Claude Code, Codex, and OpenClaw via `@agentex/agent`. Hardcoding `.claude/skills/` would assume one harness; instead we use neutral paths under our control and let the executor adapter handle per-harness placement.

| Scope     | Location                                       | Notes                                                |
|-----------|------------------------------------------------|------------------------------------------------------|
| Global    | `<brain>/skills/<name>/SKILL.md`               | User's library, available everywhere                 |
| Workspace | `<workspace>/.flow/skills/<name>/SKILL.md`     | Codebase-specific, **committed to git** by default   |

Format follows the Claude Code convention (YAML frontmatter + markdown body) so existing skill libraries port:

```markdown
---
name: github-pr-review
description: Review a PR for correctness, security, and style
---
# GitHub PR review

When invoked, look up the PR via the gh CLI, read the diff, and check for...
```

**Resolution:** workspace overrides global on name collision.

**On dispatch:** the executor adapter copies/symlinks our paths into the harness-specific locations the underlying tool expects. `@agentex/agent`'s `listInstalledSkills()` partially does this today; V1 completes it.

What skills are *not*: not code, not a permission boundary, not pipelines. Markdown only. Multiple skills in one schedule = multiple recipe pages, not a sequenced workflow.

### 4.5 Decisions

Decisions are **notes**. No new entity.

When the agent makes a decision of substance, it calls `create_note` with `title: "Decision: ..."` and a body containing context, options considered, the decision, and expected consequences. Shows up in the brain's notes list.

The seed `MEMORY.md` template instructs the agent to write decisions as notes with the `"Decision:"` title prefix. A future "Decisions" filter on the notes list (V2+) is additive UI — no schema change.

### 4.6 Webhook intake

A schedule with `kind='webhook'` gets a unique `webhook_public_id` + `webhook_secret_hash` on creation. External services POST to `/api/triggers/:public_id` with HMAC-SHA256; the runner verifies, fires the schedule, passes the payload through as `trigger_payload` available to the prompt.

Single auth scheme (HMAC-SHA256) for V1. Per-platform signatures (GitHub-style, Linear-style) layer in later if we build native connectors.

### 4.7 Cost capture + budget guardrails

Cost data comes from `@agentex/agent`'s `result` event at run completion: `input_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, `cost_usd`, `model`. Persist to `runs`.

Pricing tables in `src/lib/pricing/models.json` map provider/model → cents per million tokens. Updated as providers publish prices.

**Budget:** a `monthly_budget_usd` column on the existing `user_state` table. The scheduler checks current month's spend (sum of `runs.cost_usd` where `started_at >= first of month`) before dispatch:

- **<75%**: dispatch normally
- **75–99%**: dispatch normally; TopHud shows a soft warning ("80% of budget used")
- **≥100%**: scheduled runs auto-pause (`schedules.enabled=false`, `disabled_reason='budget_exceeded'`); manual runs require `--over-budget` flag

In-flight runs at the 100% threshold are allowed to complete. New runs are paused from that point.

### 4.8 PowerRail / executions integration

The defining choice that keeps the system from forking into two UIs:

- **PowerRail (left nav)** gains a "Schedules" group per workspace; brain-level schedules sit in a top group
- **Executions list** shows manual + scheduled + webhook runs interleaved, newest first. Filter pills: `all | manual | scheduled | webhook | unread`
- **Execution view (4-col)** identical regardless of trigger. Header gains one row when scheduled: "Triggered by `morning-triage` at 9:00 · next run 9:00 tomorrow"
- **TopHud strip** (right side): active runs · today's spend · unread count · budget % (when >50%)
- **Bundled groups** when multiple unread runs of the same schedule accumulate: "morning-triage · 3 unread"
- **No separate "Automation" tab.** Configuration lives where it's used; executions live where executions already live.

---

## 5. The thing we are *not* building: a context engine

This gets its own section because it was in earlier drafts and is being deliberately omitted.

**What it would have been:** on every scheduled dispatch, before the prompt runs, inject a structured snapshot of recent state — top open tasks, recent stream items, workspaces touched today, schedules due in next 24h — as a synthetic first user message.

**Why we're not building it:**

1. **The agent is smart and has tools.** The schedule's prompt tells the agent what to do; the agent calls `list_tasks`, `list_stream`, etc. as needed. Pre-baking a snapshot means *we* decide what's relevant before the agent has even started.
2. **Most of the snapshot is noise for any specific task.** "Triage the inbox" doesn't need "schedules due in next 24h." Generic snapshots dilute the relevant signal.
3. **The agent already gets what matters for free.** Workspace `CLAUDE.md` is loaded by Claude Code natively in that cwd. Brain `MEMORY.md` is read by the orchestrator on demand. The schedule's `prompt` is the right place to scope context.
4. **Complexity we'd rip out.** Token budgets, truncation rules, per-schedule scope flags, a `describe_world` action — infrastructure for a problem the agent doesn't actually have.

**What we do instead:**

- Author schedule prompts that are specific about what to read ("triage the inbox" → the prompt names the queries or trusts the agent)
- Trust Claude Code's existing context loading (CLAUDE.md, ancestor CLAUDE.md, MEMORY.md)
- Trust the agent's tool use
- Revisit only if dogfooding shows the agent wasting turns on orientation

**What this is NOT:** this is not the *world model*. The world model is a different concept entirely. See §11.3.

---

## 6. Schema deltas

```ts
// src/lib/db/schema.ts — additions

export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

  agent_id: text('agent_id').references(() => agents.id).notNull(),
  workspace_id: text('workspace_id').references(() => workspaces.id),

  prompt: text('prompt').notNull(),
  skill_hints: text('skill_hints', { mode: 'json' }).$type<string[]>(),

  kind: text('kind', { enum: ['at', 'every', 'cron', 'webhook'] }).notNull(),
  cron_expression: text('cron_expression'),
  interval_seconds: integer('interval_seconds'),
  run_at: text('run_at'),
  timezone: text('timezone').default('UTC'),

  active_hours_start: text('active_hours_start'),
  active_hours_end: text('active_hours_end'),

  concurrency_policy: text('concurrency_policy', {
    enum: ['forbid_concurrent', 'coalesce_if_active', 'allow_concurrent'],
  }).notNull().default('coalesce_if_active'),
  catch_up_policy: text('catch_up_policy', {
    enum: ['skip_missed', 'run_all'],
  }).notNull().default('skip_missed'),
  max_catch_up_runs: integer('max_catch_up_runs').notNull().default(3),

  target_kind: text('target_kind', { enum: ['workspace', 'orchestrator'] }).notNull(),
  // No session_strategy column in V1 — dispatch behavior derived from kind +
  // target_kind. See docs/executions-spec.md §5/§6. Adding a `continuous_chat`
  // boolean later (V2+) is purely additive.

  // Schedule → execution ownership. FK on schedules (not on executions) so
  // many schedules can point at one execution without a unique-constraint
  // workaround. ON DELETE SET NULL: archiving/deleting the execution
  // doesn't break the schedule; next fire creates a fresh execution.
  // See docs/executions-spec.md §2.3.
  owning_execution_id: text('owning_execution_id').references(() => executions.id, {
    onDelete: 'set null',
  }),

  webhook_public_id: text('webhook_public_id'),
  webhook_secret_hash: text('webhook_secret_hash'),

  model: text('model'),
  effort: text('effort', { enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }),
  timeout_seconds: integer('timeout_seconds').notNull().default(900),

  next_run_at: text('next_run_at'),
  last_fired_at: text('last_fired_at'),
  last_run_id: text('last_run_id'),
  last_run_status: text('last_run_status', {
    enum: ['completed', 'failed', 'skipped'],
  }),
  consecutive_failures: integer('consecutive_failures').notNull().default(0),
  disabled_reason: text('disabled_reason'),

  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
}, (table) => [
  // Brain-level (workspace_id IS NULL) names unique among themselves.
  // SQLite treats NULL as distinct in composite unique indexes — without
  // the partial form, multiple brain-level rows with the same name would
  // coexist silently.
  uniqueIndex('uniq_schedules_brain_name')
    .on(table.name)
    .where(sql`${table.workspace_id} IS NULL`),
  // Workspace-scoped names unique per workspace.
  uniqueIndex('uniq_schedules_workspace_name')
    .on(table.workspace_id, table.name)
    .where(sql`${table.workspace_id} IS NOT NULL`),
]);

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  schedule_id: text('schedule_id').references(() => schedules.id),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  // Added as part of the executions lift (pre-#9). Denormalized FK for cheap
  // per-execution cost rollup. NULL for orchestrator-target runs.
  execution_id: text('execution_id').references(() => executions.id),
  chat_session_id: text('chat_session_id').references(() => chatSessions.id),
  agent_id: text('agent_id').references(() => agents.id).notNull(),

  trigger: text('trigger', {
    enum: ['manual', 'cron', 'every', 'at', 'webhook'],
  }).notNull(),
  trigger_payload: text('trigger_payload', { mode: 'json' }),

  status: text('status', {
    enum: ['queued', 'running', 'completed', 'failed', 'skipped'],
  }).notNull().default('queued'),
  status_reason: text('status_reason'),

  // Lifecycle
  queued_at: text('queued_at').notNull(),
  started_at: text('started_at'),
  completed_at: text('completed_at'),
  duration_ms: integer('duration_ms'),

  // Usage
  model: text('model'),
  input_tokens: integer('input_tokens').default(0),
  output_tokens: integer('output_tokens').default(0),
  cached_input_tokens: integer('cached_input_tokens').default(0),
  cache_creation_input_tokens: integer('cache_creation_input_tokens').default(0),
  cost_usd: real('cost_usd').default(0),

  // Outcome
  summary: text('summary'),                                    // 1-3 sentences for the timeline
  artifact_refs: text('artifact_refs', { mode: 'json' }),      // [{kind:'task', id:'...'}, ...]
  error_code: text('error_code'),
  error_message: text('error_message'),

  created_at: text('created_at').notNull(),
}, (table) => [
  index('idx_runs_schedule_status').on(table.schedule_id, table.status),
  index('idx_runs_status_started').on(table.status, table.started_at),
  index('idx_runs_trigger_started').on(table.trigger, table.started_at),
]);

// Additions to existing tables:

// chat_sessions
created_by_run_id: text('created_by_run_id').references(() => runs.id, {
  onDelete: 'set null',
}),
// execution_id is added by the pre-#9 executions lift, not this migration —
// listed here for completeness. See docs/executions-spec.md §2.2.

// user_state (existing table)
monthly_budget_usd: real('monthly_budget_usd'),
```

That's the entire schema delta. Two new tables, one new column on `chat_sessions`, one new setting.

---

## 7. New orchestrator actions

| Action                 | Purpose                                          | Mutating |
|------------------------|--------------------------------------------------|----------|
| `list_schedules`       | Filters: enabled, kind, workspace_id             | No       |
| `get_schedule`         | Fetch one                                        | No       |
| `create_schedule`      | New schedule                                     | Yes      |
| `update_schedule`      | Patch fields                                     | Yes      |
| `delete_schedule`      | Remove                                           | Yes      |
| `run_schedule`         | Enqueue immediate manual run                     | Yes      |
| `list_runs`            | Filters: status, schedule_id, agent_id, since    | No       |
| `get_run`              | Fetch one with usage rollup                      | No       |
| `cancel_run`           | Best-effort SIGTERM, marks `cancelled`           | Yes      |
| `list_skills`          | Returns the merged skill set (global + workspace)| No       |

V1 keeps it small — read + manage schedules + runs. No agent-only actions (those land in V2 with the multi-state protocol).

---

## 8. UX

### 8.1 CLI

```bash
flow schedule create \
  --name "morning-triage" \
  --cron "0 9 * * 1-5" \
  --prompt "Triage stream items captured overnight" \
  --agent default
flow schedule list / show / pause / edit / delete
flow schedule run <id> [--wait]

flow runs                          # all runs, paginated
flow runs --unread                 # what needs my attention
flow run show / cancel

flow spend                         # today/week/month
flow spend --by agent / schedule
```

### 8.2 Dashboard

- **PowerRail (left)**: "Schedules" group per workspace + brain-level schedules at top
- **Schedules list / detail**: name, cadence, next fire, last status, toggle; detail = Tiptap prompt editor + next-runs preview + run history
- **Runs view**: extends existing executions view with trigger badge + filter pills. Bundled group when multiple unread runs of the same schedule accumulate
- **TopHud strip (right)**: active runs · today's spend · unread count · budget % (when >50%)

### 8.3 Schedule creation form

Single form, top to bottom:

1. **What** — name, prompt, optional description
2. **When** — `[ Run on a schedule | Every N | At a specific time | When triggered (webhook) ]`. For "on a schedule," natural-language input ("every weekday at 9am") that compiles to cron + timezone, with the resolved expression and next 3 fire times shown beneath
3. **Where** — target workspace or orchestrator. Skills selector. (No session-strategy picker — dispatch behavior is derived from kind + target_kind per `executions-spec.md` §5.)
4. **Settings** — model override, timeout, active hours, concurrency policy
5. **Save** — preview of next fire, then save

### 8.4 Run detail

Clicking any run takes you to the chat session it created (or continued), with a header strip showing schedule provenance, fire time, and cost. Worktree diff / PR controls for workspace runs work unchanged.

---

## 9. Build order

One ship, no internal gates.

**Pre-step (lands first):** **Executions lift** per `docs/executions-spec.md`. Adds the `executions` table, moves worktree/branch/PR/takeover columns off `chat_sessions`, adds `chat_sessions.execution_id` FK. ~1 week. The dispatch path (step 3 below) is written once with the right shape rather than refactored.

1. **Schema migrations** — `schedules` (incl. `owning_execution_id`), `runs` (incl. `execution_id`), `chat_sessions.created_by_run_id`, `user_state.monthly_budget_usd`
2. **Scheduler tick** in `instrumentation.ts` + file lock + `next_run_at` advance-before-dispatch semantics + active-hours skip
3. **Runs dispatch path** — for scheduled dispatches: resolve target execution per derived rules (orchestrator → no execution; one-off workspace → new execution; recurring workspace → use `schedule.owning_execution_id` if set and active, else create + persist), execution-level run mutex check (skip/coalesce per concurrency_policy if execution is busy), create chat_session inside the execution, attach to schedule, call `executor.dispatch`, insert `runs` row. Worktree provisioning is lazy — kicked off at first dispatch against an execution, not at execution-row creation
4. **Instrument existing user-initiated dispatch** in `executor/adapter.ts` to also insert a `runs` row with `trigger='manual'` on every chat send. This is what makes `runs` *unified* — without this step, manual chat is invisible to spend tracking and the budget guardrail is wrong
5. **Cost capture** from `@agentex/agent` `result` event into `runs.{tokens, cost_usd}` — fires for both manual and scheduled runs from steps 3 + 4
6. **Artifact-ref accumulator** in the dispatcher — when entity-mutating registry actions complete successfully, push the resulting id into the current run's `artifact_refs`
7. **Summary auto-extract** — on terminal `result` event, capture first ~200 chars of last assistant message into `runs.summary`
8. **Rate-lease semaphore** wrapping all `@agentex/agent` invocations
9. **Budget guardrails** — `user_state.monthly_budget_usd` + threshold check on dispatch + auto-pause schedules at 100%
10. **Cron parsing** via `croner` + `computeNextRun()` helper
11. **Webhook endpoint** `/api/triggers/:public_id` with HMAC verification
12. **Skills harness-agnostic loading** — complete `@agentex/agent` integration to read from `<brain>/skills/` and `<workspace>/.flow/skills/`, translate to per-harness layout on dispatch. Detail what specifically is missing today as a follow-up ticket during this step
13. **Schedules CRUD UI** + creation form with NL → cron translator
14. **Runs view extension** — trigger badge + filter pills + bundled groups
15. **TopHud extension** — active runs, spend, unread, budget %
16. **CLI surface** for everything (`flow schedule …`, `flow runs …`, `flow spend …`)
17. **Decisions convention** — seed `MEMORY.md` template + add "Decisions" filter to notes list
18. **Failure surfacing** — banner on schedules with `consecutive_failures >= 3`; no auto-pause (silent failure is worse than surfaced failure)

Estimated effort: 4–6 focused weeks. Ships as one release.

---

## 10. Deferred to V2

Each of these is intentionally out of V1 with a note on why and how it slots in.

- **Pre-gate for destructive actions.** Tag actions in registry + dispatcher gate + `approve_action` agent-only action. V1 ships without it; V1 schedules can do anything the registry allows. V2 adds the safety net. Migration: additive — new column on actions, new check in dispatch path.
- **Concurrency lanes.** Per-trigger-type ordering (`manual`, `cron`, `webhook`, `connector`, `session`). V1 has only the global rate-lease semaphore. V2 adds lanes when we see real contention. Migration: additive — lane column on schedules + runs, check in dispatch.
- **Heartbeat as a primitive.** Columns on `agents` + `processHeartbeats()` sibling call in the tick + `<brain>/HEARTBEAT.md` file + notifications table. V1 users wanting supervisor-pulse behavior can write a schedule that runs every 30 min with a supervisor-style prompt. V2 promotes it to its own primitive when we know the right cadence + output shape + cost model.
- **First connector** (Gmail or Linear). Native OAuth flow + typed actions + sync skill + webhook handler. V1 has webhook intake only — external services can already POST to schedule webhooks. V2 ships the polished UX.
- **Notifications table.** Global inbox primitive — heartbeat output, run state transitions, connector events, cost alerts. Build with heartbeat in V2.
- **Multi-state action protocol** (`request_input`, `report_blocked`, `continue_work`). Locks the orchestrator contract; right time is when autonomous loops genuinely need it. Migration: additive — new agent-only actions, new run statuses.
- **Goals entity.** Title, description, area_id, target_date, success_criteria, status, parent_goal_id. Load-bearing for self-directed autonomy.
- **Work queue + `tasks.ai_eligible` flag.** The "agent picks from a queue" pattern. Build after goals.
- **Subagent lineage** (`parent_run_id`, `depth` on runs). Add when multi-agent coordination exists. Today Claude Code subagents are within-turn and roll up into the parent run's cost.
- **Schedule templates UI.** Pre-baked schedules as one-click create. Useful after we see what people actually create.
- **Activity timeline as its own page.** V1 surfaces activity through the extended executions view. Promote to its own surface if filtering / rollups grow beyond what fits there.

---

## 11. Deferred to V3+

The bigger bets that don't fit a V2 timeline.

### 11.1 Self-directed autonomy

Tasks gain an `autonomy_level` enum (`off | semi | full`). At `semi`, the agent picks from the work queue. At `full`, the agent reads goals + areas + recent state and decides what's most valuable to work on. The inverted "AI initiates" mode. Requires goals + work queue + a few weeks of `semi` dogfooding before we know what `full` should actually do.

### 11.2 Multi-agent specialization

Per-agent skill libraries, per-agent tool permissions, per-agent heartbeat. Inter-agent delegation. The data model already supports multiple agents; what's missing is the UX for "which agent handles this conversation" and the coordination patterns.

### 11.3 The world model

Distinct from the (deliberately omitted) context engine. The **world model** is the AI's organizational memory — every artifact of the user's life or company's history: every decision made or reversed, every project shipped or abandoned, every customer input, every piece of code, every conversation that mattered. Not "current state" — the *accumulated context a human picks up over months of being embedded in a place*.

In V1 the world model is the entities the user authors: tasks, notes, decisions (as notes), stream items, workspaces, `MEMORY.md`. The agent has access via the action registry.

The full direction:

- **Ingestion at scale.** External sources flow in as stream items or first-class entities. Gmail threads, Linear issues, GitHub PRs, support tickets, sales calls, meeting transcripts, customer interviews. Each via webhook, MCP, or dedicated polling.
- **Synthesis.** A periodic AI process reads recent stream items, extracts decisions / patterns / links, writes them into the appropriate artifacts. The pile becomes structure.
- **Retrieval that matches the question.** Hybrid keyword + embedding + structured filters, with prompt-aware ranking. "The AI is about to draft a customer reply about X — surface the 50 most relevant pieces from support / docs / past replies."
- **Provenance traversal.** "Why did we decide X?" → the AI traverses decision → tasks → notes → chat history → stream items. Six months later, the AI reconstructs the reasoning behind any past decision.
- **Autonomous decision-making over the world model.** With this substrate, the agent answers "what's the most valuable thing for me to do?" — not by reading a pre-baked snapshot, but by querying the world model for what matters now.

This is years of work, not weeks. V1's substrate doesn't preclude any of it; it just doesn't presume any of it either.

### 11.4 Auto-action on external systems

V1 default is "draft don't send." Relaxing it requires per-action permission boundaries, audit trail with rollback for irreversible actions, and a trust dial that scales with observed reliability. The place to be slowest.

---

## 12. What we explicitly don't build (V1)

Putting these in writing so they don't sneak back in:

1. **A pipeline DSL.** Agent loop picks the next move from state. Skills are recipes, not stages.
2. **Proposal staging on every entity write.** All writes go through the live query layer.
3. **A separate review-gate state machine on `runs`.** Existing unread chip is the review surface.
4. **External worker pool / Redis / BullMQ.** SQLite + setInterval is the right size.
5. **OS cron / systemd timers / k8s CronJobs.** Scheduler lives in `instrumentation.ts`.
6. **Anthropic Routines as host.** Runs in Anthropic's cloud, can't see local workspaces.
7. **A separate "Automation" tab.** Configuration where it's used; executions where executions are.
8. **Heartbeat in V1.** V2 primitive. V1 users simulate with a 30-min schedule + supervisor prompt.
9. **"Dream mode" as a primitive.** A schedule prompt at most.
10. **A context engine.** See §5.
11. **Bootstrap files as new inventions.** Reuse `MEMORY.md` + workspace `CLAUDE.md`.
12. **Native connector adapters in V1.** Webhook intake only.
13. **A native MCP marketplace.** Document patterns; don't curate.
14. **Decisions / completions / summaries as new entities.** Notes cover all of it.
15. **Multi-state action protocol in V1.** End of turn = unread.
16. **Goals as a schema in V1.** Markdown convention via `MEMORY.md`.
17. **Destructive action pre-gate in V1.** V2 safety net.
18. **Concurrency lanes in V1.** V2 — add when contention shows up in real usage.
19. **Subagent lineage columns** (`parent_run_id`, `depth`). V2 with multi-agent.
20. **`describe_world` orchestrator action.** Agent calls existing list/get actions individually.
21. **Auto-action on external systems by default.** "Draft don't send."
22. **Cost tracking deferred.** Ships in V1. Non-negotiable.

---

## 13. Tradeoffs we accept

- **No durability across process crash without health-sweep recovery.** Stuck `queued` runs get promoted to `failed` by the existing health sweep. Cron loses one fire per outage unless `catch_up_policy='run_all'`.
- **Cron precision is best-effort.** 60s tick = cron fires within 60s of its mark.
- **Single-machine scale.** Lane model would extend to multi-machine but we're not building that.
- **Cost tracking is client-side estimate** from `@agentex/agent`'s bundled price tables. Truth is Anthropic Admin API; we don't fetch it in V1.
- **Simple status enum.** No `awaiting_input` / `blocked` vocabulary in V1. Autonomous loop in V2 will pressure us to add it; migration is additive.
- **No safety net on destructive actions.** V1 schedules can do anything the registry allows. The orchestrator's prompts are the only guardrail. V2's pre-gate adds the real safety net.
- **No lane fairness.** A burst of webhook fires can crowd out scheduled cron work. V1 trusts the global rate-lease to be enough at our scale; V2 adds lanes when we see real contention.
- **No presence.** Without heartbeat, the AI only fires when a schedule says to. V1 is "scheduled co-worker"; real co-worker pulse comes in V2.

---

## 14. Open questions

These don't block V1:

1. **Catch-up policy default.** `skip_missed` (per this proposal). If the laptop sleeps overnight and 8 nightly jobs missed, user probably doesn't want all 8 to fire at 9am. Per-schedule opt-in, max 3 catch-ups. Validate after first weeks.
2. **NL → cron parsing.** `croner` for parsing; build a small NL→cron layer or call a model. Start simple.
3. **Schedule template seeding.** Ship 3-5 examples at install (morning-triage, weekly-retro, supervisor-pulse) or empty state?
4. **Budget auto-pause UX.** When budget hits 100% mid-run, in-flight runs finish (this proposal) or terminate?
5. ~~Persistent-session compaction.~~ **Resolved by the executions lift.** Recurring workspace schedules reuse the execution (worktree, branch, PR) but create a fresh chat per fire. Chat context is bounded; the artifact persists. See `docs/executions-spec.md`.
6. **Webhook payload size cap.** HMAC verification + a body-size limit. 256KB? 1MB? Decide at build time.
7. **Execution mutex behavior for manual dispatches.** V1 default: reject with a clear error toast when a scheduled run is in flight against the execution the user just tried to message. Wait-then-drain is friendlier UX (queue the message, dispatch on completion) but adds queue surface area. Reject is the smaller V1 surface; switching to wait later is purely additive (no migration). Revisit if users hit this often in practice.
8. **Coalesce-into-which-chat under execution-level concurrency.** When schedule A fires while schedule B (different schedule, same execution) has a `running` run, and A's `concurrency_policy = coalesce_if_active`, do we append A's prompt to B's active chat, or to a chat A "owns"? V1 default: append to B's active chat with a source marker in the appended message ("[from schedule A] …") so the transcript stays legible. Revisit if it causes confusion.

---

## 15. Why this is right

Five summary points:

1. **It matches the existing execution model.** Fire-and-forget dispatch into a hot session is what we already have. The scheduler is just another trigger source.

2. **It's the smallest thing that's useful.** Two new tables, one new column, one new tick, one new endpoint, two new UI surfaces. Phase 1 of one phase.

3. **It treats AI as co-worker-in-waiting.** Scaffolding for presence (heartbeat in V2), pre-gate (V2), connectors (V2), goals + work queue (V2), self-directed (V3+) all sit on top of V1 without revisiting it.

4. **It separates code-controlled mechanism from data-controlled configuration.** The tick is code; what runs on each tick is data. The system can't be broken by an agent or user clobbering a row.

5. **It avoids inventing things Claude Code or the agent already does for free.** No context engine (agent queries). No bootstrap file system (`MEMORY.md` + workspace `CLAUDE.md` already exist). No new entities for decisions/completions (notes cover it). No native connector adapters (webhook intake is the substrate; native + MCP come later).

The pieces beyond V1 — heartbeat, pre-gate, lanes, connectors, goals, work queue, autonomous loops, the full world model — all build on this foundation. None require revisiting the V1 substrate.

---

## Appendix: file map

- `src/lib/db/schema.ts` — table + column additions
- `src/lib/db/queries.ts` — query helpers (per CLAUDE.md, route handlers go through this)
- `src/lib/scheduler/runner.ts` — scheduler tick
- `src/lib/scheduler/lock.ts` — file-based lock
- `src/lib/scheduler/cron.ts` — cron parsing + `computeNextRun()` (uses `croner`)
- `src/lib/scheduler/rate-lease.ts` — global semaphore around `@agentex/agent`
- `src/lib/executor/adapter.ts` — gains dispatch caller from runner; completes harness-agnostic skill loading
- `src/lib/orchestrator/registry.ts` — new schedule/run actions
- `src/lib/pricing/models.json` — provider/model → cents per million tokens
- `src/lib/pricing/models.ts` — loader + cost computation
- `src/app/api/triggers/[public_id]/route.ts` — schedule webhooks
- `src/app/(...)/schedules/` — schedule CRUD pages
- `instrumentation.ts` — scheduler + health sweep startup

---

## The one-line version

> **V1 ships scheduled tasks: `schedules` + `runs`, one 60s tick, webhook intake, cost capture, budget guardrails. Decisions are notes. Review is unread. Skills are harness-agnostic. Heartbeat, pre-gate, lanes, connectors, goals — all V2.**

Everything else is variations on that theme.
