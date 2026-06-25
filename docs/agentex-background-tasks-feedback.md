# @agentex/agent — background-task visibility & targeted stop

> **Status — shipped.** Both steps below are implemented in `@agentex/agent`
> (Claude provider). This doc now records *what landed* and *where the line is
> drawn* between the library and Flow, rather than proposing changes.
>
> - **Step 1 — `session.stopTask(taskId)`** + `capabilities.stopTask` — stop one
>   background task without touching the rest of the session.
> - **Step 2 — `getClaudeTaskDetails(event)`** — a stateless typed accessor that
>   decodes the `task_*` lifecycle events Flow already receives.
>
> Anything stateful — collapsing a task's events into one live status, a task
> registry, reconnect snapshots — is **deliberately Flow's job, not the
> library's** (see §4). The library forwards and decodes; it does not interpret.
>
> **Verified (2026-06-23).** Checked against the agentex **source**
> (`packages/agent/src`, not just `dist`) and the **running CLI binary
> `2.1.187`** (the build agentex spawns, decompiled for the live control + event
> schemas). Facts below are from that pass.

---

## TL;DR

Claude Code can run work that **outlives the turn that started it** — most
importantly a backgrounded shell (`task_type: 'local_bash'`, e.g. a dev server),
but also async subagents. The CLI exposes a full task lifecycle and a per-task
stop over its control channel; the two steps surface those to Flow.

| # | What | Library surface | Status |
|---|------|-----------------|--------|
| 1 | Stop one background task | `session.stopTask(taskId) → { stopped }`, `capabilities.stopTask` | ✅ shipped |
| 2 | Read task lifecycle, typed | `getClaudeTaskDetails(event) → ClaudeTaskDetails \| null` | ✅ shipped |

Neither step changes the event stream or adds state. Step 1 is a method that
only acts when called. Step 2 is a pure function you call on events you already
receive. **No new events appear in your feed** — `task_*` events have always
flowed (as `type:"unknown"`), and only when the agent actually backgrounds work.
What you render is entirely your call on the consumer side.

---

## 1. Motivation: what we're building

A read-only "background processes" panel in Flow's execution view: list the
agent's live background tasks (a `next dev` server it spun up, a long test
watcher, an async subagent), show each one's status, and offer a **Stop**
button. The data path is Flow's existing one — `createSession({ onEvent })` →
`StreamEvent` → `chat_events` → SSE → browser. No new storage; we render events
we already receive.

- The **Stop** half needs a control the session can send → **Step 1**.
- The **read** half needs the task events typed instead of raw → **Step 2**.

---

## 2. Step 1 — `session.stopTask(taskId)` (shipped)

### The gap it closed

The old `AgentSession` control surface was `interrupt()` (whole turn),
`cancel(uuid)` (a *queued* message), and `close()` (the *whole session*). None
stopped **one** running background task. For a *backgrounded* server that's
doubly stuck: it's detached from the active turn, so even `interrupt()` can't
reach it; the only hammer was `close()`, which kills the agent and every other
task. The CLI already defines a per-task stop — agentex just never forwarded it.

✅ Confirmed in CLI `2.1.187`: the control request is
`{ subtype: 'stop_task', task_id: string }`; the **harness** owns the child PID
and performs the kill (the model is never in the loop); success is acknowledged
with an **empty `{}`** control_response, and an unknown / already-ended `task_id`
comes back as an error.

### Shipped API

```ts
interface AgentSession {
  /** Stop one in-flight background task without disturbing the session. */
  stopTask(taskId: string): Promise<StopTaskResult>;
}

interface StopTaskResult {
  stopped: boolean;
}
```

- Implemented for Claude as a sibling of `cancel()`: send the control_request,
  resolve `{ stopped: true }` on the success ack, `{ stopped: false }` on error
  or a closed session.
- Gated by a new `capabilities.stopTask` (`true` for Claude only). Every other
  provider keeps a documented no-op returning `{ stopped: false }` — exactly how
  `cancel` already degrades. Additive; `interrupt`/`close` semantics unchanged.
- The terminal status is **not** returned synchronously (the ack is empty). It
  arrives on the event stream as the task's next `task_updated`
  (`patch.status: 'killed'`) / `task_notification` (`status: 'stopped'`).

### What it unblocks

Flow's panel gets a real **Stop** button — one targeted call, no model
round-trip, no `close()` collateral, no out-of-band `lsof`/`kill` against a PID
we don't own.

---

## 3. Step 2 — `getClaudeTaskDetails(event)` (shipped)

### The gap it closed

The CLI emits `task_started` / `task_progress` / `task_updated` /
`task_notification` as `type:"system"` on the wire, but ⚠️ **agentex surfaces
them as `type:"unknown"`, not `type:"system"`** — its parser only gives
`system`+`init` a typed variant; the rest fall through the forward-compat escape
hatch with the payload on `raw`. So a consumer matching `ev.type === "system"`
sees *nothing*; you must match `ev.type === "unknown"` and read `raw`. The
existing `getClaudeUnknownDetails` only exposes `raw.subtype` + `raw.content` —
not `task_id`/`status` — so it didn't help.

The real wire shapes (✅ captured from CLI `2.1.187`):

| phase | key fields |
|-------|------------|
| `task_started` | `task_id`, `tool_use_id?`, `description`, `subagent_type?`, `task_type?`, `workflow_name?` — *no status* |
| `task_progress` | `task_id`, `tool_use_id?`, `description`, `subagent_type?`, `usage{total_tokens,tool_uses,duration_ms}` |
| `task_updated` | `task_id`, **`patch{ status?, description?, end_time?, total_paused_ms?, error? }`** — a *sparse patch*; `status ∈ pending\|running\|completed\|failed\|killed\|paused` |
| `task_notification` | `task_id`, `tool_use_id?`, **`status ∈ completed\|failed\|stopped`**, `output_file`, `summary`, `usage?` |

Note: `task_type` is **optional**; `task_updated` is a *partial patch* (status
lives under `patch`, and its enum differs from `task_notification.status`).

### Shipped API

```ts
function getClaudeTaskDetails(event: StreamEvent): ClaudeTaskDetails | null;

interface ClaudeTaskDetails {
  phase: "started" | "progress" | "updated" | "notification";
  taskId: string;
  toolUseId: string | null;     // absent on `updated`
  taskType: string | null;      // optional on the wire
  subagentType: string | null;  // started/progress, for Task subagents
  workflowName: string | null;  // started, for workflow tasks
  description: string | null;
  status: ClaudeTaskStatus | null;   // this event's status, read from wherever
                                     // the CLI put it; null on started/progress
  usage: ClaudeTaskUsage | null;
  outputFile: string | null;    // notification only
  summary: string | null;       // notification only
  endTime: number | null;       // task_updated.patch.end_time
}

type ClaudeTaskStatus =
  | "pending" | "running" | "paused"
  | "completed" | "failed" | "killed" | "stopped";
```

- Pure function, sibling to `getClaudeUnknownDetails`. Returns `null` for any
  event that isn't a Claude task event. The full payload always remains on
  `event.raw`, so fields agentex doesn't model yet stay reachable.
- **Stateless per-event decode, not a reducer.** `status` reflects only the
  event in hand (and `task_updated` is a sparse patch). Collapsing a task's
  events into one current state over its lifetime is the consumer's job — see §4.

### Using it

```ts
createSession({
  onEvent(event) {
    const task = getClaudeTaskDetails(event);
    if (task?.phase === "started") registerRow(task.taskId, task.description);
    // ...feed task into your own reducer; render what you care about...
  },
});
```

---

## 4. Deliberately **not** in the library (Flow's side)

These were considered and intentionally left out — they're fast-moving,
opinionated, or stateful, and the library is meant to forward + decode, not
interpret.

- **The task reducer / "what's running right now" / `listTasks()`.** Collapsing
  `started → progress → updated(patch) → notification` into one live status per
  task is a small state machine that bakes in an opinion (what "running" means,
  how to merge two status enums). It lives in Flow, next to the panel that
  renders it, so it can evolve with the CLI without a library release.
  - It also *can't* be authoritative in the library anyway: there is **no
    control-request to query tasks** — the CLI's accepted subtypes are
    `stop_task`, `interrupt`, `get_settings`, `set_model`, `rewind_files`, the
    `mcp_*` family, etc., with nothing like `list_tasks`. Any registry could
    only mirror what was observed on the stream — a derived cache Flow can keep
    itself, with the same reconnect cold-start either way.
  - Evidence this churns: `task_updated` didn't exist in CLI 2.1.70 and appeared
    by 2.1.187, which also added `subagent_type` / `workflow_name`. A reducer is
    a standing bet against a moving schema — keep that bet in the product.
- **Tailing a background server's full output for a live log view.** That's the
  per-task `.output` / `subagents/agent-*.jsonl` file on disk — a Flow-side read
  if we ever want a byte-level log. agentex shouldn't grow a file-tailing API.
- **The browser SSE / panel UI.** Entirely Flow's surface.
- **Deciding *which* tasks are worth showing** (servers vs. transient
  subagents) and **how chatty to be** (`task_progress` fires repeatedly — key on
  `taskId`, show the latest). Product policy; filter on `taskType`/`phase`
  consumer-side.

---

## One-line version

> `@agentex/agent` now forwards the CLI's per-task `stop_task` control
> (`session.stopTask(taskId)`, gated by `capabilities.stopTask`) and exposes a
> stateless typed decoder for the `task_*` lifecycle events
> (`getClaudeTaskDetails(event)`). It does **not** reduce, store, or list tasks —
> that opinionated, fast-moving state stays in Flow.
