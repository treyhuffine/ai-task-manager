# Async Agent Execution — Plan (v5)

> **Scope.** How an agent works in this app *when the human isn't sitting at the keyboard*: scheduled jobs, webhook triggers, and the human-review surface that catches everything before it ships.
>
> **Status.** Draft v5. Tightens V1 to just *scheduled tasks*. Heartbeat moved to V2. Context engine removed entirely — the agent queries what it needs, we don't pre-bake snapshots. The real "world model" (the AI's organizational memory and autonomous decision-making substrate) is clarified as V3+ direction.
>
> **Superseded:** v1/v2/v3/v4 in this file; the parallel `scheduled-async-agents-spec.md` (kept for reference).

---

## TL;DR

V1 is **scheduled tasks**. That's it.

- **Schedules** — cron / interval / at / webhook / manual triggers that dispatch a prompt against a workspace or the orchestrator.
- **One in-process 60s tick** processes due schedules through the same `executor.dispatch()` path the UI already uses.
- **Scheduled runs surface as executions** in the existing 4-col view with a provenance chip. The existing unread machinery is the review surface — no new state machine.
- **Skills** as procedural memory at `<brain>/.claude/skills/` (global) and `<workspace>/.claude/skills/` (per-workspace) — Claude Code's native hierarchy.
- **Webhook intake** for inbound triggers from external systems. No native connectors and no MCP marketplace in V1.
- **Activity timeline + cost rollup** — one page that answers "what's the AI been up to and what is it costing me?"
- **Decisions as notes** — no new entity. The existing `notes` table covers them.

That's V1. Everything else — heartbeat, goals, work queue, self-directed autonomy, multi-state action protocol, full world model — is named in §8 as direction. None of it is built yet; none of it requires revisiting the V1 substrate.

What this is *not*:

- A pipeline DSL.
- A separate review-gate state machine on `schedule_runs`.
- A pre-baked "world snapshot" injected on every dispatch. (See §6.)
- A heartbeat reflex. (Moved to V2.)
- A Redis/BullMQ queue. (SQLite + setInterval is the right size.)
- Anthropic Routines as host. (Runs in Anthropic's cloud, can't see local state.)
- A native connector catalog or MCP marketplace. (Webhook intake only.)
- Goals / projects / work-packets as new schemas. (Notes / tasks / convention via `MEMORY.md` until patterns demand otherwise.)

---

## 1. The shape of the bet

Co-pilot vs. co-worker is an axis of **who initiates**:

| Tier             | Initiation                                                            | Status in V1                          |
|------------------|-----------------------------------------------------------------------|---------------------------------------|
| Co-pilot         | Human starts every interaction. AI responds.                          | Default (existing behavior)           |
| Co-worker        | AI picks up eligible work on a wake. Asks when stuck. Surfaces when done. | Partial — schedules give *cron-driven* initiation; heartbeat (V2) gives *presence* |
| Self-directed    | AI asks "what's the most valuable thing for me to do?" Picks freely.   | Defer — needs goals + world model     |

V1 ships **scheduled initiation only**. A schedule fires on time → the AI runs a defined prompt → output lands as an execution. That's the simplest form of "AI does work the human didn't kick off this second." It's still co-pilot-ish (the human authored the schedule), but it's the first step toward presence.

What V1 deliberately doesn't ship:

- **Heartbeat** (V2). Without it, the AI doesn't have a *pulse* — it only fires when a schedule says to. This is fine for V1 because we want to validate the scheduler machinery end-to-end before layering presence on top. Heartbeat adds rows to `agents` + a check inside the same tick — additive, not architectural.
- **Goals** (V2, load-bearing). Without goals, "self-directed" autonomy has no value function. We can't ship `full` autonomy without the AI having something to anchor "most valuable" to.
- **Work queue + autonomy levels** (V2). Tasks gain an `ai_eligible` flag + autonomy_level. A scheduled wake "advance work queue" picks the highest-priority eligible task. The first real co-worker behavior.
- **The full world model** (V3+, see §8.7). Giving the AI access to the entire organizational history — every decision, project, customer signal, piece of work — as substrate for autonomous decision-making. This is the long-end vision; V1 is the scaffolding under it.

---

## 2. What Claude Code gives us, what we build

The boundary we hold. Every primitive Claude Code does well → we author markdown / config instead of building infrastructure.

| Concern                                | Claude Code provides                                | We build                                               |
|----------------------------------------|-----------------------------------------------------|--------------------------------------------------------|
| Agent loop, tool calling               | Yes (via `@agentex/agent`)                          | Nothing                                                |
| Subagent spawning                      | Yes (Agent tool)                                    | `.md` files in `.claude/agents/` when needed           |
| Skill selection                        | Yes (description-matching auto-load)                | `SKILL.md` files in `.claude/skills/`                  |
| Hierarchical skill resolution          | Yes (`<cwd>/.claude/`, ancestor, `~/.claude/`)      | App-shipped to `<brain>/.claude/`                      |
| Per-tool permissions                   | Yes (interactive prompts; SDK callback)             | Existing unread surface handles run-level review       |
| Context compaction                     | Yes (automatic)                                     | Critical state goes in `MEMORY.md` / `CLAUDE.md`       |
| Session resume                         | Yes                                                 | Capture `sessionId`; Claude does the rest              |
| Reading workspace `CLAUDE.md`          | Yes (automatic when running with cwd)               | Nothing — author the file when useful                  |
| Reading `MEMORY.md`                    | Existing pattern; agents already read & write       | Nothing — author content over time                     |
| Cost & token usage per turn            | Yes (`ExecutionResult.usage`, `costUsd`)            | Persist what's emitted                                 |
| Hooks                                  | Yes                                                 | Use for activity-log persistence                       |
| Scheduling on self-hosted infra        | **No** (Routines is Anthropic-hosted)               | Our scheduler                                          |
| Webhook intake                         | **No**                                              | `/api/webhooks/:webhook_public_id`                     |
| Domain model (tasks/notes/...)         | **No**                                              | Drizzle schema, query layer                            |
| Cost rollup at session/agent/schedule level | **No** (Admin API is org-level)                | Roll up from per-run captures                          |
| Budget guardrails                      | **No**                                              | `monthly_budget_usd` + warn/pause                      |

**Key consequence of this boundary:** the agent already has access to `MEMORY.md` and the workspace's `CLAUDE.md` through Claude Code's native file reads. The agent also has access to all our domain entities through the existing action registry. We do **not** need to manufacture a "world snapshot" and inject it on every dispatch — the agent queries what it needs from the prompt context. See §6 for full reasoning.

---

## 3. What we already have

| Capability                                  | Where it lives                                         | Status                                            |
|---------------------------------------------|--------------------------------------------------------|---------------------------------------------------|
| Typed action registry (CLI + HTTP MCP)      | `src/lib/orchestrator/registry.ts`                     | Shipped — 15 actions                              |
| NL MCP (free-form `query` / `update`)       | `/api/[transport]`                                     | Shipped                                           |
| Multi-provider executor                     | `src/lib/executor/adapter.ts` (`@agentex/agent`)       | Shipped — Claude Code, Codex, OpenClaw            |
| Per-turn message queue                      | `chat_events.queued_at` + drain loop                   | Shipped                                           |
| 60s background health sweep                 | `instrumentation.ts:86-105`                            | Shipped — reconcile + redispatch                  |
| Session reconcile from JSONL                | `executor/reconcile.ts`                                | Shipped                                           |
| Skills inventory at session boot            | `adapter.ts` + `listInstalledSkills()`                 | Shipped                                           |
| Execution view (4-col Bolt-style)           | `docs/execution-view-spec.md`                          | In-flight refactor                                |
| Cost & usage per turn                       | `@agentex/agent` `ModelUsage`                          | Available, not surfaced                           |
| Workspace + worktree integration            | `src/lib/workspaces`                                   | Shipped                                           |
| Brain `MEMORY.md`                           | Per existing memory pattern                            | Shipped (agents already write to it)              |
| Workspace `CLAUDE.md`                       | Claude Code convention                                 | Picked up natively by Claude Code                 |
| Unread machinery                            | `chat_sessions.last_outcome_event_at` / `last_viewed_at` | Shipped                                         |
| Attachments                                 | `/api/attachments`                                     | Shipped                                           |

Gaps for V1: scheduler tick, schedules + schedule_runs tables, webhook intake, activity + cost views, one new FK on `chat_sessions`.

---

## 4. V1 architecture

### 4.1 The system tick

A single 60s tick in `src/lib/scheduler/runner.ts`, started when the Next.js server boots:

```ts
const TICK_INTERVAL_MS = 60_000;

setInterval(async () => {
  const lock = await acquireSchedulerLock();   // file-based, like Hermes
  if (!lock) return;
  try {
    const now = new Date();
    await processSchedules(now);               // schedules whose next_run_at is past
  } finally {
    await releaseSchedulerLock(lock);
  }
}, TICK_INTERVAL_MS);
```

Properties:

- **Tick is code; rows are data.** A broken schedule row doesn't break the tick — it just doesn't fire.
- **At-most-once.** `next_run_at` advances *before* dispatch. A crash between advance and dispatch leaves a `schedule_run` in `running` status; on boot it gets marked `failed` with reason `process_restart`.
- **One process, one tick, one lock.** No worker pools, no Redis, no BullMQ.
- **Global API throttle.** A single semaphore around `executor.dispatch()` caps Anthropic API concurrency (default 4). Prevents 429s when multiple schedules + manual runs collide.
- **Heartbeat layers in here later.** When V2 ships heartbeat, `processHeartbeats()` is added as a sibling call inside the same tick. No tick redesign required.

### 4.2 Schedules

A schedule is a user-authored rule: "do this on this cadence."

```ts
export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),

  // Naming
  name: text('name').notNull(),
  description: text('description'),

  // What to run
  prompt: text('prompt').notNull(),
  skills: text('skills', { mode: 'json' }).$type<string[]>().default([]),
  agent_id: text('agent_id').references(() => agents.id),

  // Target
  target_kind: text('target_kind', { enum: ['workspace', 'orchestrator'] }).notNull(),
  workspace_id: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  session_strategy: text('session_strategy', { enum: ['isolated', 'persistent'] }).notNull(),
  persistent_session_id: text('persistent_session_id')
    .references(() => chat_sessions.id, { onDelete: 'set null' }),

  // Trigger
  trigger_kind: text('trigger_kind', {
    enum: ['cron', 'interval', 'at', 'webhook', 'manual'],
  }).notNull(),
  cron_expr: text('cron_expr'),
  timezone: text('timezone'),
  interval_seconds: integer('interval_seconds'),
  run_at: text('run_at'),
  webhook_secret_hash: text('webhook_secret_hash'),
  webhook_public_id: text('webhook_public_id'),

  // Active hours
  active_hours_start: text('active_hours_start'),
  active_hours_end: text('active_hours_end'),

  // Concurrency & catch-up
  concurrency: text('concurrency', {
    enum: ['skip_if_running', 'queue', 'coalesce'],
  }).notNull().default('skip_if_running'),
  catch_up: integer('catch_up', { mode: 'boolean' }).notNull().default(false),
  max_catch_up_runs: integer('max_catch_up_runs').notNull().default(3),

  // Model overrides
  model: text('model'),
  effort: text('effort', { enum: ['low', 'medium', 'high', 'xhigh', 'max'] }),
  timeout_seconds: integer('timeout_seconds').notNull().default(900),

  // Lifecycle
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  next_run_at: text('next_run_at'),
  last_run_at: text('last_run_at'),
  last_run_status: text('last_run_status'),
  consecutive_failures: integer('consecutive_failures').notNull().default(0),
  disabled_reason: text('disabled_reason'),

  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

Defaults that matter:
- `target_kind='workspace'` defaults `session_strategy='persistent'` (the workspace's "AI lane" — replies continue the conversation).
- `target_kind='orchestrator'` defaults `session_strategy='isolated'` (each run is a fresh starting point).

Note: no `context_scope` field. The schedule's *prompt* tells the agent what to do; the agent queries what it needs via the action registry. See §6.

### 4.3 Schedule runs

One row per fire. **No `awaiting_review` / `awaiting_input` / `blocked` states** — the existing unread machinery is the review surface.

```ts
export const schedule_runs = sqliteTable('schedule_runs', {
  id: text('id').primaryKey(),
  schedule_id: text('schedule_id').notNull()
    .references(() => schedules.id, { onDelete: 'cascade' }),

  trigger: text('trigger', {
    enum: ['cron', 'interval', 'at', 'manual', 'webhook', 'catch_up'],
  }).notNull(),
  trigger_payload: text('trigger_payload', { mode: 'json' }),

  chat_session_id: text('chat_session_id')
    .references(() => chat_sessions.id, { onDelete: 'set null' }),

  status: text('status', {
    enum: ['queued', 'running', 'completed', 'failed', 'skipped'],
  }).notNull().default('queued'),
  status_reason: text('status_reason'),

  scheduled_for: text('scheduled_for').notNull(),
  started_at: text('started_at'),
  finished_at: text('finished_at'),

  // Output
  summary: text('summary'),                        // 1-3 sentences for the timeline
  output_preview: text('output_preview'),
  error_message: text('error_message'),

  // Cost
  input_tokens: integer('input_tokens'),
  cached_input_tokens: integer('cached_input_tokens'),
  cache_creation_input_tokens: integer('cache_creation_input_tokens'),
  output_tokens: integer('output_tokens'),
  cost_cents: integer('cost_cents'),
  model_used: text('model_used'),
  duration_ms: integer('duration_ms'),

  created_at: text('created_at').notNull(),
}, (table) => [
  index('idx_schedule_runs_schedule_status').on(table.schedule_id, table.status),
  index('idx_schedule_runs_status_scheduled').on(table.status, table.scheduled_for),
]);
```

When a run completes, the chat session it created (or continued) sits in the same state as any session whose AI just took a turn. The user comes back, sees the unread chip (driven by `last_outcome_event_at` > `last_viewed_at`), reads, replies if they want. The review surface is the existing inbox.

Runs of isolated-session schedules get a fresh `chat_sessions` row each fire. They group in the UI by `schedule_id` (a "weekly retro — 4 runs" affordance). Persistent-session schedules append to the same session as additional turns; nothing to group because the conversation is the history.

### 4.4 Scheduled runs surface as executions

The defining choice that keeps the system from forking into two UIs:

- A scheduled run that targets a workspace **creates or continues a `chat_session` with `type='execution'`** — same shape as user-initiated executions. With `session_strategy='persistent'`, it reuses the workspace's "AI lane" session; with `isolated`, it creates a fresh one with its own worktree (for git workspaces).
- New column on `chat_sessions`: `triggered_by_schedule_run_id` (nullable FK) records provenance.
- Wherever execution sessions appear today (workspace detail, power rail, recent runs), scheduled ones appear alongside, with a small chip ("from schedule: Morning triage") in the session header.
- The Inbox / unread feed is a filtered view: sessions where `last_outcome_event_at > last_viewed_at`. Scheduled and user-initiated runs sit in the same inbox; an optional filter chip "from schedules" narrows.

Net effect: every existing execution affordance — worktree diff, PR open, mid-stream interaction, takeover-locally — works for scheduled runs without re-implementation.

### 4.5 Skills

Two locations, opinionated about commit policy:

| Scope     | Location                                       | Notes                                                |
|-----------|------------------------------------------------|------------------------------------------------------|
| Global    | `<brain>/.claude/skills/<name>/SKILL.md`       | User's library, available everywhere                 |
| Workspace | `<workspace>/.claude/skills/<name>/SKILL.md`   | Codebase-specific, **committed to git** by default   |

Claude Code's native hierarchical resolution handles workspace + ancestor + user-global skill discovery. We don't write resolution logic.

Format follows the convention Claude Code already uses (YAML frontmatter + markdown body):

```markdown
---
name: github-pr-review
description: Review a PR for correctness, security, and style
---
# GitHub PR review

When invoked, look up the PR via the gh CLI, read the diff, and check for...
```

A schedule's `skills` field references skill names by hint; the orchestrator's normal description-matching picks them up at dispatch.

What skills are *not*:
- Not code. Markdown only.
- Not a permission boundary. Tool access is on the agent.
- Not pipelines. Multiple skills in one schedule = multiple recipes available to the agent, not a sequenced workflow.

### 4.6 Decisions

Decisions are **notes**. No new entity.

When the agent makes a decision of substance, it calls `create_note` with `title: "Decision: ..."` and a body containing context, options considered, the decision, and expected consequences. The note shows up in the brain's notes list. The user reads, edits, archives like any other note.

Future hooks if patterns demand:
- A `kind` field on notes that includes `'decision'` for filtering — additive
- A "Decisions" filter in the notes list — UI-only

For V1: the convention is the agent's prompt + `MEMORY.md` telling it to write decisions as notes with the `"Decision:"` title prefix. No schema change, no new table.

### 4.7 Connectors

**V1 ships only webhook intake.**

External services can POST to `/api/webhooks/:webhook_public_id` with an HMAC signature derived from the schedule's secret. The runner verifies, fires the schedule, passes the payload through as `trigger_payload` available to the prompt.

That's it. No native Gmail/Linear/Todoist/etc. adapters. No MCP server marketplace. No OAuth flows for individual services.

For V2+, both paths stay open:
- Hand-rolled adapters where we want polished UX
- User-registered MCP servers for outbound (Linear/Gmail/Slack MCPs already exist)
- Decision per-integration based on usage signals

The V1 webhook + skills + future MCP support gives us the substrate to go either way without commitment.

### 4.8 Activity timeline + cost rollup

A single page that answers "what's the AI been up to?" — different aggregation of existing data.

**Timeline section** (newest first):
- All `schedule_runs` and notable user-initiated `chat_sessions` events across the last 7 days
- Each row: time, schedule (if any), workspace, status, summary, cost
- Filterable by workspace, schedule, status, date range

**Cost rollup section** (top of page):
- Today / 7d / 30d totals
- Top 5 schedules by spend
- Per-model breakdown

Cost data comes from `schedule_runs.{input_tokens, cached_input_tokens, output_tokens, cost_cents}`, populated at run completion from `@agentex/agent`'s `result` event. Pricing tables in `src/lib/pricing/models.json` map provider/model → cents per million tokens.

**Budget guardrails:**
- `monthly_budget_usd` setting in config
- 75% spend → activity page shows a warning banner; the orchestrator agent gets a `budget_warning` note next time the user interacts
- 100% spend → scheduled runs auto-pause; manual runs require explicit override

This is small in code (one new query, one new page) and load-bearing for trust. Without it, users can't enable schedules confidently.

---

## 5. Schema changes summary

```ts
// 1. New column on chat_sessions:
triggered_by_schedule_run_id,

// 2. New table `schedules` (see §4.2)
// 3. New table `schedule_runs` (see §4.3)
```

Migrations:
- One Drizzle migration for `chat_sessions.triggered_by_schedule_run_id`.
- One for `schedules` + `schedule_runs`.

That's the whole schema delta for V1. No new columns on `agents` (heartbeat is V2). No `nudges` or `heartbeat_config` tables. No `connectors` table.

New orchestrator actions:
- `list_schedules`, `get_schedule`, `list_schedule_runs`, `run_schedule_now`
- `list_skills`

Mutating schedule actions (`create_schedule`, `update_schedule`, `delete_schedule`) are deferred to V2. V1 = UI-only creation. Let agents read but not mutate schedules; see what patterns emerge.

---

## 6. The thing we are *not* building: a context engine

This deserves its own section because it was in earlier drafts and is being removed deliberately.

**What "context engine" would have been:** on every scheduled dispatch, before the schedule's prompt runs, inject a structured snapshot of recent state — top open tasks, recent stream items, workspaces touched today, schedules due in next 24h, etc. — as a synthetic first user message.

**Why we're not building it:**

1. **The agent is smart and has tools.** The schedule's prompt tells the agent what to do. The agent calls `list_tasks`, `list_stream`, `get_workspace`, etc. as needed. Pre-baking a snapshot means *we* decide what's relevant before the agent has even started. We get it wrong half the time.
2. **Most of the snapshot is noise for any specific task.** A "triage the inbox" run doesn't need "schedules due in next 24h." A "review this PR" run doesn't need "open tasks across all workspaces." Generic snapshots dilute the relevant signal.
3. **The agent already gets the things that matter for free.** Workspace `CLAUDE.md` is loaded by Claude Code natively when running in that cwd. Brain `MEMORY.md` is read by the orchestrator agent on demand (and we can prompt it to do so up front in the schedule's prompt if we want). The schedule's `prompt` field is the right place to scope context — not a generic injection layer.
4. **Adding complexity we'd have to rip out.** Token budgets, truncation rules, per-schedule scope flags, a `describe_world` action — all infrastructure for a problem the agent doesn't actually have.

**What we do instead:**

- Author schedule prompts that are specific about what to read. "Triage the inbox" → the prompt says "use `list_stream` filtered to the last 24 hours" or just lets the agent figure it out.
- Trust Claude Code's existing context loading (CLAUDE.md, ancestor CLAUDE.md, ~/.claude/CLAUDE.md).
- Trust the agent's tool use.
- Add `describe_world` later (V2+) only if dogfooding shows the agent is wasting turns on orientation.

**What this is not:** this is not the *world model*. The world model is a different thing entirely. See §8.7.

---

## 7. UX

### 7.1 Navigation

Add **Automations** to the left nav (sibling to Workspaces):
- **Schedules** (default view) — list, status pills, next/last run
- **Runs** — timeline filtered by schedule

Add **Activity** to the left nav:
- Timeline of recent runs across all sources
- Cost rollup at the top

The **Inbox** lives in the existing notification surface, with an optional filter chip "from schedules."

### 7.2 Schedule creation

One form, no tabs. Top to bottom:

1. **What** — name, prompt, optional description.
2. **When** — `[ On a schedule | Every N | At a specific time | When triggered (webhook) ]`. For "on a schedule," a natural-language input ("every weekday at 9am") that compiles to cron + timezone, with the resolved expression and a preview of the next 3 fire times shown beneath.
3. **Where** — target (workspace dropdown or "orchestrator"). Session strategy (persistent / isolated, with help text). Skills selector (multi).
4. **Settings** — model override, effort, timeout, active hours.
5. **Save** — preview of the next fire, then save.

### 7.3 Workspace surfaces

Each workspace's detail view gains a small "Automations" section listing schedules whose `workspace_id` matches, with next/last run. Click-through to edit. "+ New schedule for this workspace" action.

### 7.4 Run detail

Clicking any `schedule_run` takes you to the chat session it created (or continued), with a header strip showing schedule provenance, fire time, and cost. For workspace runs, the existing worktree diff / PR controls are present unchanged.

---

## 8. Where we're heading (direction, not V1 scope)

What we're building toward but not designing now. The V1 substrate is intentionally compatible with each — they're additive, not rewrites.

### 8.1 Heartbeat (V2)

The AI's pulse. Columns on `agents` (interval, prompt template, active hours, session strategy, last run). A `processHeartbeats()` call inside the existing tick that fires due agents through `executor.dispatch()`. A `<brain>/HEARTBEAT.md` file the user authors as standing supervisory instructions.

Why it's V2 and not V1: it's purely additive (no migration), and it requires the schedule machinery to be validated first. Once V1 is dogfooded, heartbeat is roughly one week of focused work to add.

Open question: default ON or OFF for new installs. Onboarding can ask; the constant is one-line changeable.

### 8.2 Goals (V2, load-bearing)

The single most important V2 addition. Without goals, autonomous decision-making has no anchor — "what's the most valuable thing for me to do?" requires "know what we're trying to achieve."

Goals get a real schema: title, description, target_date, success_criteria, status, parent_goal_id, area_id. Tasks link to goals. The agent's context (when it scans) surfaces active goals.

### 8.3 Work queue + autonomy levels (V2)

Tasks get an `ai_eligible` flag (user-set OR agent-proposed with batch confirmation) and an `autonomy_level` enum (`off` / `semi`). A scheduled wake "advance work queue" picks the highest-priority eligible task and works on it. The agent's role-shift from co-pilot to co-worker.

`full` autonomy (the inverted "AI picks what to work on") waits for goals + a few weeks of `semi` dogfooding.

### 8.4 Multi-state action protocol (V2+)

When the autonomous loop arrives, the agent gets explicit actions for declaring run state:
- `request_input` (asking, not telling)
- `report_blocked` (move on, surface later)
- `continue_work` (re-enter without human)

These are essential for the `report_blocked → move on` behavior that makes self-directed autonomy work. V1 leaves them out because end-of-turn = unread is the surface; we don't need them until the agent is running autonomously.

### 8.5 Self-improvement (V2+)

- **Skill curation** — the AI notices "I keep doing this pattern" and writes/updates a SKILL.md file. Idle-triggered. Always reviewable, never deletes.
- **Memory consolidation** — periodic distillation of recent activity into `MEMORY.md`. Probably a scheduled run with a special prompt; not a runtime mode.

### 8.6 Connectors as a real surface (V2+)

Webhook intake + MCP support layered on top. Either build native adapters for high-value integrations (Gmail, Linear) or rely on the MCP ecosystem. Decided per-integration based on usage signal.

### 8.7 The world model (V3+, the big bet)

This is what was called "world model" in conversation and conflated with the (now-deleted) context engine. They are not the same thing.

**The world model is the AI's organizational memory.** Every artifact of the user's life or company's history: every decision made or reversed, every project shipped or abandoned, every customer input, every piece of code, every conversation that mattered. Not "current state" (that's a state machine) — the *accumulated context a human picks up over months of being embedded in a place*.

In V1, the user's world model is the existing entities they author: tasks, notes, decisions (as notes), stream items, workspaces, MEMORY.md. The agent has access to all of this via the action registry.

The full direction:

- **Ingestion at scale.** External sources flow in as stream items or first-class entities. Gmail threads, Linear issues, GitHub PRs, support tickets, sales calls, meeting transcripts, customer interviews, NPS surveys. Each via webhook, MCP, or dedicated polling.
- **Source-of-truth aggregation.** The user's chosen subset of these sources *is* the world model. The system makes choosing obvious ("connect Slack? we'll pull the channels you select; nothing else") and the controls trivial.
- **Synthesis.** A periodic AI process reads recent stream items, extracts decisions/patterns/links, writes them into the appropriate artifacts. The pile becomes structure.
- **Retrieval that matches the question.** Hybrid keyword + embedding + structured filters, with prompt-aware ranking. "The AI is about to draft a customer reply about X — surface the 50 most relevant pieces from support / docs / past replies."
- **Provenance traversal.** The user asks "why did we decide X?" and the AI traverses decision → tasks → notes → chat history → stream items. Six months later, the AI can reconstruct the reasoning behind any past decision.
- **Autonomous decision-making.** With this substrate, the agent can answer "what's the most valuable thing for me to do?" — not by reading a pre-baked snapshot, but by querying the world model for what matters now.

This is years of work, not weeks. The V1 substrate doesn't preclude any of it; it just doesn't presume any of it either. We build ingestion adapters and synthesis loops on top of V1's `stream` + `notes` + `tasks` + action registry without revisiting the foundation.

**The order in which we ship pieces of this depends on what users actually try to use the AI for.** A founder writing customer replies wants customer voice fast. An engineer reviewing PRs wants commit + issue history fast. The substrate is the same; the adapters and lenses are the variable.

### 8.8 Multi-agent specialization (V3+)

Per-agent HEARTBEAT.md, per-agent skill libraries, per-agent tool permissions. Inter-agent delegation patterns. The data model already supports multiple agents; what's missing is the UX for "which agent handles this conversation."

### 8.9 Auto-action on external systems (defer carefully)

The "draft don't send" boundary is V1's default. Relaxing it requires per-action permission boundaries, audit trail with rollback for irreversible actions, and a trust dial that scales with observed reliability. This is the place to be slowest.

---

## 9. What we explicitly don't build (V1)

Putting these in writing so they don't sneak back in:

1. **A pipeline DSL.** The agent loop picks the next move from state. Skills are recipes, not stages.
2. **A proposal-staging system per entity.** All writes go through the live query layer. Review = existing unread machinery.
3. **A separate review-gate state machine on `schedule_runs`.** Existing unread chip is the review surface.
4. **External worker pool / Redis / BullMQ.** SQLite + setInterval is the right size.
5. **OS cron.** The scheduler needs to know about session state, worktrees, executor lifecycle. Putting it in OS cron means duplicating all of that.
6. **Anthropic Routines as host.** Runs in Anthropic's cloud, can't see local workspaces. We host our own.
7. **A separate "Automation" tab that isn't tied to executions.** Scheduled runs are executions; they surface in the existing UI.
8. **Heartbeat as a row in `schedules`.** When V2 ships it, it's columns on `agents` — different concept, same tick.
9. **"Dream mode" as a primitive.** Overnight work is a schedule at 3am.
10. **A context engine.** See §6. The agent queries what it needs.
11. **Bootstrap files as a new invention.** Reuse what exists (`MEMORY.md`, workspace `CLAUDE.md`). Author content; don't manufacture file conventions.
12. **Native connector adapters in V1.** Gmail, Linear, Todoist, Notion, Calendar, GitHub — none. Webhook intake only.
13. **A native MCP marketplace.** Document patterns; don't curate.
14. **Decisions / completions / summaries as new entities.** Notes cover all of it.
15. **Multi-state action protocol in V1.** No `request_input` / `report_blocked` / `continue_work`. End of turn = unread.
16. **Goals as a schema in V1.** Markdown convention via `MEMORY.md` until patterns demand otherwise.
17. **Auto-action on external systems by default.** "Draft don't send" until trust is earned.
18. **Cost tracking deferred.** Has to ship in V1. Non-negotiable.
19. **`describe_world` action in V1.** The agent can call `list_tasks` / `list_stream` / `get_workspace` etc. individually. Convenience aggregation comes later if needed.

---

## 10. Tech debt analysis

What evolves cleanly:

- **All new tables.** Add columns freely. Status enums grow. No relational constraints to fight.
- **Scheduler tick.** Interface is "load due → dispatch." Swap implementation (in-process → external cron → BullMQ) without touching the rest.
- **Heartbeat in V2.** Pure addition — columns on `agents` + a sibling call inside the existing tick. No migration of V1 data.
- **Skills + subagents.** Markdown files. Add, edit, delete freely.
- **Cost capture.** Promote to `run_usage_events` later if per-turn breakdown matters. Additive.
- **Context aggregation if/when needed.** `describe_world` is an additive orchestrator action. Doesn't change the dispatch path.

Manageable migration cost:

- **Run-vs-session relationship.** If we later decide tasks should own a persistent chat session, we add `chat_session_id` to tasks and migrate. Well-bounded.
- **Multi-state action protocol added later.** Existing runs unaffected; orchestrator gains new actions. Additive.

Real but bounded risks:

- **Action registry naming.** Once published, renaming is breaking. Name V1 actions thinking they outlive specific use cases.
- **`session_strategy='persistent'` sessions can grow without bound.** Claude Code's auto-compaction handles it but may need pruning controls later. Open question, not a V1 blocker.

**Net: no real tech debt.** The architecture evolves additively.

---

## 11. Open questions

These don't block V1, but they need answers eventually:

1. **Persistent-session compaction / pruning.** Claude Code's auto-compaction is the safety net; revisit if friction shows up.
2. **Rollback semantics.** Activity log captures everything; the UX for "undo this run" is unclear. Build when there's a real undo moment.
3. **Per-action tool permissions for autonomy.** On tools, on schedules, or as a global trust dial? Decide in V2+ context.
4. **Goals schema details.** OKR shape, KR types, parent goals, success criteria. Design when V2 starts.
5. **Decision linking.** When the AI writes a decision (as a note with `"Decision:"` prefix), should it link to specific tasks / chat sessions / stream items? Probably yes via existing `note_links`. Concrete shape: TBD.
6. **Default heartbeat ON or OFF when V2 ships.** Onboarding question; constant is one-line changeable.
7. **Catch-up policy default.** Off, in this proposal — if the laptop sleeps overnight and 8 nightly jobs missed, the user probably doesn't want all 8 to fire at 9am. Per-schedule opt-in, max 3 catch-ups. Validate from real usage.
8. **Skill version drift between workspace and global.** If a workspace `SKILL.md` shadows a global one with the same name, surface a "shadowed" hint in the UI.
9. **Multi-user / multi-device.** Whole design assumes one user. Team mode (`docs/deployment-mode-spec.md`) makes the unread/inbox surface shared. Defer.
10. **Webhook signature scheme.** HMAC-SHA256 for V1. Native platform signatures (GitHub, Linear, etc.) layered later.
11. **When does the context engine come back, if ever?** If dogfooding V1 shows the agent wasting turns on orientation, we add `describe_world` as an action the agent can call. We do *not* auto-inject. Open until we have usage data.

---

## 12. Why this is the right V1 shape

Five summary points:

1. **It matches the existing execution model.** Fire-and-forget dispatch into a hot session is what we already have. The scheduler is just another trigger source.

2. **It's the smallest thing that's useful.** Two tables, one new column, one new tick, two UI surfaces (Automations, Activity), one new webhook route. Phase 1 of phase 1.

3. **It treats AI as co-worker-in-waiting.** The scaffolding for presence (heartbeat), agency (work queue), judgment (goals + world model) is all additive on top of V1. We just don't ship them yet.

4. **It separates code-controlled mechanism from data-controlled configuration.** The tick is code; what runs on each tick is data. The system can't be broken by an agent or user clobbering a row.

5. **It avoids inventing things the agent or Claude Code already does for free.** No context engine (agent queries). No bootstrap file system (MEMORY.md + workspace CLAUDE.md already exist). No new entities for decisions/completions (notes cover it). No native connector adapters (webhook intake is the substrate; MCP/native comes later as needed).

The pieces beyond V1 — heartbeat, goals, work queue, autonomous loops, the full world model, ingestion at scale, synthesis, multi-agent — all build on this foundation. None require revisiting the V1 substrate; they're new layers on top.

---

## The one-line version

> **V1 ships scheduled tasks: a `schedules` + `schedule_runs` pair, one 60s tick, webhook intake, activity timeline, cost rollup. Decisions are notes. Review is unread. Heartbeat, goals, work queue, and the full world model come next.**

Everything else is variations on that theme.
