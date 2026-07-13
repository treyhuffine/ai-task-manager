# Stream: Product Spec and Build Tasks

**Status:** Authoritative. Supersedes `docs/stream-fable-med.md`, `docs/stream-fable-xhigh.md`, and `docs/stream-reconciliation-prd.md` for implementation purposes. Those documents remain as background reading. Where they disagree with this document, this document wins.

**Implementation status (2026-07-12):** Phases 0 through 3 are built and verified (typecheck, unit + integration tests, production build, migration against dev and prod database copies). T3.4 executed same-day with the dogfood gate waived (single-user install): every database was verified to hold zero promoted stream rows, so no data conversion was needed and the legacy stamp columns are simply dropped. All migration SQL is drizzle-kit generated (`drizzle/0002_fine_sphinx.sql` carries the triage tables, new columns, and column drops in one CLI-authored migration). `stream_links` is the only provenance representation. Part 6 stays unchecked until the release gate. Live-model planner quality runs via `pnpm eval:triage` against the fixture corpus.

**Last updated:** 2026-07-12

**Code audit basis:** verified against the working tree on 2026-07-11. Every file path and claim in Part 2 was checked against the actual code, not inherited from earlier docs.

## How to use this document

This is both the product contract and the implementation checklist. It is written so that an LLM agent (or a human) can execute it task by task without needing outside judgment calls. Every previously open design question has been resolved in section 3.15.

- Work phases in order. Tasks within a phase may run in parallel unless a dependency says otherwise.
- Check `[ ]` to `[x]` as work lands. Do not check a box until its acceptance criteria pass.
- Part 1 (product contract) and section 3.15 (resolved decisions) must not be changed casually while implementing. If implementation reveals a contract problem, stop and flag it rather than silently deviating.
- Part 4 lists repository rules that override anything else here if they conflict.
- All user-facing copy must follow the vocabulary and rules in section 1.10.

---

# Part 1: Product contract

## 1.1 What the stream is

The stream is an append-only ledger of raw human intent and the trust boundary between the user's mind and the system. It is the front door of the product: the top of the Capture, Triage, Route, Execute, Review, Learn loop, and the source of the acceptance telemetry that is the product's long-term moat.

Traditional inboxes conflate two roles that must be separated:

- A queue to drain: items awaiting a decision, transient by nature.
- A permanent record: the temporal trace of what the user was thinking, searchable forever.

The resolution: a stream item is never deleted or moved. It receives a **disposition**. The task or note it produced links back to it. The item stays in the ledger, in vector search, in FTS, in the file mirror.

The user promise:

> Capture anything. The app keeps your words, recognizes what matters, combines what belongs together, and asks only when your judgment is truly needed.

The emotional outcome that matters more than inbox zero:

> Once something is captured, the user trusts themselves to stop remembering it.

## 1.2 The trust contract

Five invariants. Every design and implementation decision must be checkable against these.

1. **The stream is append-only and permanent.** Triage derives artifacts. It never consumes or deletes the source. No code path hard-deletes a stream item.
2. **Original words are immutable.** `raw_text` is never rewritten after its first successful value is set. Cleanup (filler removal, structure recovery for voice transcripts) happens in the derived artifact, never in place.
3. **Provenance is bidirectional and always visible.** A capture shows where it went. A task or note shows what it came from. The user never wonders where a thought ended up.
4. **Autonomy is graduated per disposition and earned through measured acceptance.** Nothing acts silently by default. Every automatic action is one tap from undo.
5. **The agent has explicit permission to do nothing.** Most thoughts should not become tasks. "Kept as a thought" is a success outcome and should be common.

## 1.3 Dispositions

The agent (or the user, manually) resolves each capture with one or more of these dispositions:

1. **Promote**: the capture becomes a new task or note.
2. **Merge**: the capture is appended into an existing task or note, non-destructively.
3. **Combine**: several captures are fused into one new task or note. The agent synthesizes a coherent body from the fragments rather than concatenating raw text.
4. **Journal**: the capture is a musing, venting, or an observation. It stays in the ledger as a record, requiring nothing. This is a recorded decision, not an absence of one, so the queue still drains.
5. **Dismiss**: the capture is noise or already covered. Soft status change, recorded, reversible.
6. **Incubate** (Phase 3): the capture is not actionable now but should resurface at a time or when related context appears.

**Splitting is supported through multiple decisions, not a separate disposition.** People do not think in task-sized units. One voice ramble can contain two tasks and context for an existing note. This is modeled as multiple decision rows referencing the same stream item (see 3.2). A capture is resolved when all of its decisions reach a terminal state.

## 1.4 The central risk: over-promotion

The biggest product risk is not mis-filing. It is an agent biased toward action converting every stray thought into a task. An inflated task list is worse than a full inbox. An inbox pile is at least honest about being unprocessed. A noise-filled task list corrodes trust in the one surface that must stay trustworthy, and it recreates the system rot the product exists to eliminate.

Consequences for implementation:

- The sweep prompt carries an explicit restraint bias: when in doubt between task and journal, choose journal.
- The journal share metric is monitored (section 3.14). Suspiciously low journal share means over-promotion.
- Stream-born task engagement is compared against manually created task engagement. Higher abandonment of stream-born tasks means the agent is promoting noise.

## 1.5 The autonomy ladder

Per disposition, three levels:

- **Suggest**: the agent attaches a proposal. Nothing changes until the user accepts.
- **Auto with digest**: the agent acts. Every sweep produces a digest. Every line is one tap from undo.
- **Silent**: the agent acts. The digest is available but not pushed. Earned per disposition, never default.

Starting positions:

| Disposition | Start level | Rationale |
|---|---|---|
| Journal | Suggest in Phase 1, auto-with-digest from Phase 2 | A no-op with a record. Cheapest trust to build. |
| Promote (task or note) | Suggest | Visible and reversible but creates surface area. |
| Dismiss | Suggest | Wrongly discarding a thought is a trust killer. |
| Merge into existing | Suggest, graduates slowly | A wrong merge is the single most trust-destroying operation. |
| Combine many into one | Suggest, graduates last | Compound merge risk. |
| Urgent reminder (narrow carve-out, see 1.7) | Auto with digest from Phase 2 | Missing an explicit time commitment is worse than a rare wrong task. |

Graduation rules (concrete, tunable constants in one module):

- Suggest to auto-with-digest: at least 20 decisions of that disposition and at least 90 percent accepted without correction.
- Auto-with-digest to silent: at least 50 decisions and at least 97 percent accepted.
- Automatic demotion: trailing-20 acceptance below 80 percent drops one level immediately.
- **Graduation is offered, never taken.** The digest asks: "I have been 96 percent accepted on task suggestions this month. Want me to start applying those automatically?" The user's acceptance writes the config change. Demotion is automatic and announced plainly in the digest ("I have been getting merges wrong, so I will go back to suggesting them").

A single global kill switch forces every disposition back to suggest without a migration or restart.

## 1.6 Extraction is automatic, judgment is correctable

The agent extracts and asserts: what kind of thing a capture is, which area it belongs to, dates and times actually mentioned, entities, a clean title, and a cleaned-up body (especially for voice transcripts).

The agent proposes but never asserts: energy, effort, priority, placement. Proposed values pre-fill the review UI. The human's tap corrects them, and the correction is logged as signal. Never invent deadlines. Never emit confident effort scores (uniform middle-of-scale judgments are worse than none).

Model confidence is an internal policy signal only. It is never shown to the user as a number, and it never gates autonomy. Measured user acceptance gates autonomy.

## 1.7 Time sensitivity (the wait-risk lane)

Batched triage improves interpretation (section 1.8), but "call Sam before 3" cannot sit in a 20-minute debounce window. A separate, narrow, fast check runs immediately after every capture becomes readable:

> Could waiting 20 minutes cause the user to miss a real commitment or time-sensitive action?

- Output is one of `wait_safe`, `time_sensitive`. Default is `wait_safe`.
- Deterministic date and time extraction runs before the model. The model must cite the exact source words supporting urgency. No cited evidence means `wait_safe`.
- A `time_sensitive` capture skips the debounce: a single-item sweep runs immediately and its proposal (or auto-applied reminder, see below) surfaces right away.
- **Urgent reminder carve-out:** when the capture contains an explicit imperative plus an explicit time ("remind me at 3pm to send the deck"), Phase 2 onward auto-creates the reminder task with the extracted `reminder_at`, records it in the digest, and keeps one-tap undo. The criteria are strict: explicit imperative, explicit time, cited evidence. Anything softer is a suggestion.
- Urgency detection does no grouping, no merging, and no note work. It is a single-purpose lane.

## 1.8 Batched triage and the digest

Triage runs in batches, not per item. Per-item instant triage cannot notice that five captures over two hours are one project taking shape. Batching also produces the natural unit of review: the digest.

Sweep triggers, in priority order:

1. **Rolling debounce**: a sweep fires 20 minutes after the most recent capture. Each new capture pushes the timer. Implemented as a trigger row so it survives restarts (section 3.9). Never an in-process timer.
2. **Scheduled**: a morning pass before deck generation, created as a visible, user-editable trigger.
3. **Threshold**: pending count at or above 10 fires immediately, even mid-debounce.
4. **On demand**: the user taps Triage in the UI or says "triage my stream" in chat.
5. **Urgency**: lane 1 marks a capture time-sensitive (single-item immediate sweep).

The digest is the review moment. Shape:

> Processed 12 captures from this afternoon. 3 became tasks (2 in Product, 1 in Home). 2 added to your migration note. 5 kept as thoughts. 2 set aside.

Every line: tap-through to the entity, one-tap undo, and **re-route** (accept the action but change the destination). Re-route is richer signal than undo and is a first-class affordance.

The digest lives on the deck (Phase 2) and in the stream tab. Do not build a second inbox to review what the agent did with the first one.

## 1.9 Provenance

- A stream item shows where it went, including multiple destinations from one capture.
- Tasks and notes show which captures they came from, in the UI and in the markdown file mirror (notes already render a Sources section, tasks must too).
- Undo is always reachable from either side (see 3.10 for exact semantics).
- `stream_links` (section 3.2) is the source of truth. It is many-to-many by construction: one capture to many entities, many captures to one entity.

## 1.10 Voice and vocabulary

Status values are internal. The user sees consequences, not machinery: "Added to Launch Plan," never "Triage run 04 applied action 3 at 0.91 confidence."

| Internal | User-facing |
|---|---|
| `pending` | Captured |
| `proposed` | Needs your call |
| `promoted` | Added to … / Became a task / Became a note |
| `reviewed` | Kept as a thought |
| `dismissed` | Set aside |
| `incubating` | Kept for later |

Copy rules (hard requirements):

- No guilt language. Never "overdue captures," "inbox debt," red pending counts, or pressure to process everything.
- The ambient signal is binary: something needs your call, or nothing does. Never a raw unprocessed count as the primary signal.
- Empty state reassures: "Nothing needs you."
- Failure copy states what is safe first: "Your recording is saved. Transcription needs another try."
- Never use em dashes or semicolons in user-facing copy.
- Never hardcode a product name or a person's name in user-facing strings (project is going open source).
- Never show model confidence as a number.

## 1.11 Non-goals and anti-goals

Not building, on purpose:

- **A rules engine.** No user-authored if-this-then-that routing. The agent plus telemetry is the mechanism. Users who want determinism can edit the sweep trigger's prompt (the user-owned hook).
- **Auto-ingesting firehoses.** The visible stream holds things a human meant to capture. Connector-sourced signal (email, Slack, calendar) stays out of the stream. When connectors ship, they get their own ingestion boundary and reuse the reconciliation engine behind a stricter trust wall. Existing Pocket webhook items are deliberate user pushes and stay.
- **The stream as a destination.** No feed mechanics, no pinning, no folders, no stream-native organization. It is a ledger with a queue on top.
- **A second review surface.** The digest lives on the deck and the stream tab. No new top-level destination.
- **A tagging system, a knowledge graph, or perfect semantic organization in v1.**
- **Hard deletion paths for stream items.** Nothing in this spec deletes a capture.
- **Confident judgment scores.** See 1.6.
- **Exposing internal vocabulary** (runs, passes, confidence, dispositions) in the default UX.

---

# Part 2: Current state (verified 2026-07-11)

What exists and is sound:

- **Schema** (`src/lib/db/schema.ts:169-207`): `stream` table with `rawText`, `source` (capture/chat/webhook), `media` (text/voice/image), `origin`, external dedupe fields (`externalSource`, `externalId`, `externalPayload`, indexed), `status` (pending/promoted/dismissed), `dismissedBy`, `promotedToType/Id/At`, `promotionPass`, `attachments`.
- **Query layer** (`src/lib/db/queries.ts`): `listStream`, `getStream`, `findStreamByExternalId`, `createStream`, `updateStream`, `dismissStream`. Embedding upsert and mirror sync fire on create/update. No hard delete exists anywhere.
- **Orchestrator actions** (`src/lib/orchestrator/registry.ts`): `list_stream`, `get_stream_item`, `create_stream_item`, `promote_stream` (one item to one new task or note, guards status pending, throws conflict on re-promote), `dismiss_stream`.
- **Capture surface**: `POST /api/capture` (`src/app/api/capture/route.ts`) handles text, voice (transcription), image (vision extraction). Failure paths already preserve the original: failed transcription saves the audio attachment, failed image extraction saves the images. Pocket webhook dedupes via `externalId`.
- **Manual triage UI** (`src/components/stream/`): `stream-list.tsx`, `stream-triage.tsx`, `promote-actions.tsx`, `stream-attachments.tsx`.
- **Search**: stream is a first-class entity in sqlite-vec and FTS5, participates in hybrid search.
- **Triggers infrastructure** (`src/lib/db/schema.ts:1037`, `src/lib/scheduler/runner.ts`): kinds `manual | at | every | cron | webhook`, `nextRunAt` advanced atomically before dispatch, `concurrencyPolicy`, per-trigger model/effort, `findTriggerByName` query, `run_trigger` action, `runs` table. Dispatches harness sessions.
- **Entity versions** (`src/lib/db/schema.ts:872`): full snapshot per change, `source` human/ai/system, `revertedFromVersionId`. `updateTask` and `updateNote` accept `meta?: EntityVersionMeta`.
- **Harness triage prompt**: `src/lib/orchestrator/harness-surface.ts` has a "Stream triage" section instructing per-item promote/dismiss. On-demand only. Nothing runs it automatically.

The critical gap: **no automated triage exists at all.** Nothing calls the stream actions proactively. The feature as built is a manual GTD inbox with agent-shaped plumbing.

Defects and dormant scaffolding (all verified in code):

| # | Finding | Location | Resolution |
|---|---|---|---|
| 1 | Promotion is duplicated client-side as non-atomic create-then-stamp | `stream-list.tsx:111-192`, `stream-triage.tsx:92-174` | Phase 0, T0.2 |
| 2 | "Merge into note" overwrites the target note body (acknowledged in a comment: "API should append, but for now we mark as promoted") | `stream-list.tsx:179` | Phase 0, T0.1 |
| 3 | `tasks.streamItemId` FK exists but no promote path writes it | `schema.ts:224`, `registry.ts` promote handler | Phase 0, T0.2 |
| 4 | Triage sheet collects a placement override that is never persisted | `stream-triage.tsx:59, 265-337` | Phase 0, T0.2 (remove the pill) |
| 5 | `promotionPass` column declared, never read or written | `schema.ts:200` | Superseded by `triage_decisions.pass_id`, dropped in Phase 3 |
| 6 | `brain-dump-modal.tsx` exists alongside `quick-capture-modal.tsx` | `src/components/dashboard/` | Phase 0, T0.6 (delete if unmounted) |
| 7 | Notes have no back-link to stream | `schema.ts:943` | `stream_links` solves it, do not add a column to notes |
| 8 | One-to-one stamp columns cannot represent many-to-many outcomes | `schema.ts:197-199` | `stream_links`, Phase 0, T0.3 |
| 9 | No proposal state, no reversal path (un-promote, reopen) anywhere | schema, queries, registry | Phase 0 and 1 |
| 10 | Generic PATCH on `/api/stream/[id]` accepts arbitrary fields | `src/app/api/stream/[id]/route.ts` | Phase 0, T0.5 |
| 11 | Task file mirror renders no Sources section (notes do) | `src/lib/export/mirror/sync.ts` | Phase 0, T0.6 |
| 12 | Agent cannot merge, combine, journal, or propose | `registry.ts` | Phase 1, T1.1 |

---

# Part 3: Technical design

## 3.1 Status lifecycle

`stream.status` values: `pending | proposed | promoted | dismissed | reviewed | incubating`

```
            +--> proposed ----+--> promoted   (promote/merge/combine applied)
            |                 +--> reviewed   (journal applied)
pending ----+                 +--> dismissed
            |                 +--> incubating (phase 3)
            +--> (direct, when auto-applied or user acts manually)

undo / reopen: any terminal status --> pending
incubating --> pending when resurfaceAt arrives
```

Transition rules:

- `pending -> proposed` when one or more decisions in state `proposed` reference the item.
- An item with multiple decisions takes the highest-precedence applied outcome: `promoted > incubating > reviewed > dismissed`. While any referencing decision is still `proposed`, the item stays `proposed`.
- Every terminal status is reversible. Undo and reopen return the item to `pending` (see 3.10).
- Drizzle text enums in SQLite are type-level only, so extending the enum is code-only and requires no migration. Readers must tolerate all six values.

Auto-applied decisions skip `proposed`: the item goes straight to its terminal status, and the decision row records that it was applied by policy so the digest can show "applied automatically" with undo.

## 3.2 Schema

All new tables follow the repository timestamp rule: `id` first, then the shared `timestamps` spread, then remaining fields. All new columns on existing tables are nullable or defaulted (additive only). Generate migrations with `pnpm db:generate`, never hand-apply with sqlite3.

### `triage_passes` (new)

One row per sweep. Doubles as the single-flight lock.

```ts
triagePasses = sqliteTable('triage_passes', {
  id: text().primaryKey(),            // uuidv7
  ...timestamps,
  trigger: text({ enum: ['debounce', 'schedule', 'threshold', 'manual', 'urgency'] }).notNull(),
  status: text({ enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  sessionId: text(),                  // chat session that ran the sweep, null for lane-1-only passes
  itemsSeen: integer().notNull().default(0),
  autoApplied: integer().notNull().default(0),
  proposed: integer().notNull().default(0),
  summary: text(),                    // agent's one-paragraph account, feeds the digest
  completedAt: text(),
}, (t) => [index('idx_triage_passes_status').on(t.status, t.createdAt)])
```

Single-flight: refuse to start a sweep while a `running` pass exists that is younger than 10 minutes. A `running` pass older than 10 minutes is stale: mark it `failed` and proceed. A failed sweep leaves items `pending`, never half-disposed.

### `triage_decisions` (new, load-bearing)

One row per disposition decision, agent or human. This single table powers proposal storage, digest rendering, undo, and the acceptance telemetry that gates autonomy.

```ts
triageDecisions = sqliteTable('triage_decisions', {
  id: text().primaryKey(),            // uuidv7
  ...timestamps,
  passId: text().references(() => triagePasses.id),   // null for manual UI triage
  streamItemIds: text({ mode: 'json' }).$type<string[]>().notNull(), // usually one, several for combine
  disposition: text({ enum: [
    'promote_task', 'promote_note',
    'merge_task', 'merge_note',
    'combine_task', 'combine_note',
    'journal', 'dismiss', 'incubate',
  ] }).notNull(),
  targetType: text({ enum: ['task', 'note'] }),        // null for journal/dismiss/incubate
  targetId: text(),                    // existing entity for merge, created entity once executed
  draft: text({ mode: 'json' }).$type<TriageDraft>(),  // see 3.3
  confidence: real(),                  // agent self-report, internal policy signal ONLY
  rationale: text(),                   // one sentence, shown in review UI
  state: text({ enum: ['proposed', 'executed', 'accepted', 'corrected', 'undone'] }).notNull(),
  correctedDisposition: text(),        // what the user changed it to, when state = 'corrected'
  actor: text({ enum: ['agent', 'user'] }).notNull(),
  decidedAt: text(),                   // when a human accepted/corrected, or policy auto-applied
  undoneAt: text(),
  entityVersionId: text(),             // version created by an applied merge, for undo
}, (t) => [
  index('idx_triage_decisions_pass').on(t.passId),
  index('idx_triage_decisions_state').on(t.state, t.createdAt),
  index('idx_triage_decisions_disposition').on(t.disposition, t.state),
])
```

State semantics:

- `proposed`: suggest-mode, awaiting the user. Referenced items are status `proposed`.
- `executed`: applied by policy (auto tier) or by user accept. Counts as pending-acceptance until the user sees the digest. For telemetry, `executed` decisions that survive 7 days without correction or undo count as accepted.
- `accepted`: user explicitly confirmed (tapped accept, or tapped "Looks right" on the digest).
- `corrected`: user changed disposition, target, or draft materially. Records `correctedDisposition`.
- `undone`: user reversed it.

**Key move: manual UI triage writes rows here too, with `actor: 'user'` and `state: 'accepted'`.** The user's own routing history is ground-truth labeled data. It bootstraps the agent's few-shot context and gives acceptance metrics a baseline before the agent ever acts.

**Splitting:** one capture producing a task and a note append is two decision rows, each with the same single-element `streamItemIds`. No special disposition needed.

### `stream_links` (new, provenance source of truth)

```ts
streamLinks = sqliteTable('stream_links', {
  id: text().primaryKey(),            // uuidv7
  ...timestamps,
  streamId: text().notNull().references(() => stream.id),
  entityType: text({ enum: ['task', 'note'] }).notNull(),
  entityId: text().notNull(),
  relation: text({ enum: ['created', 'merged_into', 'combined_into'] }).notNull(),
  decisionId: text().references(() => triageDecisions.id), // null for backfilled legacy rows
}, (t) => [
  index('idx_stream_links_stream').on(t.streamId),
  index('idx_stream_links_entity').on(t.entityType, t.entityId),
])
```

Many-to-many by construction. A combine of five captures into one task yields five rows with relation `combined_into`. A capture that appends to a note and spawns a task yields two rows. Reverse lookups go through one query helper `getStreamSources(entityType, entityId)` shared by UI and mirror.

Legacy stamp columns (`promotedToType`, `promotedToId`, `promotedAt`) keep being written for the single-link case through Phase 2 for UI compatibility, then reads migrate to `stream_links` and the columns are dropped in Phase 3 along with `promotionPass`.

### `stream` table changes

- Extend the `status` enum (code-only, see 3.1).
- Add `resurfaceAt: text()` nullable, in Phase 3 only, for incubation.
- No proposal column. Proposals live in `triage_decisions`.

### `user_state` changes

Add one JSON column:

```ts
streamAutonomy: text({ mode: 'json' }).$type<StreamAutonomyConfig>()
```

```ts
interface StreamAutonomyConfig {
  killSwitch: boolean                        // true forces everything to suggest
  levels: Partial<Record<Disposition, 'suggest' | 'auto_digest' | 'silent'>>
  // absent key = the starting level from section 1.5
}
```

## 3.3 The draft object

Stored on `triage_decisions.draft`, validated with Zod (single schema module `src/lib/stream-triage/schema.ts`, shared by actions, routes, and the planner):

```ts
interface TriageDraft {
  title?: string          // for promote/combine creates
  body?: string           // synthesized body. For voice: cleaned transcript. Original rawText untouched.
  description?: string    // task description for merge-as-context
  areaId?: string | null
  parentId?: string | null      // subtask placement for merge_task when actionable (see 3.15)
  energy?: 'deep' | 'light' | null      // PROPOSED, never asserted
  effort?: 'trivial' | 'small' | 'medium' | 'large' | 'epic' | null  // PROPOSED
  hardDeadline?: string | null  // only when explicit in source text
  reminderAt?: string | null    // only when explicit in source text
  evidence?: string             // exact source words supporting dates/urgency, required when either date field is set
  expectedTargetUpdatedAt?: string  // optimistic concurrency guard for merges
}
```

Validation rules enforced server-side (not just in the prompt): `hardDeadline` or `reminderAt` without `evidence` is rejected. Empty `title` on a create is rejected. `targetId` must exist and match `targetType` at apply time.

## 3.4 Query layer functions

All in `src/lib/db/queries.ts` (or a `src/lib/db/queries/` module it re-exports). Handlers and routes never touch Drizzle directly.

New functions:

- `appendToNote(noteId, content, meta: EntityVersionMeta & { sourceStreamIds: string[] })`: non-destructive append with a blank line separator, creates an entity version via the existing `updateNote` path, returns the created version id.
- `appendTaskContext(taskId, content, meta)`: appends to task `body` under a `## Context` heading (creates the heading if absent), versioned the same way.
- `createTriagePass(input)`, `completeTriagePass(id, summary, counts)`, `failTriagePass(id)`, `findRunningPass()` (with the 10-minute staleness rule).
- `createTriageDecision(input)`, `listTriageDecisions(filter)` (by pass, state, disposition, trailing window), `getTriageDecision(id)`.
- `applyTriageDecision(id)`: the single transactional apply path (see 3.6). Idempotent: applying an already-executed decision returns the existing result.
- `correctTriageDecision(id, correction)`: records the correction, applies the corrected action.
- `undoTriageDecision(id)`: see 3.10.
- `createStreamLinks(rows)`, `getStreamSources(entityType, entityId)`, `getStreamOutcomes(streamId)`.
- `reopenStream(id)`: any terminal status back to `pending`, clears stamp columns if their target was removed.
- `getAcceptanceStats(disposition, window)`: pure aggregation over `triage_decisions` for the graduation engine and metrics.
- `getStreamAutonomy()` / `setStreamAutonomy(config)` on user state.

Changed functions:

- `updateStream`: reject changes to `rawText` when the row already has a non-empty value, except the transcription-retry path filling in a previously failed transcript (guard: current `rawText` is empty or a placeholder and `media` is voice or image). Reject invalid status transitions.
- `promoteStream` logic moves fully server-side and also writes `tasks.streamItemId`, `stream_links`, and a `triage_decisions` row.

## 3.5 Orchestrator actions

Names are the public wire contract: snake_case, params as Zod raw shapes, `ActionError` with stable codes (`not_found | invalid_params | conflict | unsupported`), plain-data returns, no console.log, retry-safe. Existing `promote_stream` and `dismiss_stream` keep their names and semantics.

New actions (all dispatch through the query layer):

| Action | Params | Semantics |
|---|---|---|
| `merge_stream` | `id` or `ids`, `target_type`, `target_id`, `content?`, `as_subtask?`, `expected_target_updated_at?`, `pass_id?` | Append item(s) into an existing task or note, atomically. Records a decision + links. Conflict on non-pending items or stale target. |
| `combine_stream` | `ids` (2+), `to` (`task` or `note`), `draft`, `pass_id?` | One new entity from several captures. All items stamped with the same target. Conflict if any item non-pending. |
| `mark_stream_reviewed` | `id` or `ids`, `reason?`, `pass_id?` | The journal disposition as a recorded decision. |
| `propose_stream_triage` | `proposals` (array of decision inputs), `pass_id` | Writes decisions in state `proposed`, flips items to `proposed`. The suggest-mode path. |
| `undo_triage_decision` | `decision_id` | Reverses per 3.10. |
| `incubate_stream` (Phase 3) | `id`, `resurface_at`, `pass_id?` | Kept for later. |

Changed actions:

- `promote_stream`: gains `pass_id?`, writes `tasks.streamItemId`, `stream_links`, and a decision row. Existing conflict-on-re-promote behavior extends to all new mutating actions (status guard makes every mutation retry-safe).
- `list_stream`: `status` filter accepts all six values, gains optional `pass_id` filter.

**Policy enforcement lives in the action layer, not the prompt.** Every mutating action that carries a `pass_id` consults `StreamAutonomyConfig` before executing. If the disposition's level is `suggest` (or the kill switch is on), the action does not execute: it records the decision as `proposed` and returns `{ proposed: true, decision_id }` so the agent knows what happened. The agent cannot overstep by being confidently wrong, regardless of prompt. Calls without `pass_id` (user-initiated via UI routes or local CLI) execute directly. This is the enforcement seam. Harden it further when remote multi-principal contexts arrive (`ctx.remote` is the hook).

## 3.6 Transactional application

`applyTriageDecision` runs inside one SQLite transaction:

1. Load the decision, verify state is `proposed` (or being auto-applied within sweep flow). Applying an already-`executed`/`accepted` decision is a no-op returning the prior result (idempotency).
2. Verify all referenced stream items are in an applicable status.
3. For merges: recheck `expectedTargetUpdatedAt` against the target's `updated_at`. Mismatch throws `conflict`, decision stays `proposed`, the review UI re-renders with fresh target state.
4. Create or mutate the entity through the existing query functions (which enforce embedding upsert and mirror sync invariants).
5. Create the entity version (merges) and capture `entityVersionId` on the decision.
6. Write `stream_links` rows.
7. Update item statuses and legacy stamp columns (single-link case).
8. Set decision state (`executed` for policy, `accepted` for direct user action) and `decidedAt`.

Embedding and mirror side effects fire through the existing query-layer paths after commit, never for rolled-back data.

## 3.7 The sweep runner

Location: `src/lib/stream-triage/` (`context.ts`, `sweep.ts`, `prompt.ts`, `schema.ts`, `autonomy.ts`).

Runs as a harness session dispatched by the triggers infrastructure (targetKind `orchestrator`), consistent with the orchestrator-on-harness direction. The sweep flow:

1. `sweep.ts` creates the pass row (single-flight check), assembles context, and dispatches the session with the sweep prompt.
2. The agent works through the action vocabulary (3.5). The action layer enforces autonomy policy per decision.
3. On session completion, `sweep.ts` finalizes the pass: counts, agent summary, digest event. On failure or timeout, the pass is marked `failed` and items remain `pending`.

Context assembled per sweep (`context.ts`):

1. All `pending` items (oldest first) with attachments and transcripts. Cap at 50 items per pass; if more are pending, log the cap in the pass summary and let the next sweep continue (no silent truncation).
2. Per item: nearest neighbors via existing sqlite-vec embeddings, two candidate sets: (a) other pending items in the window (combine candidates, weighted by semantic similarity and temporal proximity), (b) existing tasks and notes (merge targets) with their ids and `updated_at`. **The agent judges retrieved candidates. It never free-associates merge targets from memory.**
3. Compact world state: area list, active task titles, recent note titles.
4. The user's recent corrections and undos from `triage_decisions` (states `corrected` and `undone`, trailing 30), rendered as few-shot examples of this user's judgment.
5. The current autonomy config, so the agent knows which dispositions will auto-apply and which will be converted to proposals.

The sweep prompt constitution (in `prompt.ts`, replacing the current "Stream triage" section of `harness-surface.ts`):

- Restraint bias. Journal is a success outcome. When in doubt between task and journal, choose journal.
- Extract, do not judge. Dates and areas come from the text. Never invent deadlines. Effort and energy are proposals.
- Merge only when the target is unambiguous. Ambiguity means propose, or promote standalone and note the possible relation in the rationale.
- Combine only within tight semantic and temporal proximity. Never combine across unrelated areas.
- Split multi-thought captures: one capture may yield several decisions. Each decision cites which part of the capture it covers in its rationale.
- Voice transcripts are cleaned in the derived artifact (draft.body). `rawText` is never rewritten.
- Every decision includes a one-sentence rationale and a confidence self-report.
- Never block on ambiguity. If undecidable, propose the best guess with low confidence and say why. The stream must drain.

## 3.8 Lane 1: wait-risk detection

Location: `src/lib/stream-triage/urgency.ts`, invoked fire-and-forget from the capture service after the item's text is durable and readable (for voice/image: after successful transcription/extraction).

1. Deterministic pre-check: scan for time and date language (times, weekdays, "today", "tomorrow", "by", "before", "at N"). No hits means `wait_safe` with zero model calls. This keeps the common case free.
2. On hits: one small, fast model call (Vercel AI SDK, cheapest configured tier, temperature 0) with the capture text, current time, and timezone. Structured output: `{ verdict: 'wait_safe' | 'time_sensitive', evidence?: string, reminderAt?: string }`. No cited evidence means `wait_safe`, enforced in code.
3. `time_sensitive`: enqueue an immediate single-item sweep (pass trigger `urgency`). Phase 2 onward, the strict urgent-reminder carve-out (1.7) may auto-apply within that sweep.
4. Failures are swallowed: lane 1 is an accelerator, never a gate. The item still flows through normal batch triage.

## 3.9 Trigger wiring

Three trigger rows drive the cadence, all through the existing triggers table and scheduler:

1. **Debounce** (reserved row, name `stream-sweep-debounce`, kind `at`): the capture service upserts it on every capture, setting `runAt`/`nextRunAt` to now + 20 minutes (`findTriggerByName` exists). Each capture pushes the timer. Survives restarts because it is a row, not a timer. Threshold rule: if pending count is at or above 10, set it to fire now instead.
2. **Morning sweep** (user-visible trigger, created during Phase 2 migration/onboarding): scheduled before deck generation, honoring the user-owned-hooks principle. The user can see it, edit its cadence and prompt, or delete it.
3. **Manual**: the Triage button and chat both invoke the same sweep entry point (the existing `run_trigger` action or a direct call into `sweep.ts`).

Concurrency: the pass row is the lock (3.2). Trigger-level `concurrencyPolicy` stays `coalesce_if_active`.

## 3.10 Undo semantics

Exact rules, enforced in `undoTriageDecision`:

| What was applied | Undo behavior |
|---|---|
| Created entity (promote/combine), no human edits since creation | Delete the entity (notes: existing `deleteNote`. tasks: new `deleteTask` guarded to refuse when children or completions exist, falling back to archive). Remove links. Items back to `pending`. |
| Created entity, human-edited since | Do not silently destroy work. Archive the entity instead of deleting, remove links, items back to `pending`. Digest line says "archived, not deleted, because you edited it." |
| Merge/append where the append's entity version is the latest | Revert the entity to the pre-append snapshot via `entity_versions` (`source: 'system'`, `revertedFromVersionId` set). Remove links. Items back to `pending`. |
| Merge/append with later edits on top | Refuse automatic revert. Surface the entity's version history for manual resolution. Decision still marked `undone` for telemetry, links removed, items back to `pending`. |
| Journal / dismiss / incubate | Pure status reset to `pending`. |

Invariants: undo never deletes a stream item, never deletes an attachment file, and always returns items to `pending`. Every undo records `undoneAt` and decays the disposition's acceptance stats immediately (undone weighs heavier than accepted, see 3.11).

## 3.11 Autonomy engine

Location: `src/lib/stream-triage/autonomy.ts`. Pure functions, unit-testable, no I/O.

- `acceptanceRate(decisions)`: accepted / (accepted + corrected + undone), where `executed` older than 7 days without correction counts as accepted. Corrections count half against, undos count fully against, and one undo also removes credit for one prior accept in the trailing window (undos weigh heavier).
- `evaluateGraduation(disposition, stats, currentLevel)`: returns `offer_promotion | demote | hold` per the thresholds in 1.5.
- Evaluated at the end of every sweep. **Promotion is only ever offered** (a digest line the user must accept, which then calls `setStreamAutonomy`). **Demotion is automatic** and announced in the digest.
- The kill switch is checked before every policy decision and forces `suggest` everywhere.

## 3.12 UI surfaces

### Stream tab (`stream-list.tsx`)

Becomes the calm ledger, not a work queue:

- Default filter is Recent. A "Needs your call" filter appears only when non-empty. Power filters (all statuses, full history) live behind a secondary control. Do not lead with Pending/Promoted/Dismissed.
- Each capture row: normalized display text, time and input method, calm processing indicator when transcribing, outcome annotations from `getStreamOutcomes` ("Became a task", "Added to Onboarding UX", multiple outcomes render as multiple annotations), "Kept as a thought", "Needs your call", undo/correct affordances where applicable.
- No unprocessed-count badge as the ambient signal anywhere in navigation. Binary signal only.
- All manual actions route through the server (T0.2) and log decisions (T0.4).

### Review (proposals mode in `stream-triage.tsx`)

- When items are `proposed`, the sheet renders the agent's proposal pre-filled: disposition, target, draft title/body, extracted dates, proposed energy/effort as pills. Accept is one tap. Today's manual controls become the correction affordance, and any material change records `corrected`.
- Grouped by pass, combine proposals grouped together with expandable source captures (provenance on demand).
- Accept-all is offered only for groups containing exclusively low-risk dispositions (journal, dismiss, promote). Merges and combines are never inside a blind accept-all.
- Re-route (accept the action, change the destination) is a first-class button, not buried in an edit flow.

### Digest

- Phase 1: a per-pass summary block at the top of the stream tab, rendered from applied outcomes (never from the plan). Lines per section 1.8 with tap-through, undo, re-route.
- Phase 2: the same digest as a deck card, plus optional notifier delivery (off by default, respecting the notification matrix).
- A "seen" timestamp so unreviewed digests can be surfaced calmly without badging.
- Weekly meta-digest (Phase 3): acceptance stats per disposition, graduation offers, demotion notices.

### Capture (`quick-capture-modal.tsx`)

- Already decision-free. Keep it that way: no new fields at capture time.
- Long input expands naturally (no separate brain dump mode). Enter submits short captures, Shift+Enter inserts a newline, Mod+Enter always submits (hotkeys via `src/constants/commands.ts`).
- The composer closes as soon as durable storage succeeds. AI work continues after close.
- Honest async states for voice/image: "Transcribing your thought", "Reading this image". Failure keeps the capture with its attachment and a retry action: "Your recording is saved. Transcription needs another try."

## 3.13 API routes

UI calls go through authFetch to route handlers that dispatch to the same query functions the actions use (no logic duplication, no raw SQL):

- `POST /api/stream/decisions/[id]/accept`
- `POST /api/stream/decisions/[id]/correct` (body: corrected disposition/target/draft)
- `POST /api/stream/decisions/[id]/undo`
- `POST /api/stream/[id]/reopen`
- `POST /api/stream/triage` (manual sweep trigger)
- `GET /api/stream/passes?limit=` (digest data)
- `PATCH /api/stream/[id]`: restricted via a Zod schema to safe fields only. `rawText`, stamp columns, and status jumps outside the transition rules are rejected.

Existing promote/dismiss UI flows move onto the promote/dismiss query paths via their routes (T0.2).

## 3.14 Metrics

Pure queries over `triage_decisions` and `stream`, exposed as query-layer functions and rendered in the weekly meta-digest (no new analytics infrastructure):

Primary:

- **Acceptance rate per disposition** (the moat metric, gates autonomy).
- **Time-to-clarity**: median time from capture to terminal disposition. The number this feature exists to crush.
- **Pending age p95**: the guilt-pile indicator. Growth means the cadence or restraint calibration is wrong.

Guardrails:

- **Journal share**: suspiciously low means over-promotion. Suspiciously high with frequent user re-promotes means under-promotion.
- **Over-promotion check**: engagement rate (completed, edited, or referenced within 14 days) of stream-born tasks vs manually created tasks.
- **Undo and correction rates** per disposition, trailing windows (drive demotion).
- Zero known capture loss after acknowledgment. Zero silent note-body replacement. One hundred percent provenance coverage for stream-derived entities.

## 3.15 Resolved design decisions

Decisions an implementer must not re-litigate:

1. **Merge into task: subtask vs context?** Default is appending to the task body under `## Context`. Create a subtask (`parentId`) only when the fragment is itself independently actionable (has its own verb and completable outcome). The agent states which rule it applied in the rationale.
2. **Do dismissed items re-enter triage?** Yes, as supporting context for clusters only. They are never resurrected on their own and never counted as pending.
3. **Chat-sourced items** (`source: 'chat'`) are triaged identically to captures. The originating session id is available context but not special-cased in v1.
4. **Placement pill in the triage sheet**: removed, not wired. The deck is the ranking authority. A newly created task gets ranked by the deck like any other.
5. **`propose_stream_triage` stays separate from the execute actions.** Distinct names keep the wire contract unambiguous for agents. Execute actions may still be downgraded to proposals by policy (3.5).
6. **Sweep cadence defaults**: 20-minute rolling debounce, pending threshold 10, morning sweep before deck generation. All constants in one module (`src/lib/stream-triage/constants.ts`).
7. **No normalized-text column in v1.** `rawText` is immutable, display cleanup lives in derived artifacts. If transcript correction ships later, add `normalizedText` additively then.
8. **Image capture text**: the existing behavior (vision extraction into `rawText`, original image in attachments) is correct and the sweep depends on it. Verify consistency in T0.5, do not redesign.
9. **Connector ingestion** is out of scope. The `origin`/`externalSource` fields are the seam. Design when connectors ship.
10. **Team context** is out of scope, but `triage_decisions.actor` and `stream_links` are deliberately compatible with future multi-principal attribution.
11. **Brain dump is not a mode.** The universal composer expands. Multi-thought input is handled by splitting (multiple decisions per capture), not by a separate content type. `brain-dump-modal.tsx` is deleted if unmounted.
12. **Confidence never gates autonomy and is never shown.** Measured acceptance gates autonomy.

---

# Part 4: Repository rules (binding on every task)

- Use pnpm. Typecheck with `pnpm ts` after every task (lint is not required per project convention).
- Schema: every new table is `id`, then the shared `timestamps` spread, then fields. New columns on existing tables are nullable or defaulted, appended, never reordered. Generate migrations with `pnpm db:generate`. Never apply migrations via sqlite3 directly (use `pnpm db:push` in dev or let `getDb()` auto-migrate). Never hand-edit the drizzle journal.
- Types derive from the Drizzle schema through `src/db/types.ts`. No duplicate type definitions.
- API routes and orchestrator handlers dispatch through `src/lib/db/queries.ts`. Never raw SQL, never direct Drizzle in a handler. The query layer enforces embedding upsert, markdown-mirror sync, and attachment derivation.
- Orchestrator actions: names are `snake_case` and permanent. Params are Zod raw shapes (not `z.object(...)`). Throw `ActionError` with stable codes. Return plain data. No console.log in handlers. Every mutating action safe under retry. Branch on `ctx.remote` for security-sensitive work.
- Client-side API calls use `authFetch`, not `fetch`.
- Hotkeys come from `src/constants/commands.ts` via `matchesHotkey`.
- Paths resolve via `src/lib/config/paths.ts` helpers. Never hardcode the data-directory name.
- User-facing copy: no em dashes, no semicolons, no hardcoded product or person names, no guilt language, vocabulary from section 1.10.
- Async React state updates that derive from prior state use the functional updater form.
- Never static-import `@agentex/agent` in tsx-CLI-reachable modules (dynamic import only, `pnpm smoke:boot` guards it).
- On dev machines, leave test artifacts in place for inspection. Do not clean them up.

---

# Part 5: Build tasks

Dependency shape: `Phase 0 -> Phase 1 -> Phase 2 -> Phase 3`. Tasks inside a phase are parallel unless noted. Each phase is independently shippable and independently valuable.

## Phase 0: Honesty and foundation

Fixes real bugs and starts telemetry accumulating before any agent exists. No behavior change beyond bug fixes.

### T0.1: Non-destructive note and task appends

**Files:** `src/lib/db/queries.ts`, `src/components/stream/stream-list.tsx`, `src/components/stream/promote-actions.tsx`, tests.

- [x] Implement `appendToNote(noteId, content, meta)`: appends with a blank-line separator, creates an entity version through the existing `updateNote` meta path, returns the version id
- [x] Implement `appendTaskContext(taskId, content, meta)`: appends under a `## Context` heading in the task body, versioned the same way
- [x] Replace the destructive merge in `stream-list.tsx:179` (currently overwrites the note body) with a call to the append path via a server route
- [x] Unit tests: append preserves existing body, creates a version, second append stacks correctly

**Acceptance:**

- [x] No UI action can overwrite an existing note body with raw capture text
- [x] Every agent or stream-originated append produces an `entity_versions` row with `source: 'ai'` or the acting session attributed
- [x] `pnpm ts` passes

**Depends on:** nothing

### T0.2: Consolidate promotion server-side

**Files:** `src/lib/db/queries.ts`, `src/lib/orchestrator/registry.ts`, `src/app/api/stream/[id]/route.ts` (or new route files), `src/components/stream/stream-list.tsx`, `src/components/stream/stream-triage.tsx`, `src/components/stream/promote-actions.tsx`, `src/hooks/use-stream.ts`.

- [x] Move promotion into a single transactional query function used by both the `promote_stream` action and new UI routes
- [x] Write `tasks.streamItemId` on task promotion
- [x] Backfill `tasks.streamItemId` from `stream.promotedToId` for historical rows (idempotent script or startup backfill)
- [x] Delete the hand-rolled create-then-stamp logic in `stream-list.tsx:111-192` and `stream-triage.tsx:92-174`, replace with route calls
- [x] Remove the placement pill from `stream-triage.tsx` (resolved decision 4)
- [x] Concurrency test: double-promote attempts yield one entity and one stable conflict

**Acceptance:**

- [x] Promotion either commits completely or has no effect (kill the process mid-promote in a test: no orphan entity, no half-stamped item)
- [x] A repeated promote request returns the first result or a stable conflict, never a duplicate
- [x] UI, CLI, and MCP all exercise the same query function
- [x] `pnpm ts` passes

**Depends on:** T0.1 (shares the route plumbing)

### T0.3: Data foundation migration

**Files:** `src/lib/db/schema.ts`, `src/db/types.ts`, `drizzle/`, schema tests.

- [x] Add `triage_passes` per 3.2
- [x] Add `triage_decisions` per 3.2
- [x] Add `stream_links` per 3.2
- [x] Add `user_state.streamAutonomy` JSON column (nullable)
- [x] Extend the `stream.status` enum in code to the six values (type-level, no migration)
- [x] Generate the migration with `pnpm db:generate`, verify it is purely additive
- [x] Backfill `stream_links` from existing `promotedToType`/`promotedToId` rows with relation `created`, `decisionId` null (idempotent, reports rows whose target no longer exists without failing)
- [x] Verify migration against a fresh dev database and a copy of a populated one

**Acceptance:**

- [x] Fresh and populated migrations succeed, no existing stream data changes
- [x] Every new table has `id`, `created_at`, `updated_at` in the required order with `$onUpdate` on `updated_at`
- [x] Re-running the backfill produces no duplicate links
- [x] `pnpm ts` passes

**Depends on:** nothing (parallel with T0.1/T0.2, but T0.4 needs it)

### T0.4: Telemetry bootstrap from manual triage

**Files:** `src/lib/db/queries.ts`, stream routes, `src/components/stream/`.

- [x] Every manual UI triage action (promote, merge, dismiss) writes a `triage_decisions` row with `actor: 'user'`, `state: 'accepted'`, `passId` null
- [x] Manual actions also write `stream_links` and keep dual-writing legacy stamp columns for the single-link case
- [x] `getAcceptanceStats` implemented and unit-tested against seeded decision rows

**Acceptance:**

- [x] A week of normal manual use accumulates ground-truth decision rows without the user noticing anything changed
- [x] Stats queries return sensible values on seeded data

**Depends on:** T0.2, T0.3

### T0.5: Immutability and input hardening

**Files:** `src/lib/db/queries.ts`, `src/app/api/stream/[id]/route.ts`, `src/app/api/capture/route.ts`, tests.

- [x] `updateStream` rejects `rawText` changes once a non-empty value exists (exception: transcription-retry filling a failed transcript per 3.4)
- [x] Restrict `PATCH /api/stream/[id]` to safe fields via a Zod schema, reject status jumps outside the transition rules in 3.1
- [x] Add a manual retry affordance for failed voice transcription and image extraction (capture route already preserves the attachments, surface the retry)
- [x] Verify image-capture extraction lands in `rawText` consistently (resolved decision 8) and document the finding in this file
  - Verified 2026-07-12: the capture route writes extraction into `rawText` (extracted text + image refs) on success, and an `[Images, extraction pending]` placeholder on failure with the originals preserved in `attachments`. The retry route replaces the placeholder through the one sanctioned `rawText` rewrite. Consistent — the sweep can rely on `rawText`.
- [x] Add `reopenStream(id)` and a `POST /api/stream/[id]/reopen` route

**Acceptance:**

- [x] No route or action can rewrite a capture's original words
- [x] A failed transcription leaves playable audio, a visible calm state, and a working retry
- [x] Reopen returns any terminal item to `pending`

**Depends on:** T0.3

### T0.6: Provenance rendering and dead code removal

**Files:** `src/lib/export/mirror/sync.ts`, `src/components/dashboard/brain-dump-modal.tsx`, stream components.

- [x] Task file mirror renders a Sources section listing source captures, matching the existing note behavior, driven by `getStreamSources`
- [x] Stream item rows show outcome annotations driven by `getStreamOutcomes` (multiple outcomes render as multiple annotations)
- [x] Verify `brain-dump-modal.tsx` is unmounted, then delete it (quick-capture supersedes it)

**Acceptance:**

- [x] Creating a task from a capture shows the link in both directions (task UI + mirror file + stream row)
- [x] No dangling imports after deletion, `pnpm ts` passes

**Depends on:** T0.3

## Phase 1: On-demand sweep, suggest mode

The agent shows up. Everything is proposed, nothing auto-applies. Acceptance measurement starts.

### T1.1: Action vocabulary

**Files:** `src/lib/orchestrator/registry.ts`, `src/lib/db/queries.ts`, `src/lib/stream-triage/schema.ts`, registry tests.

- [x] Zod schemas for `TriageDraft` and decision inputs in `src/lib/stream-triage/schema.ts` (single source, reused by actions and routes)
- [x] Implement `merge_stream`, `combine_stream`, `mark_stream_reviewed`, `propose_stream_triage`, `undo_triage_decision` per 3.5
- [x] Extend `promote_stream` with `pass_id` and decision/link writes, extend `list_stream` filters
- [x] Policy enforcement in the action layer: `pass_id` present + disposition at `suggest` (or kill switch on) converts execution to a proposal, returning `{ proposed: true, decision_id }`
- [x] Server-side draft validation: dates require evidence, empty titles rejected, target existence and type checked
- [x] All mutating actions idempotent via status guards, contract tests for CLI and MCP parity

**Acceptance:**

- [x] An agent session can propose, merge, combine, journal, and undo through the wire surface
- [x] With the kill switch on, no agent call mutates an entity, ever, regardless of arguments
- [x] Retrying any mutating action is safe

**Depends on:** Phase 0 complete

### T1.2: Context assembly

**Files:** new `src/lib/stream-triage/context.ts`, embedding/search helpers, tests.

- [x] Gather pending items (cap 50, cap logged), neighbors from sqlite-vec for combine candidates and merge targets (with `updated_at` for concurrency guards)
- [x] Include compact world state (areas, active task titles, recent note titles)
- [x] Include trailing 30 corrections/undos as few-shot examples
- [x] Include the autonomy config snapshot
- [x] Bound total context size, log candidate counts per item

**Acceptance:**

- [x] For a fixture with an obvious append target, the target appears in candidates
- [x] Context size stays bounded as the database grows (test with a large seeded db)

**Depends on:** T0.3

### T1.3: Sweep runner and constitution

**Files:** new `src/lib/stream-triage/sweep.ts`, `prompt.ts`, `constants.ts`, `src/lib/orchestrator/harness-surface.ts`, tests.

- [x] Pass lifecycle: create with single-flight check (10-minute staleness rule), finalize with counts and summary, fail cleanly leaving items pending
- [x] Dispatch a harness session with the constitution prompt (3.7) and the context bundle
- [x] Replace the old "Stream triage" section in `harness-surface.ts` with the new contract (propose-first, new actions)
- [x] Manual entry points: Triage button calls `POST /api/stream/triage`, chat "triage my stream" resolves to the same sweep
- [x] A crashed or retried sweep cannot double-apply (status guards + pass idempotency test)

**Acceptance:**

- [x] Manual sweep on a seeded stream produces proposals, a completed pass row, and zero mutations while everything is at suggest
- [x] Two concurrent sweep requests yield one running pass
- [x] Exit criteria for the phase: proposals exist, acceptance is measured, undo works end to end

**Depends on:** T1.1, T1.2

### T1.4: Review surface (proposals mode) and decision routes

**Files:** `src/components/stream/stream-triage.tsx`, `stream-list.tsx`, new routes per 3.13, `src/hooks/use-stream.ts`.

- [x] Routes: accept, correct, undo, reopen, triage, passes (3.13), all through the query layer with `authFetch` on the client
- [x] Proposals mode: pre-filled disposition, target, draft, extracted fields, one-tap accept, correction affordances that record `corrected` with the final action
- [x] Group by pass, combine groups expandable to source captures
- [x] Accept-all only for low-risk groups (journal, dismiss, promote), never merges/combines
- [x] Re-route as a first-class button
- [x] Undo per 3.10, including the edited-entity refusal paths

**Acceptance:**

- [x] Accepting a proposal applies it transactionally and flips the decision to `accepted`
- [x] Correcting records `correctedDisposition` and applies the corrected action
- [x] Undo of an untouched created entity removes it and returns the capture to `pending`
- [x] Undo of a human-edited entity archives instead and says so

**Depends on:** T1.1

### T1.5: Digest in the stream tab

**Files:** stream components, passes route, copy per 1.10.

- [x] Per-pass digest block rendered from applied outcomes and proposals (never from unapplied plans)
- [x] Lines with tap-through, undo, re-route
- [x] Seen timestamp, calm unread handling, no badges
- [x] Vocabulary table from 1.10 applied across all stream surfaces (audit existing copy while here)

**Acceptance:**

- [x] After a sweep, the user can understand everything that happened in under ten seconds and reverse any line in one tap
- [x] No internal vocabulary (pass, confidence, disposition) appears in the UI

**Depends on:** T1.3, T1.4

### T1.6: Fixtures and evaluation harness

**Files:** new `src/lib/stream-triage/fixtures/`, vitest suites, a `pnpm eval:triage` script.

- [x] At least 30 fixtures covering: one clear task, one clear note, mixed task+note in one paragraph (split), several tasks in one voice dump, fragments that should combine, related fragments that must stay separate, an append candidate, a near-duplicate task, an explicit reminder, an ambiguous date, a low-intent idea, an emotional thought that should journal, a failed transcription, adversarial text that tries to instruct the agent
- [x] Each fixture records the expected decision graph (dispositions, targets, splits), not just a class label
- [x] Unit tests (no model calls): policy math, graduation function, undo paths, idempotency, draft validation
- [x] `pnpm eval:triage`: runs the real planner against fixtures with a live model, reports per-disposition precision and the false-merge count. Manual, not CI

**Acceptance:**

- [x] Unit suite green in CI, eval script produces a comparable report run over run
- [x] The adversarial fixture cannot cause any mutation while at suggest level

**Depends on:** T1.1, T1.2 (runnable before or alongside T1.3)

## Phase 2: Autonomous cadence and urgency

The system starts showing up on its own. Exit criteria for the phase: a user who captures all day and never opens the stream tab still ends the day with a drained queue and a digest they trust.

### T2.1: Cadence triggers

**Files:** capture service, `src/lib/stream-triage/constants.ts`, trigger seeding, `src/lib/scheduler/` touchpoints.

- [x] Debounce: capture path upserts the reserved `stream-sweep-debounce` trigger row (kind `at`) to now + 20 minutes on every capture
- [x] Threshold: pending count at or above 10 sets it to fire immediately
- [x] Morning sweep: visible, editable trigger created idempotently (migration or first-run), scheduled before deck generation
- [x] Sweep runs survive an app restart mid-debounce (row-based, verify with a test)

**Acceptance:**

- [x] Captures during a burst produce exactly one sweep about 20 minutes after the last one
- [x] The user can see, edit, and delete the morning trigger like any other

**Depends on:** Phase 1 complete

### T2.2: Lane 1 wait-risk detection

**Files:** new `src/lib/stream-triage/urgency.ts`, capture service, tests.

- [x] Deterministic date/time pre-scan, zero model calls when clean
- [x] Fast structured model call per 3.8 with evidence requirement enforced in code
- [x] `time_sensitive` enqueues an immediate single-item sweep (trigger `urgency`)
- [x] Urgent-reminder carve-out per 1.7: explicit imperative + explicit time + cited evidence auto-creates the reminder task with digest line and undo
- [x] Lane failures never block or delay capture (fire-and-forget, test the failure path)

**Acceptance:**

- [x] "remind me at 3pm to send the deck" produces a reminder task within seconds, with evidence recorded and one-tap undo
- [x] "I should think about the roadmap sometime" stays `wait_safe` with zero model calls
- [x] Capture latency is unchanged when the model provider is down

**Depends on:** T2.1

### T2.3: Journal graduates to auto-with-digest

**Files:** `src/lib/stream-triage/autonomy.ts`, config defaults.

- [x] Default `journal` level becomes `auto_digest` for new and existing users (config default, not a per-user write)
- [x] Auto-applied journal decisions appear in the digest's quiet section with undo
- [x] Kill switch verified to return journal to suggest instantly

**Acceptance:**

- [x] Low-intent thoughts stop appearing as review work while remaining searchable and reversible

**Depends on:** T2.1

### T2.4: Digest on the deck and notifier delivery

**Files:** deck integration points, notifier integration, digest components.

- [x] Digest renders as a deck card per completed pass (reuse the Phase 1 component)
- [x] The deck may show one compact prompt ("1 thought needs your call") and is never blocked by stream review
- [x] Notifier event type for the digest through the existing channels/matrix, off by default
- [x] No notification for normal successful routing (only digests per the user's matrix, failed captures, and explicit reminders)

**Acceptance:**

- [x] Morning deck shows the overnight/morning digest without a second inbox appearing anywhere
- [x] Deck generation is unaffected when a sweep is running

**Depends on:** T2.1, T1.5

## Phase 3: Graduation, incubation, cleanup

### T3.1: Graduation engine

**Files:** `src/lib/stream-triage/autonomy.ts`, digest components, settings.

- [x] `evaluateGraduation` wired to run at the end of every sweep
- [x] Promotion offers rendered in the digest, acceptance writes `setStreamAutonomy`
- [x] Automatic demotion with a plain-language digest announcement
- [x] Silent tier honored (digest available, not pushed)
- [x] A single "automation level" control in settings (review everything / handle the obvious / manual only) mapping onto the kill switch and level defaults. No per-disposition toggle wall

**Acceptance:**

- [x] Seeded acceptance histories produce the exact offers/demotions the thresholds in 1.5 dictate (unit-tested)
- [x] The system never raises its own autonomy without an accepted offer

**Depends on:** Phase 2 complete

### T3.2: Incubation

**Files:** schema (additive `stream.resurfaceAt`), `incubate_stream` action, sweep prompt, deck resurfacing.

- [x] `resurfaceAt` column (nullable, additive migration)
- [x] `incubate_stream` action and disposition wired through decisions, policy, digest, undo
- [x] Sweep context includes incubating items whose `resurfaceAt` has arrived, returning them to `pending`
- [x] Deck can surface a resurfaced item calmly ("You kept this for later")

**Acceptance:**

- [x] An incubated item disappears from attention and returns on schedule with its provenance intact

**Depends on:** T3.1

### T3.3: Weekly meta-digest

**Files:** sweep scheduling, digest components, metrics queries per 3.14.

- [x] Weekly pass composes acceptance rates, journal share, time-to-clarity, pending age p95, over-promotion check, plus any graduation offers
- [x] Delivered as a digest (deck card, optional notifier), calm tone, no charts required

**Acceptance:**

- [x] The metrics in 3.14 are all computable from production data and rendered somewhere a user actually sees

**Depends on:** T3.1

### T3.4: Legacy cleanup (DONE 2026-07-12 — dogfood gate waived, single-user install)

**Files:** `src/lib/db/schema.ts`, `drizzle/`, all readers of stamp columns.

- [x] Verify no consumer reads `promotedToType`/`promotedToId`/`promotedAt` (reads migrated to `stream_links`)
- [x] Stop dual-writing stamp columns
- [x] Drop `promotedToType`, `promotedToId`, `promotedAt`, `promotionPass` in a separately generated migration (respecting the additive-first discipline: this is the one destructive step, taken last, after a dogfood period)
- [x] Update `docs/prd.md` and any doc that still says one stream item has exactly one promotion target
- [x] Full pass: `pnpm ts`, `pnpm build`, targeted tests

**Acceptance:**

- [x] Fresh install and upgraded install behave identically
- [x] Documentation describes one coherent stream model

**Depends on:** everything above plus a dogfood gate (at least two weeks of Phase 2 in daily use)

---

# Part 6: Final release checklist

### Product

- [ ] Capture feels complete after durable save, even when AI is offline
- [ ] The user is never asked to classify during capture
- [ ] A multi-thought dump produces one calm digest, understandable in seconds
- [ ] Kept-as-a-thought is common and understandable
- [ ] Needs your call is finite: three or fewer decisions on a typical day
- [ ] The deck is never blocked by stream review
- [ ] Copy passes the 1.10 rules everywhere

### Trust

- [ ] Every automatic action is explainable (rationale), attributable (actor, pass), and undoable
- [ ] Zero known capture loss after acknowledgment
- [ ] Zero silent note-body replacement
- [ ] One hundred percent provenance coverage for stream-derived entities
- [ ] Kill switch forces propose-only instantly, no migration
- [ ] No disposition auto-applies without meeting its measured gate
- [ ] The adversarial fixture cannot cause unauthorized mutation

### Data and pipeline

- [ ] Original words immutable, verified by test
- [ ] Every mutation idempotent under retry, verified by test
- [ ] Merges guarded by optimistic concurrency
- [ ] Sweep survives restart, single-flight holds under concurrency
- [ ] Acceptance telemetry queryable per disposition and window

### Quality

- [ ] Unit tests cover policy, graduation, undo, idempotency, transitions
- [ ] Fixture evaluation run recorded before enabling any auto tier
- [ ] `pnpm ts` and `pnpm build` pass
- [ ] Accessibility: capture, review, undo all keyboard-reachable, processing states announced, color never the only signal

## The standard for success

This feature succeeds when the stream stops feeling like a place the user must return to and starts feeling like a dependable extension of memory. The lovable experience is not perfect categorization. It is that the user can speak or type imperfectly, close the window, and feel lighter. Later, the right task appears, the right note has grown, or one thoughtful question arrives at a good moment.

The system should feel quietly attentive: it preserves before it interprets, waits when waiting improves understanding, acts when action is safe, asks when judgment belongs to the person, and never makes the person clean up after its confidence.
