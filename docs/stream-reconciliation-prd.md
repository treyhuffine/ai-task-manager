# Stream Reconciliation PRD and Build Checklist

**Status:** Proposed

**Last updated:** 2026-07-09

**Product owner:** Flow

**Primary surfaces:** Quick Capture, Stream, Chat, Deck, Notes, Tasks

**Authoritative scope:** This document replaces the stream-specific behavior in `docs/prd.md`, the manual stream triage behavior in `docs/deck-checkin-spec.md`, and the one-item-to-one-entity assumptions in the current orchestrator stream contract. `docs/deck-v2-spec.md` remains authoritative for the Deck.

## How to use this document

This is both the product specification and the implementation checklist.

- Product decisions appear first and should not be changed accidentally while implementing a task.
- Each build task has steps, acceptance criteria, dependencies, and likely files.
- Check `[ ]` to `[x]` as work lands.
- Complete phases in order unless a task explicitly says it can run in parallel.
- Keep migrations additive until the compatibility and rollback gates pass.
- Do not expose internal terms such as triage runs, confidence scores, or processing queues in the default user experience.

## Executive summary

The Stream is the place where a person can externalize anything without first deciding what it is. It should feel as safe and effortless as thinking out loud to someone who knows them well.

The Stream is not a task inbox the user must empty. It is:

1. A working-memory release valve
2. An immutable record of what the user captured
3. A short observation window where related thoughts can accumulate
4. A provenance layer connecting raw thought to tasks, notes, reminders, and later decisions

The agent reconciles captures against one another and against the user's existing world. One capture may create several outcomes. Several captures may become one outcome. Some captures should remain searchable memory without creating anything else.

The user promise is:

> Capture anything. Flow will keep your words, recognize what matters, combine what belongs together, and ask only when your judgment is truly needed.

The emotional outcome is more important than inbox zero:

> Once something is captured, the user trusts themselves to stop remembering it.

## 1. The user problem

People do not think in clean task-sized units. A thought can contain an obligation, an observation, a question, and context for an existing project at the same time. Related thoughts often arrive minutes or days apart.

Traditional capture systems ask the user to classify too early:

- Is this a task or a note?
- Which project does it belong to?
- What is its priority?
- When should it appear again?
- Does it duplicate something already in the system?

Those decisions interrupt the thought and turn capture into administration. When capture becomes work, people stop using it. When capture is easy but routing is weak, the system fills with undifferentiated debt.

AI can remove that maintenance, but only if the result feels trustworthy. A fast system that silently misfiles thoughts, creates duplicate tasks, overwrites notes, or loses the user's original words is worse than a simple notebook.

## 2. Product decision

Keep the Stream as a core primitive, but define it as a capture ledger with reconciliation rather than an inbox with promotion.

### 2.1 The Stream is user-originated

The visible Stream contains things the user intentionally externalized:

- Typed captures
- Voice captures
- Images the user chose to capture
- Explicit brain dumps
- Ambiguous or multi-thought content intentionally sent to the Stream from chat

Email, Slack, GitHub, calendar changes, meeting transcripts, and other connector payloads do not appear in the visible Stream by default. They enter through a separate integration-event boundary and can use the same reconciliation engine.

This preserves three important properties:

- The Stream remains emotionally personal and scannable
- User intent stays distinguishable from ambient inbound data
- Untrusted external content stays behind a stricter security boundary

### 2.2 Original input is immutable

Flow never destroys what the user originally captured.

- Text capture stores the exact submitted text
- Voice capture stores the original audio attachment and the first machine transcript
- Image capture stores the original image and the first extraction result
- Corrections update a separate normalized representation
- Every derived task, note, or reminder can be traced back to its source captures

The UI may show the normalized text by default after a correction, but the original is always inspectable.

### 2.3 Outcomes are many-to-many

The system must support:

- One capture creating multiple tasks
- One capture creating a task and updating a note
- Several captures combining into one task or note
- A fragment appending to an existing note
- A fragment adding context to an existing task
- A capture being recognized as a duplicate
- A capture remaining as raw memory
- A capture requiring a user decision

No stream row owns a single canonical `promoted_to_id` relationship.

### 2.4 Settled memory is a valid outcome

Not every thought deserves a task or note.

A capture can become **settled** when it has no active action and does not justify a durable note. Settled captures:

- Leave the attention queue
- Remain searchable
- Remain available to future retrieval and synthesis
- Do not create task debt
- Can be reopened if later context makes them relevant

This replaces silent decay and prevents frictionless capture from producing task and note inflation.

### 2.5 Review is concentrated

The user does not manually process a queue of every capture. Flow handles clear, reversible work and gathers genuine uncertainties into a small “Needs your call” review.

The Deck is never blocked by Stream review. A review can appear near the Deck when relevant, but it is a separate, optional decision moment.

## 3. Goals and non-goals

### 3.1 Goals

- Capture text locally in under 250 ms at p95 before AI processing
- Persist voice and image captures before transcription or extraction completes
- Preserve original content and attachment provenance
- Support splitting and combining captures
- Avoid duplicate tasks and destructive note updates
- Process natural capture bursts together
- Detect time-sensitive commitments quickly
- Auto-apply safe, reversible actions when appropriate
- Propose risky or ambiguous changes with concise reasoning
- Keep unresolved capture review small and finite
- Make every agent action attributable, inspectable, correctable, and undoable
- Learn autonomy from actual acceptance, correction, rejection, and undo behavior
- Keep connector ingestion separate from the user's visible Stream

### 3.2 Non-goals

- Turning every capture into structured content
- Building a user-managed tagging system
- Exposing raw model confidence scores
- Requiring inbox zero
- Replacing the Deck's prioritization system
- Automatically sending messages or changing external systems from a Stream capture
- Building a full generalized knowledge graph in this project
- Mixing untrusted connector payloads into the user-capture prompt without isolation
- Perfect semantic organization on the first release

### 3.3 The right-sized lovable release

The first release is complete when a person can:

1. Capture text, voice, images, or a long brain dump without waiting on AI
2. Close the capture surface knowing the original is safe
3. Receive one calm summary after a brain dump
4. See clear tasks created when intent is explicit
5. See note appends proposed rather than silently applied
6. Let low-intent thoughts settle without creating clutter
7. Correct or undo every automatic outcome quickly
8. Encounter only a small number of genuine decisions in Needs your call

The first lovable release does not require:

- Automatic merges
- Automatic rewrites of existing notes
- Broad connector expansion
- A generalized review platform for every agent mutation
- A new task-ranking system
- A native mobile offline queue
- User-visible autonomy configuration beyond propose-only and safe automatic actions

This boundary keeps the experience whole without making the first release carry every future use case.

## 4. Product principles

### 4.1 Capture first, interpret second

Capture must never wait on AI. Store first, acknowledge, then process.

### 4.2 Patience improves interpretation

Most non-urgent thoughts benefit from a short wait. Additional thoughts can reveal whether something is a task, a note, context, or passing mental residue.

### 4.3 False merges are more damaging than missed merges

Creating two related notes is recoverable. Quietly blending unrelated ideas can corrupt the user's memory. Automatic consolidation requires stronger evidence than automatic creation.

### 4.4 Structure is a consequence, not a capture requirement

Areas, task metadata, note titles, and placement are inferred after capture. They are not fields the user fills while trying to clear their head.

### 4.5 Show consequences, not machinery

The user should see “Added to Launch Plan” rather than “Triage run 04 applied action 3 at 0.91 confidence.”

### 4.6 Undo is a primary action

For reversible automatic work, undo should be easier to reach than settings.

### 4.7 No guilt language

Avoid “overdue captures,” “inbox debt,” red pending counts, and pressure to process everything. Use calm language such as:

- Captured
- Working on it
- Kept for later
- Added to
- Needs your call
- Nothing needs you

## 5. Core user experience

### 5.1 Universal capture

Quick Capture is one surface that expands naturally with the user.

**Requirements:**

- One global keyboard shortcut and one reliable mobile entry point
- Text, voice, images, and attachments
- Multi-line input without selecting “brain dump mode” first
- Enter submits short captures
- Mod+Enter always submits
- Shift+Enter inserts a newline
- Long input expands without turning into a form
- Client-generated idempotency key makes retries safe
- The composer closes as soon as durable storage succeeds
- AI work continues after the composer closes

**Confirmation:**

> Captured

Optionally include a short preview. Do not promise that a task or note exists until it actually does.

### 5.2 Voice and image capture

Voice and image capture are two-stage operations.

1. Persist the capture envelope and original attachment
2. Transcribe or extract asynchronously

The user sees an honest state:

> Transcribing your thought

or:

> Reading this image

If preprocessing fails, the capture still exists with its original attachment and a retry action. A failed transcription must never make the capture disappear.

### 5.3 Explicit brain dumps

A brain dump is a capture session, not a different content type.

**Entry points:**

- Let the universal composer expand naturally
- “Brain dump” command in chat
- Optional dedicated shortcut for users who prefer it

**Behavior:**

- No processing while the user is actively composing
- Closing or submitting the dump closes its capture session
- The session is processed immediately after submission
- One raw dump stays intact even when multiple source spans produce different outcomes

**Post-processing summary example:**

> I found 3 things to do, added 2 thoughts to Product Strategy, and kept 1 idea for later.

Actions:

- Looks right
- Review
- Undo

Do not ask the user to confirm every extracted item when the changes are safe and reversible.

### 5.4 Recent captures view

The Stream becomes a slim “Recent captures” history rather than a work queue.

Each capture can display:

- Normalized text, with the original available on inspection
- Time and input method
- A calm processing indicator when needed
- Outcome annotations such as “Created 2 tasks” or “Added to Onboarding UX”
- “Kept for later” for settled memory
- “Needs your call” for unresolved judgment
- Undo or correct when an action was applied

Default filters:

- Recent
- Needs your call, only when non-empty

Power-user filters can expose settled, failed, and all history. Do not lead with Pending, Promoted, and Dismissed.

### 5.5 Needs your call

Only ambiguity or meaningful risk should reach this surface.

Each decision card contains:

- The relevant source words
- Flow's suggested action
- One sentence explaining why
- The smallest useful choice set, usually two or three actions
- An inspect affordance for full context

Examples:

> “Maybe ask Sam about joining the project.”
>
> Is this something you intend to do, or a thought to keep?
>
> [Make task] [Keep as thought]

> “Move the launch to Friday.”
>
> This may change an existing commitment.
>
> [Review change] [Keep as context]

Never show model confidence as a percentage. Confidence informs policy, not user trust.

### 5.6 Corrections and undo

The correction surface must support:

- Undo a newly created task or note without deleting the original capture
- Separate captures that were grouped incorrectly
- Combine outcomes that should have been one
- Move a fragment to another note
- Convert task to note or note to task
- Correct normalized text without modifying the original
- Reject an inferred deadline or reminder
- Explain “this is not a task” in plain language

Every correction records structured feedback for later autonomy decisions.

### 5.7 Deck integration

- Newly created tasks become eligible for normal Deck ranking
- Explicitly urgent captures can trigger Deck reconciliation
- Non-urgent burst processing does not regenerate the Deck automatically
- Stream review never blocks Deck generation
- The Deck may show one compact prompt such as “1 thought needs your call”
- The Deck must not become a second copy of Recent Captures

### 5.8 Chat behavior

Chat distinguishes direct commands from capture:

- Clear command, such as “Create a task to call Sam tomorrow,” acts directly and records provenance from the chat event
- Ambiguous thought, such as “I keep wondering if Sam should join,” can be captured into the Stream
- Explicit brain dump opens or creates a capture session
- Chat should never duplicate a direct task into both the task table and Stream unless the Stream record is intentionally being used as provenance

The user should not need to say “task” or “note” when they are simply externalizing a thought.

### 5.9 Notifications

Notifications are reserved for:

- An explicit time-sensitive reminder
- A failed capture that could not be recovered automatically
- A small batch of decisions that has waited for the configured review moment

Do not notify for normal successful routing. A quiet annotation in Recent Captures is enough.

## 6. Capture lifecycle

The user-facing lifecycle and processor lifecycle are separate.

### 6.1 Capture status

| Status | Meaning |
|---|---|
| `open` | No final disposition yet |
| `needs_input` | A user decision is required |
| `resolved` | One or more useful actions were applied or accepted |
| `settled` | Retained as searchable memory with no active action |

Failures do not create a terminal capture status. A failed processing run leaves the capture open and records the error on the run so it can retry.

### 6.2 Processing status

Processing status lives on triage runs:

| Status | Meaning |
|---|---|
| `queued` | Durable work exists and has a not-before time |
| `running` | A worker owns the run |
| `planned` | A valid operation plan exists |
| `applied` | All approved operations reached a terminal state |
| `partial` | Some operations applied and others failed or need input |
| `failed` | No safe result was applied and the run can retry |
| `cancelled` | Superseded or explicitly cancelled |

### 6.3 State guarantees

- Captures never disappear because AI processing failed
- A capture may participate in more than one applied action
- A resolved capture can be reopened by undo or correction
- A settled capture can later contribute to a note or task
- No user capture is silently deleted
- Retry does not duplicate an action

## 7. Autonomy and action policy

Policy is evaluated per action type. A single global confidence threshold is not sufficient.

| Action | Initial policy |
|---|---|
| Create new task | Auto-apply when intent is explicit and reversible |
| Create new note | Auto-apply when the capture is clearly durable knowledge |
| Link capture to entity | Auto-apply with undo |
| Add non-destructive context to a task | Auto-apply only through an append-safe operation |
| Append to existing note | Propose until user-specific trust is established |
| Rewrite existing note | Always propose in V1 |
| Merge existing tasks or notes | Always propose in V1 |
| Set reminder from explicit time language | Auto-apply with confirmation |
| Infer hard deadline | Propose unless external evidence is explicit |
| Settle as memory | Auto-apply, visible and reversible |
| Dismiss or delete user content | Never automatic |
| External side effect | Follow connector permission and approval policy |

Autonomy can increase when the same action type is repeatedly accepted without correction. It must decrease quickly after rejection, correction, or undo.

## 8. Data model

All new tables follow the repository timestamp rule: `id`, then the shared `timestamps` spread, then the remaining fields.

### 8.1 Changes to `stream`

Add these fields additively before removing legacy fields:

| Column | Type | Nullability during migration | Purpose |
|---|---|---|---|
| `original_text` | text | nullable | Immutable first representation of user content |
| `normalized_text` | text | nullable | Editable text used for retrieval and processing |
| `capture_session_id` | text FK | nullable | Groups explicit dumps and natural bursts |
| `content_status` | enum | non-null default `ready` | `pending`, `ready`, `failed` for transcription or extraction |
| `status` | enum | existing column, new values | `open`, `needs_input`, `resolved`, `settled` |
| `resolved_at` | text | nullable | When applied outcomes resolved attention |
| `settled_at` | text | nullable | When the capture left active attention without an entity |
| `settled_reason` | text | nullable | `low_intent`, `duplicate`, `handled`, `user_choice`, `agent_recommendation` |
| `needs_input_at` | text | nullable | When a decision was first requested |
| `needs_input_reason` | text | nullable | Short machine-readable reason |
| `last_triage_run_id` | text FK | nullable | Most recent run that considered the capture |
| `capture_key` | text | nullable, unique when present | Client or upstream idempotency key |

Legacy compatibility fields:

- Keep `raw_text` during dual-read and dual-write migration
- Keep `promoted_to_type`, `promoted_to_id`, `promoted_at`, `promotion_pass`, and `dismissed_by` until provenance backfill is verified
- Stop creating new `source='webhook'` stream rows after integration-event ingestion ships

Indexes:

- `(status, created_at)`
- `(capture_session_id, created_at)`
- Unique partial index on `capture_key` where non-null
- `(content_status, created_at)` for preprocessing recovery

### 8.2 New `capture_sessions` table

Purpose: group one intentional brain dump or an implicit burst of related captures.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUIDv7 |
| `created_at`, `updated_at` | timestamps | Shared spread |
| `kind` | enum | `quick`, `brain_dump`, `voice`, `chat` |
| `state` | enum | `open`, `closed`, `processing`, `processed` |
| `opened_at` | text | Required |
| `last_capture_at` | text | Updated as captures arrive |
| `closed_at` | text | Explicit submission or inferred burst close |
| `process_after` | text | Durable debounce deadline |
| `summary` | text | User-facing result after processing |
| `summary_seen_at` | text | Supports calm unread behavior |

Indexes:

- `(state, process_after)`
- `(last_capture_at)`

### 8.3 New `triage_runs` table

Purpose: durable processing job, audit record, and replay unit.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUIDv7 |
| `created_at`, `updated_at` | timestamps | Shared spread |
| `capture_session_id` | text FK nullable | Null for daily or integration sweeps |
| `source_scope` | enum | `stream`, `integration` |
| `trigger` | enum | `urgency`, `burst`, `manual`, `daily`, `retry` |
| `status` | enum | Processing statuses from section 6.2 |
| `not_before` | text | Durable debounce and retry time |
| `lease_owner` | text nullable | Worker claim identity |
| `lease_expires_at` | text nullable | Crash recovery |
| `attempt` | integer | Starts at zero |
| `idempotency_key` | text unique | Prevents duplicate runs |
| `input_manifest` | JSON | Capture ids, versions, context ids, and hashes |
| `input_hash` | text | Detects stale plans |
| `prompt_version` | text | Evaluation and replay |
| `provider` | text nullable | Model provider used |
| `model` | text nullable | Model used |
| `plan` | JSON nullable | Validated declarative operation plan |
| `summary` | text nullable | User-facing compact outcome |
| `started_at` | text nullable | Worker timing |
| `completed_at` | text nullable | Worker timing |
| `error_code` | text nullable | Stable failure category |
| `error_message` | text nullable | Debug detail |

Indexes:

- `(status, not_before)`
- `(capture_session_id, created_at)`
- `(trigger, created_at)`
- Unique `idempotency_key`

### 8.4 New `triage_actions` table

Purpose: store each proposed or applied operation independently so approval, retry, correction, and undo are precise.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUIDv7 |
| `created_at`, `updated_at` | timestamps | Shared spread |
| `triage_run_id` | text FK | Required |
| `operation` | enum | See operation list below |
| `status` | enum | `proposed`, `approved`, `applying`, `applied`, `rejected`, `failed`, `reverted` |
| `risk_class` | enum | `low`, `medium`, `high`, `external` |
| `confidence` | real nullable | Internal policy signal only |
| `rationale` | text | Short evidence-based reason |
| `source_refs` | JSON | Source type, ids, and optional text spans |
| `target_entity_type` | enum nullable | `task`, `note` |
| `target_entity_id` | text nullable | Existing or created entity |
| `base_updated_at` | text nullable | Optimistic concurrency guard |
| `payload` | JSON | Typed operation payload |
| `idempotency_key` | text unique | Exactly-once action application |
| `applied_at` | text nullable | Completion time |
| `decided_at` | text nullable | Human or policy decision time |
| `decided_by` | enum nullable | `user`, `policy`, `agent` |
| `entity_version_id` | text nullable | Version created by applied mutation |
| `reverted_at` | text nullable | Undo timing |
| `error_code` | text nullable | Stable failure category |
| `error_message` | text nullable | Debug detail |

Initial operations:

- `create_task`
- `create_note`
- `append_note`
- `add_task_context`
- `link_entity`
- `set_reminder`
- `propose_deadline`
- `settle_capture`
- `mark_needs_input`
- `mark_duplicate`

Do not add a generic `update_entity` operation. Typed operations make policy, validation, and undo safer.

Indexes:

- `(triage_run_id, status)`
- `(target_entity_type, target_entity_id)`
- `(status, risk_class, created_at)`
- Unique `idempotency_key`

### 8.5 New `provenance_links` table

Purpose: durable many-to-many lineage from source material to resulting entities.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUIDv7 |
| `created_at`, `updated_at` | timestamps | Shared spread |
| `source_type` | enum | `stream`, `integration_event`, `chat_event` |
| `source_id` | text | Polymorphic source id |
| `entity_type` | enum | `task`, `note` |
| `entity_id` | text | Result entity id |
| `relation` | enum | `created`, `appended`, `context`, `duplicate`, `related` |
| `triage_action_id` | text FK nullable | Action that created the link |
| `source_spans` | JSON nullable | Character offsets and labels |

Constraints and indexes:

- Unique composite on source, entity, relation, and triage action
- `(source_type, source_id)`
- `(entity_type, entity_id)`
- `(triage_action_id)`

### 8.6 New `integration_events` table

Purpose: hold untrusted connector input outside the personal Stream.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUIDv7 |
| `created_at`, `updated_at` | timestamps | Shared spread |
| `connector_id` | text FK nullable | Installed connector identity |
| `workspace_id` | text FK nullable | Workspace scope when known |
| `provider` | text | `gmail`, `slack`, `github`, `calendar`, and others |
| `external_id` | text | Upstream dedupe id |
| `event_type` | text | Provider event kind |
| `occurred_at` | text nullable | Upstream event time |
| `payload` | JSON | Raw inbound payload |
| `content_text` | text nullable | Sanitized extracted content |
| `trust_class` | enum | `external_untrusted`, `external_verified` |
| `status` | enum | `pending`, `reconciled`, `ignored`, `failed` |
| `last_triage_run_id` | text FK nullable | Most recent processing run |
| `error_code` | text nullable | Stable failure category |
| `error_message` | text nullable | Debug detail |

Constraints and indexes:

- Unique composite on provider, external id, and event type
- `(status, created_at)`
- `(connector_id, occurred_at)`
- `(workspace_id, occurred_at)`

### 8.7 Entity version integration

Every applied task or note change must create or link to an `entity_versions` record with:

- `source='ai'` for agent-applied work
- Actor session or triage-run provenance when available
- A concise summary
- Revert linkage when undone

Creation provenance must be covered, not only updates. If `entity_versions` remains update-only, record task and note creation through `triage_actions` and `provenance_links`, then extend versions before generalized review ships.

## 9. Migration plan

The migration must protect real local-first data and remain reversible until final cleanup.

### 9.1 Migration A: additive schema

- Add nullable Stream columns
- Add `capture_sessions`
- Add `triage_runs`
- Add `triage_actions`
- Add `provenance_links`
- Add `integration_events`
- Add indexes and uniqueness constraints
- Do not remove or reorder existing Stream columns

### 9.2 Compatibility release

Deploy compatibility code before changing historical status values:

- Read normalized text first, then fall back to raw text
- Accept both legacy and new status values in readers
- Dual-write raw and normalized text for compatibility
- Write both legacy promotion fields and new provenance links for one release
- Compare legacy and new relationship queries in diagnostics
- Keep old UI available behind a recovery flag until migration verification passes

### 9.3 Backfill

For each existing Stream row:

- `original_text = raw_text`
- `normalized_text = raw_text`
- Existing `pending` maps to `open`
- Existing `promoted` maps to `resolved`
- Existing `dismissed` maps to `settled`
- `resolved_at = promoted_at` where available
- `settled_at = updated_at` for historical dismissed rows
- `settled_reason = handled` when no stronger evidence exists
- Create a provenance link for valid promoted targets
- Create a synthetic applied triage action for valid promoted targets
- Preserve rows whose promoted target no longer exists and flag them in the migration report

The backfill script must:

- Be idempotent
- Run transactionally in bounded batches
- Produce a JSON manifest under the configured backup directory
- Count every source row and every created link
- Read back and verify results
- Never modify attachment files

### 9.4 Cleanup release

Only after dogfood verification:

- Stop dual-writing legacy promotion fields
- Remove broad Stream PATCH support
- Remove legacy promotion fields in a separately generated migration
- Remove `raw_text` only after every consumer reads original or normalized text
- Rebuild and verify the CLI distribution so source and bundled actions match

### 9.5 Rollback

Before every migration against a real brain:

- Stop the app
- Use SQLite backup APIs or `sqlite3 .backup`, not filesystem copy while WAL may be active
- Record schema version and row counts
- Keep additive columns and tables on code rollback
- Do not attempt destructive rollback after new many-to-many actions have been applied

## 10. Ingestion architecture

### 10.1 One user-capture service

All intentional user capture paths call one server-side service in `queries.ts` or a focused capture module that delegates to `queries.ts`:

- Quick Capture
- Voice Capture
- Image Capture
- Chat capture
- Local API capture

The service owns:

- Idempotency
- Capture-session assignment
- Original and normalized content
- Attachment derivation
- Markdown mirror synchronization
- Embedding scheduling
- Urgency-run enqueueing
- Burst deadline updates

Route handlers do not coordinate multi-step writes themselves.

### 10.2 Separate connector ingestion

Webhook and connector routes write `integration_events`, not Stream rows.

The connector ingestion service owns:

- Provider authentication and signature verification
- Upstream dedupe
- Workspace and connector scoping
- Raw payload retention
- Safe text extraction
- Prompt-injection boundary labels
- Reconciliation-run enqueueing

Integration-event prompts never inherit tool authority from the text being processed. The model produces a plan. A deterministic policy layer decides what may execute. Stream and integration events use separate runs in V1. A future mixed run requires a separate security review.

### 10.3 Preprocessing

Text capture is immediately ready.

Voice and image capture enqueue preprocessing after durable storage:

- Voice to transcript
- Image to extracted text and description
- Attachment text extraction when relevant
- Normalization without replacing originals
- Embedding after normalized content is ready

Failed preprocessing uses exponential backoff with a capped retry count. After the cap, show a calm retry action and keep the original attachment available.

### 10.4 Offline and retry behavior

- Client creates a stable capture key before submission
- Retrying the same submission returns the existing capture
- The composer keeps unsent content locally until the server confirms storage
- Network failure never clears the draft
- A later mobile implementation can queue the same envelope offline without changing the server contract

## 11. Reconciliation pipeline

### 11.1 Lane 1: wait-risk detection

Immediately after text becomes ready, run a narrow check:

> Could waiting several minutes cause the user to miss a real commitment or time-sensitive action?

Inputs:

- Normalized capture text
- Current time and timezone
- Explicit dates, times, and deadline language
- Minimal user context needed to interpret relative dates

Outputs:

- `wait_safe`
- `time_sensitive`
- `needs_input`

Use deterministic date extraction before model reasoning. The model must cite the exact source text supporting urgency.

Urgency detection does not perform broad note grouping or project organization.

### 11.2 Lane 2: burst reconciliation

Trigger when:

- An explicit brain dump closes
- An implicit capture session has been quiet for about two minutes
- The user chooses Process now

Inputs:

- Full normalized content for the session
- User captures from the prior 48 hours when relevant
- Current user state
- Active areas and their context
- Candidate tasks and notes from hybrid retrieval
- Current task titles, note summaries, and update timestamps
- Current Deck ids for context, not automatic regeneration

The context builder should retrieve candidate entities. It must not send the entire lifetime database to the model.

### 11.3 Lane 3: daily safety sweep

Once per day, or on explicit request:

- Find open captures not owned by an active run
- Reconsider them with broader context
- Settle low-intent memory when safe
- Group decisions into one Needs your call digest
- Surface failures that exhausted retries

The daily sweep does not silently delete captures and does not force the user through every item.

### 11.4 Planning contract

The model returns a validated operation graph, not prose and not direct database mutations.

Each action includes:

- Operation type
- One or more source references
- Optional source spans
- Proposed target or create payload
- Evidence from the source text
- Short rationale
- Internal confidence
- Risk class
- User-facing outcome phrase

The plan can include several actions from one capture and one action from several captures.

### 11.5 Retrieval

Use hybrid retrieval to generate candidates:

- Keyword match for names, projects, and explicit references
- Semantic match for related concepts
- Recency and active status filters
- Area and current-task context

Retrieval proposes candidates only. It does not authorize merges.

### 11.6 Validation

Before policy evaluation:

- Validate the plan with Zod
- Verify every source id exists
- Verify every target id exists
- Verify target entity type matches
- Verify source spans are within normalized text bounds
- Reject unsupported operations
- Reject empty task titles and empty note updates
- Require imperative task titles when appropriate
- Verify attachment references
- Verify the target `updated_at` matches `base_updated_at`
- Reject any external action from an untrusted-source plan

Stale target data causes re-planning or user review. It never causes blind overwrite.

### 11.7 Policy evaluation

The policy engine considers:

- Operation type
- Risk class
- Source type
- Model confidence
- Evidence quality
- Whether the action creates or changes existing content
- User-specific acceptance and correction history
- Current autonomy setting

It returns:

- Apply
- Propose
- Needs input
- Reject

### 11.8 Transactional application

Each action is applied through a typed query-layer operation.

Within one SQLite transaction:

- Claim the action idempotency key
- Recheck optimistic concurrency
- Create or update the entity
- Create entity version metadata
- Create provenance links
- Update action status
- Recompute capture dispositions when appropriate

The compound mutation collects required embedding and markdown work while the transaction is open, then starts those side effects only after commit through the existing invariant-preserving query path. Any asynchronous failure is recorded for recovery. A rolled-back transaction must never publish a markdown or embedding update for data that did not commit.

### 11.9 Session completion

After terminal actions:

- Generate a compact user summary from actual applied outcomes, not the original plan
- Mark the capture session processed
- Notify query caches or SSE subscribers
- Reconcile the Deck only when an urgent task materially changes today's priorities
- Leave a visible undo window

### 11.10 Failure and recovery

- Worker leases expire so another worker can recover abandoned runs
- Retries use the same run or a linked retry run with stable action keys
- Partial runs never replay already-applied actions
- An exhausted run leaves captures open
- The Recent Captures view shows a recoverable failure without alarming language
- A manual Retry creates an audited retry run

## 12. Search and memory behavior

- Search indexes normalized text and can optionally inspect original text
- Settled captures remain searchable
- Search results identify the item as a capture, task, or note
- Derived entities can show “From 3 captures” with provenance details
- Future synthesis can retrieve settled captures without promoting them first
- Dismissed historical rows remain searchable after migration to settled

## 13. Security and privacy

- Original voice and image artifacts stay local under the configured attachment path
- Provider calls include only the minimum context needed for the run
- Integration payloads are marked untrusted and processed in a separate prompt context
- External text can never grant permissions or alter system instructions
- Remote MCP clients cannot access raw external payloads without an explicit action contract
- Every automatic mutation has actor provenance
- Logs avoid full capture content by default
- Debug exports require an explicit user action

## 14. Accessibility and emotional design

- All capture and review actions are keyboard accessible
- Processing state is announced with `aria-live` without repeated interruptions
- Color is never the only status signal
- Undo remains reachable by keyboard and screen reader
- Voice capture clearly indicates when recording starts and stops
- Failure copy states what is safe: “Your recording is saved. Transcription needs another try.”
- Empty states reassure rather than congratulate inbox maintenance: “Nothing needs you.”
- The interface never implies moral failure because thoughts accumulated

## 15. Performance and reliability requirements

- Text capture durable response under 250 ms p95 on local hardware
- Voice and image envelope durable response under 500 ms p95 before preprocessing
- No data loss across app restart after capture acknowledgment
- Exactly-once application under repeated worker delivery
- No destructive note update without optimistic concurrency check
- Burst job survives server restart
- Search includes settled capture within 60 seconds of content readiness
- Recent Captures renders the latest 100 items without one request per outcome
- Processing 100 captures in one sweep does not block capture writes

## 16. Success metrics

The north star is trusted cognitive release, not inbox zero.

### 16.1 Primary metrics

- **Hands-off usefulness:** percentage of captures that produce a useful outcome or settle without manual organization
- **Correction rate:** percentage of applied actions edited, rejected, separated, or undone within seven days
- **False merge rate:** percentage of append or merge actions later separated or reverted
- **Missed urgency rate:** time-sensitive captures not surfaced before their useful deadline
- **Review burden:** median active time spent in Needs your call per day
- **Task inflation:** tasks created per capture session and later archived without action
- **Capture trust retention:** percentage of active users still using capture after four weeks

### 16.2 Guardrails

- Zero known capture loss after acknowledgment
- Zero silent note-body replacement
- Zero duplicate applied action from worker retry
- One hundred percent provenance coverage for AI-created tasks and notes
- Ninety-five percent of days have three or fewer Needs your call decisions for a typical single-user workload
- Automatic append and merge remain disabled until their measured correction rate meets the rollout gate

### 16.3 Local telemetry events

- `capture_created`
- `capture_content_ready`
- `capture_content_failed`
- `triage_run_started`
- `triage_plan_validated`
- `triage_action_proposed`
- `triage_action_applied`
- `triage_action_rejected`
- `triage_action_corrected`
- `triage_action_undone`
- `capture_settled`
- `needs_input_seen`
- `needs_input_decided`

Telemetry records ids and structured outcomes, not full private content.

## 17. Evaluation strategy

Automation must earn mutation authority.

### 17.1 Capture corpus

Build a local evaluation corpus from consented or synthetic examples covering:

- One clear task
- One clear note
- Mixed task and note in one paragraph
- Several tasks in one voice dump
- Several fragments that should become one note
- Related fragments that must remain separate
- Existing-note append candidate
- Near-duplicate task
- Explicit reminder
- Ambiguous date
- Low-intent idea
- Emotional or reflective thought that should settle
- Failed transcription
- Adversarial connector content

Expected output is an operation graph, not only a class label.

### 17.2 Shadow mode

Before automatic mutations:

- Run the full planner on dogfood captures
- Store proposed actions without applying them
- Compare proposals against what the user actually does
- Label false splits, false merges, missed urgency, and unnecessary task creation
- Version prompts and models in every run

### 17.3 Rollout gates

Suggested initial gates:

- Create-task auto-apply only after at least 100 shadow examples with acceptable false-task rate
- Create-note auto-apply only after acceptable note-inflation rate
- Settling can auto-apply earlier because it is non-destructive and reversible
- Append to existing note requires at least 95 percent acceptance over a meaningful sample for that user and operation
- Merge remains proposed in V1 regardless of aggregate confidence
- Any missed urgent commitment pauses urgency auto-apply until reviewed

## 18. Build sequence

```text
Phase 0: Contract and safety
  -> Phase 1: Additive data foundation
  -> Phase 2: Durable capture ingestion
  -> Phase 3: Shadow reconciliation
  -> Phase 4: Lovable product surface
  -> Phase 5: Graduated automation
  -> Phase 6: Separate connector ingestion
  -> Phase 7: Legacy cleanup
```

## 19. Implementation checklist

### STREAM-00: Freeze the product contract and fixtures

**Goal:** make the new mental model executable before schema work begins.

**Likely files:**

- `docs/stream-reconciliation-prd.md`
- `src/lib/orchestrator/harness-surface.ts`
- `skills/orchestrator/SKILL.md`
- New stream evaluation fixture directory

**Tasks:**

- [ ] Mark this document authoritative for Stream behavior
- [ ] Update product vocabulary to use Recent Captures and Needs your call
- [ ] Define the typed plan schema with many-to-many source references
- [ ] Define operation-specific autonomy defaults
- [ ] Create at least 50 evaluation fixtures before implementing the planner
- [ ] Include false-merge and low-intent examples, not only happy paths
- [ ] Record expected operation graphs for every fixture
- [ ] Document which old PRD sections are superseded

**Acceptance:**

- [ ] A contributor can explain open, resolved, settled, and needs input without reading code
- [ ] Fixtures demonstrate one-to-many and many-to-one behavior
- [ ] No authoritative doc still says every Stream item has exactly one promotion target

**Depends on:** nothing

### STREAM-01: Fix current promotion safety

**Goal:** remove known destructive and partial-write behavior before adding automation.

**Likely files:**

- `src/components/stream/stream-list.tsx`
- `src/components/stream/stream-triage.tsx`
- `src/app/api/stream/[id]/route.ts`
- `src/lib/db/queries.ts`
- `src/lib/orchestrator/registry.ts`
- Stream tests

**Tasks:**

- [ ] Replace client-side create-then-update promotion with one server operation
- [ ] Wrap entity creation and Stream state compatibility writes in one transaction
- [ ] Remove or disable the current append-to-note path that replaces the note body
- [ ] Rename or remove “Merge into task” behavior that currently creates a subtask
- [ ] Add transition validation to Stream mutations
- [ ] Restrict generic PATCH fields through a Zod request schema
- [ ] Prevent mutation of raw source text after this task lands
- [ ] Add failure tests proving no orphan entity remains after a simulated error
- [ ] Add concurrency tests for double promotion and retry
- [ ] Rebuild `dist/cli` and verify source actions match CLI help
- [ ] Fix the bundled `describe_schema` runtime failure

**Acceptance:**

- [ ] No UI action can overwrite an existing note with raw capture text
- [ ] Promotion either commits completely or has no effect
- [ ] A repeated request returns the first result or a stable conflict without duplication
- [ ] CLI and source expose the same Stream actions

**Depends on:** STREAM-00

### STREAM-02: Add the data foundation

**Goal:** add the new tables and additive Stream fields.

**Likely files:**

- `src/lib/db/schema.ts`
- `src/db/types.ts`
- `drizzle/`
- Schema tests

**Tasks:**

- [ ] Add nullable Stream columns from section 8.1
- [ ] Add `capture_sessions` with shared timestamps
- [ ] Add `triage_runs` with shared timestamps
- [ ] Add `triage_actions` with shared timestamps
- [ ] Add `provenance_links` with shared timestamps
- [ ] Add `integration_events` with shared timestamps
- [ ] Add all specified indexes and unique constraints
- [ ] Derive TypeScript types from Drizzle
- [ ] Generate the migration with `pnpm db:generate`
- [ ] Verify migration against a fresh test brain
- [ ] Verify migration against a copy of a populated dev brain

**Acceptance:**

- [ ] Fresh and populated migrations succeed
- [ ] Every new table has `id`, `created_at`, and `updated_at` in the required order
- [ ] Duplicate capture keys, action keys, and integration ids fail predictably
- [ ] No existing Stream data changes in the additive migration

**Depends on:** STREAM-00

### STREAM-03: Backfill lineage and compatibility

**Goal:** migrate existing Stream meaning without losing history.

**Likely files:**

- New `scripts/migrate-stream-reconciliation.ts`
- New verification script
- `src/lib/db/queries.ts`
- Migration tests

**Tasks:**

- [ ] Implement the backfill mapping in section 9.2
- [ ] Create synthetic actions and provenance links for historical promotions
- [ ] Report missing promoted targets without failing the whole migration
- [ ] Add read-back verification and row-count checks
- [ ] Write a JSON migration manifest to the configured backup directory
- [ ] Make the script idempotent
- [ ] Add dual-read helpers for normalized and legacy raw text
- [ ] Deploy readers that accept both legacy and new status values before backfill
- [ ] Add dual-write compatibility for one release
- [ ] Add a diagnostic comparing legacy promotion links to provenance links

**Acceptance:**

- [ ] Every existing Stream row appears in the migration manifest
- [ ] Re-running the migration produces no duplicate actions or links
- [ ] Historical promoted and dismissed items render with equivalent meaning
- [ ] Missing target rows are visible and recoverable

**Depends on:** STREAM-02

### STREAM-04: Unify intentional capture ingestion

**Goal:** route all user-intentional capture through one idempotent service.

**Likely files:**

- `src/app/api/capture/route.ts`
- `src/app/api/stream/route.ts`
- New `src/lib/capture/ingest.ts`
- `src/lib/db/queries.ts`
- `src/components/dashboard/quick-capture-modal.tsx`
- `src/hooks/use-stream.ts`

**Tasks:**

- [ ] Define a versioned capture envelope
- [ ] Require or generate a stable capture key
- [ ] Implement get-or-create idempotency behavior
- [ ] Assign explicit and implicit capture sessions
- [ ] Update session `last_capture_at` and `process_after` transactionally
- [ ] Keep unsent composer content locally until acknowledgment
- [ ] Return as soon as durable storage succeeds
- [ ] Schedule embeddings and processing after commit
- [ ] Route text, voice, image, chat capture, and local API through the service
- [ ] Deprecate direct arbitrary Stream creation from UI routes

**Acceptance:**

- [ ] Repeating the same request creates one capture
- [ ] Closing the composer after success cannot race with data persistence
- [ ] Capture still succeeds when the model provider is unavailable
- [ ] Text capture meets the latency target on local hardware

**Depends on:** STREAM-02

### STREAM-05: Make media preprocessing durable

**Goal:** save first, then transcribe or extract without losing the capture.

**Likely files:**

- `src/app/api/capture/route.ts`
- `src/lib/stt/`
- `src/lib/attachments/`
- New preprocessing worker module
- Stream media tests

**Tasks:**

- [ ] Persist voice and image envelopes before model work
- [ ] Set `content_status='pending'`
- [ ] Implement leased preprocessing jobs or reuse the triage-run worker contract safely
- [ ] Save first transcript or extraction as original text
- [ ] Save corrected content separately as normalized text
- [ ] Mark failed preprocessing without closing the capture lifecycle
- [ ] Retry with capped exponential backoff
- [ ] Add manual retry action
- [ ] Add honest processing and failure copy
- [ ] Verify original attachments survive every failure path

**Acceptance:**

- [ ] Killing the app after upload but before transcription does not lose the capture
- [ ] Restart resumes pending preprocessing
- [ ] Failed transcription leaves playable audio and a retry action
- [ ] Editing transcript does not alter the original transcript or audio

**Depends on:** STREAM-04

### STREAM-06: Build the durable run coordinator

**Goal:** create reliable urgency, burst, manual, daily, and retry execution.

**Likely files:**

- New `src/lib/stream-runs/`
- `instrumentation.ts`
- `src/lib/db/queries.ts`
- Worker lease tests

**Tasks:**

- [ ] Implement queued run creation with unique idempotency keys
- [ ] Implement implicit burst debounce by moving `process_after`
- [ ] Implement explicit brain-dump close trigger
- [ ] Implement worker lease claim, renewal, expiry, and recovery
- [ ] Implement capped retry timing
- [ ] Ensure active runs are not duplicated by the scheduler tick
- [ ] Ensure capture writes remain available during large sweeps
- [ ] Add manual Process now
- [ ] Add daily safety sweep scheduling
- [ ] Add graceful shutdown behavior

**Acceptance:**

- [ ] Burst processing survives app restart
- [ ] New captures extend the open burst rather than spawning duplicate work
- [ ] An expired worker lease is safely recovered
- [ ] One hundred open captures can be swept without blocking new capture

**Depends on:** STREAM-02, STREAM-04

### STREAM-07: Build the context and retrieval layer

**Goal:** give the planner enough context to combine thoughtfully without flooding it.

**Likely files:**

- New `src/lib/stream-triage/context.ts`
- Search and embedding helpers
- Query-layer candidate functions
- Context tests

**Tasks:**

- [ ] Load all captures in the active session
- [ ] Load relevant captures from the previous 48 hours
- [ ] Load user state and active area context
- [ ] Retrieve candidate tasks and notes through hybrid search
- [ ] Include target ids and `updated_at` for concurrency guards
- [ ] Include current Deck ids without triggering regeneration
- [ ] Enforce token and candidate limits
- [ ] Keep untrusted integration content in a separate context envelope
- [ ] Hash the complete input manifest
- [ ] Record context ids, not full private text, in debug logs

**Acceptance:**

- [ ] Related existing notes appear in append fixtures
- [ ] Unrelated but semantically broad notes do not dominate candidates
- [ ] Context size stays bounded as the database grows
- [ ] Every target proposal carries a base update timestamp

**Depends on:** STREAM-02, STREAM-06

### STREAM-08: Implement the typed planner

**Goal:** convert capture context into a validated operation graph.

**Likely files:**

- New `src/lib/stream-triage/schema.ts`
- New `src/lib/stream-triage/planner.ts`
- Prompt files or constants
- Planner evaluation tests

**Tasks:**

- [ ] Define Zod schemas for every operation
- [ ] Support multiple source refs per action
- [ ] Support multiple actions per capture
- [ ] Require source evidence for urgency and deadlines
- [ ] Require concise rationale and user outcome text
- [ ] Implement wait-risk prompt separately from burst planning
- [ ] Implement burst planner
- [ ] Implement daily sweep planner
- [ ] Version every prompt
- [ ] Persist raw model output only in bounded local debug artifacts when enabled
- [ ] Reject malformed plans without partial mutation

**Acceptance:**

- [ ] Evaluation fixtures pass at the agreed threshold in shadow mode
- [ ] Planner can split one paragraph into several actions
- [ ] Planner can combine several captures into one action
- [ ] Planner can choose settled memory without inventing a task or note
- [ ] Planner never directly executes a tool or database mutation

**Depends on:** STREAM-00, STREAM-07

### STREAM-09: Implement validation and action policy

**Goal:** turn model proposals into safe decisions.

**Likely files:**

- New `src/lib/stream-triage/validate.ts`
- New `src/lib/stream-triage/policy.ts`
- User autonomy settings or existing permission-mode integration
- Policy tests

**Tasks:**

- [ ] Implement all validation checks from section 11.6
- [ ] Assign risk classes deterministically
- [ ] Define initial per-operation policy
- [ ] Treat external-source actions more strictly
- [ ] Read user-specific acceptance and correction history
- [ ] Return apply, propose, needs input, or reject
- [ ] Prevent raw confidence from reaching default UI
- [ ] Add a kill switch that forces propose-only behavior
- [ ] Add policy decision telemetry

**Acceptance:**

- [ ] Stale note targets never receive blind appends
- [ ] Untrusted content cannot authorize external or privileged action
- [ ] Merge and rewrite operations remain proposed in V1
- [ ] Propose-only mode works without changing planner behavior

**Depends on:** STREAM-08

### STREAM-10: Implement transactional action execution

**Goal:** apply approved operations exactly once with complete provenance.

**Likely files:**

- New `src/lib/stream-triage/apply.ts`
- `src/lib/db/queries.ts`
- `src/lib/orchestrator/registry.ts`
- Entity-version helpers
- Transaction and retry tests

**Tasks:**

- [ ] Implement one typed query operation per action type
- [ ] Apply each action in a SQLite transaction
- [ ] Enforce idempotency keys
- [ ] Recheck target update timestamps
- [ ] Create entity versions for updates
- [ ] Record creation provenance for new entities
- [ ] Create many-to-many provenance links
- [ ] Recompute capture status from terminal actions
- [ ] Preserve attachments by reference without duplicating files
- [ ] Implement partial-run completion semantics
- [ ] Schedule embeddings and markdown sync through invariant-safe paths

**Acceptance:**

- [ ] Retrying an applied action produces no duplicate entity or append
- [ ] Simulated failure rolls back entity, action, link, and capture changes
- [ ] One capture can link to several entities
- [ ] Several captures can link to one entity
- [ ] Every applied entity change can be traced to its source action and captures

**Depends on:** STREAM-02, STREAM-09

### STREAM-11: Implement undo and correction telemetry

**Goal:** make mistakes cheap and learning concrete.

**Likely files:**

- Entity version and revert helpers
- New correction API routes
- Stream and entity UI components
- Telemetry queries

**Tasks:**

- [ ] Undo newly created derived entity while preserving source capture
- [ ] Revert note append through entity versions
- [ ] Reopen capture status when undo removes its only resolution
- [ ] Implement Separate and Move correction flows
- [ ] Implement task-to-note and note-to-task correction where safe
- [ ] Record accepted, corrected, rejected, and undone outcomes
- [ ] Attribute correction to the original triage action
- [ ] Lower autonomy after correction or undo
- [ ] Add tests for undo after later unrelated entity edits

**Acceptance:**

- [ ] User can recover from every V1 automatic mutation
- [ ] Undo never deletes the original capture
- [ ] Revert refuses or stages when later edits make direct undo unsafe
- [ ] Correction metrics can be queried by operation type and prompt version

**Depends on:** STREAM-10

### STREAM-12: Replace Stream UI with Recent Captures

**Goal:** make the Stream feel calm, personal, and trustworthy.

**Likely files:**

- `src/components/stream/stream-list.tsx`
- `src/components/stream/stream-triage.tsx`
- New outcome and provenance components
- `src/hooks/use-stream.ts`
- Stream API query routes

**Tasks:**

- [ ] Default to Recent rather than All
- [ ] Remove pending-count pressure from primary navigation
- [ ] Replace status vocabulary with product language from section 4.7
- [ ] Show processing, outcome, settled, and needs-input annotations
- [ ] Show multiple outcomes from one capture
- [ ] Add original-versus-normalized inspection
- [ ] Add undo and correction affordances
- [ ] Hide settled captures from default after the recent window
- [ ] Keep failed captures visible until recovered or explicitly settled
- [ ] Remove area, effort, energy, and placement controls from default capture review
- [ ] Add accessible loading and processing announcements

**Acceptance:**

- [ ] A user can understand what happened without learning internal states
- [ ] The default surface presents no inbox-zero obligation
- [ ] Multiple derived outcomes are legible from one capture
- [ ] Original input is always reachable
- [ ] Mobile and keyboard workflows cover capture, inspect, undo, and review

**Depends on:** STREAM-03, STREAM-10, STREAM-11

### STREAM-13: Ship lovable brain-dump summaries

**Goal:** close the loop while the user's context is still fresh.

**Likely files:**

- `src/components/dashboard/quick-capture-modal.tsx`
- Existing unused brain-dump component, likely removed or folded in
- New session-summary component
- Session APIs and hooks

**Tasks:**

- [ ] Let universal capture expand for long input
- [ ] Remove the duplicate unused brain-dump implementation
- [ ] Explicitly close brain-dump sessions on submit
- [ ] Render summaries from applied outcomes, not planned actions
- [ ] Add Looks right, Review, and Undo
- [ ] Keep the summary available in Recent Captures if the toast disappears
- [ ] Avoid one card per extracted action by default
- [ ] Add warm, concise copy for zero-action and mixed-action dumps
- [ ] Test long text, voice dump, images, and mixed attachments

**Acceptance:**

- [ ] A ten-thought dump can be understood and accepted in under ten seconds when routing is correct
- [ ] User can inspect every individual outcome when desired
- [ ] Closing the summary does not mark proposed actions accepted
- [ ] Summary accurately reflects partial failures and needs-input items

**Depends on:** STREAM-06, STREAM-10, STREAM-12

### STREAM-14: Build Needs your call

**Goal:** concentrate human judgment into a small, humane review surface.

**Likely files:**

- New review query and API
- New Stream review components
- Deck compact prompt
- Notification integration

**Tasks:**

- [ ] Query proposed actions and needs-input captures as one review list
- [ ] Group decisions by capture session when helpful
- [ ] Show source text, recommendation, reason, and minimal choices
- [ ] Add Accept all only for compatible low-risk actions
- [ ] Never mix high-risk actions into blind Accept all
- [ ] Add seen and decided timestamps
- [ ] Add one compact Deck prompt without blocking the Deck
- [ ] Add digest notification rules
- [ ] Add “Nothing needs you” empty state
- [ ] Measure active review time locally

**Acceptance:**

- [ ] Typical dogfood days require three or fewer decisions
- [ ] High-risk actions cannot be batch-approved accidentally
- [ ] Skipping review does not hide or delete source captures
- [ ] Deck use remains uninterrupted

**Depends on:** STREAM-09, STREAM-10, STREAM-12

### STREAM-15: Integrate Chat and orchestrator actions

**Goal:** make human and agent behavior share the same safe contracts.

**Likely files:**

- `src/lib/orchestrator/registry.ts`
- `src/lib/orchestrator/harness-surface.ts`
- `skills/orchestrator/SKILL.md`
- Chat tools and prompt
- Registry tests

**Tasks:**

- [ ] Replace one-item `promote_stream` assumptions with plan and action APIs
- [ ] Add read actions for capture session, outcomes, and needs-input state
- [ ] Add a scoped `process_stream` action that creates a durable run
- [ ] Keep direct create-task and create-note actions for explicit commands
- [ ] Record chat-event provenance for direct commands
- [ ] Route ambiguous and multi-thought chat input into a capture session
- [ ] Make all mutating actions retry-safe
- [ ] Update skill instructions and examples
- [ ] Rebuild CLI and MCP surfaces from the same registry
- [ ] Add contract tests for source, CLI, and MCP parity

**Acceptance:**

- [ ] Agent can combine several captures in one run
- [ ] Agent can explain every applied outcome with entity markers
- [ ] Direct chat commands do not create duplicate Stream rows
- [ ] CLI, MCP, and UI use the same mutation layer

**Depends on:** STREAM-10, STREAM-14

### STREAM-16: Run shadow mode and calibrate automation

**Goal:** earn auto-apply authority using real evidence.

**Likely files:**

- Evaluation runner
- Local metrics queries
- Prompt versions
- Developer diagnostics page or CLI

**Tasks:**

- [ ] Run the planner in propose-only mode on dogfood capture sessions
- [ ] Compare model actions to actual human outcomes
- [ ] Label false tasks, false notes, false merges, and missed urgency
- [ ] Track results by prompt and model version
- [ ] Review at least 100 meaningful examples before enabling create-task auto-apply
- [ ] Establish operation-specific rollout thresholds
- [ ] Add global and per-operation kill switches
- [ ] Enable low-risk automation gradually
- [ ] Review correction metrics weekly during rollout

**Acceptance:**

- [ ] No operation auto-applies without a documented gate
- [ ] False-merge rate is measured separately from general correction rate
- [ ] Rollback to propose-only requires no migration
- [ ] A prompt or model regression can be identified from stored run metadata

**Depends on:** STREAM-08, STREAM-09, STREAM-14

### STREAM-17: Separate connector ingestion

**Goal:** let real work flow in without polluting or compromising the personal Stream.

**Likely files:**

- Connector webhook routes
- `src/app/api/webhooks/pocket/route.ts`
- New integration-event ingestion service
- Reconciliation context and policy
- Connector tests

**Tasks:**

- [ ] Route new webhook content to `integration_events`
- [ ] Preserve upstream dedupe and raw payload audit
- [ ] Mark all connector content untrusted by default
- [ ] Extract safe content separately from raw payload
- [ ] Use integration-scoped triage runs
- [ ] Prevent connector text from modifying instructions or permissions
- [ ] Create provenance links from integration events to accepted entities
- [ ] Keep integration events out of Recent Captures
- [ ] Provide a separate diagnostic or source filter for advanced users
- [ ] Migrate historical webhook Stream rows or mark them as legacy external rows

**Acceptance:**

- [ ] New connector traffic creates no visible Stream rows by default
- [ ] Duplicate webhook delivery creates one integration event
- [ ] Prompt-injection fixtures cannot cause unauthorized action
- [ ] Accepted connector-derived tasks retain full source provenance

**Depends on:** STREAM-02, STREAM-09, STREAM-10

### STREAM-18: Complete legacy cleanup and documentation

**Goal:** remove the old model only after the new one is proven.

**Likely files:**

- `src/lib/db/schema.ts`
- `drizzle/`
- Old Stream components and routes
- Product and contributor docs
- CLI distribution

**Tasks:**

- [ ] Verify no consumer reads legacy promotion fields
- [ ] Verify no UI mutates raw text
- [ ] Verify no webhook writes to Stream
- [ ] Run the migration-completeness script against dev and a production backup
- [ ] Generate the destructive cleanup migration
- [ ] Remove old manual triage components and dead types
- [ ] Remove unrestricted Stream PATCH route
- [ ] Update `docs/prd.md`, knowledge rationale, README, and orchestrator docs
- [ ] Rebuild and smoke-test the CLI distribution
- [ ] Run `pnpm ts`, `pnpm lint`, targeted tests, and `pnpm build`
- [ ] Perform an accessibility and copy review

**Acceptance:**

- [ ] Legacy fields and code paths are absent
- [ ] Migration manifests prove all historical relationships were handled
- [ ] Fresh install and upgraded install behave identically
- [ ] Documentation describes one coherent Stream model
- [ ] Full verification suite passes

**Depends on:** STREAM-03 through STREAM-17, plus dogfood gate

## 20. Suggested pull request boundaries

1. Contract, fixtures, and immediate safety fixes
2. Additive schema and migration scripts
3. Unified capture ingestion and durable media preprocessing
4. Run coordinator and context retrieval
5. Planner, validation, and shadow mode
6. Transactional action execution and provenance
7. Undo, correction, and acceptance telemetry
8. Recent Captures and brain-dump summaries
9. Needs your call, Deck prompt, and notifications
10. Chat and orchestrator contract update
11. Connector-event separation
12. Legacy cleanup after rollout gates pass

## 21. Final release checklist

### Product

- [ ] Capture feels complete after durable save, even when AI is offline
- [ ] Long brain dumps produce one calm summary
- [ ] The user is never asked to classify during capture
- [ ] Settled memory is understandable and searchable
- [ ] Needs your call is finite and optional
- [ ] Deck flow remains fast and independent
- [ ] Copy is calm, clear, and free of guilt

### Data

- [ ] Original content is immutable
- [ ] Normalized content is separately editable
- [ ] Many-to-many provenance is complete
- [ ] Every mutation is idempotent
- [ ] Every update has concurrency protection
- [ ] Historical Stream data is migrated and verified
- [ ] Backups and manifests exist for real-brain migration

### Pipeline

- [ ] Capture ingestion is unified
- [ ] Voice and image preprocessing is durable
- [ ] Urgency and burst lanes are separate
- [ ] Planner returns typed actions
- [ ] Policy controls application
- [ ] Application is transactional
- [ ] Daily sweep catches open captures
- [ ] Failures retry without duplication

### Trust

- [ ] Every automatic action is explainable
- [ ] Every V1 automatic action is undoable
- [ ] Corrections feed operation-specific metrics
- [ ] Propose-only kill switch works
- [ ] Connector content is isolated and untrusted
- [ ] No automatic merge ships without its gate

### Quality

- [ ] Unit tests cover state, policy, idempotency, and concurrency
- [ ] Integration tests cover capture through outcome and undo
- [ ] Migration tests cover fresh and populated brains
- [ ] Evaluation corpus covers ambiguous and adversarial input
- [ ] Accessibility review passes
- [ ] Performance targets pass on representative local hardware
- [ ] Typecheck, lint, build, and targeted test suites pass

## 22. The standard for success

This feature succeeds when the Stream stops feeling like a place the user must return to and starts feeling like a dependable extension of memory.

The lovable experience is not that Flow perfectly categorizes every sentence. It is that the user can speak or type imperfectly, close the window, and feel lighter. Later, the right task appears, the right note has grown, or one thoughtful question arrives at a good moment.

The system should feel quietly attentive:

- It preserves before it interprets
- It waits when waiting improves understanding
- It acts when action is safe
- It asks when judgment belongs to the person
- It never makes the person clean up after its confidence

That is the Stream worth building.
