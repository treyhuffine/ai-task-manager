# Async Review Semantics Migration Note

Status: opinion note
Date: 2026-05-22

## Question

Can we start simple, rely on existing unread/session review behavior, and add a new table or richer review state later?

## Short answer

Yes, but only if "simple" still preserves a durable run boundary from day one.

I would not start with review semantics living only in `chat_sessions.last_outcome_event_at` and `last_viewed_at`. That is fine as a notification system, but it is too weak as the future foundation for async agents. Later, when we want `awaiting_input`, `blocked`, approval, rollback, run summaries, cost attribution, or artifact attribution, we would have to reconstruct what happened from chat events and timestamps. That is doable once or twice, but it is not a good substrate for autonomy.

The safe simple version is:

- Keep the existing unread mechanics as the first review UI.
- Add a small run record now.
- Do not add the full review state machine yet.
- Make the small run record shaped so it can grow into the full `runs` table later.

In other words: start with simple semantics, not absent semantics.

## The important distinction

There are three possible approaches:

1. **Unread-only**
   - Scheduled work creates or continues a chat session.
   - Review is derived from `last_outcome_event_at > last_viewed_at`.
   - No durable execution row beyond normal chat events.

2. **Run-lite**
   - Every async execution gets a row.
   - Status is simple: `queued`, `running`, `completed`, `failed`, `skipped`.
   - The existing unread surface is still how the human reviews it.
   - The run row stores provenance, timing, summary, cost, and session linkage.

3. **Full run review**
   - The run row has semantic statuses: `awaiting_review`, `awaiting_input`, `blocked`, `done`, `failed`, `cancelled`, `timed_out`.
   - The agent must end each turn by declaring what state it is in.
   - The UI can distinguish "done, please review" from "I need your answer" from "I am blocked but no human action is needed."

I think v1 should ship approach 2. Approach 1 is too thin. Approach 3 is probably more than we need for the first pass.

## Why unread-only is risky

Unread means "the user has not looked at this outcome."

It does not mean:

- the agent is done
- the agent needs a decision
- the agent is blocked
- the result is safe to treat as approved
- the run produced artifacts
- the run changed tasks, notes, files, or external systems
- the run should be retried
- this output belongs to a particular schedule fire

Those are different concepts. They will become more important as soon as the agent is doing work while the human is gone.

Unread is a good review surface. It is not a good review contract.

## What I would add now

Add a general `runs` table now, but keep it intentionally small.

Do not call it `schedule_runs` unless we are comfortable renaming later. The future system will have manual runs, scheduled runs, webhook runs, connector runs, heartbeat-initiated followups, and queue runs. A generic `runs` table is the better durable primitive.

Minimum fields:

```ts
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),

  // provenance
  trigger: text('trigger', {
    enum: ['manual', 'schedule', 'webhook', 'connector', 'queue'],
  }).notNull(),
  schedule_id: text('schedule_id').references(() => schedules.id),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  agent_id: text('agent_id').references(() => agents.id).notNull(),
  chat_session_id: text('chat_session_id').references(() => chatSessions.id),
  trigger_payload: text('trigger_payload', { mode: 'json' }),

  // simple lifecycle
  status: text('status', {
    enum: ['queued', 'running', 'completed', 'failed', 'skipped'],
  }).notNull().default('queued'),
  status_reason: text('status_reason'),

  // timing
  queued_at: text('queued_at').notNull(),
  started_at: text('started_at'),
  finished_at: text('finished_at'),
  duration_ms: integer('duration_ms'),

  // outcome
  summary: text('summary'),
  artifact_refs: text('artifact_refs', { mode: 'json' }),
  error_message: text('error_message'),

  // usage
  input_tokens: integer('input_tokens'),
  cached_input_tokens: integer('cached_input_tokens'),
  output_tokens: integer('output_tokens'),
  cost_usd: real('cost_usd'),

  created_at: text('created_at').notNull(),
});
```

This gives us most of the long-term value without forcing the whole review UX now.

## What can stay simple

The first version can keep review behavior exactly where the current app already has leverage:

- A scheduled run writes to a normal execution chat session.
- The final agent outcome bumps `last_outcome_event_at`.
- The session appears in the existing unread / needs-review surface.
- The run row says `completed`, not `awaiting_review`.
- The user reviews by opening the session, replying, archiving, or marking read.

This is enough for the first product loop: "AI did something while I was away; show me what happened."

## What must not be deferred

These should exist from the first async version:

- A durable row per execution.
- A stable `run_id`.
- A link from run to chat session.
- A link from run to schedule/webhook/trigger.
- A summary field.
- Cost/token fields.
- Start/finish timestamps.
- Failure/skipped status.

These are cheap now and expensive to recreate later.

I would also seriously consider run write attribution early, even if approval UI is deferred. At minimum, when an agent creates or updates a task/note through the action registry, we should be able to know which run caused it. That could be an `activity_log` table, or a lighter `run_artifacts` table. Without this, "approve" and "rollback" later become fuzzy.

## Later migration to full review state

When simple unread review starts to break down, migrate the `runs.status` enum from:

```text
queued, running, completed, failed, skipped
```

to:

```text
queued, running, awaiting_review, awaiting_input, blocked,
done, failed, skipped, cancelled, timed_out
```

Migration rule:

- Existing `completed` runs become `done`.
- New async agent completions become `awaiting_review` if `requires_review=true`.
- Human mark-read can remain mark-read; approval becomes a separate action.
- `last_outcome_event_at` still drives notification badges.

That lets us keep unread as "attention" while adding run status as "workflow."

## When to add the full table/state

Add richer review state when we see any of these:

- The agent often asks questions while working asynchronously.
- The user cannot tell whether a run is done or waiting on them.
- The user wants to approve, reject, or iterate on a bundle of work.
- We need to group multiple runs from the same schedule.
- We need to retry blocked work.
- The system starts generating enough artifacts that "I read the chat" is no longer a meaningful approval.

My guess: this will happen quickly once schedules are useful. But it does not have to block the first scheduler.

## My recommendation

Ship a `runs` table now, but not the full review-gate experience.

For v1:

- use `runs.status = queued | running | completed | failed | skipped`
- use existing unread sessions as the human review surface
- track summary, cost, provenance, and artifacts
- keep heartbeat nudge-only and out of `runs`
- keep the UI language lightweight: "Activity", "Unread", "Needs attention"

For v1.5:

- add `requires_review`
- add `awaiting_review`
- add `awaiting_input`
- add `blocked`
- add agent completion actions
- add approval/iterate controls

This gives us the v2 document's simplicity without painting over the v3 document's core insight. The product can feel simple while the data model quietly preserves the autonomy path.

