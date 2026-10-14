# Agent task ordering

`reorder_tasks` moves an explicit ordered selection to the top of an Area's
existing Priority Order. It is available through the shared CLI and orchestrator
MCP registry. It does not create another priority field or change task lifecycle.

```json
{
  "area_id": "AREA_UUID",
  "task_ids": ["FIRST_TASK_UUID", "SECOND_TASK_UUID"],
  "position": "top"
}
```

`position` is optional and currently supports only `top`. The selection accepts
1 to 1,000 unique existing task IDs, all already in the specified Area. IDs are
ordered top to bottom. The response includes `areaId`, `position`, `taskIds` and
`changedTaskIds`. Raw ordering keys are not required from the caller.

## Guarantees

- Validates the complete selection and writes it in one immediate transaction.
- Updates only selected tasks' `sortKey` and `updatedAt`. Other tasks, including
  other Areas and the rest of the selected Area, are unchanged.
- Preserves bodies, attachment manifests, statuses, lifecycle history, deadlines
  and all other task fields. No content embeddings need regeneration.
- Leaves unselected null and duplicate keys intact. New fractional keys are
  placed before the earliest unselected non-null key in the Area.
- An already-correct selected prefix is a no-op, including timestamps. A retry
  after intervening user ordering is a new request to restore this prefix.
- Refreshes changed Markdown mirrors through one normal query-layer sync batch.
  Shared linked documents are deduplicated. Those usual mirror cascades do not
  mutate the linked documents' database rows.
- Returns `not_found` for missing tasks/Area, `invalid_params` for invalid or
  duplicate selections, and `conflict` for an Area mismatch or malformed
  unselected ordering bound. Rejected requests do not partially reorder tasks.

The operation is Area-wide across statuses, including Done and Archived records.
It does not move a task between Kanban columns. Within each column, Priority
Order reflects the selected order. Views sorted by recent activity, creation
time or deadline retain those sorting rules, rather than the requested positions.
The Updated sort can move selected tasks because their `updatedAt` changes.
`reorderTaskInLane` remains the separate
drag-and-drop helper for positioning a single card between visible neighbors.

## Ranking one task

`rank_task` puts one task at a numbered spot in the Priority Order of committed
work: Todo and In progress, across every Area, 1 being the top. It is the same
number a task's slideout shows ("Ranked #3 of 42"), where a person sets it by
clicking the rank and typing. The slideout's Move buckets (Top to Lowest) land
on a rank through the same write.

```sh
ri agent rank_task TASK_UUID 3
```

The response is `{ id, rank, total }`: where the task landed and how many tasks
are ranked. Ranks count tasks as `list_tasks` returns them with status `active`
and orderBy `sortKey`. A rank is not stored: it is the task's position, kept in
`sortKey` like every other ordering.

- A rank past the end places the task last. A rank below 1, or not a whole
  number, is `invalid_params`.
- Only the task moves. It takes a key between its new neighbors. The only other
  writes are keys a task above it needs first: an unranked task (unranked tasks
  sort after every ranked one, newest first), or tasks tied on one key at the
  requested spot. Unranked tasks below it stay unranked.
- A list whose keys can't bound a new one (out of order, malformed) is re-keyed
  in its new order. Unranked tasks below the spot still stay unranked.
- Repeating a satisfied rank is a no-op, timestamps included.
- Consider, Done and Archived tasks are not ranked: `conflict`. A missing task
  is `not_found`. A team home refuses ranks, since a team's task doesn't keep
  `sortKey` (it is each person's own planning).
- Ties in `sortKey` and `createdAt` are settled by id, in `listTasks` and here
  alike, so a rank always names one spot.

The placement rule is one pure function (`placeAtRank` in
`src/lib/tasks/priority-rank.ts`) used by the query (`rankTask`) and by the
slideout's optimistic update (`useRankTask`), so the readout moves at once and
settles on the same order.

## Verification

```sh
pnpm exec vitest run src/lib/db/queries.reorder.test.ts src/lib/orchestrator/registry.reorder.test.ts
pnpm exec vitest run src/lib/tasks/priority-rank.test.ts src/lib/db/queries.rank.test.ts src/lib/orchestrator/registry.rank.test.ts
pnpm ts
```

Tests use isolated temporary app roots and databases. They cover mixed statuses,
unselected-row preservation, null/duplicate keys, whole-Area selections, retries,
invalid inputs, malformed bounds, real transaction rollback and mirror refresh.
The rank tests add a seeded walk over lists with ties and unranked tails, checking
every placement lands on its rank and keeps the rest in order.
