# Scheduled & Async Agent Execution — Plan v2

Status: draft for review (revision after deep conversation)
Date: 2026-05-22

---

## TL;DR

This is a plan to move the system from **AI-as-copilot** (you type, AI responds) to **AI-as-coworker** (AI has presence, judgment, and continued existence between your sessions; you delegate at the rhythm and scope you choose).

The v1 substrate is small but load-bearing:

- **Schedules** — cron or interval triggers that dispatch a prompt against a workspace or the orchestrator. The user's authored recurring work.
- **Heartbeat** as a property of the agent (not a schedule row) — the AI's pulse. Lives on the `agents` table; protected by code invariants.
- **A code-controlled system tick** (60s) that processes both heartbeats and due schedules. Schedules and heartbeat configs are data; the tick that drives them is code.
- **Scheduled runs surface as executions** in the existing UI, with provenance linking back to the schedule. No separate "automation runs" feed. The existing unread machinery is the review surface — no new review-gate status.
- **Skills** as procedural memory — markdown files at `<brain>/skills/<name>/SKILL.md` (global) and `<workspace>/.flow/skills/<name>/SKILL.md` (workspace, committed to git). The agent loads them as procedural memory when invoked.
- **Activity timeline + cost rollup** — a single page that answers "what's the AI been up to?" across schedules, workspaces, sessions. The data is already there in `chat_events`; this is a new lens.
- **Context engine** — on every scheduled dispatch, inject a structured world snapshot (bootstrap files loaded verbatim + structured state queried from the DB). 4-8k token budget for the dynamic portion; bootstrap files always intact.
- **Bootstrap files** (3, hardcoded for v1): `<brain>/COMPANY.md` (user's standing context), `<workspace>/.flow/WORKSPACE.md` (per-workspace context), `<brain>/HEARTBEAT.md` (standing supervisory instructions).
- **Decisions** as a directory convention — `<brain>/decisions/YYYY-MM-DD-<slug>.md`, one file per decision, light UI (list + open + mark-reversed). No new table.
- **Connectors substrate** — outbound via user-registered MCP servers, inbound via webhook-triggered schedules.

That's v1. What sits beyond v1 — the full **world model** (organizational memory), the **self-improvement loop**, **ingestion at scale**, **provenance traversal**, **multi-agent role specialization** — is named in §10 as direction. The v1 substrate is built so each of those is additive rather than a rewrite.

What this does *not* try to be:

- A declarative pipeline / DAG engine. (No.)
- A separate review-gate state machine. (No — existing unread machinery.)
- A "dream mode" primitive. (No — overnight work is a schedule at 3am.)
- A Redis/BullMQ-backed job queue. (No — SQLite + setInterval is the right size.)
- A clone of Claude Code's Routines. (No — Routines run in Anthropic's cloud and can't see local workspaces; we host our own.)
- A formalized goal / project / work-packet primitive. (Not yet — convention via markdown, formalize if patterns emerge.)

---

## 1. The shape of the bet

The system today is excellent at **synchronous, request-driven work**: you sit at the keyboard, the AI helps you build / write / decide / debug. That's the copilot.

The bet underlying everything below is that the next inflection isn't making the copilot smarter. It's making the AI a **coworker** — something with persistent existence, standing instructions, judgment about what's worth doing, and the ability to act when you're not at the laptop. Polsa-style "humans at the edges, AI does the work" is the trajectory; we don't have to ship that on day one, but the architecture has to enable it without a rewrite.

Coworker isn't a feature. It's an architectural posture. Specifically:

- **Presence**: the AI exists between your sessions. It has a pulse (heartbeat). When you walk away, it doesn't pause.
- **Standing instructions**: you write down what you care about (`COMPANY.md`, `HEARTBEAT.md`) and the AI reads them on every wake. Updating the doc updates the AI's behavior — no code change.
- **Initiative**: the AI scans state, identifies what's worth doing, acts on low-stakes things, surfaces high-stakes ones for your input.
- **Memory**: the AI accumulates context. Decisions are durable. The world model gets richer over time.
- **Voice**: the AI communicates back through the same surface you already use — chat threads. New work shows up as new turns you can reply to.
- **Improvability**: the AI gets better at being your coworker the longer you use it. Skill files evolve. Standing instructions sharpen.

Every architectural choice in this doc is justified by which of these it enables. The pieces we're not building in v1 (full ingestion, synthesis, provenance, multi-agent) are exactly the pieces that take coworker-ness from "useful" to "indispensable" — but the v1 substrate is what makes them buildable later.

---

## 2. What changes vs. the current execution model

Today (per `docs/executor-wiring-spec.md`, `docs/conductor-migration-spec.md`):

- User sends a message → route inserts user `chat_event` → fires `executor.dispatch(sessionId, message)` without awaiting.
- Executor maintains hot `AgentSession`s in a module-scoped `Map`.
- Stream events flow to `chat_events`; SSE pushes to the client.
- Turn ends; nothing else happens until the next user message.

What we're adding:

- A **system tick** alongside the executor, in the same Next.js process. Every 60 seconds, the tick wakes, queries due heartbeats + schedules, dispatches them through the *same* `executor.dispatch()` path the user already uses.
- A `schedules` table to define what gets dispatched.
- A `schedule_runs` table to record what happened.
- New columns on `agents` for heartbeat config.
- New column on `chat_sessions` (`triggered_by_schedule_run_id`) so scheduled runs appear in execution surfaces with provenance.
- A new "Automations" surface (define schedules), "Activity" surface (timeline + cost), and integration with the existing inbox (filter on triggered-by-schedule).

That's the entire surface. Everything below is detail on these few additions.

---

## 3. v1 architecture

### 3.1 The system tick

A single in-process tick in `src/lib/scheduler/runner.ts`, started when the Next.js server boots:

```ts
const TICK_INTERVAL_MS = 60_000;

setInterval(async () => {
  const lock = await acquireSchedulerLock();   // file-based, like Hermes
  if (!lock) return;
  try {
    const now = new Date();
    await processHeartbeats(now);              // agents whose pulse is due
    await processSchedules(now);               // schedules whose next_run_at is past
  } finally {
    await releaseSchedulerLock(lock);
  }
}, TICK_INTERVAL_MS);
```

Key properties:

- **The tick is code, not data.** Schedule/heartbeat rows can be broken by a user or an agent without breaking the tick. The tick keeps running; broken rows just don't fire.
- **`next_run_at` advances under the lock before dispatch.** Atomic-before-execute means a crash mid-run doesn't repeat the run.
- **One process, one tick, one lock.** No worker pools, no Redis, no BullMQ.
- **Crash safety:** state is in SQLite. On boot, any `schedule_runs` left in `running` status get marked `failed` with reason `process_restart`. If the schedule has `catch_up=true`, the next tick may re-fire (bounded).

### 3.2 Schedules

A schedule is a user-authored rule: "do this on this cadence."

```ts
export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().default('local'),

  // Naming
  name: text('name').notNull(),
  description: text('description'),

  // What to run
  prompt: text('prompt').notNull(),
  skills: text('skills', { mode: 'json' }).$type<string[]>().default([]),
  agent_id: text('agent_id').references(() => agents.id),

  // Target
  target_kind: text('target_kind', {
    enum: ['workspace', 'orchestrator'],
  }).notNull(),
  workspace_id: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  session_strategy: text('session_strategy', {
    enum: ['isolated', 'persistent'],
  }).notNull(),
  persistent_session_id: text('persistent_session_id')
    .references(() => chatSessions.id, { onDelete: 'set null' }),

  // Trigger
  trigger_kind: text('trigger_kind', {
    enum: ['cron', 'interval', 'webhook', 'manual'],
  }).notNull(),
  cron_expr: text('cron_expr'),
  timezone: text('timezone'),
  interval_seconds: integer('interval_seconds'),
  webhook_secret: text('webhook_secret'),
  active_hours_start: text('active_hours_start'),
  active_hours_end: text('active_hours_end'),

  // Concurrency & catch-up
  concurrency: text('concurrency', {
    enum: ['skip_if_running', 'queue', 'coalesce'],
  }).notNull().default('skip_if_running'),
  catch_up: integer('catch_up', { mode: 'boolean' }).notNull().default(false),
  max_catch_up_runs: integer('max_catch_up_runs').notNull().default(3),

  // Quiet hours preference (GBrain-style)
  prefer_window_start: text('prefer_window_start'),   // optional "22:00"
  prefer_window_end: text('prefer_window_end'),       // optional "07:00"
  prefer_window_policy: text('prefer_window_policy', {
    enum: ['skip', 'defer'],
  }),

  // Context scope (used by context engine on dispatch)
  context_scope: text('context_scope', {
    enum: ['narrow', 'wide', 'supervisor'],
  }).notNull().default('narrow'),

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

  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
```

Defaults that matter:

- `target_kind='workspace'` defaults `session_strategy='persistent'` (the workspace's "AI lane" — replies continue the conversation).
- `target_kind='orchestrator'` defaults `session_strategy='isolated'` (each run is a fresh starting point).
- `context_scope` defaults to `narrow` (this workspace only) for workspace targets, `wide` for orchestrator. Heartbeats use `supervisor` (a curated scan-of-everything snapshot).

### 3.3 Schedule runs

One row per fire.

```ts
export const scheduleRuns = sqliteTable('schedule_runs', {
  id: text('id').primaryKey(),
  schedule_id: text('schedule_id').notNull()
    .references(() => schedules.id, { onDelete: 'cascade' }),

  trigger: text('trigger', {
    enum: ['cron', 'interval', 'manual', 'webhook', 'catch_up'],
  }).notNull(),
  trigger_payload: text('trigger_payload', { mode: 'json' }),

  // Session this run was dispatched against
  chat_session_id: text('chat_session_id')
    .references(() => chatSessions.id, { onDelete: 'set null' }),

  // Status — no review gate. Existing unread machinery handles "review."
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
  output_tokens: integer('output_tokens'),
  cost_cents: integer('cost_cents'),
  model_used: text('model_used'),
  duration_ms: integer('duration_ms'),

  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_schedule_runs_schedule_status').on(table.schedule_id, table.status),
  index('idx_schedule_runs_status_scheduled').on(table.status, table.scheduled_for),
]);
```

Note what's *not* here: no `needs_review`, no `reviewed_at`, no `reviewed_decision`. When a run finishes, the chat session it created (or continued) sits in the same state as any session whose AI just took a turn. The user comes back, sees the unread chip on the session (driven by existing `last_outcome_event_at` / `last_viewed_at`), reads it, replies if they want, archives if they don't. The "review surface" is the existing inbox.

For runs of isolated-session schedules, each fire creates a fresh `chat_sessions` row. They group in the UI by `schedule_id` (a "weekly retro — 4 runs" affordance). For persistent-session schedules, all runs land in the same session as additional turns; there's nothing to group because the conversation is the history.

### 3.4 Heartbeat as agent property

The AI's pulse lives on the `agents` table, not in `schedules`. This is the conceptual claim of §1: heartbeat is *presence*, not work.

Additions to `agents`:

```ts
heartbeat_interval_seconds: integer('heartbeat_interval_seconds'),  // null = no heartbeat
heartbeat_prompt_template: text('heartbeat_prompt_template'),       // editable
heartbeat_active_hours_start: text('heartbeat_active_hours_start'), // "09:00"
heartbeat_active_hours_end: text('heartbeat_active_hours_end'),     // "22:00"
heartbeat_active_hours_tz: text('heartbeat_active_hours_tz'),       // IANA
heartbeat_session_strategy: text('heartbeat_session_strategy', {
  enum: ['isolated', 'persistent'],
}).default('isolated'),
heartbeat_last_run_at: text('heartbeat_last_run_at'),
```

The default heartbeat prompt (the seeded value of `heartbeat_prompt_template`):

> Read `HEARTBEAT.md` if it exists. It's the user's standing instructions for what to scan for and how to act.
>
> Then check, in this order:
> 1. Schedule runs that have been unread for >6 hours — list tersely, one line each.
> 2. Active execution sessions silent for >2 hours with no terminal event.
> 3. Schedules that should have fired but didn't (`next_run_at` < now - 5 min).
> 4. Anything else in `HEARTBEAT.md` the user asked you to scan for.
>
> If nothing needs attention, reply exactly `HEARTBEAT_OK`. Otherwise, return a tight summary in under 300 characters with the most important thing first.

The system finalizer strips `HEARTBEAT_OK` (at start or end of reply, with body under 300 chars) and suppresses notification. Otherwise the reply becomes a notification + a chip in the inbox.

The orchestrator agent is seeded with `heartbeat_interval_seconds = 1800` (30 min), active hours `09:00 → 22:00` in the user's tz, and the default prompt template. The user can disable (set interval to null), reschedule, or edit the prompt. Code invariants on agent save: if heartbeat columns are set, they must be a coherent set (interval > 60, prompt non-empty).

This addresses the clobbering concern: heartbeat lives on the agent row, which is harder to corrupt than a schedules row. Agents rarely write to themselves; we can add a `is_system: true` flag on the orchestrator agent to make destructive updates require explicit user confirmation. If a bad write happens anyway, the tick keeps running — only that one agent's heartbeat goes silent until repaired.

### 3.5 Scheduled runs surface as executions

The defining choice that keeps the system from forking into two UIs:

- A scheduled run that targets a workspace **creates or continues a `chat_session` with `type='execution'`**, same shape as user-initiated executions. With `session_strategy='persistent'`, it reuses the workspace's "AI lane" session; with `isolated`, it creates a fresh one with its own worktree (for git workspaces).
- A new column `chat_sessions.triggered_by_schedule_run_id` (nullable FK) records provenance.
- Wherever execution sessions appear today (workspace detail, power rail / action bar, recent runs), scheduled ones appear alongside, with a small chip ("from schedule: Nightly bug triage") in the session header.
- The Inbox / unread feed is a filtered view: sessions where `last_outcome_event_at > last_viewed_at`. Scheduled and user-initiated runs sit in the same inbox, grouped or filtered as the user prefers.

Net effect: every existing execution affordance — worktree diff, PR open, mid-stream interaction, takeover-locally — works for scheduled runs without re-implementation.

### 3.6 Skills

Two locations, opinionated about commit policy:

- **Global**: `<brain>/skills/<name>/SKILL.md` — the user's library, available everywhere.
- **Workspace**: `<workspace>/.flow/skills/<name>/SKILL.md` — codebase-specific, **committed to git by default** so teammates and the AI itself get them on clone.

Format follows the convention Claude Code already uses (YAML frontmatter + markdown body):

```markdown
---
name: github-pr-review
description: Review a PR for correctness, security, and style
---
# GitHub PR review

When invoked, look up the PR via the gh CLI, read the diff, and check for...
```

Resolution: workspace overrides global on name collision (inside that workspace). The orchestrator action `list_skills` returns the merged set. A schedule's `skills` field references skill names; on dispatch, the runner injects each skill body as a `<skill name="...">…</skill>` block in the prompt (Hermes' pattern: preserves prompt cache, edits take effect immediately, no registration step).

What skills are *not*:

- Not code. No execution semantics. Markdown only.
- Not a permission boundary. Tool access is on the agent, not the skill.
- Not pipelines. Multiple skills in one schedule = multiple recipe pages in the prompt, not a sequenced workflow.

If we later want skill-with-code (scripts that run before the agent, à la Hermes' script injection), it's a separate primitive that doesn't retrofit the markdown flavor.

### 3.7 Context engine + bootstrap files

Every scheduled dispatch begins by injecting a structured world snapshot as the first user message. This is what makes the AI start each run *aware* rather than scoped-blind.

Two parts:

**Static (bootstrap files, loaded verbatim, always included intact)**:
- `<brain>/COMPANY.md` — the user's standing context. Mission, current priorities, ongoing initiatives, key people, anything that gives the AI a sense of "what we're doing."
- `<workspace>/.flow/WORKSPACE.md` (when `target_kind='workspace'`) — codebase- or project-specific context.
- `<brain>/HEARTBEAT.md` (when the run is a heartbeat) — the standing supervisory instructions.

**Dynamic (queried from DB on dispatch, budgeted ~4-8k tokens)**:
- Open tasks (top N by priority, filtered by `context_scope`)
- Recent stream items (last 24h, filtered)
- Workspaces touched today
- Schedules due in next 24h
- Recent decisions (newest N from `<brain>/decisions/`)
- Recent activity since this schedule last ran (if persistent)

Shape, injected as the first user message of each scheduled dispatch:

```
<world-state>
  <user-instructions>
    {{COMPANY.md content}}
  </user-instructions>

  <workspace-instructions>
    {{WORKSPACE.md content if applicable}}
  </workspace-instructions>

  <active>
    Open tasks (top 10): ...
    Stream items (last 24h): ...
    Workspaces touched today: ...
    Schedules due in next 24h: ...
  </active>

  <recent-activity since="{{schedule.last_run_at}}">
    {{decisions, completions, notes created or updated}}
  </recent-activity>
</world-state>

{{schedule.prompt}}
```

Per-schedule customization via `context_scope`:
- `narrow` (default for workspace schedules) — just this workspace's data.
- `wide` (default for orchestrator schedules) — everything.
- `supervisor` (default for heartbeat) — needs-attention scan: unread sessions >6h, silent runs >2h, stale tasks, missed fires.

Token budget: bootstrap files always included intact (the user authored them, they're load-bearing). Dynamic section caps at ~4-8k tokens (configurable per schedule), truncating lowest-priority items first. Above the cap, the agent can query the rest via existing orchestrator actions if it needs more — the snapshot is a starter, not an exhaustive dump.

### 3.8 Decisions as a directory convention

Decisions are the single most important artifact for AI as coworker — they're "the why behind what we did" — but they don't need a new table.

Convention:
- One file per decision: `<brain>/decisions/YYYY-MM-DD-<slug>.md`
- Frontmatter: `title`, `decided` (boolean — vs proposed), `decided_at`, optional `reverses` (path to a prior decision), `tags`
- Body: context, options considered, the decision, expected consequences

The AI is instructed (in the default `COMPANY.md` template + the heartbeat prompt) to write a decision file when it makes one of substance, and to read recent decisions at the start of important runs (via the context engine).

UI: a "Decisions" tab on the brain / settings surface that lists recent files newest-first, lets you open / edit / mark-reversed. No new database table. No schema. The directory is the source of truth; the UI is a thin reader.

If patterns emerge (search across decisions, link decisions to tasks/projects, scoring), we'd consider promotion to a schema in v2. For v1: the convention + the light UI + the context-engine inclusion is enough.

### 3.9 Connectors

The minimum substrate, no native integrations:

**Outbound (the AI calls external systems)**: user-registered MCP servers. The user adds their Linear MCP, Gmail MCP, Slack MCP, etc. once; the orchestrator + executor agents pick them up as tool providers. The agent calls them like any other tool. We don't build native Linear / Gmail / Slack adapters; the MCP ecosystem already handles this and gets better every quarter.

**Inbound (external events trigger schedule runs)**: a schedule with `trigger_kind='webhook'` gets a unique URL + HMAC secret on creation. External services POST to `/api/webhooks/:schedule_id` with a JSON body; the runner verifies HMAC, runs the schedule, passes the payload through as `trigger_payload` available to the prompt. This is the same pattern OpenClaw and Hermes use.

**Polling (the AI checks an external system periodically)**: emerges from the above. A schedule's prompt says "use the Linear MCP to look at issues assigned to me; surface anything that changed since the last run." No new primitive.

What we're explicitly not doing in v1: shipping a native catalog of "supported integrations" (Gmail, Linear, Slack, Notion, etc.). The MCP layer handles this. We document the pattern; we don't curate a marketplace.

### 3.10 Activity timeline + cost rollup

A single page that answers "what's the AI been up to?" — different aggregation of existing data:

**Timeline section** (newest first):
- All `schedule_runs` and notable user-initiated `chat_sessions` events across the last 7 days
- Each row: time, schedule (if any), workspace, status, summary, cost
- Filterable by workspace, schedule, status, date range

**Cost rollup section** (top of page):
- Today / 7d / 30d totals
- Top 5 schedules by spend
- Per-model breakdown

Token / cost data comes from `schedule_runs.{input_tokens, cached_input_tokens, output_tokens, cost_cents}`, populated at run completion from agentex's `result` event. Pricing tables in `src/lib/pricing/models.json` map provider/model → cents per million tokens. Updated as Anthropic/OpenAI publish new prices.

This is small in code (one new query, one new page) and load-bearing for trust. Without it, users can't enable autonomous work. With it, they can see exactly what the AI is doing and what it costs.

---

## 4. Schema additions, all in one place

```ts
// Additions to src/lib/db/schema.ts

// 1. New columns on `agents`:
heartbeat_interval_seconds: integer('heartbeat_interval_seconds'),
heartbeat_prompt_template: text('heartbeat_prompt_template'),
heartbeat_active_hours_start: text('heartbeat_active_hours_start'),
heartbeat_active_hours_end: text('heartbeat_active_hours_end'),
heartbeat_active_hours_tz: text('heartbeat_active_hours_tz'),
heartbeat_session_strategy: text('heartbeat_session_strategy', {
  enum: ['isolated', 'persistent'],
}),
heartbeat_last_run_at: text('heartbeat_last_run_at'),
is_system: integer('is_system', { mode: 'boolean' }).notNull().default(false),

// 2. New column on `chat_sessions`:
triggered_by_schedule_run_id: text('triggered_by_schedule_run_id')
  .references(() => scheduleRuns.id, { onDelete: 'set null' }),

// 3. New table `schedules` (see §3.2)
// 4. New table `schedule_runs` (see §3.3)
```

Migrations needed:
- One Drizzle migration for the agents column additions (nullable, no backfill required).
- One migration for the `chat_sessions.triggered_by_schedule_run_id` FK.
- One migration for `schedules` + `schedule_runs`.
- A seed script that creates the orchestrator agent's default heartbeat config and seeds `COMPANY.md` template (and optionally an example schedule) on first run.

New orchestrator actions:
- `list_schedules`, `get_schedule`, `list_schedule_runs`, `run_schedule_now`
- `list_skills`
- `list_decisions`, `get_decision`
- `describe_world` — convenience action that returns the same snapshot the context engine would inject (for ad-hoc agent queries mid-turn)

Mutating actions (`create_schedule`, `update_schedule`, `delete_schedule`, `create_decision`) are deferred to phase 2 — start with UI-only creation, let agents read but not mutate, see what patterns emerge.

---

## 5. UX

### 5.1 Navigation

Add **Automations** to the left nav (sibling to Workspaces):
- **Schedules** (default view) — list, status pills, next/last run
- **Runs** — timeline filtered by schedule
- **Heartbeat** — the orchestrator agent's heartbeat config + HEARTBEAT.md editor

Add **Activity** to the left nav:
- Timeline of recent runs across all sources
- Cost rollup at the top

The **Inbox** lives in the existing notification surface, with a filter chip "from schedules."

### 5.2 Schedule creation

One form, no tabs. Top to bottom:

1. **What** — name, prompt, optional description.
2. **When** — `[ Run on a schedule | Every N minutes | When triggered (webhook) ]`. For "on a schedule," a natural-language input ("every weekday at 9am") that compiles to cron + timezone, with the resolved cron expression shown beneath plus a preview of the next 3 fire times.
3. **Where** — target (workspace dropdown or "orchestrator"). Session strategy (persistent / isolated, with help text). Skills selector (multi).
4. **Settings** — model override, effort, timeout, context scope, active hours, optional preferred window (defer to overnight).
5. **Save** — preview of the next fire, then save.

### 5.3 Heartbeat configuration

A single page under Automations:
- Current state (enabled / disabled, next pulse, last pulse)
- Interval input (with help text — "the AI checks in every X minutes")
- Active hours
- Prompt template editor (with a "Reset to default" button — the default is load-bearing)
- HEARTBEAT.md editor right below (Tiptap or monaco), with a live preview of the resolved prompt (template + HEARTBEAT.md merged)

### 5.4 Decisions

A simple "Decisions" tab in settings/brain:
- List newest-first
- Click opens the file in a markdown editor (in-place, no modal)
- "Mark reversed" button writes frontmatter
- "+ New decision" creates a new file with a template

### 5.5 Workspace surfaces

Each workspace's detail view gains a small "Automations" section listing schedules whose `workspace_id` matches, with next/last run. Click-through to edit. "+ New schedule for this workspace" action.

### 5.6 Run detail

Clicking any schedule_run takes you to the chat_session it created (or continued), with a small header strip showing schedule provenance ("from schedule: Nightly bug triage", "fired at ...", "cost: $0.04"). For workspace runs, the existing worktree diff / PR controls are present unchanged.

---

## 6. Implementation phases

**Phase 1 — Cron + Schedules + Inbox integration (~3 weeks)**
- Schema migrations (schedules, schedule_runs, agents heartbeat columns, chat_sessions FK)
- System tick + scheduler runner
- Cron parser (`croner`) + interval support
- Dispatch path: create/resume chat_session, call executor.dispatch
- Bootstrap file loading
- Schedule creation UI + schedule list
- Run lands in existing execution surfaces with provenance chip
- Cost tracking (pricing table + result event extraction)

**Phase 2 — Heartbeat + Skills (~2 weeks)**
- Heartbeat dispatch on tick (per-agent interval)
- `HEARTBEAT_OK` ack stripping in finalizer
- HEARTBEAT.md editor + heartbeat config UI
- Skills directory discovery (global + workspace) + `list_skills` action
- Skill body injection on dispatch
- Heartbeat indicator dot in the top status bar
- Seed orchestrator agent's default heartbeat config

**Phase 3 — Activity timeline, decisions, webhooks (~2 weeks)**
- Activity page (timeline + cost rollup)
- Decisions directory + UI tab
- Webhook trigger schedules (`POST /api/webhooks/:schedule_id` with HMAC)
- `list_decisions` / `get_decision` orchestrator actions
- Per-schedule context scope enforcement

**Phase 4 — Context engine refinement + connector docs (~1-2 weeks)**
- Context engine token budgeting + truncation rules
- `describe_world` orchestrator action
- Catch-up runs (bounded)
- Quiet-hours / preferred-window scheduling
- Documentation: MCP setup guide, webhook setup guide, schedule prompt patterns

Total v1: ~8-9 weeks of focused work. Each phase ships independently usable functionality.

---

## 7. Where we're heading (direction, not v1 scope)

This is the section the conversation explicitly wanted captured: what we're building toward but not designing now. The v1 substrate is intentionally compatible with each of these — they're additive, not rewrites.

### 7.1 The world model — full organizational memory

The bet: a real coworker AI needs access to the entire scope and history of the business — every decision made or reversed, every project built or abandoned, every customer signal, every piece of work created. Not "current state" (that's a state machine); the **accumulated organizational memory** a human picks up over months of being embedded.

In v1, we capture an individual's world model: COMPANY.md + decisions/ + the existing tasks/notes/stream/chat data, surfaced via the context engine. That's a real and useful starting point.

The full direction:

- **Ingestion at scale**: external sources flow in as stream items. Gmail threads, Linear issues, Slack channels (selected), GitHub PRs, support tickets, sales-call transcripts, meeting notes, customer interviews, NPS surveys. Each source is an adapter — some via MCP, some via webhook subscriptions, some via dedicated polling agents.
- **Source-of-truth aggregation**: the user's chosen subset of these sources is the world model. The system makes the choice obvious ("connect your Slack? we'll pull the channels you select; nothing else") and the controls trivial.
- **Decisions as first-class**: promote the markdown convention to a schema if patterns demand. Decisions get linked to the tasks/projects/conversations they emerged from. The graveyard (what we tried and abandoned) is preserved with rationale.
- **Customer voice as a dimension**: a "what are customers asking for / frustrated by" view that aggregates support / sales / community signals. Not a separate table; a query/lens over ingested stream items tagged by source.
- **Retrieval that matches the question**: better-than-naive search over the corpus. Hybrid keyword + embedding + structured filters, with prompt-aware ranking ("the AI is about to draft a customer reply about X, surface the 50 most relevant pieces from support / docs / past replies").

We can build all of this. The order in which we ship pieces depends on what users (us, then early adopters) actually try to use the AI for. A founder writing customer replies wants customer voice fast. An engineer reviewing PRs wants commit + issue history fast. The substrate (stream items + MCP + the context engine) is the same; the adapters and lenses are the variable.

### 7.2 Self-improving AI

A coworker AI should get better the longer you use it. Three flavors of self-improvement, each with a different implementation:

- **Skill curation** (Hermes' curator pattern, idle-triggered): the AI notices "I keep doing this pattern" and writes / updates a SKILL.md file. Narrow scope, never deletes, always reviewable.
- **Memory consolidation** (OpenClaw's dreaming pattern, periodic): short-term observations get scored, ranked, deduped, and promoted to long-term memory. Stays out of v1 because it requires memory schema we don't have.
- **World-model evolution**: the AI's understanding of the user's business gets richer. Less defined; closer to "the AI develops a feel for how this user works." Probably emerges from skill curation + memory consolidation rather than as its own loop.

Architecture-wise, skill curation is buildable on top of v1 right now (skills are markdown files the AI can write via Edit, and you'd schedule a "skill curator" run nightly). We just don't ship it as part of v1.

### 7.3 Synthesis — turning stream items into knowledge

Ingestion creates a pile of raw items. Synthesis turns the pile into structure: this customer complaint relates to that bug fix, this Slack thread is the origin of that decision, this PR closed three issues, this design doc was abandoned because of these constraints.

The Hermes curator + GBrain autopilot patterns combined: a periodic AI process (scheduled, low-priority, runs during quiet hours) that reads recent stream items, extracts decisions/patterns/links, writes them into the appropriate artifacts (decision files, note updates, task links). Always reviewable, never destructive.

This is the layer that makes the world model **smart** rather than just **searchable**. It's also where the AI's understanding of the business compounds.

### 7.4 Provenance traversal — "how did we get here"

The killer differentiator for AI as coworker: the user asks "why did we decide X?" and the AI traverses decision files → the tasks that led to them → the notes from those tasks → the chat history → the original stream items. Six months later, the AI can reconstruct the reasoning behind any past decision.

Requires v1 + ingestion + synthesis to be working. Then it's a graph traversal exposed as an orchestrator action plus a prompt convention.

### 7.5 Multi-agent / role specialization

Today: one orchestrator agent + one executor agent. The autonomy thesis suggests team roles — a "marketing agent," "ops agent," "dev agent," each with its own pulse, scope, standing instructions, and skill library.

The data model already supports multiple agents (`agents.kind`, `agents.name`, `agents.role`, `agents.config`). What's missing:

- Per-agent HEARTBEAT.md (vs the shared one) — easy
- Per-agent skill libraries (probably scoped by config field) — easy
- Per-agent tool permissions and connector access — needs design
- A UX for "which agent does this conversation belong to / which agent should handle this task" — needs design
- Inter-agent delegation patterns (does the marketing agent assign work to the dev agent?) — needs design

v1 keeps to two agents. The above gets designed when use cases demand it.

### 7.6 Autopilot / queue with deterministic prioritization

GBrain's pattern: a non-LLM autopilot script that evaluates state and decides what jobs to enqueue. The opposite of "agent decides what to do" — code decides; agent executes.

Useful when patterns are stable enough to encode. Not useful when the user is still learning what to delegate.

Defer until schedule-prompt patterns clearly stabilize. The v1 substrate doesn't preclude adding a deterministic autopilot layer later; it just doesn't presume one.

### 7.7 Goals as schema

Today: tasks-with-subtasks + COMPANY.md as the goal-alignment surface. Markdown convention.

If usage patterns reveal that goals need first-class status, ownership, target dates, dependencies, progress views, etc. — promote to a schema. Until then, don't.

### 7.8 Long-running project sessions ("work packets")

Already enabled by `session_strategy='persistent'` + workspace-targeted schedules + markdown ROADMAP / PROJECT files in the workspace. The architectural support exists in v1; what's missing is the convention library and UX polish for "this thread is an ongoing project advancement, not a chat."

This is mostly a docs + templates problem on top of v1, not a new primitive.

### 7.9 Auto-action on external systems

The "draft don't send" boundary is the current default for v1 — the AI drafts PRs, drafts emails, drafts Slack messages, but doesn't send / merge / publish. The user reviews and acts.

Relaxing this carefully is a real product question. It requires:

- Per-action permission boundaries (probably on tools, not on schedules)
- Audit trail + rollback for irreversible actions
- A trust dial that scales with observed AI reliability
- Possibly a "two-key" pattern for sensitive actions (AI proposes + another AI reviews + then the AI acts)

This is the place to be slowest. The cost of getting it wrong is high; the cost of being slow is low.

---

## 8. Anti-patterns explicitly rejected

These are tempting and wrong. Putting them in writing so they don't sneak back in:

- **Declarative pipelines / DAGs.** Skills are recipes the agent decides to use, not stages in a workflow. The agent loop is the orchestrator.
- **A separate review-gate status machine.** Existing unread / `last_outcome_event_at` is the review surface.
- **"Dream mode" as a primitive.** Overnight work is a schedule at 3am. Memory consolidation is a future system; not a runtime mode.
- **Subagents-as-pipeline-stages.** Claude Code's Task tool is for parallel forks within a turn. Not coordination across stages.
- **A separate worker process.** SQLite + setInterval in the Next.js server is the right size.
- **BullMQ / Redis-backed queue.** None of the comparable projects (OpenClaw, Hermes, Paperclip, GBrain) chose Redis for this. Don't take on the infra.
- **OS cron.** The scheduler has to know about session state, worktrees, executor lifecycle. Putting it in OS cron means duplicating all of that.
- **Anthropic Routines (as host).** Routines run in Anthropic's cloud, can't see local workspaces, daily-capped. We host our own.
- **A native connector marketplace.** MCP layer handles this. We document patterns; we don't curate.
- **Auto-action on external systems by default.** "Draft don't send" until trust is earned through experience.
- **Goals / projects / work-packets as new tables in v1.** Convention via markdown first; schema if patterns demand.
- **Cost tracking deferred.** Has to ship in v1. Without it, autonomy is untrustable.

---

## 9. Open questions

These don't block v1, but they need answers before later phases:

1. **Per-action tool permissions for autonomy.** Where does "AI can draft but not send" get enforced — on tools (per-tool config), on schedules (per-schedule whitelist), or on settings (global trust dial)? My guess: per-tool config as the primary, with sane defaults shipped. Decide in phase 3.

2. **Goals as schema or markdown.** Markdown convention for v1. Re-evaluate after 2-3 months of usage; promote to schema only if the markdown pattern is breaking down.

3. **Decision linking.** When the AI writes a decision file, should it link to specific tasks / chat sessions / stream items it was based on? Probably yes (as frontmatter `links` array). Concrete shape to design.

4. **Multi-agent UX.** When we add multiple specialized agents, how does the user dispatch work between them? "@" mentions in chat? Schedule-level agent assignment? Auto-routing by topic? Needs design before phase 5+.

5. **Skill version drift.** Workspace skills are committed to git; global skills are user-local. What happens when a workspace skill and global skill have the same name (workspace wins per resolution rule), but the user expects global behavior because they forgot the workspace one exists? Probably a "skill is shadowed" hint in the UI.

6. **HEARTBEAT.md vs COMPANY.md scope.** HEARTBEAT.md is for "what to scan and act on each pulse." COMPANY.md is for "what's true about this business." There's overlap (current priorities show up in both?). Document the split clearly in the seeded templates.

7. **Catch-up policy default.** Off, in this proposal — if the laptop sleeps overnight and 8 nightly jobs missed, the user probably doesn't want all 8 to fire at 9am. Per-schedule opt-in, max 3 catch-ups. Validate.

8. **Token budget on the dynamic context section.** 4-8k tokens as default; configurable per schedule. May need tuning based on real usage.

---

## 10. Why this is the right v1 shape

Five summary points:

1. **It matches the existing execution model.** Fire-and-forget dispatch into a hot session is what we already have. The scheduler is just another trigger source; the heartbeat is just another wake reason.

2. **It mirrors the pattern every serious reference project converges on.** OpenClaw, Hermes, Paperclip, GBrain — independently — all arrived at "cron + heartbeat + run history + cost tracking, all in one process, all DB-backed." Strong external evidence this is the right shape.

3. **It treats AI as coworker without rushing autonomy.** Presence (heartbeat), agency (existing tools + MCPs), persistent existence (session continuity), judgment (prompts + skills + bootstrap files), visibility (activity + cost) — all in v1. Acting on external systems unsupervised — not in v1.

4. **It separates code-controlled mechanism from data-controlled configuration.** The tick is code; what runs on each tick is data. The system can't be broken by an agent clobbering a row.

5. **It's a small surface.** Two tables, one new module, three UI surfaces, a few new columns. Phase 1 is ~3 weeks. Everything else is additive.

The pieces beyond v1 — full world model, self-improvement, synthesis, provenance, multi-agent, autopilot — get built on this foundation. None of them require revisiting the v1 substrate; they're new layers on top.

---

## Appendix A: Reference paths

Primary sources for the research synthesis (full details elsewhere in this conversation):

- OpenClaw cron + heartbeat + dreaming: `examples/openclaw/docs/automation/cron-jobs.md`, `examples/openclaw/docs/gateway/heartbeat.md`, `examples/openclaw/docs/concepts/dreaming.md`, `examples/openclaw/src/cron/`, `examples/openclaw/src/infra/heartbeat-runner.ts`
- Hermes scheduler + curator + skills: `examples/hermes-agent/cron/scheduler.py`, `examples/hermes-agent/cron/jobs.py`, `examples/hermes-agent/agent/curator.py`, `examples/hermes-agent/hermes-already-has-routines.md`
- Paperclip routines + heartbeat + approvals + cost: `examples/paperclip/server/src/services/routines.ts`, `examples/paperclip/server/src/services/heartbeat.ts`, `examples/paperclip/packages/db/src/schema/`
- GBrain Minions queue + autopilot: `examples/gbrain/src/commands/autopilot.ts`, `examples/gbrain/src/core/minions/`
- Claude Code Routines / `/loop` / subagents / skills: https://code.claude.com/docs/en/{routines,scheduled-tasks,subagents,skills}
- Agent SDK sessions / memory / multiagent: https://platform.claude.com/docs/en/managed-agents/{sessions,memory,multi-agent}

Existing ai-task-manager files most relevant to implementation:

- `src/lib/db/schema.ts` — column / table additions
- `src/lib/db/queries.ts` — per CLAUDE.md, route handlers go through this layer
- `src/lib/executor/adapter.ts` — `dispatch()` caller from the new runner
- `src/lib/orchestrator/registry.ts` — new orchestrator actions
- New: `src/lib/scheduler/runner.ts`, `src/lib/scheduler/cron.ts`, `src/lib/scheduler/lock.ts`, `src/lib/scheduler/context-engine.ts`
- New: `src/lib/pricing/models.ts`, `src/lib/pricing/models.json`
- New: `src/app/(...)/automations/`, `src/app/(...)/activity/`, decisions tab
