---
name: {{SKILL_NAME}}
description: Use when the user references tasks, notes, or their daily deck — or says things like "add to my list", "what am I working on", "remind me later", "capture this", "triage my inbox", "what's on my plate". Also when they mention their productivity system (an AI-native tasks + notes + deck app). Invoke BEFORE reading or writing files manually — the app owns the source of truth.
---

# Orchestrator

This app is the user's task + note + deck system. Data lives in a user-configurable data directory — SQLite (`data.db`) plus a markdown mirror. The exact on-disk paths are discoverable via the `describe_paths` action; never hardcode them. The data root can be moved via the `<APP>_ROOT` / `<APP>_BRAIN_PATH` env overrides, so always ask the app where things are rather than assuming.

Every write you make through the orchestrator automatically updates embeddings and the markdown mirror. If you bypass it and edit the DB or the mirror by hand, those invariants break and the user notices a week later.

## How to interact

You have two equivalent surfaces. Prefer MCP tools when the user's Claude Code has them wired; fall back to CLI.

**MCP tools** (one per action):

- Orientation: `describe_paths`, `describe_schema`, `list_skills`
- Tasks: `list_tasks`, `get_task`, `create_task`, `update_task` (content/metadata only, never status), `transition_task` (move_to_todo / move_to_consider / start / return_to_todo / reopen / archive / restore), `complete_task`
- Task lifecycle notes: status changes go through `transition_task` / `complete_task`, never `update_task`. Both are retry-safe with `idempotency_key`. Archiving/completing a parent with open children returns a conflict listing them, and you retry with `acknowledged_child_ids`. Archiving/returning a task with a genuinely running workstream returns a conflict, and you retry with `runtime_choice` (keep_running or stop_running_agent).
- Task to execution: `attach_execution_to_task`, `detach_execution_from_task`, `list_task_executions`. An association is durable context (an execution may work many tasks, a task be worked by many executions), not exclusive ownership or proof of live work.
- Execution review: `review_execution` records an exact-output disposition (accepted / changes_requested / dismissed). Pass the exact `output_event_id` (event ids come back in `get_session_messages`). Reading output never reviews it.
- Notes: `list_notes`, `get_note`, `create_note`, `update_note`
- Links: `list_backlinks`, `list_outgoing_links` (what links to / from a task or note; write `[[task:UUID]]` / `[[note:UUID]]` in a body to create durable links)
- Stream: `list_stream`, `get_stream_item`, `create_stream_item`, `promote_stream`, `dismiss_stream`
- Areas: `list_areas`, `get_area`, `create_area`, `update_area`
- Deck: `get_deck`, `update_deck`, `regenerate_deck`
- Search: `search`
- User state: `get_user_state`, `update_user_state`
- Execution oversight: `list_executions`, `get_session_messages`, `send_session_message`, `get_pending_input`, `answer_pending_input`
- Workspaces / schedules / runs: `list_workspaces`, `get_workspace`, `create_workspace`, `archive_workspace`, `list_workspace_sessions`, `list_schedules`, `get_schedule`, `create_schedule`, `update_schedule`, `delete_schedule`, `run_schedule`, `list_runs`, `get_run`, `cancel_run`, `reset_schedule_failures`

**CLI**: `<cli> agent <action> [params]` (the concrete `<cli>` binary is named in the CLAUDE.md at the app's data root). Output is JSON on stdout — pipe to `jq`. Run `<cli> agent <action> --help` to see params, or `<cli> agent describe_paths` to confirm where the app is installed on this machine.

Both surfaces share the same action registry — same names, same params, same return shape.

## Before doing anything

1. `describe_paths` — confirm the app is installed and which brain this session is talking to.
2. `list_tasks` / `list_notes` with a filter — or `search` — before creating, to avoid duplicates.
3. `describe_schema` if you're planning a multi-step operation and need exact column names.

## Writing conventions

- **Titles are imperatives.** "Ship the new MCP" — not "New MCP" or "MCP shipping".
- **Task energy:** `deep` (focused heads-down) or `light` (low cognitive load). Omit if unsure.
- **Task effort:** `trivial | small | medium | large | epic`. Default to `small` when unsure.
- **Status values:** tasks are `consider | todo | in_progress | done | archived`. Notes are `active | archived`. "Current" (or "active") work is the derived union of `todo` plus `in_progress`, not a stored state. New tasks default to `todo`, use `consider` only for a tentative user-owned possibility.
- **Change lifecycle with `transition_task`** (move to todo, move to consider, start, return to todo, reopen, archive, restore). `update_task` changes content and metadata only and cannot set status. Runtime and agent-run events never change a task's lifecycle on their own.
- **Always use `complete_task` to mark done**, never `update_task`. Completion records a `task_completions` row and rolls recurring tasks to their next occurrence.
- **Prefer archive over delete.** There is no delete action in the agent surface, this is intentional.
- **Task vs. note:** if there's an action implied ("do X", "follow up with Y"), it's a task. If it's pure capture (an idea, a link, a quote, a reference), it's a note.
- **Link notes to tasks** when the note is context for a specific task — pass `task_id` on create.
- **Link to areas** when the user's active area is known — pass `area_id`. Don't guess areas; if unsure, leave it null and the user files it later.
- **IDs are UUIDs, never names.** Look ids up first (`list_areas`, `list_tasks`, `search`) — never pass a name where an id is expected.

## Deck, search, and user state

- **Deck** = the day's ranked priority stack (3–7 items) plus alternatives. `get_deck` reads the
  latest. `update_deck` reorders/swaps — preserve each item's `rationale`, and mark items you
  place as `source: "user"` (you're acting on the user's behalf). `regenerate_deck` reruns the
  full AI pipeline — it's slow and replaces the stack, so only on explicit request ("rebuild my
  deck"), not as a side effect.
- **Search first.** `search` is hybrid semantic + keyword over tasks, notes, and stream entries.
  Reach for it before creating anything and before answering "what was I doing about X".
- **User state** is the user's *current* working context (active area/task, energy, available
  minutes, focus text) — update it when the user tells you how they're showing up ("I have 30
  minutes", "low energy today"). It is not a settings surface; app settings aren't writable here.

## Stream triage

The stream is the quick-capture inbox. Triage loop: `list_stream` (pending) →
per item: actionable → `promote_stream to=task` with a shaped imperative
title; keep-but-not-actionable → `promote_stream to=note`; noise →
`dismiss_stream`. Promotion creates the entity and stamps the stream row's
links in one call; raw text and attachments carry over — shape the title,
don't rewrite the user's words. Ambiguous items: ask or leave pending rather
than guess. `create_stream_item` files things INTO the inbox when the right
shape isn't clear yet.

## Execution oversight

Executions are agent sessions doing delegated work inside workspaces. The
oversight loop: `list_executions` (`running` / `awaitingInput` / `unread`
flags — unread mirrors the rail's Unread section) →
`get_session_messages` (condensed transcript tail — **read before acting**) →
`send_session_message` (nudge, add context, redirect). Sends are
asynchronous — re-check the transcript for the response.

A session that's `awaitingInput` is **blocked** — queued messages won't reach
it. Use `get_pending_input` for the prompt + requestId, then
`answer_pending_input`: questions when the user's intent is clear from
context; permission prompts default to surfacing to the user — approve only
what they explicitly asked for or delegated. Never send to your own session.
Recurring oversight belongs in a schedule with `target_kind=orchestrator`,
which fires with this same surface.

When reporting on an execution, reference it as `[[execution:SESSION_ID]]`
(plain text, own line — same rules as task/note markers) so the user gets a
live-status chip that opens the execution on click.

## Escape hatch

If you need a column, filter, or operation that isn't exposed in the action list, **do not** reach into the database or edit the markdown mirror directly. Tell the user what's missing, and propose adding an action to `src/lib/orchestrator/registry.ts`. The point of the typed action surface is that every dangerous operation goes through review.

Exception: purely *reading* a file under the brain directory (the markdown mirror — get its path via `describe_paths`) to orient yourself is fine. Writing to it is not.

## Error shape

Actions return a stable envelope:

```json
{ "ok": true, "action": "create_task", "result": { … } }
{ "ok": false, "action": "get_task", "error": { "code": "not_found", "message": "…" } }
```

Common error codes: `not_found`, `invalid_params` (Zod issues included), `conflict`, `unsupported`, `unknown_action`, `internal_error`. Surface the message to the user when it's actionable; swallow it when you can recover.
