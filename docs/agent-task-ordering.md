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

## Verification

```sh
pnpm exec vitest run src/lib/db/queries.reorder.test.ts src/lib/orchestrator/registry.reorder.test.ts
pnpm ts
```

Tests use isolated temporary app roots and databases. They cover mixed statuses,
unselected-row preservation, null/duplicate keys, whole-Area selections, retries,
invalid inputs, malformed bounds, real transaction rollback and mirror refresh.
