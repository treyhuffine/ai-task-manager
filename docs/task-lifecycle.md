# Task lifecycle (Consider to Done)

This supersedes the old `active | done | archived` task model. It is the
implementation record for the "Ship Ri's Consider-to-Done task lifecycle" work.
The canonical spec and checklist live in that task's body, not here.

## The five canonical states

Stored on `tasks.status` (type-level enum, no SQL CHECK). Source of truth:
`src/lib/tasks/lifecycle.ts`.

| Status | Meaning |
|---|---|
| `consider` | A human-owned possibility (idea, open decision, maybe-task, verification, experiment). Not a commitment. |
| `todo` | Accepted into the committed queue, not currently underway. The default for normal task creation. |
| `in_progress` | The outcome is deliberately underway. Occupies a WIP slot. Persists through pauses, agent crashes, handoffs, and review. |
| `done` | The outcome happened and was accepted. A completed agent run alone never completes a task. |
| `archived` | No longer pursued, without claiming completion. Done work stays Done. |

`active` is no longer a status. "Current"/"active" work is the derived union
`todo | in_progress`. `ready`, `working`, `blocked`, `review`, `stalled`,
`needs input` are derived signals, never stored states.

## Transitions

All lifecycle changes go through one chokepoint in `src/lib/db/queries.ts`
(`transitionTask` and `completeTask`). Generic `update_task` / PATCH can no
longer change status.

| Command | Source → target |
|---|---|
| `move_to_todo` | consider → todo |
| `move_to_consider` | todo → consider (rejected while a deadline / recurrence / unresolved blocker / live associated workstream is present) |
| `start` | consider, todo → in_progress |
| `return_to_todo` | in_progress → todo |
| `complete` (via `complete_task`) | todo, in_progress → done (recurring: records one occurrence, advances, returns to todo) |
| `reopen` | done → todo (clears current completion fields, preserves completion history) |
| `archive` | consider, todo, in_progress → archived |
| `restore` | archived → todo |

Each command is transactional, carries a durable idempotency key (a retry with
the same key replays the recorded result), and bumps a monotonic
`status_changed_count`. A caller may pass the count it last saw
(`expectedStatusChangedCount`) for optimistic concurrency; a stale one returns a
stable `conflict`. Every command is recorded in the append-only
`task_status_changes` ledger with provenance.

`status_changed_at` records when a task entered its current status (for
current-state age). Legacy rows keep it NULL until their first transition, so
age is honestly unknown rather than faked.

The task↔workstream association is many-to-many via the `execution_tasks` join
table: a workstream (execution) can be associated with several tasks (a batch
with shared context) and a task can be worked by several workstreams. Association
is durable context, not ownership: it does not gate the task lifecycle and does
not claim live work. It collapses cleanly back to a single column if that ever
proves clunky. Reviews (`execution_reviews`) are keyed to the exact output event.

## Surfaces

- REST: `POST /api/tasks/:id/transition` and `/complete`. Generic PATCH rejects
  a `status` field; POST rejects a non-`consider`/`todo` create status.
- Orchestrator (CLI + MCP): `transition_task`, `complete_task`,
  `create_task` (consider|todo only), `update_task` (no status), `list_tasks`
  (accepts the legacy `active` filter alias = todo|in_progress).
- Client: `useTaskLifecycle` (shared complete/start/archive/restore/reopen/move
  actions), `useTransitionTask`, transition-aware optimistic cache
  (`optimisticTransition`).
- Deck: the generated daily stack selects only Ready Todo (status=todo,
  unblocked, not snoozed past now, recurrence due); In progress belongs to
  Current Work, not the stack.
- Calendar: shows Todo + In progress deadlines; Consider stays off.
- Stream: `promote_stream` can park an item in Consider or commit it to Todo.
- Lanes (List, and the planned Kanban): Current Work, Todo, Consider, Done,
  Archived — two views over the same records and the same lifecycle
  (`src/lib/tasks/lanes.ts`).

## Migration and backfill

- Schema migration `drizzle/0016_lyrical_network` adds the new columns and the
  three new tables, and changes the `tasks.status` default from the legacy
  `active` to `todo`. SQLite cannot `ALTER` a column default, so drizzle's only
  option is a full table rebuild, which reassigns rowids and desyncs the
  `tasks_fts` FTS5 index keyed by rowid. The migration is hand-rolled off that
  rebuild into a rowid-safe column swap (`RENAME status TO status_old` / `ADD
  status DEFAULT 'todo'` / `UPDATE status = status_old` / drop the status
  indexes / `DROP COLUMN status_old` / recreate the indexes). Column-level
  ALTERs preserve rowids, so FTS stays intact (verified). Existing `status`
  bytes are copied verbatim; the backfill maps `active` → `todo`. The status
  enum values change is type-level only in SQLite (no CHECK), so it emits no SQL.
  See CLAUDE.md "Column defaults" for the general rule.
- Data is normalized by a separate standalone command, never a migration:
  `pnpm backfill:lifecycle` (`scripts/backfill-task-lifecycle.ts`). Dry-run
  default; `--apply` snapshots the DB + tasks mirror first, rewrites task rows
  and task version snapshots (`active` → `todo`) in one transaction via raw SQL
  (preserving rowids, sort keys, completions, and all timestamps), re-renders
  the mirror, then verifies integrity_check, foreign_key_check, the FTS row
  count, and a zero-pending re-scan. Idempotent; refuses to apply on any unknown
  non-`active` status.
- During the compatibility window, reads normalize any lingering `active` byte
  to `todo` at the query boundary (`normalizeTaskStatus`), so no surface ever
  sees a non-canonical status even before the backfill runs.

## Entity version revert

Version revert is content-only: it restores title/body/description and other
content fields but never `status` or completion metadata. An undo of an edit
cannot silently un-complete a task or move it between lanes. Lifecycle changes
only ever happen through an explicit lifecycle command.
