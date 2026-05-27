# Async Agent Execution — v1 Spec

Status: ship plan (synthesized from two independent design passes + 10 turns of debate)
Date: 2026-05-22

---

## TL;DR

1. The goal is to move the app from **AI-as-copilot** (you type, AI responds) toward **AI-as-coworker** (AI has presence, picks up scheduled work, lives between your sessions). v1 ships the substrate; the autonomy gradient extends in v2+.
2. **Build the confident core in one push**: schedules + runs + connectors + skills (harness-agnostic) + cost tracking + rate leases + destructive-action pre-gate + budget guardrails. These belong together.
3. **Schedules trigger work; the orchestrator agent executes.** Cron, interval, webhook, or internal-event triggers. Schedules dispatch through the same `executor.dispatch()` path user messages already use.
4. **One unified `runs` table** for all executions — manual, cron, webhook, connector. Simple status enum (`queued | running | completed | failed | skipped`). The richer completion vocabulary (awaiting_input, blocked, continue_work) is deferred until autonomous loops pressure it.
5. **No new review-gate state.** Scheduled runs surface in the existing executions view with a trigger badge. "Needs review" is just unread (existing `last_outcome_event_at` vs `last_viewed_at` machinery).
6. **Heartbeat deferred to v2**, alongside the notifications primitive it needs. v1 users can simulate it with a supervisor-style schedule that runs every 30 min. We promote heartbeat to its own primitive when usage patterns warrant.
7. **First connector ships in v1** (Gmail or Linear, decided at build time) so the system is real out of the box. Other connectors (and MCP-server-as-connector path) are documented patterns that come later.
8. **Harness-agnostic skill + subagent locations.** This app runs on Claude Code, Codex, and OpenClaw via `@agentex/agent`. Skills live at `<brain>/skills/` and `<workspace>/.flow/skills/`, never inside `.claude/`. Workspace skills commit to git.

---

## 1. The shape of the bet

The current execution model is excellent at synchronous, request-driven work. You sit at the keyboard, the AI helps you build / write / decide / debug. That's the copilot.

The bet is that the next inflection isn't making the copilot smarter — it's making the AI a coworker. Something with persistent presence, standing context, and the ability to act when you're not at the laptop. Polsa-style "humans at the edges, AI does the work" is the trajectory. We don't need to ship that on day one, but the architecture has to enable it without a rewrite.

Three autonomy levels, distinguished by who initiates:

- **Co-pilot** (today): human initiates every turn. AI responds.
- **Co-worker** (v1 substrate + v2 surfaces it): AI wakes on schedule or trigger, executes the prompt, surfaces output for the human. AI does the work; human authored the rule.
- **Self-directed** (v2+): AI wakes, reads world state, decides what's most valuable to do, acts on low-stakes, surfaces high-stakes. Requires goals entity + AI-eligible task flag, both deferred.

v1 ships the foundation for co-worker. Self-directed sits on top of v1 without rewriting it.

---

## 2. What we have, what we're adding

**Already shipped**:
- Typed orchestrator action registry (`src/lib/orchestrator/registry.ts`) — 15 actions, source of truth for CLI + MCP
- Multi-provider executor (`src/lib/executor/adapter.ts`) via `@agentex/agent` — Claude Code, Codex, OpenClaw
- 60s background health sweep (`instrumentation.ts:86-105`, `executor/health.ts`) — reconcile + redispatch
- Session reconcile from on-disk JSONL (`executor/reconcile.ts`)
- Workspace + worktree integration (`src/lib/workspaces`)
- Execution view (4-col Bolt-style, in-flight refactor)
- Cost & usage per turn — available in `@agentex/agent`'s `ModelUsage`, not surfaced yet
- Task heartbeat *columns* on `tasks` — schema only, no consumer

**Gaps v1 fills**:
- Scheduler tick (alongside health sweep)
- `schedules`, `runs`, `connectors` tables
- Webhook endpoints
- Cost capture + budget guardrails
- Rate leases for Anthropic API throughput
- Destructive-action pre-gate
- Harness-agnostic skill discovery
- First connector (Gmail or Linear)
- TopHud + PowerRail extensions

---

## 3. v1 architecture

### 3.1 Scheduler tick

Lives in `instrumentation.ts`, sibling to the existing health sweep:

```ts
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
      // Advance next_run_at FIRST (at-most-once semantics under lock)
      const next = computeNextRun(s, now);
      await db.update(schedules).set({ next_run_at: next }).where(eq(schedules.id, s.id));

      // Spawn the run — don't await
      void dispatchRun(s, { trigger: s.kind, scheduledFor: now });
    }
  } finally {
    await releaseSchedulerLock(lock);
  }
}, 30_000);
```

Properties:
- **Tick is code, not data.** Bad rows don't break the tick; only those rows fail to fire.
- **`next_run_at` advances under lock before dispatch** — at-most-once semantics; crash mid-run doesn't double-fire.
- **One process, one tick, one file lock.** No worker pool, no Redis.
- **Crash safety:** on boot, any `runs` left in `running` get promoted to `failed` by the health sweep with reason `process_restart`. `catch_up_policy` on the schedule determines whether the next tick re-fires.

### 3.2 Schedules

A `schedules` row is "fire under these conditions." User-editable.

| Kind     | Meaning                                                            |
|----------|--------------------------------------------------------------------|
| `at`     | Fire once at an absolute time, then archive                        |
| `every`  | Fire every N seconds, with optional active hours                   |
| `cron`   | Fire on a cron expression in a timezone                            |
| `event`  | Fire when a registered internal event lands (e.g., `stream_item_added`) |

Each schedule has: `prompt`, `agent_id`, optional `workspace_id`, `lane`, `concurrency_policy`, `catch_up_policy`, `enabled`, plus kind-specific config (cron expression, interval seconds, run-at timestamp, or event kind).

**Concurrency policy** (previous run still active):
- `forbid_concurrent` — skip this fire
- `coalesce_if_active` (default) — append as a follow-up message to the active run
- `allow_concurrent` — spawn a new run

**Catch-up policy** (process was down at fire time):
- `skip_missed` (default)
- `run_all` — fire once per missed window, capped at 3

**Webhooks**: a schedule with `kind='event'` and `event_kind='webhook'` gets a unique `webhook_public_id` + `webhook_secret_hash` on creation. External services POST to `/api/triggers/:public_id` with HMAC-SHA256 auth; the runner verifies, enqueues a run, passes the payload through as `trigger_payload`.

### 3.3 Runs

A `runs` row is "this execution happened (or is happening)."

Status enum (v1): `queued | running | completed | failed | skipped`.

Each run gets a `chat_session` (existing table, `type='execution'`). The orchestrator runs inside it. `runs` holds metadata (trigger, lane, status, cost, timing, summary). `chat_events` holds the transcript.

**Why runs separate from sessions:**
- A session may host multiple runs (initial → iterate → re-iterate = three runs on the same session).
- Aggregations need a per-execution row.
- Trigger metadata has nowhere clean to live on the session.

Provenance: a new column `chat_sessions.triggered_by_run_id` (nullable FK) so scheduled runs appear in the existing executions list with a trigger badge — no separate "automation runs" UI.

**Review surface**: existing unread machinery. When a run completes, the chat session sits with the AI's last message; `last_outcome_event_at` updates; existing inbox queries (`last_outcome_event_at > last_viewed_at`) pick it up. User reads, replies if they want, archives if they don't. No new status, no new actions.

For isolated-session runs, each fire creates a fresh `chat_sessions` row; they group in the UI by `schedule_id` (a "weekly retro — 4 runs" affordance). For persistent-session schedules, all runs land in the same session as additional turns; the conversation IS the history.

### 3.4 Connectors

External integrations (Gmail, Linear, Todoist, Notion, Calendar, GitHub). Two trigger paths plus an outbound path:

| Pattern  | Example                                       | Implementation                                                       |
|----------|-----------------------------------------------|----------------------------------------------------------------------|
| Pull     | "Fetch Gmail every 30 min"                    | `every` schedule + connector-specific skill                          |
| Push     | "Linear webhook on issue created"             | POST to `/api/connectors/:id/webhook` → enqueues run                 |
| Sync-out | "Mark Linear ticket done when our task done"  | Hook on `complete_task` → fire-and-forget connector outbound (not a run) |

Each native connector ships:
- Typed actions added to the orchestrator action registry (`gmail.list_recent`, etc.)
- A skill (`<brain>/skills/connector-gmail/SKILL.md`)
- Webhook payload schema (for push)
- OAuth flow handled by CLI (`flow connector add gmail`)

**Webhook split**:
- `/api/triggers/:public_id` — user-defined schedule webhooks. Auth: HMAC-SHA256.
- `/api/connectors/:id/webhook` — connector-platform webhooks (Gmail Pub/Sub, Linear HMAC). Different auth schemes per platform; keeping these split means no incompatible-auth merge.

**MCP servers as the BYO escape hatch**: users with niche needs (or who want a connector we haven't built natively) can register external MCP servers via existing config; the orchestrator's tool list picks them up. We document the pattern. Native connectors are for the common cases where one-click OAuth + a curated skill beat BYO MCP setup.

**First v1 connector**: Gmail or Linear, decided at build time. Both have merit; Linear's HMAC auth is simpler, Gmail's reach is broader. Open question.

### 3.5 Skills + subagents — harness-agnostic

The app runs on Claude Code, Codex, and OpenClaw via `@agentex/agent`. All three share the same model: a file acts as ambient context (like `CLAUDE.md`) and a skills folder gets auto-loaded by description match.

We use harness-agnostic paths and let the executor adapter handle per-harness loading:

- **Global skills**: `<brain>/skills/<name>/SKILL.md` — available everywhere.
- **Workspace skills**: `<workspace>/.flow/skills/<name>/SKILL.md` — codebase-specific, committed to git.
- **Subagents**: same structure under `agents/` paths (mirrors Claude Code's convention but in our location).
- **Resolution**: workspace overrides global on name collision.

Format follows the Claude Code convention (YAML frontmatter + markdown body) so existing skill libraries port.

On dispatch, the executor adapter copies/symlinks our paths into the harness-specific locations the underlying tool expects. This already partially exists in `@agentex/agent`'s `listInstalledSkills()`; verify and complete.

What skills are *not*: not code, not a permission boundary, not pipelines. Markdown only. Multiple skills in one schedule = multiple recipe pages in the prompt, not a sequenced workflow.

### 3.6 Concurrency lanes + rate leases (two layers)

**Layer 1 — lanes (SQLite contention + run ordering)**:

| Lane          | Default cap | Notes                                                       |
|---------------|-------------|-------------------------------------------------------------|
| `manual`      | 3           | User-initiated runs                                         |
| `cron`        | 1           | Scheduled work, serialized                                  |
| `webhook`     | 3           | External event-driven                                       |
| `connector`   | 2           | Connector pulls                                             |
| `<session_id>`| 1           | Per-execution-session — chat sessions are inherently serial |

**Layer 2 — rate leases (Anthropic API throughput)**:

A single global semaphore. Default 4 concurrent. Any code calling `@agentex/agent` for a Claude/Codex subprocess waits for a lease before proceeding. Prevents 429s when manual + cron + webhook collide.

### 3.7 Destructive action pre-gate

Orchestrator actions can be tagged `destructive: true` in the registry. Examples: `send_email`, `merge_pr`, `delete_*`, anything that writes to an external system or causes irreversible local damage.

Destructive actions refuse to execute mid-run unless either:
- The schedule has `require_approval_for_destructive=false` (opt-out, default true), or
- The agent has already called `approve_action` earlier in the same run with the matching action signature.

When a destructive action is gated, the run transitions to `awaiting_input` (already in our v1 status enum? — no, deferred. Reality for v1: the action throws an `ActionError` with code `destructive_not_approved`; the agent surfaces this as a chat message and the run ends with `status='completed'` with the question in the final message; the user replies "approved" and we resume).

This is the v1 shape. When the 4-state vocabulary lands in v2, the gate becomes a clean `awaiting_input` transition.

### 3.8 Budget guardrails

A `monthly_budget_usd` setting at the user / brain level. The scheduler checks current month's spend (sum of `runs.cost_usd` where `started_at >= first of month`) before dispatching:

- **<75%**: dispatch normally.
- **75-99%**: dispatch normally, surface a soft warning in the TopHud strip ("80% of budget used").
- **≥100%**: scheduled runs auto-pause (set `schedules.enabled=false` with `disabled_reason='budget_exceeded'`); manual runs require an `--over-budget` CLI flag or explicit UI confirmation.

In-flight runs at the 100% threshold are allowed to complete. New runs from that point are paused.

### 3.9 PowerRail / executions integration

- **PowerRail (left nav)**: gains "Schedules" group per workspace; "Connectors" group at brain level.
- **Executions list**: shows manual + scheduled + webhook + connector runs interleaved, newest first. Filter pills: `all | manual | scheduled | webhook | connector | unread`.
- **Execution view (4-col)**: identical regardless of trigger. Header gains one row when scheduled: "Triggered by `morning-triage` at 9:00 · next run 9:00 tomorrow."
- **TopHud strip**: active runs count · today's spend · unread count · budget % (if >50%).
- **No separate "Automation" tab.** Configuration lives where it's used (per workspace for workspace-scoped schedules, brain-level for connectors).

---

## 4. Data model

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

  kind: text('kind', { enum: ['at', 'every', 'cron', 'event'] }).notNull(),
  cron_expression: text('cron_expression'),
  interval_seconds: integer('interval_seconds'),
  run_at: text('run_at'),
  event_kind: text('event_kind'),
  timezone: text('timezone').default('UTC'),

  active_hours_start: text('active_hours_start'),
  active_hours_end: text('active_hours_end'),
  active_days: text('active_days', { mode: 'json' }).$type<number[]>(),

  lane: text('lane').notNull().default('cron'),
  concurrency_policy: text('concurrency_policy', {
    enum: ['forbid_concurrent', 'coalesce_if_active', 'allow_concurrent'],
  }).notNull().default('coalesce_if_active'),
  catch_up_policy: text('catch_up_policy', {
    enum: ['skip_missed', 'run_all'],
  }).notNull().default('skip_missed'),
  max_catch_up_runs: integer('max_catch_up_runs').notNull().default(3),
  require_approval_for_destructive: integer('require_approval_for_destructive', {
    mode: 'boolean',
  }).notNull().default(true),

  session_strategy: text('session_strategy', {
    enum: ['isolated', 'persistent'],
  }).notNull(),
  persistent_session_id: text('persistent_session_id').references(() => chatSessions.id),

  webhook_public_id: text('webhook_public_id'),
  webhook_secret_hash: text('webhook_secret_hash'),

  next_run_at: text('next_run_at'),
  last_fired_at: text('last_fired_at'),
  last_run_id: text('last_run_id'),
  disabled_reason: text('disabled_reason'),

  connector_id: text('connector_id').references(() => connectors.id),

  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  schedule_id: text('schedule_id').references(() => schedules.id),
  connector_id: text('connector_id').references(() => connectors.id),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  chat_session_id: text('chat_session_id').references(() => chatSessions.id),
  agent_id: text('agent_id').references(() => agents.id).notNull(),

  trigger: text('trigger', {
    enum: ['manual', 'cron', 'every', 'at', 'webhook', 'event'],
  }).notNull(),
  trigger_payload: text('trigger_payload', { mode: 'json' }),
  lane: text('lane').notNull(),

  status: text('status', {
    enum: ['queued', 'running', 'completed', 'failed', 'skipped'],
  }).notNull().default('queued'),

  // Lease for at-most-once + crash recovery
  claimed_at: text('claimed_at'),
  lock_until: text('lock_until'),

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
  summary: text('summary'),
  artifact_refs: text('artifact_refs', { mode: 'json' }),  // [{kind:'task', id:'...'}, ...]
  error_code: text('error_code'),
  error_message: text('error_message'),

  created_at: text('created_at').notNull(),
});

export const connectors = sqliteTable('connectors', {
  id: text('id').primaryKey(),
  kind: text('kind', {
    enum: ['gmail', 'linear', 'todoist', 'notion', 'calendar', 'github'],
  }).notNull(),
  name: text('name').notNull(),
  config: text('config', { mode: 'json' }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

  webhook_public_id: text('webhook_public_id'),
  webhook_secret_hash: text('webhook_secret_hash'),

  last_sync_at: text('last_sync_at'),
  last_sync_status: text('last_sync_status', { enum: ['ok', 'error', 'partial'] }),
  last_sync_error: text('last_sync_error'),

  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

// Additions to existing tables:

// chat_sessions
triggered_by_run_id: text('triggered_by_run_id').references(() => runs.id, {
  onDelete: 'set null',
}),

// agents
is_system: integer('is_system', { mode: 'boolean' }).notNull().default(false),

// settings (or however we store user-level config)
monthly_budget_usd: real('monthly_budget_usd'),
```

**Indexes**:
- `schedules(enabled, next_run_at)` — scheduler hot path
- `runs(status, lane)` — concurrency check
- `runs(schedule_id, status)` — per-schedule history
- `runs(trigger, started_at)` — activity timeline
- `connectors(enabled, last_sync_at)` — connector dashboard

---

## 5. New orchestrator actions

| Action                 | Purpose                                          | Mutating | Agent-only |
|------------------------|--------------------------------------------------|----------|------------|
| `list_schedules`       | Filters: enabled, kind, lane, workspace_id       | No       | No         |
| `get_schedule`         | Fetch one                                        | No       | No         |
| `create_schedule`      | New schedule                                     | Yes      | No         |
| `update_schedule`      | Patch fields                                     | Yes      | No         |
| `delete_schedule`      | Remove                                           | Yes      | No         |
| `run_schedule`         | Enqueue immediate manual run                     | Yes      | No         |
| `list_runs`            | Filters: status, schedule_id, agent_id, since    | No       | No         |
| `get_run`              | Fetch one with usage rollup                      | No       | No         |
| `cancel_run`           | Best-effort SIGTERM, marks `cancelled`           | Yes      | No         |
| `list_connectors`      | List configured connectors                       | No       | No         |
| `create_connector`     | Add connector (CLI initiates OAuth)              | Yes      | No         |
| `update_connector`     | Patch config / enable / disable                  | Yes      | No         |
| `delete_connector`     | Remove + revoke tokens                           | Yes      | No         |
| `approve_action`       | Pre-approve a destructive action in current run  | Yes      | Yes        |

The destructive-action pre-gate lives on the dispatcher, not as a separate orchestrator action — it inspects the registry's `destructive: true` tag on every action invocation.

---

## 6. UX

### 6.1 CLI

```bash
flow schedule create \
  --name "morning-triage" \
  --cron "0 9 * * 1-5" \
  --prompt "Triage stream items captured overnight" \
  --agent default
flow schedule list / show / pause / edit / delete
flow schedule run <id> [--wait]

flow runs                                       # all runs, paginated
flow runs --unread                              # what needs my attention
flow run show / cancel

flow connector add gmail                        # OAuth via CLI
flow connector list / show / sync / disable

flow spend                                      # today/week/month
flow spend --by agent / schedule / connector
```

### 6.2 Dashboard

- **PowerRail (left)**: `Schedules` per workspace, `Connectors` at brain level, `Brain` group as today.
- **Schedules list / detail**: name, cadence, lane, next fire, last status, toggle; detail = Tiptap prompt editor + next-runs preview + run history.
- **Connectors list / detail**: kind, status, last sync, webhook URL (if push), re-auth action.
- **Runs view**: extends existing executions view with trigger badge + filter pills. Bundled group when multiple unread runs of the same schedule accumulate ("morning-triage · 3 unread").
- **TopHud strip**: today's spend · active runs · unread · budget % (when >50%).

### 6.3 Schedule creation

Single form, top to bottom:

1. **What** — name, prompt, optional description.
2. **When** — `[ Run on a schedule | Every N minutes | When triggered (webhook) ]`. For "on a schedule," natural-language input ("every weekday at 9am") that compiles to cron + timezone, with the resolved expression and next 3 fire times shown beneath.
3. **Where** — target workspace or orchestrator session. Session strategy (persistent / isolated, with help text). Skills selector.
4. **Settings** — model override, timeout, active hours, concurrency policy.
5. **Save** — preview of next fire, then save.

---

## 7. Tradeoffs we're accepting

- **No durability across process crash without health-sweep recovery.** Stuck `queued` runs get promoted to `failed` by the existing health sweep. Cron loses one fire per outage unless `catch_up_policy='run_all'` (capped at 3).
- **Cron precision is best-effort.** 30s tick = cron fires within 30s of its mark.
- **Single-machine scale.** Lane model extends to multi-machine but we're not building that.
- **Cost tracking is client-side estimate** from `@agentex/agent`'s bundled price tables. Truth is the Anthropic Admin API; we don't fetch it in v1.
- **Simple status enum.** No `awaiting_input` / `blocked` / `continue_work` vocabulary in v1. The autonomous loop in v2 will pressure us to add it; the migration is additive (new enum values + new actions, no in-flight breakage).
- **No real-time Gmail push in v1** if Gmail is the first connector. Pull every 30 min; Pub/Sub push later.
- **Heartbeat absent.** Users wanting a supervisor pulse write a schedule that runs every 30 min with a supervisor-style prompt. When the pattern matures, we promote it to a proper primitive.

---

## 8. Deferred to v2 (explicit list)

Each of these is intentionally out of v1 with a note on why:

- **Heartbeat as a primitive**. v1 users simulate it with a schedule. Promote when we know what the right cadence + output shape + cost model is. Needs notifications first.
- **Notifications table**. Global inbox primitive — heartbeat output, run state transitions, connector events, cost alerts. Build with heartbeat.
- **4-state completion protocol** (`awaiting_input`, `blocked`, `continue_work`). Locks the orchestrator contract; right time is when autonomous loops genuinely need it. Migration is additive.
- **Subagent lineage** (`parent_run_id`, `depth` on runs). Add when multi-agent coordination exists. Today, Claude Code subagents are within-turn and roll up into parent run's cost.
- **Goals entity**. Load-bearing for self-directed autonomy. Shape: title, description, area_id, target_date, success_criteria, status, parent_goal_id.
- **Work queue + `tasks.ai_eligible` flag**. The "agent picks from a queue" pattern. Build after goals.
- **Self-directed autonomy mode**. Needs goals + queue + a few weeks of co-worker usage to inform the design.
- **Decisions surface**. Either a note type or a separate table; defer the decision (no pun intended).
- **Additional connectors**: Linear, Todoist, Notion, Calendar, GitHub (whichever wasn't shipped first).
- **Schedule templates UI**. Pre-baked schedules as one-click create. Useful after we see what people actually create.
- **Activity timeline view as its own page**. v1 surfaces activity through the extended executions view. Promote to its own surface if filtering / rollups grow beyond what fits there.
- **Per-skill or per-action-class autonomy levels**. Finer-grained trust than `off/semi/full`. Build when the destructive-action pre-gate proves too coarse.
- **Multi-agent specialization** (marketing agent, ops agent, etc.). Single agent in v1; multi-agent when use cases pressure it.

---

## 9. Open questions

These don't block v1 — most are decisions made at build time or after a few weeks of usage:

1. **First connector**: Gmail or Linear? Linear is easier (HMAC, no OAuth), Gmail has broader reach. Decide at build time.
2. **Notifications table name** (when we build it in v2): `notifications`, `agent_signals`, `inbox_items`?
3. **Heartbeat output destination** (when we build it): write to notifications, or to a special-typed `chat_event` on the orchestrator session? Tradeoff is reusing existing chat machinery vs polluting the chat transcript.
4. **Destructive action registry**: what specifically gets tagged `destructive: true`? Start opinionated (`send_email`, `merge_pr`, `delete_*`, `publish_*`, anything writing to external systems), expand as patterns emerge.
5. **Budget auto-pause UX**: when budget hits 100% mid-run, do in-flight runs finish or terminate? v1 default: let them finish, pause new ones.
6. **Catch-up policy default**: off in this proposal (skip_missed), opt-in per schedule, max 3 catch-ups. Validate after first weeks of usage.
7. **Decisions surface eventually**: note type or separate table? Defer until v2.
8. **NL → cron parsing**: use `croner` for parsing; build a small NL→cron layer or call a model to translate. Start simple.
9. **Schedule template seeding**: do we ship 3-5 example schedules (morning-triage, weekly-retro, supervisor-pulse) at install? Or empty state?
10. **Heartbeat-as-a-schedule pattern**: how do we document the supervisor-pulse pattern for v1 users so they know they can simulate heartbeat? Docs + a starter template in the seeded schedules (if we do #9)?

---

## 10. Anti-patterns explicitly rejected

These are tempting and wrong. Putting them in writing so they don't sneak back in:

1. **A pipeline DSL.** The orchestrator picks the next move from state. Skills are recipes, not stages.
2. **Proposal staging on every entity write.** All writes go through the live query layer. Review is post-hoc (via unread); destructive actions have an explicit pre-gate.
3. **External worker pool / Redis / BullMQ.** SQLite is the broker. Single in-process tick.
4. **External cron / systemd timers / k8s CronJobs.** Scheduler lives in `instrumentation.ts`.
5. **A separate "Automation" or "Connectors" tab.** Configuration lives where it's used; executions live where executions already live.
6. **OS cron triggering CLI commands.** Same reason: scheduler needs to know about session state, worktrees, executor lifecycle.
7. **Anthropic Routines.** Cloud-hosted, can't see local workspaces, daily-capped. Wrong host.
8. **Predictive / AI-decides-when scheduling.** Schedules are explicit. Agent can `update_schedule` but no adaptive timing in v1.
9. **Multi-agent IPC primitives.** Subagents return their final message; that's the handoff. No message bus between agents.
10. **Mid-run pause / resume / migrate-agent.** A run runs to terminal. If different handling is needed, the human iterates after the run completes.
11. **"Dream mode" as a primitive.** A schedule template at most.
12. **OpenClaw-style weighted scoring for memory promotion.** Out of scope for v1 entirely; if we want memory consolidation later, it's a curator-style scheduled job.
13. **Comments on tasks/notes as a feedback surface.** Iteration on a run lives in the run's chat. Artifacts edited in their normal editors.
14. **A collaborative-document editor.** The 4-col execution view's file pane does this.
15. **An "approval inbox" screen.** Inbox is a filter on the existing runs view.
16. **Decisions / completions / summaries as separate entities.** Notes or `runs.summary` cover all of v1's needs.
17. **`.claude/skills/`-style hardcoded paths.** Harness-agnostic locations under our control; executor adapter translates per harness.

---

## 11. Build order (not phases — one push)

Implementation order within v1, no ship gates between them:

1. **Schema migrations** — `schedules`, `runs`, `connectors`, column additions.
2. **Scheduler tick** in `instrumentation.ts` + file lock + `next_run_at` advance semantics.
3. **`runs` dispatch path** — create chat_session, attach to schedule, call `executor.dispatch`.
4. **Cost capture** from `@agentex/agent` `result` event into `runs.{tokens, cost_usd}`.
5. **Rate-lease semaphore** wrapping all `@agentex/agent` invocations.
6. **Destructive action pre-gate** on orchestrator action registry + dispatcher.
7. **Budget guardrails** — settings table column + threshold check on dispatch.
8. **Schedules CRUD UI** + creation form with NL → cron.
9. **Runs view extension** — trigger badge + filter pills + bundling.
10. **TopHud extension** — spend, runs, unread, budget %.
11. **Webhook endpoint** `/api/triggers/:public_id` with HMAC.
12. **First connector** (Gmail or Linear) — OAuth flow, sync skill, webhook handler, actions in orchestrator registry.
13. **CLI surface** for everything.
14. **Skills harness-agnostic loading** — verify/complete `@agentex/agent` integration.

Estimated effort: 6-8 focused weeks. Ships as one release.

---

## Appendix: file map

- `src/lib/db/schema.ts` — table + column additions
- `src/lib/db/queries.ts` — query helpers (per CLAUDE.md, route handlers go through this)
- `src/lib/scheduler/runner.ts` — scheduler tick
- `src/lib/scheduler/lock.ts` — file-based lock
- `src/lib/scheduler/cron.ts` — cron parsing + next_run_at computation (uses `croner`)
- `src/lib/scheduler/rate-lease.ts` — global semaphore
- `src/lib/executor/adapter.ts` — gains dispatch caller from runner
- `src/lib/orchestrator/registry.ts` — new actions + `destructive: true` tags
- `src/lib/pricing/models.json` — provider/model → cents per million tokens
- `src/lib/pricing/models.ts` — loader + cost computation
- `src/lib/connectors/<kind>/` — per-connector OAuth + sync + webhook handler
- `src/app/api/triggers/[public_id]/route.ts` — schedule webhooks
- `src/app/api/connectors/[id]/webhook/route.ts` — connector webhooks
- `src/app/(...)/schedules/` — schedule CRUD pages
- `src/app/(...)/connectors/` — connector CRUD pages
- `instrumentation.ts` — scheduler + health sweep startup
