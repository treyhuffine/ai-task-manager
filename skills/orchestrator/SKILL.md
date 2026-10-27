---
name: {{SKILL_NAME}}
description: Use when the user references tasks, notes, or their daily deck — or says things like "add to my list", "what am I working on", "remind me later", "capture this", "triage my inbox", "what's on my plate". Also when they mention their productivity system (an AI-native tasks + notes + deck app). Invoke BEFORE reading or writing files manually — the app owns the source of truth.
---

# Orchestrator

Ri is the user's task + note + deck system. It keeps its data in one folder on the computer running it: a SQLite database (`data.db`) plus a markdown mirror. The folder can move, so never hardcode a path. On that computer, the `describe_paths` action says where everything is.

Every write you make through the orchestrator automatically updates embeddings and the markdown mirror. If you bypass it and edit the DB or the mirror by hand, those invariants break and the user notices a week later.

## How to interact

You have two equivalent surfaces. Prefer MCP tools when this agent has Ri's MCP connected (Settings → Connect your agent). On the computer running Ri, the `ri` command works too, so use it when MCP isn't connected.

An agent connected to Ri's MCP from outside Ri gets a smaller set of tools: tasks, notes, areas, the deck and search. The other tools below are for the chats Ri runs, or through `ri` on the computer running Ri.

**MCP tools** (one per action):

- Orientation: `describe_paths`, `describe_schema`, `list_skills`
- Tasks: `list_tasks`, `get_task`, `create_task`, `update_task` (content/metadata only, never status), `transition_task` (move_to_todo / move_to_consider / start / return_to_todo / reopen / archive / restore), `complete_task`
- Task ordering: `reorder_tasks` takes `area_id`, ordered `task_ids`, and optional `position: "top"`. Use it when asked to prioritize selected tasks, not `update_task` with raw ordering keys. `rank_task` takes a task `id` and a `rank` (1 is the top) and puts that one task at that number in the Priority Order of committed work (Todo and In progress, every Area), the number its slideout shows.
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
- Memory, from a session on another device that can't read Ri's files: `read_memory`. Send findings with `message_agent`, target `orchestrator`, response `none`, and a stable `request_id`. Ask the main chat to consider recording the finding in MEMORY.md, which it keeps
- Execution oversight: `list_executions`, `get_session_messages`, `message_agent`, `get_pending_input`, `answer_pending_input`, `delegate_work`, `archive_execution`
- Workspaces (the user calls a workspace an "agent"): `list_workspaces`, `get_workspace`, `create_workspace`, `update_workspace`, `archive_workspace`, `list_workspace_sessions`
- Triggers / runs: `list_triggers`, `get_trigger`, `create_trigger`, `update_trigger`, `delete_trigger`, `run_trigger`, `list_runs`, `get_run`, `cancel_run`, `reset_trigger_failures`
- Skills (what the user builds under Plugins): `list_skills`, `get_skill`, `create_skill`, `save_skill`, `move_skill`. A new skill is a draft (`draft:<name>`), which no agent uses until it's installed. Installed, it lives in Ri (every chat Ri runs uses it), globally (`~/.claude/skills`, every agent on this computer), or in a project (an agent's repo, shared by committing it), and each has a `ref` like `ri:weekly-review`. `move_skill` installs a draft, moves an installed skill, or uninstalls it (`to: "draft"`). Install or move only when the user asks or agrees. Pass the `hash` from `get_skill` as `baseHash` to `save_skill`: the user may be editing the same skill, and a stale save is refused instead of overwriting them.

**CLI**, on the computer running Ri: `ri agent <action> [params]`. Output is JSON on stdout, so pipe it to `jq`. Run `ri agent <action> --help` to see params, or `ri agent describe_paths` to confirm where Ri keeps its data on this machine.

Both surfaces share the same action registry — same names, same params, same return shape.

## Before doing anything

1. `describe_paths`: confirm which Ri this session is working with and where it keeps its data.
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
- **Decisions are notes with `kind: "decision"`.** When the user asks you to record a decision, `create_note` with `kind: "decision"`, a title that says what was decided ("Use the existing billing provider"), and a body with the choice, context, alternatives and rationale that were actually discussed. `update_note` with `kind` turns an existing note into a decision or back. Find them with `list_notes` or `search` and `kind: "decision"`. A "Decision:" title prefix means nothing. A conclusion that only matters to one task can stay in its body.
- **Link to areas** when the user's active area is known — pass `area_id`. Don't guess areas; if unsure, leave it null and the user files it later.
- **IDs are UUIDs, never names.** Look ids up first (`list_areas`, `list_tasks`, `search`) — never pass a name where an id is expected.
- **Priority order:** read the Area's tasks with `orderBy: "sortKey"`, then pass selected IDs to `reorder_tasks` in the intended top-to-bottom order. It preserves unselected tasks and all lifecycle states. Kanban still separates statuses, and this does not modify the Deck or start work. For one task at a number ("make this #3", "put it last"), use `rank_task`. Ranks count tasks as `list_tasks` returns them with `status: "active"` and `orderBy: "sortKey"`, and a rank past the end places the task last.

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

Executions are agent sessions doing delegated work inside workspaces. The user
calls a workspace an **agent** ("the ri agent" is the workspace named ri): its
folder, what it can use, a `purpose`, and standing `instructions` that every
execution in it receives. The oversight loop: `list_executions` (`running` /
`awaitingInput` / `unread` flags — unread mirrors the rail's Unread section) →
`get_session_messages` (condensed transcript tail — **read before acting**) →
`message_agent` (target `session:<chat id>`, content, stable `request_id`,
and required `response`). Choose `response: "required"` for an automatic
returned outcome, or `response: "none"` for information or steering without
an automatic return. Both modes wake the recipient when available. A message you send is
labeled with the chat it came from, in the transcript and for the receiving
agent, so it is never mistaken for the user typing. An imported terminal
session is read-only until the user takes it over in the app, so a send to one
is refused.

Start new work with `delegate_work` (`workspace_id`, a complete `prompt`, and
a fresh `request_id` per piece of work: retrying with the same one returns the
same execution rather than starting a second). It runs on the agent's default
device unless you pass `device_id`: `get_workspace` shows its `runOn`
choices, and `update_workspace` sets `defaultDeviceId` when the user asks.
Completion, failure, and blocked updates return automatically. An acceptance
receipt is not the outcome. Continue independent work or finish your turn
when waiting. Use `get_agent_request` for inspection instead of transcript polling.
Close out finished work with
`archive_execution`. It refuses when the worktree holds uncommitted or unpushed
work and says so. Only pass `force` when the user has said that work can go.
`update_workspace` edits an agent's name, emoji, area, `purpose` and
`instructions`. Connector access and the browser change only in the app.

A session that's `awaitingInput` is **blocked** — queued messages won't reach
it. Use `get_pending_input` for the prompt + requestId, then
`answer_pending_input`: questions when the user's intent is clear from
context. Permission prompts belong to the user: only a person can approve
one, in the app, and an approval from you is refused. You can deny one with
a reason to redirect the agent. Otherwise surface it. Never send to your own
session.
Recurring oversight belongs in a trigger with `target_kind=orchestrator`,
which fires with this same surface.

When reporting on an execution, reference it as `[[execution:SESSION_ID]]`
(plain text, own line — same rules as task/note markers) so the user gets a
live-status chip that opens the execution on click.

## Escape hatch

If you need a column, filter, or operation that isn't exposed in the action list, **do not** reach into the database or edit the markdown mirror directly. Tell the user what's missing, and propose adding an action to `src/lib/orchestrator/registry.ts`. The point of the typed action surface is that every dangerous operation goes through review.

Exception: purely *reading* a file in Ri's data folder (the markdown mirror, whose path `describe_paths` gives) to orient yourself is fine. Writing to it is not.

## Error shape

Actions return a stable envelope:

```json
{ "ok": true, "action": "create_task", "result": { … } }
{ "ok": false, "action": "get_task", "error": { "code": "not_found", "message": "…" } }
```

Common error codes: `not_found`, `invalid_params` (Zod issues included), `conflict`, `unsupported`, `unknown_action`, `internal_error`. Surface the message to the user when it's actionable; swallow it when you can recover.
