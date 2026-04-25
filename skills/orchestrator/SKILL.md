---
name: orchestrator
description: Use when the user references tasks, notes, or their daily deck — or says things like "add to my list", "what am I working on", "remind me later", "capture this", "triage my inbox", "what's on my plate". Also when they mention their productivity system (an AI-native tasks + notes + deck app). Invoke BEFORE reading or writing files manually — the app owns the source of truth.
---

# Orchestrator

This app is the user's task + note + deck system. Data lives in a user-configurable data directory — SQLite (`data.db`) plus a markdown mirror. The exact on-disk paths are discoverable via the `describe_paths` action; never hardcode them. The data root can be moved via the `<APP>_ROOT` / `<APP>_BRAIN_PATH` env overrides, so always ask the app where things are rather than assuming.

Every write you make through the orchestrator automatically updates embeddings and the markdown mirror. If you bypass it and edit the DB or the mirror by hand, those invariants break and the user notices a week later.

## How to interact

You have two equivalent surfaces. Prefer MCP tools when the user's Claude Code has them wired; fall back to CLI.

**MCP tools** (one per action): `describe_paths`, `describe_schema`, `list_tasks`, `get_task`, `create_task`, `update_task`, `complete_task`, `list_notes`, `get_note`, `create_note`.

**CLI**: `<cli> agent <action> [params]` (the concrete `<cli>` binary is named in the CLAUDE.md at the app's data root). Output is JSON on stdout — pipe to `jq`. Run `<cli> agent <action> --help` to see params, or `<cli> agent describe_paths` to confirm where the app is installed on this machine.

Both surfaces share the same action registry — same names, same params, same return shape.

## Before doing anything

1. `describe_paths` — confirm the app is installed and which brain this session is talking to.
2. `list_tasks` / `list_notes` with a filter before creating, to avoid duplicates.
3. `describe_schema` if you're planning a multi-step operation and need exact column names.

## Writing conventions

- **Titles are imperatives.** "Ship the new MCP" — not "New MCP" or "MCP shipping".
- **Task energy:** `deep` (focused heads-down) or `light` (low cognitive load). Omit if unsure.
- **Task effort:** `trivial | small | medium | large | epic`. Default to `small` when unsure.
- **Status values:** tasks are `active | done | archived`; notes are `active | archived`.
- **Always use `complete_task` to mark done**, never `update_task` with `status: "done"`. Completion records a `task_completions` row and rolls recurring tasks to their next occurrence.
- **Prefer archive over delete.** There is no delete action in the agent surface — this is intentional.
- **Task vs. note:** if there's an action implied ("do X", "follow up with Y"), it's a task. If it's pure capture (an idea, a link, a quote, a reference), it's a note.
- **Link notes to tasks** when the note is context for a specific task — pass `task_id` on create.
- **Link to areas** when the user's active area is known — pass `area_id`. Don't guess areas; if unsure, leave it null and the user files it later.

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
