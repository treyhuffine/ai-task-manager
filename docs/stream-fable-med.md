# Stream Spec: The Ledger and the Reconciler

Status: proposal, independent take (written before reading the existing stream reconciliation PRD)
Author: Claude (Fable), 2026-07-10

## 1. What the stream is

The stream is the front door of the product. Every thought, transcription, webhook payload, and forwarded artifact enters here first, as raw material with no categorization demanded at capture time. It is not a feature that sits alongside tasks and notes. It is the ingestion layer they are derived from.

Three framing decisions define it:

**It is a ledger, not an inbox.** Append-only, never deleted, always searchable. Items change status but never disappear. This makes the stream the provenance layer of the whole system: every task and note can trace back to the raw captures that produced it. Provenance is also the prerequisite for the team direction, so this decision is load-bearing beyond the stream itself.

**The unit of intelligence is the corpus, not the item.** Per-item classification ("task or note?") is stateless and will be a commodity. The durable value is reconciliation: noticing that five captures across two weeks are one project, that a new dump duplicates an existing task, that four fragments should merge into one note instead of becoming four orphans. The agent's job is compression. N fragments in, fewer than N coherent entities out, deduplicated against everything that already exists. Auto-promoting every fragment 1:1 does not fix inbox rot, it relocates it into the task list, where rot is worse because tasks carry obligation.

**Autonomy is graduated, not binary.** Full auto-promotion destroys trust the first time a half-thought becomes a task. Full manual triage recreates the tax the product exists to remove. The path between them is propose-then-accept, with every accept and override recorded. That acceptance telemetry is what lets confidence thresholds rise until obvious classes of capture apply silently. Reversibility is the precondition: nothing graduates to automatic until it can be undone in one gesture.

### The user-facing promise

"Nothing here needs you." The stream must never present as a guilt pile. No badge count of unprocessed items as the primary signal. The healthy state is: captures flow in, the reconciler compresses them into proposals, the user skims a small batch at review time, done. The metric the UI communicates is whether anything is waiting on the user, not how much raw material exists.

## 2. Current state (what exists today)

Grounded in the code as of 2026-07-10:

- Capture plumbing is solid. Unified `POST /api/capture` handles text, image (vision OCR), and audio (STT). Pocket webhook ingests with external-id dedupe. Brain dump modal and chat both create items. All items are embedded and hybrid-searchable (`src/lib/embeddings/embed.ts`).
- Schema (`src/lib/db/schema.ts:138-178`): `stream` table with `rawText`, `source`, `media`, `origin`, external dedupe fields, `status` in `pending | promoted | dismissed`, one-to-one promotion stamps (`promotedToType`, `promotedToId`, `promotedAt`), an unused `promotionPass` column, and derived `attachments`.
- Promotion exists in two parallel implementations: the atomic server-side `promote_stream` orchestrator action (`src/lib/orchestrator/registry.ts:304-443`) and hand-rolled client-side create-then-stamp in `stream-list.tsx:111-192` and `stream-triage.tsx:92-174`.
- Agent triage is prompt-driven and on-demand (`src/lib/orchestrator/harness-surface.ts:153-177`), triggerable via a user-created trigger. Nothing runs by default.

### Gaps, in order of how much they block the vision

1. **No combination.** Promotion is strictly one item to one new entity. Clustering, merging, and dedup against existing tasks and notes do not exist. This is the differentiating half of the feature and it is entirely missing.
2. **No proposal state.** Status jumps from `pending` straight to terminal. The agent has nowhere to park a suggestion for human review, so graduated autonomy has no substrate.
3. **"Merge into note" is destructive.** It overwrites the target note body instead of appending (acknowledged in a comment at `stream-list.tsx:179`).
4. **Link model cannot represent reconciliation.** `promotedToType`/`promotedToId` assumes one item, one entity. Merges are many-to-one and one-to-many (an item can append to a note and spawn a task).
5. **No reversibility.** No un-promote, un-dismiss, or reopen path anywhere.
6. **Promotion logic duplicated in the client.** Drift is already visible: the triage UI collects a placement value (top/mid/low/backlog) that is never persisted to the created task.
7. **Nothing scheduled by default.** Triage only happens on explicit user click or explicit agent invocation.
8. `promotionPass` is declared but never written. It is the natural provenance hook for reconciliation passes and should be used or removed.

## 3. Target design

### 3.1 Lifecycle

```
             +--> proposed --> promoted
pending -----|                    |
             +--> dismissed       | (undo)
                     |            v
                     +-------- pending (reopened)
```

Statuses: `pending | proposed | promoted | dismissed`.

- `pending`: captured, not yet reconciled. The reconciler owns getting items out of this state.
- `proposed`: the agent has attached a proposal (see 3.3) and is waiting on the user. Items in `proposed` are what the review surface shows.
- `promoted`: applied. The item produced or joined one or more entities, recorded in `stream_links`.
- `dismissed`: judged noise or already-covered. Kept, searchable, reversible.

New transitions: `promoted -> pending` (un-promote, reverses links and any entity created solely from this item, or detaches from merged entities) and `dismissed -> pending` (reopen). Every terminal transition must be reversible. This is what makes rising autonomy safe.

Auto-apply (section 3.5) skips `proposed` and goes straight to `promoted`, but stamps the proposal it acted on so the review surface can show "applied automatically" with one-tap undo.

### 3.2 Schema changes

**New table `stream_links`** (replaces the one-to-one stamp columns as source of truth):

```
stream_links
  id            text pk (uuidv7)
  ...timestamps
  stream_id     text notNull -> stream.id
  entity_type   text notNull        -- 'task' | 'note'
  entity_id     text notNull
  relation      text notNull        -- 'created' | 'merged_into' | 'appended'
  pass_id       text                -- reconciliation pass that produced it, null = manual
  index (stream_id), index (entity_type, entity_id)
```

Many-to-many by construction. A cluster of five items merged into one new task yields five rows with relation `created` (or one `created` for the seed item and four `merged_into`, see 3.4). An item that appends context to a note and spawns a follow-up task yields two rows.

**Stream table changes** (additive, per the timestamps and migration rules in CLAUDE.md):

- `status` gains the `proposed` value.
- New nullable `proposal` JSON column, shape in 3.3.
- New nullable `cluster_id` text column, stamped by the reconciler so the review surface can group.
- `promotedToType`, `promotedToId`, `promotedAt` become a denormalized fast path for the common single-link case, written alongside `stream_links`, or are deprecated after migration. Recommendation: keep writing them for one release for UI compatibility, then drop reads, then drop columns.
- `promotionPass` is superseded by `stream_links.pass_id` and a `passes` record (below). Drop it in the same cleanup.

**New table `reconciliation_passes`** (provenance and telemetry for each run):

```
reconciliation_passes
  id            text pk (uuidv7)
  ...timestamps
  trigger       text notNull        -- 'scheduled' | 'manual' | 'on_capture'
  items_seen    integer notNull
  clusters      integer notNull
  proposals     integer notNull
  auto_applied  integer notNull
  summary       text                -- agent's one-paragraph account of what it did and why
```

**New table `proposal_events`** (the acceptance telemetry, the moat):

```
proposal_events
  id            text pk (uuidv7)
  ...timestamps
  stream_id     text notNull
  pass_id       text
  proposal      text notNull (JSON)  -- the proposal as offered
  outcome       text notNull         -- 'accepted' | 'overridden' | 'edited' | 'undone'
  final_action  text (JSON)          -- what the user actually did, when != proposal
```

Notes already lack a back-link to stream. `stream_links` solves this for both entity types, so do not add a `notes.streamItemId` column.

### 3.3 The proposal object

Stored on `stream.proposal`, validated with Zod, written only through the query layer:

```ts
{
  action: 'create_task' | 'create_note' | 'merge_into_task' | 'append_to_note' | 'dismiss',
  targetType?: 'task' | 'note',
  targetId?: string,          // existing entity for merge/append
  title?: string,             // for create actions
  body?: string,              // synthesized body when combining, else rawText passthrough
  parentId?: string,          // subtask placement
  areaId?: string,
  energy?: ..., effort?: ...,
  clusterId?: string,         // items proposed together
  confidence: number,         // 0..1, calibrated by class over time
  rationale: string,          // one sentence, shown in review UI
}
```

A cluster proposal is represented as the same proposal object stamped on every member item with a shared `clusterId`. One member (the seed) carries `action: create_*`, the rest carry `merge_into_*`/`append_to_*` pointing at the seed's eventual entity. Applying a cluster is a single atomic server-side operation.

### 3.4 The reconciler

A scheduled orchestrator run (default on, created at onboarding as a visible, editable trigger, honoring the user-owned-hooks principle: the user can see it, change its cadence, or delete it). Suggested default: twice daily, aligned with the deck's morning review and an end-of-day sweep.

Each pass:

1. **Gather.** All `pending` items, plus for each item its embedding-nearest neighbors among existing tasks, notes, and other stream items (the substrate already exists via `upsertEmbedding` on all three entity types).
2. **Cluster.** Group pending items that are the same underlying thought or project. Similarity is a candidate generator, the LLM makes the final grouping call. Singletons are clusters of one.
3. **Decide per cluster.** One of: create task, create note, merge into existing task (subtask or body context), append to existing note, dismiss as noise or duplicate. When combining, synthesize a coherent body from the fragments rather than concatenating raw text, but always preserve links to the raw items (that is what the ledger is for).
4. **Write proposals.** Stamp `proposal`, `cluster_id`, set status `proposed`, record the pass in `reconciliation_passes`.
5. **Auto-apply** the subset above the confidence threshold for its action class (3.5), writing `stream_links` and `proposal_events` with outcome recorded on user undo.
6. **Never block on ambiguity.** If the agent cannot decide, it proposes its best guess with low confidence and says why in `rationale`. The stream must drain. An item that survives multiple passes without user action gets a standing low-confidence proposal, not silence.

There is also a cheap **on-capture classification**: when an item arrives, a fast single-item pass attaches a provisional proposal immediately (likely-task, likely-note, likely-noise). This gives instant feedback in the UI and lets unambiguous, high-confidence classes short-circuit without waiting for the batch pass. The batch pass may revise provisional proposals it has not applied yet, since clusters need time to form. This two-cadence rhythm is deliberate: instant for the obvious, delayed for the combinable.

### 3.5 Graduated autonomy

Per action class (create_task, create_note, merge_into_task, append_to_note, dismiss), maintain an acceptance rate from `proposal_events`. Policy:

- Below threshold (default 0.9 acceptance over a minimum sample, e.g. 20 events): always `proposed`, user reviews.
- At or above threshold: auto-apply, surfaced in the review feed as already-done with one-tap undo.
- An undo or override decays the class score immediately (undone events weigh heavier than accepts).

Ship with everything in review mode. No settings page of toggles for v1 beyond a single "automation level" control (review everything / let the agent handle the obvious / manual only). The per-class thresholds are the mechanism, not the interface.

### 3.6 Server-side consolidation

- All promotion, merging, appending, and dismissal goes through query-layer functions called by orchestrator actions. The client calls the same server paths (route handlers that dispatch to the same `queries.ts` functions). Delete the hand-rolled create-then-stamp logic in `stream-list.tsx` and `stream-triage.tsx`.
- New query functions: `applyProposal(streamIdOrClusterId)`, `appendToNote(noteId, content, provenance)` (non-destructive, versioned via `entity_versions`), `unpromoteStream(id)`, `reopenStream(id)`, `mergeStreamCluster(clusterId)`.
- New or changed orchestrator actions: `propose_stream` (agent writes a proposal without applying), `apply_stream_proposal`, `unpromote_stream`, `reopen_stream`. `promote_stream` remains for direct promotion and gains cluster support. All mutating actions stay retry-safe per registry invariants.
- Fix the triage placement bug as part of consolidation: placement either persists to the created task or leaves the UI.

### 3.7 Review surface

Replace the current item-by-item triage slide-over with a batch review, and fold it into the deck's morning surface:

- Grouped by cluster, each group shows the proposal headline, rationale, source item count, and expandable raw items (provenance visible on demand).
- Primary gesture: accept all. Secondary: per-group override (change action, change target, edit title) and per-group dismiss.
- A separate quiet section lists what was auto-applied since last review, each with undo.
- No unprocessed-count badge as the ambient signal. The ambient signal is binary: something awaits review, or nothing does.

The existing stream timeline (`stream-list.tsx`) survives as the ledger view: full history, all statuses, searchable, with per-item manual actions for users who want direct control.

## 4. What we explicitly are not building

- **Auto-promotion without telemetry.** No shipping a mode where the agent silently creates tasks before acceptance data exists.
- **A rules engine.** No user-authored if-this-then-that for stream routing. The agent plus telemetry is the mechanism. If a user wants determinism they can edit the reconciler trigger's prompt, which is the user-owned hook.
- **Hard deletion paths.** Nothing in this spec deletes stream items.
- **Stream as a second notes app.** Items are raw material with a bounded residence time in `pending`. The reconciler's job is to keep the pending set near zero. If pending items routinely age past a few days, that is a bug in the reconciler, not a new UI to build.

## 5. Migration and rollout

Phase 1, foundation (no behavior change):
- Add `stream_links`, `proposal_events`, `reconciliation_passes` tables and the `proposal`/`cluster_id` columns (nullable, additive, per the drizzle rules).
- Backfill `stream_links` from existing `promotedToType`/`promotedToId` rows with relation `created`.
- Implement `appendToNote` and fix the destructive note merge.
- Route client promotion through server paths, fix or remove placement.
- Implement un-promote and reopen.

Phase 2, the reconciler:
- On-capture provisional classification.
- Scheduled reconciliation pass writing proposals (review mode only, zero auto-apply).
- Batch review surface, `proposal_events` recording from day one.

Phase 3, graduated autonomy:
- Per-class acceptance scoring and auto-apply above threshold.
- Auto-applied feed with undo.
- Drop the deprecated stamp columns and `promotionPass` once reads are migrated.

Each phase is independently shippable and independently valuable. Phase 1 fixes real bugs even if the rest never ships.

## 6. Open questions

1. Cadence default for the reconciler: twice daily is a guess. Should it also fire when pending count crosses a size threshold?
2. When a cluster merges into an existing task, subtask versus body-append is a judgment call per case. Does the agent decide freely, or do we constrain to subtask-only initially for predictability?
3. Should `dismissed` items ever re-enter reconciliation (e.g. a later capture makes an old dismissed fragment relevant)? The ledger makes this possible. Recommendation: yes, but only as supporting context for clusters, never resurrected on their own.
4. External high-volume sources (future email or Slack connectors) may need a pre-stream filter so the reconciler is not drowned. Out of scope here, but the `origin`/`externalSource` fields are the seam.
