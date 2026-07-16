# Chat Sessions: Agents, Threads, and How the Conversation Persists

Decision doc for how chat works in this app. Written for future-me and anyone wondering why there's no thread sidebar.

Implementation note, 2026-07-14: historical imports now use the provider-neutral Agentex history APIs and the `external_session_imports` ledger. Claude and Codex use Agentex `localHistory`. OpenCode uses Agentex `savedHistory`. The `chat_sessions.external_*` fields described below are live CLI bindings only. Imported transcript synchronization is explicit in Settings in this pass. It is not part of the live-session startup and on-open reconciler. See `docs/external-agent-history-import-spec.md` for the authoritative import contract.

## TL;DR

**There are three distinct kinds of chat, not one model with variants.** Each serves a different purpose and gets the UX that purpose deserves:

1. **Orchestration** — your main thread with the orchestrator. Always-on, in-app, ongoing relationship. One session, chronologically whole. Discover by going to the main surface; never listed.
2. **Content chat** — scoped to a task or note. "Talk to the AI about this piece of content." A *focused harness session* (the user's Claude/Codex subscription) pinned to one entity, acting through the same orchestrator tool surface. Sessions exist as loose conversations attached to the content they're about. Its edits are snapshotted so the human can diff + undo what the agent changed. See [In-document content chat (implementation)](#in-document-content-chat-implementation).
3. **Execution** — CLI-backed work sessions (Claude Code, Codex, other agentex providers). Discrete jobs with their own scope. Run interactively, autonomously, or on cron. Pull in tasks/notes as context via refs. Report back via notifications. These are the "isolated execution channels" — each one its own context-hungry Claude Code-style thread.

Other principles that hold across all three:

- **Agents are first-class database entities.** Agent = definition (prompt, cwd, harness). Session = an instance of that definition running on something. Same agent definition → many concurrent sessions is fine.
- **Full transcripts always.** No summaries replacing messages. Search/retrieval runs over transcripts; memory is a future index over them, not a precondition.
- **Two resets:** undo last turn, `+` to archive current and start fresh.
- **Background/cron/agent-initiated activity goes to notifications**, not into any active chat. Notifications are the entry point to cron-spawned executions.
- **Source of truth follows execution.** For in-app sessions (orchestration, content) our DB is authoritative. For CLI-backed executor sessions, provider-owned history is the durable record and `chat_events` projects from it. App-spawned sessions get rows through Agentex live events and the live-session reconciler. Explicitly imported Claude and Codex chats use Agentex file-backed `localHistory`. Explicitly imported OpenCode chats use service-backed `savedHistory`.
- **No DB-enforced uniqueness on partition.** You decide how many sessions exist and how they overlap. The app picks sensible defaults; schema doesn't constrain.

Internally in the data model: call them `chat_sessions` with a `type` discriminator. Externally in the UI: the word "session" doesn't appear to users.

## The problem this solves

Every chat app has two ways to get conversations wrong:

1. **Pollution.** One eternal thread where everything mixes. Yesterday's pricing discussion buried under today's invoicing spec. The agent has a hard time staying focused; the user can't find anything.
2. **Fragmentation.** Many threads, each about one thing. A sidebar of "Untitled chat" entries. Organizational tax every time you start typing. Graveyard of past conversations no one ever opens.

Most tools pick one failure mode and suffer the other. ChatGPT picked fragmentation. One-session agents like early Claude Code picked pollution. Openclaw tried to split the middle with named sessions + a dropdown — better than either extreme, but still asks the user to manage sessions.

**We side-step both by treating different chat needs as different things.** Orchestration is your ongoing relationship — one thread, always there. Content chat scopes to the piece of work you're looking at. Executions are discrete jobs with their own contexts. Each gets the UX it needs; none of them ask the user to manage a list of past conversations. Sessions exist but are entered via context (the page you're on, the agent you click, the notification you see), never browsed.

## Principles

### 1. Agent is definition; session is instance

An agent row is a *definition* — persona, prompt, harness, cwd. A session is an *instance* of that definition running against whatever the user is doing. One agent definition can have many concurrent sessions. Same Claude executor working on three tasks at once = one `agents` row + three `chat_sessions` rows. This is how people already use coding agents, and the schema shouldn't fight it.

Chat types serve different purposes (orchestration, content, execution) and the schema records the type explicitly. The UX for each type is tuned to what that type is for.

### 2. Chronology is inviolable

A thread is read chronologically. Any rendering that shows "messages from this thread matching some filter" breaks the reading experience and destroys the model's context. If a conversation belongs to a thread, the UI shows that thread whole — start to finish of what's active — not a slice.

This is the argument that killed "filtered views" as a design option. Either you show the whole thread or you're in a different thread.

### 3. Transcripts are the record; memory is an index over them

Transcripts are local to their thread. Retrieval runs across all of them — it's what lets the agent feel continuous across surfaces. The agent doesn't need every message co-located in context; it needs to be able to *find* the relevant messages when asked.

Concretely: when a user chats about task X in the task's thread, the orchestrator's main thread doesn't have those messages verbatim. But a later question in main ("where did we land on task X?") resolves by searching across `chat_events` — the task-thread is where the answer lives, and the orchestrator can reach it.

**Search is over our DB, not the JSONL files.** Our `chat_events` table mirrors everything the CLI transcript has, plus in-app rows. We never read JSONL files to answer queries — those are just the wire format; the DB has the queryable form. For v1, SQLite FTS5 over `content` gives fast full-text search across a user's entire history. Vector embeddings (via `sqlite-vec`, already in the stack) become a layered optimization when semantic match matters more than keyword match — future concern, not a precondition.

A dedicated "memory" store (distilled facts, decisions, preferences) is the next layer on top — faster than scanning for recurring patterns. Ship transcripts + FTS first; add embeddings when FTS proves insufficient; layer memory distillation on top when we see what's worth storing.

This is what lets us have three distinct chat types without breaking the "one continuous relationship" feeling.

### 4. No session management for ongoing chat; intentional dispatch for execution

For **orchestration and content chat**, the user never manages sessions. No dropdown, no sidebar, no "name this thread." You navigate to where you are (main surface, task, note) and the right session is there. Default is most-recent-active for that context; `+` starts a new one. This is an ongoing relationship pattern — organizational overhead would kill it.

For **execution**, starting or resuming is an intentional user act — you're dispatching work or picking up a job. That's not session management tax; that's the actual mental model. But there's still no list view: you enter an execution via notifications (work that happened or needs you), via search, or via cross-references from a task/note that touched it. The transcripts are the record; retrieval gets you to them.

Either way, the rule is: **no browsing a list of past conversations.** Past work is recallable, not scrollable.

### 5. Transcripts are full. Summaries augment, never replace.

Users read messages. If the system starts hiding messages behind summaries, trust erodes and the user starts hoarding things in tasks/notes "just in case."

Acceptable: orientation markers when scrolling back ("— resumed after 16h —"), collapsed tool-call detail (shown as a one-liner with expandable detail), inline references to tasks/notes created from the conversation.

Not acceptable: auto-collapsing exchanges, replacing past messages with a one-line summary, hiding older turns behind a "show earlier" wall.

The model's context window is a separate concern. What the *model* sees can be trimmed and summarized internally. What the *user* sees is the full transcript.

### 6. The UI never lies about what the agent knows

Especially for CLI-backed executors, it's tempting to show a polished "continuing conversation" while the underlying CLI session has rolled or died. That creates the worst possible failure mode: the user makes a decision assuming the agent remembers something it doesn't.

The rule: **displayed state equals actual state.** If the CLI session rolled, the user sees a visible divider in the transcript and a handoff message showing exactly what context was carried forward. If the agent doesn't know something, the transcript shows it didn't know. No pretend continuity.

This drives a concrete decision: the CLI transcript is the source of truth for executor messages; our DB follows it. We don't cache "is the session alive" booleans (they go stale). We don't silently rewrite history. We mirror what actually happened.

## The design

### Agents

First-class rows. Created at onboarding for the orchestrator; created on demand for executors.

```
agents
  id
  user_id
  kind              // "orchestrator" | "executor"
  name              // user-facing name
  role              // short description
  harness           // "in_app" | "claude_code" | "codex" | ...
  config            // JSON blob; shape varies by harness
  status            // "active" | "archived"
  created_at
  archived_at
```

Users chat with agents like they'd DM teammates. The orchestrator is your CEO. Executors are specialists you dispatch work to.

**Harness-specific config lives in the `config` JSON.** In-app agents hold model/tools/persona/system prompt. CLI-backed executors also hold a `cwd` — the working directory we pass as `spawn.cwd` when invoking the CLI. Users set `cwd` when creating the executor (directory picker in the UI, or default to the current project root).

**One executor = one project for v1.** If a user wants one "coworker" spanning multiple projects, they create multiple executors — which matches the agent-as-entity framing and avoids per-session cwd overrides. Adding session-level cwd overrides later is a clean addition if users ask.

**Observing cwd from the transcript.** Claude Code writes the cwd into every transcript entry. We compare observed cwd against `agents.config.cwd` on sync as a drift check (user moved the project, Claude Code reconfigured, whatever) — log a warning on mismatch; don't silently continue with stale config. No additional column needed; it's a runtime check against what's stored.

**Multi-device.** `config.cwd` is machine-local; on a new device the path may point to nothing. v1 handles this via the same rollover pattern — spawn fails → user prompted to re-bind. When multi-device becomes real, `config` becomes device-scoped (either a `device_config` JSON keyed by device id, or a separate `agent_device_bindings` table). Deferred, clean migration.

### Sessions

```
chat_sessions
  id                        // our session id; stable across CLI rollovers
  user_id
  agent_id                  // FK to agents
  type                      // "orchestration" | "content" | "execution" — app-level enum
  surface_kind              // "main" | "task" | "note" | null for execution (refs-based)
  surface_ref               // task_id / note_id / etc.; null otherwise
  status                    // "active" | "archived"
  label                     // user-facing title; useful for executions, usually null for others
  refs                      // JSON { task_ids?: [], note_ids?: [], area_ids?: [] }
  started_at
  archived_at

  external_session_id       // current CLI session id; mutable; null for in-app sessions
  external_provider_type    // provider owning the current live CLI session id
  external_transcript_path  // observed path where the CLI wrote the transcript; null for in-app
  external_sync_offset      // bytes read through; for incremental transcript sync; null for in-app
  external_sync_last_event_id   // last external_event_id upserted; defensive check; null for in-app

  UNIQUE (external_provider_type, external_session_id)
    WHERE external_provider_type IS NOT NULL AND external_session_id IS NOT NULL

external_session_imports
  id, chat_session_id, provider_type, external_session_id, source_kind,
  source_path, source_size, source_modified_at_ns, source_content_sha256,
  source_updated_at, sync_offset, sync_last_event_id, history_checkpoint,
  status, last_scanned_at, last_synced_at, last_error

  UNIQUE (chat_session_id)
  UNIQUE (provider_type, external_session_id)
```

**`type` discriminates the three kinds.** Each type has its own behavior:

- `orchestration` — main thread with orchestrator agent. App convention: one active session per user; `+` archives and starts new. `external_*` null. `surface_kind` null or `"main"`.
- `content` — scoped chat about a task or note. `surface_kind` and `surface_ref` point to it. `external_*` null. App convention: one active per `(user, agent, surface)` by default, but not DB-enforced — multiple is fine if the user wants it.
- `execution` — CLI-backed work session. Live sessions populate `external_*`. Historical imports use `surface_kind = "imported_agent"` and keep source state in `external_session_imports`. Many execution chats can exist simultaneously. `label` carries a human-readable execution title.

**No DB-enforced uniqueness on partition.** The only source uniqueness in this table is the provider-qualified current live binding. Historical source uniqueness is enforced in `external_session_imports`. Everything else about how many orchestration, content, or execution chats exist remains an app-level choice.

**`external_session_id` is mutable.** One `chat_session` can span multiple CLI sessions over its lifetime — if the CLI session rolls or dies, we update `external_session_id` on the same row and append a visible divider message. One DB session, continuing user-facing conversation, rotating CLI state underneath. That's what keeps the UI honest about what actually happened without fragmenting the user's view of "this execution."

We deliberately do **not** cache an "alive" boolean. Liveness is a runtime question — "can I resume this session right now?" — not a stored fact. We check **on send attempt only**: user hits send, we try `resumeSession`, if it fails we rollover. No background polling.

**`external_transcript_path` stores observed truth for the current live binding.** Historical file imports keep their server-only source path and fingerprints in `external_session_imports`. OpenCode historical imports have no source path because Agentex reads them through the authenticated service and returns opaque checkpoints.

**`refs` is session-level.** JSON column with task/note/area ids the session has touched. Maintained as messages reference new things. Used for:
- Surfacing "executions that touched this task" on the task view
- Retrieval anchor points
- Notification routing

Session-level is the right granularity — the primary queries are "what sessions touched X?" and "what did this session touch?" Both answerable from one column. If we ever need "which turn inside a session referenced X," we can add message-level refs later; not needed now.

**Task/note deletion: sessions orphan, don't cascade.** `surface_ref` and `refs` entries are loose references, not foreign keys. When a task is deleted, any session pointing at it stays in the DB; it becomes unreachable through surface navigation but the transcript is preserved (the work may have produced decisions worth retrieving later via search).

**Historical synchronization state belongs to the import ledger.** File sources store a byte offset plus size, nanosecond mtime, and SHA-256 fingerprint. Service sources store an opaque checkpoint. The live-session `external_sync_*` columns are not reused as historical import provenance.

Examples:

- Main chat with orchestrator → `type="orchestration"`, `(user, orchestrator, "main", null)`, no external fields
- Chat on task X with orchestrator → `type="content"`, `(user, orchestrator, "task", X)`, no external fields
- Claude executing "refactor auth middleware" → `type="execution"`, `(user, claude-executor, null, null)`, `label="Refactor auth middleware"`, `refs={task_ids:[42]}`, `external_session_id` set
- Second concurrent execution on a different task → another row, same `agent_id`, different `external_session_id`, different `label` and `refs`

### Events

```
chat_events
  id                             uuidv7 pk     -- our internal id, time-ordered
  session_id                     fk            -- FK to chat_sessions
  role                           text          -- "user" | "assistant" | "system" | "tool" — app-level enum
  source                         text          -- see source enum below — app-level enum
  content                        text          -- text content (null for tool_call rows; text or serialized for others)
  tool_name                      text          -- populated on tool_call rows
  tool_input                     jsonb         -- populated on tool_call rows; tool args are inherently structured
  tool_is_error                  bool          -- populated on tool_result rows
  tool_exit_code                 int           -- populated on tool_result rows (Codex command_execution only; Claude hides exit codes)
  raw                            jsonb         -- full wire event verbatim, audit + forward-compat
  external_event_id              text          -- unique-per-row provider id; null for in-app rows
  external_message_id            text          -- logical message correlation (Claude assistant rows only); null elsewhere
  external_turn_id               text          -- Codex turn scope (native UUIDv7 from v2 app-server); null for Claude
  external_tool_call_id          text          -- on tool_call and tool_result rows; links them
  external_parent_tool_call_id   text          -- Claude sub-agent ancestry; null for Codex
  source_part_index              int           -- position within source wire event when splitting occurred; default 0
  created_at                     timestamp

  UNIQUE (session_id, COALESCE(external_turn_id, ''), external_event_id, source_part_index)
    WHERE external_event_id IS NOT NULL
```

**NULL-safe unique.** SQLite treats NULL as distinct in unique indexes by default — two Claude rows with `(session_X, NULL, same_uuid, 0)` would both insert, breaking idempotency. The `COALESCE(external_turn_id, '')` wrapping coerces NULL to empty string for index purposes so rows with no turn scope still deduplicate correctly. Drizzle expresses this via the `sql` template on the index builder.

**Why `chat_events`, not `chat_messages`.** A row is any atomic thing that happened in a chat — user messages, assistant text, thinking, tool calls, tool results, session init, rate limits, run completions. Only ~22% of rows (Claude assistant entries) are "messages" in the narrow sense. Calling the table `chat_messages` would misrepresent the contents and would clash with `external_message_id` (which means "the logical message this row belongs to," a correlation — not "this row's message id"). `chat_events` keeps table-name and column-name semantics consistent: each row is an event; it has an `external_event_id`; it may correlate to a logical message via `external_message_id`.

**Source enum** (text, app-level, no DB CHECK so adding values is migration-free):

- `user` — user-sent message
- `agent` — assistant text
- `thinking` — assistant reasoning (Claude thinking blocks, Codex reasoning items — content may be placeholder when encrypted)
- `tool_call` — assistant invoking a tool
- `tool_result` — tool returning a result
- `system` — session init, meta, compaction boundary markers
- `result` — run / turn completion (ExecutionResult lives here; full object in `raw`)
- `background_task` — terminal subagent or background process outcome, with the normalized lifecycle event in `raw`
- `rate_limit` — throttling signals
- `error` — API or harness errors
- `recap` — idle-timer summary the CLI emits when the user has been away (Claude Code `away_summary`); distinct from compaction, it doesn't replace context — it's a chat-visible "here's where we left off" note
- `cron` — background-triggered rows (reserved)
- `unknown` — forward-compat: unrecognized wire event types, raw preserved

`role` mirrors LLM API roles (ChatML-ish); `source` is our semantic intent. They answer different questions and are both kept because each surfaces different queries cleanly.

**Refs live on the session, not the event.** Session-level refs answer "which sessions touched task X?" and "what did this session touch?" — both primary queries. Per-event refs are not stored.

### ID model

Each row has up to five external identifiers. Each captures a distinct provider concept; none are synthesized at random.

| Column | Populated for | Role |
|---|---|---|
| `external_event_id` | All CLI-backed rows | Unique-per-row identifier. Claude: JSONL `uuid`. Codex (v2 app-server): globally-unique `item.id` (`msg_*`, `rs_*`, userMessage UUID). |
| `external_message_id` | Claude assistant rows only (~22% of rows) | Logical message correlation. Multiple rows can share one when Claude splits content blocks. |
| `external_turn_id` | Codex rows (turn-scoped events only — skipped on system/rate_limit rows) | Native Codex UUIDv7 turn id. Emitted on every turn-scoped v2 notification (`params.turnId` or `params.turn.id`). Participates in the unique key as a defensive scope. Redundant for v2 (item ids are globally unique already), useful for legacy-format or rollout-file ingestion. |
| `external_tool_call_id` | `tool_call` and `tool_result` rows | Links a call to its result. Claude: `toolu_xxx` / `tool_use_id`. Codex: `item.id` or `call_id`. |
| `external_parent_tool_call_id` | Claude sub-agent rows | Ancestry, used when rendering sub-agent nesting. |
| `source_part_index` | Always, default 0 | Position in the source wire event when one wire line produced multiple rows (Claude rare multi-block case). |

**The derivation rule.** The adapter populates these fields deterministically from the provider event. Same wire event → same column values every time. That's what makes upsert idempotent within a session: re-reading the same input produces the same rows, and the unique constraint turns replays into no-ops. Each session uses one ingestion path only (see Reconciling section), so there's no cross-path collision to worry about.

**`source_part_index` in practice.** In real data, 99.95% of rows have `source_part_index = 0`. Only Claude's rare multi-block JSONL entries (text + tool_use baked into one line) produce multiple rows sharing an `external_event_id`; those get `source_part_index` 0, 1, … to disambiguate. The column is cheap and makes the schema honest about splits rather than hiding them in a synthesized string.

### Ordering

Events sort by `ORDER BY created_at ASC, id ASC`. `created_at` comes from the provider's timestamp for CLI-backed rows and from `now()` for in-app writes — monotonic within a session in practice. `id` is UUIDv7 (time-ordered), so same-millisecond ties resolve by the v7 counter. No explicit sequence column needed.

### Write paths

Two writer pairings, depending on who spawned the session:

- **App-spawned sessions (the agentex case):** stdio events are the *primary* writer — agentex emits a StreamEvent for every atomic thing; we parse, upsert, update the UI live. A *secondary* reconciler reads the on-disk transcript when drift is detected (server crashed mid-turn, stdio missed an event, laptop slept). The two paths dedup at the DB level:
  - **Claude:** the wire `uuid` lands in `external_event_id`; the partial unique index makes re-inserts no-ops. Reconcile can safely run even mid-turn.
  - **Codex:** rollout entries have no stable id, so reconcile defers entirely while the executor's `isRunning` flag is set. The two paths never interleave for the same session.
- **Externally-spawned sessions** (user ran `claude -r {id}` in their terminal, cron ran `codex exec`, etc.): the on-disk transcript is the sole writer. File-sync reads it incrementally. stdio is never attempted.

Idempotency within a path is guaranteed by the unique constraint — re-reading the same stdio stream or re-parsing the same file section produces `ON CONFLICT DO NOTHING`. The original correlation hazard (Codex rollout entries lack ids that would match stdio's) is sidestepped by Codex's run-time deferral, not eliminated.

### Event mapping by event type

| source | role | Typical columns populated | Where it comes from |
|---|---|---|---|
| `user` | user | content | User sends a message (in-app or provider user event) |
| `agent` | assistant | content, external_message_id (Claude) | Assistant text |
| `thinking` | assistant | content (or placeholder), external_message_id (Claude) | Claude thinking blocks, Codex reasoning items |
| `tool_call` | assistant | tool_name, tool_input, external_tool_call_id | Claude tool_use block, Codex item.started for tools |
| `tool_result` | tool | content, tool_is_error, tool_exit_code (Codex), external_tool_call_id | Tool returning |
| `system` | system | content, raw | session_meta, init markers |
| `result` | system | raw carries full ExecutionResult | turn.completed / run completion |
| `background_task` | system | content (summary), tool_is_error, raw | Detached subagent or process completion |
| `rate_limit` | system | content (summary), raw | token_count / rate_limit events |
| `error` | system | content (error message), raw | API or harness errors |
| `recap` | system | content (summary text), raw | Claude Code `away_summary` (idle-timer recap) |
| `unknown` | system | raw only | Forward-compat for new provider event types |

### Full-text search (transcripts)

Transcripts are searchable by content — principle §3 ("transcripts are the record") extended to retrieval, so you can find "the chat where we discussed X" including imported Claude/Codex history. A regular FTS5 table `chat_events_fts` (in `EXTRA_SQL`, alongside `tasks_fts`/`notes_fts`/`stream_fts`) indexes the **message-bearing** events only: `content` where `source IN ('user','agent')`. Tool calls/results, thinking, and system plumbing are excluded on purpose, so a keyword like "auth" surfaces conversations, not tool-output noise.

- **Index maintenance** is trigger-driven (insert/update/delete on `chat_events`). It's a *regular* fts5 table, not a `content='chat_events'` external-content one: because indexing is conditional (only user/agent rows), the delete trigger drops by `rowid` unconditionally — a no-op for never-indexed rows — so the index can't drift. `session_id`/`event_id` ride along `UNINDEXED`, so a hit carries enough to group-by-session and deep-link without joining back to `chat_events`.
- **Backfill** is a one-shot idempotent `INSERT … WHERE NOT EXISTS (SELECT 1 FROM chat_events_fts)` in `EXTRA_SQL`. Existing + imported history becomes searchable the first time the index is created (i.e. the next server start after this ships, when `getDb()` re-runs `EXTRA_SQL`), and it never re-runs after that.
- **Query** — `searchChatSessions()` (queries.ts) scans the index, groups event hits to one result per session keeping the best-ranked hit's snippet, then hydrates via the `listHistorySessions` join. Scoped to `type='execution'` chats (native + imported); searches active + archived by default; filters by status/workspace/source. `snippet()` wraps matched terms in the control-char sentinels from `@/lib/search/highlight`.
- **Surfaces** — the always-visible rail search box (`RailTabs` → `SessionSearchResults`), the `GET /api/sessions/search` endpoint, and the orchestrator `search_sessions` action (which strips the highlight sentinels for plain-text tool output). Deliberately **not** in the ⌘K palette, to keep that launcher high-precision.
- **Reserved / deferred** — a `tool_summary` FTS column exists but is empty; indexing tool-call names/args is an additive follow-up needing no reindex of message rows. Semantic/vector search over chats is likewise deferred (FTS-only today; the entity search stack already degrades to FTS-only without an OpenAI key). Orchestration and content chats aren't searched yet — the surface is the execution rail.

### Attachments (multimodal content)

Chat reuses the **same generic attachment system** that tasks, notes, and areas use — files live on disk under `<brain>/attachments/<file_name>` and are referenced by an `Attachment[]` JSON column on the owning entity. No separate `chat_attachments` table.

**Where attachments live:**

- On `chat_events.attachments` — a JSON column of `Attachment[]`. Each user message can carry N attachments (pastes, drops, paperclip-picked files).
- On disk — `<brain>/attachments/<uuidv7>.<ext>`. Filename is content-stable; original_name is preserved in the JSON record.

**The `Attachment` shape** (defined in `src/lib/db/schema.ts`):

```ts
interface Attachment {
  file_name:     string;  // <uuidv7>.<ext>, the on-disk filename
  original_name: string;  // user-facing display name
  mime_type:     string;  // canonical, normalized
  size:          number;  // bytes
  uploaded_at:   string;  // ISO timestamp
}
```

**The upload flow:**

1. Editor's paste/drop/paperclip handler → `POST /api/attachments` (multipart) → server writes bytes, returns `Attachment` record.
2. Editor inserts a `FileChip` Tiptap node at the cursor with the returned attrs. Body text gets a `[[file:<file_name>]]` marker at that position (compact, position-preserving, doesn't bloat events polls).
3. On send → `POST /api/sessions/:id/messages` with `{ content, attachments: Attachment[] }`. Server persists the event row with `content` carrying markers and `attachments` carrying the JSON array.
4. Transcript renderer parses markers via `parseFileMarkers`, resolves each to its `Attachment`, renders inline chips (image thumb / expandable text / download button) via `MessageFileChip`.

**Sending to the model.**

For execution chat (Claude Code subprocess via agentex), `expandMarkers` substitutes each `[[file:<file_name>]]` with:

- The absolute disk path if Claude Code's Read tool handles the mime natively (text, code, images, PDF).
- An inline `<attachment filename="...">…</attachment>` block carrying extracted text otherwise (docx, xlsx, pptx via mammoth/`xlsx`/officeparser; audio via STT through `pickProvider`).

For orchestrator chat (Anthropic/OpenAI via ai-sdk), `inlineTextAttachments` rewrites file parts:

- Text/code/json/svg → inlined as `<attachment>` tags.
- docx/xlsx/pptx → extracted to text via the same extractor.
- Audio → STT transcript, tagged `kind="audio-transcript"`.
- Images → server-side normalized via `sharp` (HEIC→JPEG, downscale to Anthropic's 5 MiB/8000px caps), then base64-inlined.
- PDFs → base64-inlined for Anthropic (native PDF support); text-extracted via `unpdf` for OpenAI (which doesn't accept PDF parts).

A 200k-char cap applies to every extraction so a single large document can't blow the context window.

**Why unified with tasks/notes.** Same `Attachment` shape, same `POST /api/attachments`, same `GET /api/attachments/:file_name` serve route, same orphan-cleanup story. Future media types fit the same `mime_type` field without a schema migration.

### The two reset affordances

**Undo last turn.** A subtle affordance after each agent turn. Drops the last turn pair from the active session. Keeps context, keeps the session row. Use: agent went down the wrong path, I want to rewind one step.

**`+` (new topic).** Archives the current session, creates a new active one in the same context with app-default routing. New transcript. Use: we're done with this line of thought, start fresh but keep our relationship.

These solve two different needs: rewind one step, or reset a topic. Both preserve the ongoing relationship; the difference is scope.

### Notifications (separate surface, not a thread)

Background/scheduled/agent-initiated activity never writes into an active chat thread. That's openclaw's main UX wart — cron jobs pollute the session you were in, and when you return your thread is clunky.

We deliberately avoid the word "inbox." Inbox connotes email — a productivity junk drawer that people learn to dread. What we want is the notification pattern: things happened while you weren't watching, here they are, triage them and move on.

**Shape, sketched — not final.** Notifications live in their own table, distinct from `chat_events`. Many upstream sources feed it (agents, crons, executors, subagents, future integrations), and we don't know all of them yet, so the schema wants to be flexible without being a junk drawer itself:

```
notifications
  id
  user_id
  source_kind          // "executor_completion" | "cron" | "agent_observation" | "subagent_question" | ...
  source_ref           // opaque pointer back to the producer (session id, cron id, task id, etc.)
  title                // short human-readable headline
  body                 // longer description or structured payload
  refs                 // { task_ids?: [], note_ids?: [], session_ids?: [] }
  status               // "unread" | "read" | "dismissed" | "promoted"
  promoted_to          // if promoted to a thread, which session_id + message_id
  created_at
  read_at
  dismissed_at
```

`source_kind` is a text column with an app-level enum so new producer types don't need migrations. The shape above is a starting sketch; we'll revisit closer to implementation when we know which producers and triage actions actually matter.

Each notification is triageable: dismiss, act on it, or promote its content into one of the active threads (promotion writes a small reference-style message into the target thread with `refs.notification_id` back-linking, not a wholesale merge).

The routing rule: **did the user ask for this in an active thread they're currently engaged with?** → result surfaces in that thread. Otherwise → notifications. Err toward notifications when unsure; thread pollution is worse than an extra card.

### Execution sessions (CLI as source of truth)

In-app sessions (orchestration, content chat) are authoritative in our DB. We own their transcript.

Execution sessions — CLI-backed work runs via agentex (Claude Code, Codex, others) — are different. The CLI already maintains its own transcript — Claude Code writes JSONL files at `~/.claude/projects/{escaped-cwd}/{session-id}.jsonl`. That file is what the agent actually saw on its next turn. If we try to maintain a parallel authoritative record in our DB, they will drift, and the drift will always be in the direction of our UI lying about the agent's state.

**So we flip the authority.** For execution sessions, the CLI transcript is the source of truth; `chat_events` is a projection.

The runtime flow, for an app-spawned session:

1. **We persist the user message ourselves** on the write path *before* calling agentex. Agentex deliberately skips `userMessage` events from the stream (both Claude session mode and Codex v2 item/completed with `type: "userMessage"`), so the stream echo is not our source of truth — our write is.
2. User sends → we call into agentex; for continuing sessions we pass the external session id to resume.
3. agentex pipes stdio events back — assistant text, thinking, tool calls, tool results, completion.
4. We parse events as they arrive, write to `chat_events` (idempotent on the compound unique), update the UI live.

The CLI also writes the same events to its JSONL/rollout file on disk. The reconciler reads that file on cold start (sweep) and on session open (lazy) and replays any events stdio missed through the same `insertChatEvent` chokepoint. See `docs/realtime.md` for the cursor model and per-provider dedup story.

For **externally-spawned** sessions the user imports into the app, there is no stdio writer. Agentex discovers and normalizes provider-owned history. Claude and Codex use file-backed `localHistory`. OpenCode uses service-backed `savedHistory`. Flow stages the normalized events, writes them to `chat_events`, and records source state in `external_session_imports`.

UI renders from `chat_events` throughout — the source of the rows is invisible to the UI layer.

**What happens on rollover.** Any of these triggers a new CLI session: prior session file is gone, prior session failed to resume, user hit `+`, machine changed. In all cases:

1. We generate a handoff message describing the prior context (recent conversation, relevant tasks/notes, outstanding questions) — this is a real row in `chat_events` with `source: "system"` and distinct rendering
2. We invoke the CLI fresh with the handoff as the first user-visible content
3. New CLI session id populates `external_session_id` on the same `chat_session`
4. UI shows a visible divider — same thread, new CLI state underneath, honest about the rollover

> **TODO (revisit closer to implementation):** how the handoff message is actually *produced* — LLM summarization call vs. structured template over recent turns + refs vs. hybrid. This is its own design problem (scope, cost, latency, failure modes) and we should chat about it when we start building the rollover path, not now. The rest of the rollover mechanics don't depend on the choice.

**What happens cross-device.** CLI transcripts are local to a machine. If the user opens the UI on a second device, our DB mirror has all prior messages (they were synced before), but the CLI session file isn't on the new machine. Attempting to resume fails → rollover path runs → handoff message is generated → new CLI session on the new machine. The user's first message on the new machine lands in a fresh CLI session with carried context. They see the rollover happen.

**What happens if both the UI and a terminal try to write to the same CLI session concurrently.** Don't allow it. A per-`external_session_id` lock on our side serializes UI invocations. If the user is actively using the terminal, our UI shows "active elsewhere — waiting" rather than interleaving. Correct behavior is more important than parallel convenience here.

**The adapter layer is built on Agentex.** We use [`@agentex/agent`](https://www.npmjs.com/package/@agentex/agent) for app-spawned sessions and imported provider history. Flow translates normalized Agentex events into `chat_events`, manages live rollovers, and owns historical import persistence. Provider file formats, OpenCode service calls, stable event identity, fingerprints, and checkpoints stay in Agentex.

Adapter responsibilities (on top of agentex):

- `startSession(cwd, initialMessage) → { external_session_id, external_transcript_path, events }` — **app-spawned path.** Spawn via agentex; return the session id, observed transcript path (stored for reference, not read), and the stdio event stream.
- `sendMessage(external_session_id, message) → events` — **app-spawned path.** Continue a running session via agentex stdio; returns an event stream. Fails if session is gone (triggers rollover).
- `discoverExternalAgentSessions() → ExternalAgentDiscovery` discovers provider-neutral candidates through Agentex and joins them with the Flow import ledger.
- `importExternalAgentSessions(sessionKeys) → ExternalAgentImportResult` imports new candidates and explicitly synchronizes already imported candidates.
- `refreshExternalAgentSessions(chatSessionIds) → ExternalAgentImportResult` resolves ledger rows by Flow chat ID and runs the same trusted synchronization path.
- `parseStreamEvent(event) → chat_event | null` — maps agentex StreamEvents to `chat_events` rows (app-spawned path).
- Agentex `localHistory.read()` and `savedHistory.read()` normalize imported history. Flow has no provider-specific file parser.

v1 ships one adapter: Claude Code. Codex is the next adapter and its spec is documented below so we know the interface survives it. In-app sessions (orchestration, content) skip the adapter layer entirely — those are direct API calls whose events we write to `chat_events` directly.

**Where events get written: keep the seam clean (`EventWriter`).** The adapter doesn't call `insertChatEvent` directly. It takes an `EventWriter` interface (`write(event): Promise<void>`) and routes all `chat_events` writes through it. v1 has one implementation — a one-liner that calls `insertChatEvent` — so behavior is identical to writing inline. The reason for the parameter is forward-compatibility with cross-machine execution: when a laptop runs an executor as a client of a canonical server (see `docs/workspaces-spec.md` §"Deferred: cross-machine execution"), the same adapter swaps in an `HttpEventWriter` that POSTs events to the canonical API. Same parsing, same error handling, different write path. Cost today is ~10 lines; cost of retrofitting later is rewriting the adapter's inner loop, so we pay it now.

**Streaming granularity is block-level, not token-level in v1.** Agentex emits a complete assistant StreamEvent when a message block finishes; it currently drops Codex's `item/agentMessage/delta` notifications. The UX is "agent starts thinking → brief pause → full response appears" rather than typewriter-style word-by-word. For a task-oriented product this is fine. If we later want typewriter UX, agentex adds a `delta` StreamEvent variant and we add handling; not a schema change. Documented so expectations are set.

### The Claude Code adapter, concretely

This is the v1 adapter. Everything here is verified by inspecting real transcripts in `~/.claude/projects/`.

**File layout:**

```
~/.claude/projects/
└── {cwd.replace('/', '-')}/         e.g. -Users-treyhuffine-dynamism-ai-task-manager
    ├── {session-id}.jsonl           main transcript (append-only)
    └── {session-id}/
        └── subagents/
            ├── agent-{id}.jsonl     each subagent is its own file
            └── agent-{id}.meta.json { "agentType": "Explore" }
```

For live Claude sessions, the observed path can be retained with the live binding. Historical import does not derive this path in Flow. Agentex owns Claude home resolution, path discovery, and transcript normalization. Flow stores the trusted server-side source path and fingerprints in `external_session_imports`.

**Entry shape (JSONL, one event per line):**

Every chat entry carries:

- `uuid` — stable, never reused → our `external_event_id` for rows derived from this entry
- `message.id` — the logical message id (msg_XXX), populated on assistant entries only (~22% of rows in real transcripts) → our `external_message_id` for those rows
- `parentUuid` — linked-list ordering; null for the first entry
- `sessionId` — matches the filename
- `timestamp` — ISO 8601 with ms
- `type` — `"user"` | `"assistant"` for chat; other types for metadata
- `message.role` — `"user"` | `"assistant"`
- `message.content` — string (user) or array of content blocks (assistant); block types are `text`, `thinking`, `tool_use`, `tool_result`
- `cwd`, `version`, `gitBranch`, `userType`, `isSidechain`, `permissionMode` — useful context
- On assistant: `requestId`, `model`, `usage`, `stop_reason`
- On API errors: `error: "authentication_failed"`, `isApiErrorMessage: true`, `model: "<synthetic>"`

**Compaction entries (`isCompactSummary`).** When Claude Code's own context window overflows, it auto-compacts and inserts a pseudo-user message with:

```json
{
  "type": "user",
  "message": { "role": "user", "content": "This session is being continued... Summary: ..." },
  "isCompactSummary": true,
  "isVisibleInTranscriptOnly": true
}
```

The content is a structured summary (primary request, technical concepts, files, errors, pending tasks). The *process* runs in an `agent-acompact-*` subagent file; the *result* lands in the main transcript as this entry. Paired with a nearby `system` entry with `subtype=compact_boundary` that carries `compactMetadata: {trigger, preTokens}` — useful for surfacing "auto-compacted" vs "you ran /compact" in the UI.

**This is a gift — but only for one case.** Claude Code's auto-compaction covers **in-session context overflow only**: when one live CLI session gets long, Claude Code compacts itself and writes the summary back into that session's transcript. We mirror that entry and render it as a divider. No summarizer needed for this case.

Every other rollover case still needs our own handoff summarization:
- `+` reset (user intentionally starting fresh)
- Dead-session resume failure (CLI session expired, file deleted, machine changed)
- Cross-device rollover (new machine has no transcript file)

For those, Claude Code's internal compaction doesn't help us — there is no live session to compact. We generate the handoff ourselves (LLM call or structured template over recent turns + refs, TBD at implementation time), write it as a `source="system"` row, and the new CLI session starts with it as the first user-visible content. `isCompactSummary: true` is a convenient marker for rendering our own handoff entries with the same visual treatment Claude Code uses.

**Recap entries (`away_summary`).** Separate from compaction. When the user has been idle for ~3 minutes, Claude Code emits a chat-visible summary of where things were left off:

```json
{
  "type": "system",
  "subtype": "away_summary",
  "content": "Consolidating device types and cleaning up the repo... (disable recaps in /config)",
  "parentUuid": "<last entry at fire time>",
  "timestamp": "...",
  "isMeta": false
}
```

Verified against 137 real occurrences across this project's transcripts: delay between the last entry and the recap sits in a tight band (p25 183s, median 184s, p75 185s) — it's a fixed idle timer. `parentUuid` points to whatever the last entry was when it fired (most often a `turn_duration` close-of-turn marker, sometimes directly the last assistant message). Multiple recaps can occur per session if the user is idle multiple times; each new recap is triggered independently once idle time passes again.

**Recaps do not replace context.** Unlike `isCompactSummary`, a recap is purely UX — it re-orients the user on return. The next turn's prompt isn't reseeded from it. So we don't need to carry recap text into any rollover handoff; it's a decorative message.

**We store recaps as normal events.** One row, `role="system"`, `source="recap"`, `content` = the summary text, `external_event_id` = entry `uuid`, `created_at` = entry timestamp, `raw` = full entry. Rendered in the chat with distinct styling (subdued, labeled) so the user recognizes it as "CLI-generated, not the agent talking." The file-sync loop picks it up on the next pass like any other entry — no special handling needed beyond the mapping.

**Entry → `chat_events` row(s) mapping:**

Since agentex splits assistant `message.content` arrays into one StreamEvent per block, a single Claude JSONL entry may produce multiple rows (~0.05% of entries in real data). Each row gets `external_event_id = entry.uuid`, shared across splits, disambiguated by `source_part_index`.

| Entry matches | → Rows produced |
|---|---|
| `type=user` + `isCompactSummary=true` | 1 row: `role="system"`, `source="system"`, content is the summary. Rendered as divider + summary panel. |
| `type=user` with text only | 1 row: `role="user"`, `source="user"`, content = user text |
| `type=user` carrying `tool_result` blocks | 1 row per tool_result block: `role="tool"`, `source="tool_result"`, `external_tool_call_id` from `tool_use_id`. No `external_message_id` (Claude user-role entries don't have message.id). |
| `type=assistant` + `isApiErrorMessage=true` | 1 row: `role="assistant"`, `source="error"`, distinct render |
| `type=assistant`, `text` block | row: `role="assistant"`, `source="agent"`, content = text |
| `type=assistant`, `thinking` block | row: `role="assistant"`, `source="thinking"` |
| `type=assistant`, `tool_use` block | row: `role="assistant"`, `source="tool_call"`, `tool_name`, `tool_input`, `external_tool_call_id` from block.id |
| `type=system` + `subtype=away_summary` | 1 row: `role="system"`, `source="recap"`, content = the summary text. Async idle-timer entry (~3 min after last turn); UI renders with distinct recap styling. |
| `type=system` + `subtype=compact_boundary` | 1 row: `role="system"`, `source="system"`, content = `"Conversation compacted"`, `raw` carries `compactMetadata` so UI can show trigger (manual/auto) + preTokens. Paired with the `isCompactSummary` entry above. |
| `type=system` + `subtype=api_error` | 1 row: `role="system"`, `source="error"`, content = the error text |
| `type=system` + `subtype=turn_duration` / `local_command` / `informational` | skip (timing telemetry, CLI command echoes, one-off UI banners) |
| `type=file-history-snapshot` / `last-prompt` / `progress` / `permission-mode` / `attachment` / `queue-operation` / `ai-title` | skip (CLI plumbing, UI state, or session-attribute updates — `ai-title` writes to `chat_sessions.title` instead) |
| Any other unknown `type` | 1 row: `source="unknown"`, full entry in `raw`; do not crash |

`created_at` = parsed `timestamp`. `raw` = the full JSONL entry, preserved verbatim via a tolerant Zod schema with `.passthrough()` so forward-compatible fields survive.

**ID derivation for Claude rows:**
- `external_event_id` = entry's `uuid` (globally unique within session; usable as-is)
- `external_message_id` = `message.id` if present (only on assistant entries); null otherwise
- `external_turn_id` = null (Claude doesn't surface turn scope in JSONL)
- `external_tool_call_id` = block's `id` on tool_use rows; `tool_use_id` on tool_result rows
- `external_parent_tool_call_id` = entry's `parent_tool_use_id` (populated on sub-agent rows)
- `source_part_index` = position within `message.content` when splitting a multi-block entry (0 for the common single-block case)

**Historical-import filtering.** Agentex returns root sessions with meaningful human messages. Nested subagent-only transcripts are not imported as standalone chats.

**Historical-import sync.** Agentex reads and normalizes the file. Flow verifies the previously synchronized SHA-256 prefix, stages bounded normalized events, fingerprints the complete source again, and commits events plus ledger state atomically only if the source stayed stable. Truncation, path movement, changed prefixes, and legacy unverified offsets trigger a full staged replay.

### The Codex adapter, concretely

This is the v-next adapter. Agentex v2 provider ships with `turnId: string | null` on `BaseStreamEventFields`, native UUIDv7 turn scoping, normalized reasoning → `thinking`, and auto-detection of v2 JSON-RPC vs legacy NDJSON wire formats. No upstream blockers. Spec below verified against real `codex app-server` capture.

**Codex has three wire formats — know which one you're reading.**

1. **v2 JSON-RPC** (`codex app-server`) — what agentex uses for session mode. Emits notifications like `{method: "item/completed", params: {item: {id: "msg_abc"}, threadId, turnId}}`. Items have globally unique IDs; every turn-scoped event carries a native UUIDv7 `turnId`.
2. **Legacy NDJSON** (`codex exec --json`) — what agentex uses for one-shot execute mode. Emits lines like `{type: "item.completed", item: {id: "item_0"}}`. Items have turn-local IDs, no `turnId`. Safe because execute mode is one turn per invocation, so `item_N` doesn't collide within a session.
3. **Rollout file** (`~/.codex/sessions/...jsonl`) — what Codex writes to disk as a permanent record. Uses envelope types `session_meta`, `turn_context`, `response_item`, `event_msg`. Message `response_item` entries have no id at all; turn_id lives in `event_msg` payloads.

**Agentex hides #1 and #2** — its auto-detecting parser emits the same `StreamEvent` shape for either. Our code consuming agentex stdio only sees one normalized stream.

**#3 is an Agentex boundary for historical import.** Agentex `localHistory` owns rollout discovery, provider-format parsing, stable source identity, and normalized reads. Flow owns staged persistence, ledger checkpoints, and explicit sync policy. The separate live-session reconciler still handles drift recovery for app-spawned sessions.

**File layout:**

```
~/.codex/sessions/
└── YYYY/MM/DD/
    └── rollout-{iso-ts-with-dashes}-{session-id}.jsonl

~/.codex/session_index.jsonl     { id, thread_name, updated_at } per session
```

Example filename: `rollout-2026-04-21T10-38-27-019db0e8-4f53-7b82-bc37-2402bc18de21.jsonl`.

**Path is NOT derivable from session id alone.** The filename embeds the ISO creation timestamp and the file is date-sharded. To resolve a path from a session id you'd need the creation timestamp or a glob over `~/.codex/sessions/**/rollout-*-{session-id}.jsonl`. This is exactly why we store `external_transcript_path` as observed truth — for Codex, derivation is a directory scan, not a function. At `startSession` time we either observe where Codex wrote, or use `session_index.jsonl` + the date-sharded structure to find it.

Session ids look like UUIDv7 (`019db0e8-...`) — time-ordered, which happens to match the date-sharded directory layout.

**Envelope structure.** Each line is a JSONL event with a top-level `type` acting as an envelope. Three kinds matter:

- `session_meta` — one header line at the top of the file. Contains session id, cwd, `originator` (`codex-tui`), `cli_version`, `source`, `model_provider`, full `base_instructions` (system prompt), git info.
- `turn_context` — per-turn config (cwd, date, timezone, approval_policy, sandbox_policy, model, personality, effort, user_instructions, truncation_policy). Can change mid-session.
- `response_item` — raw Responses API items: `reasoning`, `message` (role: `developer` | `user` | `assistant`), `function_call`, `function_call_output`.
- `event_msg` — high-level events for UI/telemetry: `task_started`, `user_message`, `agent_message`, `token_count`.

**The same logical event appears twice.** A user turn writes both a `response_item` with role `user` AND an `event_msg` with type `user_message`. Our canonical source is `response_item` (API-level truth); `event_msg` is useful cross-check metadata but we don't mirror it as a separate message.

**Identifying real user input vs injected content.** Codex injects `AGENTS.md` and environment_context as `response_item` messages with role `user` — not actual user input. The `event_msg` envelope discriminates: a message is real user input only if there's a corresponding `event_msg` / `type: user_message` at the same (or very close) timestamp. Adapter uses this correlation to filter out injected content from user-facing messages.

**Reasoning is encrypted.** `response_item` / `type: reasoning` contains `encrypted_content` — we cannot read the content. We mirror the entry as a "thinking…" placeholder with timing and token usage, no expandable body. UI shows a collapsed marker; there's nothing to show when expanded.

**No compaction summary. Silent truncation.** Codex has `turn_context.truncation_policy` (e.g. `{mode: "tokens", limit: 10000}`) that drops oldest messages when limits are hit — no `isCompactSummary`-style entry lands in the transcript. Losing visibility is a problem for our transparency goal. Mitigation: we track `event_msg` / `type: token_count` against `model_context_window` and **proactively trigger our rollover** when approaching the limit — write our own handoff message (as we do for Claude Code rollovers) before Codex silently drops context. This is adapter-specific logic that's not needed for Claude Code.

**Two parse paths, one adapter.** The Codex adapter handles two different event streams through one shared mapper:

- **stdio events** (what agentex emits at runtime, from `codex exec`): `thread.started`, `item.started`, `item.completed` for each atomic piece (`agent_message`, `command_execution`, `function_call`, `reasoning`), `turn.completed`, `turn.failed`, `error`, `token_count`. This is the realtime path.
- **rollout file** at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (what Codex writes to disk): wrapped in `session_meta`, `turn_context`, `response_item`, `event_msg` envelopes. Agentex `localHistory` owns this format for explicit historical import. Flow never parses these envelopes directly.

Both ultimately represent the same items. The adapter normalizes either stream into the same `chat_events` rows.

**ID derivation for Codex rows:**
- `external_event_id` = the item's stable provider ID for live events. For rollout imports, Agentex supplies a deterministic identity derived from the provider session and source position. Flow combines it with `source_part_index` inside the imported chat's unique key.
- `external_message_id` = null (Codex doesn't have a separate "message id" concept — each item is atomic)
- `external_turn_id` = the native UUIDv7 turn id that v2 app-server emits on every turn-scoped notification (`params.turnId` or `params.turn.id`). Attached to every turn-scoped row; null on system/rate_limit rows that aren't part of a turn.
- `external_tool_call_id` = the tool item's `id` (or `call_id` for function_calls) on both `tool_call` and `tool_result` rows, linking the pair
- `external_parent_tool_call_id` = null (Codex has no sub-agents)
- `source_part_index` = always 0 (Codex items are atomic; no splitting)

No byte-offset synthesis needed — agentex surfaces `item.id` directly. Older drafts that proposed `{session}:{byte_offset}` were working from the rollout file alone; with agentex, we have real ids.

**Inside the rollout file, user messages appear twice.** A user turn in the rollout file emits both a `response_item` with role `user` AND an `event_msg` with type `user_message`. Our rollout-file parser treats `response_item` as canonical and uses `event_msg` only as cross-check metadata (to discriminate real user input from injected context — see below); we don't mirror the `event_msg` as its own row.

**Identifying real user input vs injected context.** Codex injects `AGENTS.md` and `environment_context` as `response_item` messages with role `user` that aren't actual user input. The `event_msg` / `user_message` envelope discriminates: a message is real user input only when correlated with a `user_message` event at the same (or very close) timestamp. Injected-context messages become `source="system"` rows; real user messages become `source="user"`.

**Reasoning is encrypted.** `reasoning` items carry `encrypted_content` — we can't read the body. Mirror as `source="thinking"` with content set to a placeholder; the opaque body lives in `raw` for future expansion if Codex ever ships a way to decrypt.

**No compaction summary. Silent truncation.** Codex has `turn_context.truncation_policy` that silently drops oldest messages when limits are hit — no equivalent of Claude's `isCompactSummary` lands in the transcript. Losing visibility violates the "UI never lies" principle. Mitigation: track `event_msg` / `token_count` against `model_context_window` and **proactively trigger our rollover** when approaching the limit, writing our own handoff message (as on Claude Code rollovers) before Codex drops context. Codex-specific adapter behavior.

**Event → `chat_events` row(s) mapping:**

| Event matches | → Row produced |
|---|---|
| stdio `thread.started` / rollout `session_meta` | 1 row: `role="system"`, `source="system"`, tagged as session-start; contains base_instructions, git, cwd |
| rollout `turn_context` | skip by default; surface separately if user wants to see config changes |
| stdio `item.started` (type=`command_execution` / `function_call`) | 1 row: `role="assistant"`, `source="tool_call"`, `tool_name`, `tool_input`, `external_tool_call_id` = item.id (or call_id for function_calls) |
| stdio `item.completed` (type=`command_execution` / `function_call`) | 1 row: `role="tool"`, `source="tool_result"`, `tool_is_error`, `tool_exit_code` (command_execution only), `external_tool_call_id` matches |
| stdio `item.completed` (type=`agent_message`) | 1 row: `role="assistant"`, `source="agent"`, content = text |
| stdio / rollout `reasoning` | 1 row: `role="assistant"`, `source="thinking"`, content = placeholder |
| rollout `response_item` role `developer` (permissions/skills instructions) | skip (Codex-internal, not user-meaningful) |
| rollout `response_item` role `user` + matching `user_message` | 1 row: `role="user"`, `source="user"` |
| rollout `response_item` role `user` without matching `user_message` | 1 row: `role="system"`, `source="system"` (injected AGENTS.md / env context) |
| stdio `turn.completed` / rollout `turn.completed` | 1 row: `source="result"`, raw carries the `ExecutionResult`-equivalent |
| stdio / rollout `turn.failed` / `error` | 1 row: `source="error"`, content = error message |
| stdio / rollout `event_msg` / `token_count` | either a rate_limit row (when rate_limits surface) or skipped (just telemetry) |
| Any unknown `type` | 1 row: `source="unknown"`, raw preserved; do not crash |

`created_at` = parsed `timestamp`. `raw` = the full event payload. Content fields are extracted into typed columns (`content`, `tool_name`, `tool_input`, `tool_is_error`, `tool_exit_code`) — no nested JSON in `content`.

**Session discovery.** Agentex `localHistory` owns the date-sharded walk, indexes, eligibility filtering, and metadata fallbacks. Flow asks Agentex only when the explicit import surface or sync path needs a trusted catalog.

**Reliability verdict:** append-only, ISO timestamps, clear event types, `cli_version` for forward-compat detection. Weaker than Claude in two ways: no compaction summary (we proactively rollover), no message-level grouping (but the atomic-items design means we don't need it). Stronger in one way: exit codes surface for `command_execution`. Proactive rollover is the only meaningful Codex-specific behavior beyond mapping; everything else is event translation.

### Reconciling chats that happen outside the app

Users can create agent sessions outside Flow. These sessions are not visible to Agentex live events because Flow did not spawn them. Explicit historical import discovers them through Agentex. Claude and Codex are file-backed. OpenCode is service-backed.

Writer pairings by spawn origin:

- **App-spawned sessions (the default):** stdio via agentex is the primary writer; a transcript reconciler is the secondary writer that fills events stdio missed (crash mid-turn, missed stream event). Per-provider dedup keeps this safe — see Write paths above and `docs/realtime.md`.
- **Externally-spawned sessions that the user imports into Flow:** provider-owned history is the sole source. Flow never starts a live writer for them.

The original cross-ingest concern was that stdio and rollout-file identifiers don't always match (Codex rollout `response_item` entries have no `id`). That's why Codex reconcile defers while `isRunning` instead of trying to dedup — the two paths never write the same session concurrently, so there's nothing to correlate. Claude's wire `uuid` does match between stdio and disk, so its two paths can run concurrently and the partial unique index drops the dupes.

**Synchronization triggers:**

- **Imported historical chats:** explicit Sync or Retry in Settings, bulk synchronization from the same panel, or an explicit call to the refresh API. There is no startup, on-open, or periodic imported-history sync in this pass.
- **App-spawned live sessions:** the existing live-session startup and on-open reconciler remains independent. It uses live binding fields on `chat_sessions`, not `external_session_imports`.

**What this does not try to do:**

- **Auto-import orphan sessions.** Discovery may show eligible saved sessions in Settings, but persistence always requires an explicit user selection.
- **Cross-device file sync.** Transcript files are local to the machine that ran the CLI. If the user chats on their laptop terminal and opens our app on a desktop, the desktop can't see the laptop's file. The rollover path handles this honestly: resume fails → handoff summary → fresh CLI session on the new machine.
- **Hooks-based sync.** Claude Code has a hook system that could fire on message events. Possibly useful later, but it means asking users to install config into their CLI. stdio + file-sync covers the needs without that.

**The imported-history integrity invariant:** `(session_id, external_event_id, source_part_index)` makes replay idempotent. File sync verifies the prior prefix and a stable before-and-after fingerprint. Service sync uses an opaque provider checkpoint. Any required replacement is staged before old external rows are deleted, and same-source sync requests are serialized so a stale request cannot roll the transcript or checkpoint backward.

## UX rules

- **Orchestration thread follows you.** Main view → you see the orchestrator's main thread. No picker, no list.
- **Content chat lives with its content.** Opening a task or note shows the content chat for that item (or an empty pane if none exists yet; first message creates it). It doesn't write to the main thread. It's its own session, chronologically whole.
- **Execution sessions are entered, not browsed.** You get into an execution via (a) dispatching a new one (intentional act, from anywhere), (b) a notification (work happened / needs you), or (c) cross-references from a task/note that touched it. No list view of past executions.
- **Agents are the only navigable chat entities.** A small agents list (maybe 2–8 agents, not hundreds) replaces what would have been a thread list. Clicking an agent opens the agent's current context — for the orchestrator that's your main/content chat; for an executor it's the new-execution or recent-execution view.
- **When a task or note chat is first opened, the pane is empty.** That's fine. The agent still knows you — retrieval spans all transcripts. First message starts the content chat.
- **Full transcripts. No collapsed exchanges. No summarized past.** Orientation markers are OK. Collapsed tool-call detail is OK. Hidden messages are not.
- **CLI rollovers are visible.** When an execution's CLI session rotates (died, expired, machine changed, user hit `+`), the transcript shows a divider and the handoff message. Never a silent continuation claiming state the agent doesn't have.

## In-document content chat (implementation)

The content chat is realized as a **focused harness session**, not a bespoke per-page
agent. It reuses the orchestrator's surface end to end:

- **Session.** A `chat_sessions` row with `type='content'`, scoped to the entity via
  `surface_kind` (`'task' | 'note'`) + `surface_ref` (the entity id). `GET
  /api/document-chat?entityType=&entityId=` ensures one (persistent per entity — reopening
  the doc resumes the same thread); `POST` archives it and starts fresh (the "New chat"
  affordance). Messages send + stream through the shared `/api/sessions/[id]/messages` and
  `/api/sessions/[id]/stream` transport — identical to executions and orchestration — and
  the slideout renders the same `HarnessChatSession` surface (transcript + composer).
- **Agent surface.** `ensureAgentSession` treats `content` like `orchestration`: it
  installs the orchestrator brief + tool set at the app data root (MCP in `harness_mcp`,
  CLI in `harness_skills`). **No new tools** — the agent edits the focused entity with the
  existing `get_/update_task|note` actions. A per-session **focus directive**
  (`renderContentFocusPrompt`, delivered via Claude's `--append-system-prompt` so it never
  shows in the transcript) pins it to the one entity and tells it to act decisively, since
  the human reviews via diff/undo rather than approving each edit. Content sessions default
  to `permissionMode='bypass'`.
- **Provider-agnostic, subscription-only.** Runs on whatever harness the user has
  configured (Claude or Codex subscription today; future local/free agents are just more
  providers). The old direct-to-OpenAI copilot path is gone — there's no API-key fallback,
  and because edits now flow through the orchestrator MCP they go through `queries.ts`
  (embeddings, mirror, attachment derivation, versioning) instead of bypassing it.

### Change versioning, diff & undo

Every content change to a task/note is snapshotted into `entity_versions` — an append-only
history (`entity_type`, `entity_id`, `snapshot` JSON, `source` `human|ai|system`,
`actor_session_id`, `created_at`). Capture lives inside `updateTask`/`updateNote` so all
three write paths (UI, agent MCP, CLI) are tracked through one place. It's lazy (the first
edit seeds a baseline from the pre-edit state so the first diff has a "before") and skips
no-op bumps (sortKey, lastViewedAt) via a structural snapshot comparison. UI edits are
`human`; agent edits via the orchestrator actions are tagged `ai`.

That backs a reviewable, reversible loop for "the AI changed it — assume it's right, but
let me check":

- The agent's `update_task`/`update_note` tool calls render an **"Edited · view changes"**
  chip in the transcript (`EntityEditChip`, detected by `parseEntityEditTool` in
  `execution-event.tsx`).
- The chip opens `EntityDiffModal` — a unified diff of the change against the prior version
  (reusing `lineDiff` / `DiffLines` from the execution transcript) plus changed-property
  rows, with prev/next navigation through the history.
- **Undo** (`POST /api/entity-versions/[id]/revert` → `revertEntityTo`) restores the prior
  snapshot through the normal update path, so the revert is itself recorded as a new
  `system` version and is undoable in turn. Same model as the proactive deck's revert.

## What we explicitly did not build

- **A sessions dropdown or sidebar.** Openclaw has one; it works for a developer tool, not for this. Agents + surfaces + notifications + cross-references replace it.
- **A list view of past executions.** Even though executions are discrete artifacts worth reviewing, we don't surface them as a browsable list. Entry is via notifications, search, or cross-reference from the task/note they touched. The transcripts are the record; retrieval gets you to them.
- **Auto-titled conversations.** Labels come from context (agent name, task title, scope for executions) — not from LLM-summarizing the first message. Auto-titles are noisy and organizational-feeling.
- **A global merged thread.** Users asked for "everything the agent and I ever said." We chose not to — it breaks chronology when combined with the three-type model, and retrieval handles the real use case ("what did we decide about X?") better than scrolling.
- **Filtered views of a thread.** Considered; rejected because it breaks chronological coherence. Either show the whole thread or show a different thread.
- **Branching / edit-and-regenerate.** ChatGPT lets you edit a past user message and regenerate from there, forking the thread. Not supported in v1. Claude Code has a rewind pattern worth studying — investigate before we commit to a position.
- **Scratch mode.** Earlier drafts proposed an ephemeral, never-persisted mode. Dropped — couldn't name a concrete use case that `+` + delete doesn't already cover.
- **Inactivity-based auto-session-rotation.** Sessions persist until the user archives them. No day boundaries. No idle timeouts. Coming back after a week should feel like picking up where you left off.
- **A DB UNIQUE partition constraint.** Earlier drafts had `UNIQUE (user, agent, surface_kind, surface_ref) WHERE active` to "enforce one thread per context." Removed — it was encoding a convention as a rule. Multiple concurrent sessions in any partition is fine; app defaults handle the common case.
- **Compaction checkpoints as a v1 feature.** Openclaw has them; useful for developers who want to branch from a past state. We don't need them until we hit real context pressure with real users. Add when needed.
- **Multi-surface routing beyond task/note/main for v1.** Slack, Discord, email integrations — the schema supports them (add a new `surface_kind`), but none are built in v1.
- **A cached `alive` flag on CLI sessions.** Liveness is a runtime property. Caching it means the DB can claim "alive" when the transcript file has been deleted, or "dead" when the user just reopened the app. We ask the CLI at the moment we need to know.
- **`continued_from_session_id` lineage links between DB sessions.** Considered for tracking "new DB session replacing a dead one," rejected because `external_session_id` is mutable on the same row — the DB session persists across CLI rollovers. One DB session = one continuing conversation; divider messages record the rollovers within it.
- **Using only file size for imported-history change detection.** Rejected after integrity review. Historical file sync stores a SHA-256 fingerprint and verifies the previously synchronized prefix before accepting growth as append-only. It also compares size, nanosecond mtime, and full hash before and after a staged read. Live-session reconciliation can still use cheaper probes for its separate path.
- **Our own summarizer for Claude Code's *in-session* compaction.** Claude Code auto-compacts when context overflows and writes the summary into the transcript as an `isCompactSummary: true` entry. We mirror that; we don't duplicate the work *for this case*. We **do** need our own handoff summarizer for `+`, dead-session, and cross-device rollovers — see the rollover section.

## The tradeoffs we are accepting

- **The three types don't share a transcript.** Orchestration chat, content chat on task X, and an execution that worked on task X are three separate sessions with three separate transcripts. Retrieval connects them when the user asks cross-cutting questions; they're not co-located in one view. This is the deliberate tradeoff for scoping context appropriately per type.
- **Each content-chat on a task accumulates a session.** Not a graveyard because sessions aren't listed, but the database grows. Cheap; worth it.
- **Executions fragment by design.** Many short-to-medium executions rather than one long-running one. This matches how coding agents actually get used — fresh context per job — but means "what has Claude been up to lately?" requires search/notifications, not a thread to scroll.
- **Notifications need discipline.** If cron jobs fire every 5 minutes and each writes a card, notifications become a new graveyard. Solution: batched cards, auto-dismiss for benign results, grouping by source. Out of scope for first cut; keep an eye on it.
- **The model sees less context per turn than a "one omniscient thread" design.** Retrieval has to work well to compensate. This is the main thing to watch during real usage.

## Open questions to revisit with real usage

- **Should opening a task auto-surface recent executions that touched it?** Probably yes, as a notification-style strip above the content chat pane — informational chips linking to the execution sessions, not part of the thread itself.
- **Should `+` require confirmation?** Users might hit it accidentally and fear they lost something. Probably add a tiny "undo" toast for the first 30 seconds post-archive.
- **When the orchestrator dispatches a subagent mid-conversation, does the subagent get a real `agents` row or is it ephemeral?** V1: ephemeral, merged back into the dispatching session on completion. If users want to "join" in-flight subagents, promote to real agent rows later.
- **Per-session cwd override.** Not built in v1 (one executor = one project). If users ask to span multiple projects with one executor, add a `cwd` field on `chat_sessions` that overrides `agents.config.cwd`.
- **Multi-device agent config.** A `device_config` JSON keyed by device id on `agents` is probably enough. But: what's "device id" — app install id? Machine hostname? Something the user can name? Deferred; not needed until we actually support multi-device.
- **Codex adapter.** Spec documented (see the Codex adapter section). Unblocked — agentex v2 provider ships with the required fields. Main Codex-specific behavior to implement is proactive rollover on token pressure, since Codex silently truncates instead of writing a compaction summary.
- **Rewind / branching.** Claude Code supports rewind-the-conversation. Worth investigating — what the UX looks like, whether branching or just linear truncation, what it does to retrieval. Don't build until we've seen how Claude handles it and decided if that pattern fits our three-type model.
- **Orphan attachment cleanup.** The unified attachment system shares files on disk with tasks/notes — when a `chat_events` row is deleted or its `attachments` JSON is edited, the bytes on disk aren't swept. Janitor pass not built yet; will accumulate slowly.

## Schema summary

Three tables (plus a notifications table, sketched separately). Attachments live on `chat_events.attachments` as JSON — same `Attachment` shape used everywhere else in the app (tasks/notes/areas). No separate `chat_attachments` table. No `chat_threads`. No per-device partitioning. No lineage links. No cached liveness flags. No partition-key UNIQUE constraints.

```
agents
  id, user_id, kind, name, role, harness, config, status, created_at, archived_at
  -- config is JSON; for CLI-backed agents it includes cwd (device-local for v1)

chat_sessions
  id, user_id, agent_id, type, surface_kind, surface_ref, status, label, refs,
  external_provider_type, external_session_id, external_transcript_path,
  external_sync_offset, external_sync_last_event_id,
  permission_mode, pre_plan_mode, model, effort,
  started_at, archived_at
  UNIQUE (external_provider_type, external_session_id)
    WHERE external_provider_type IS NOT NULL AND external_session_id IS NOT NULL

external_session_imports
  id, chat_session_id, provider_type, external_session_id, source_kind,
  source_path, source_size, source_modified_at_ns, source_content_sha256,
  source_updated_at, sync_offset, sync_last_event_id, history_checkpoint,
  status, last_scanned_at, last_synced_at, last_error,
  created_at, updated_at
  UNIQUE (chat_session_id)
  UNIQUE (provider_type, external_session_id)

chat_events
  id, session_id, role, source, content,
  tool_name, tool_input, tool_is_error, tool_exit_code,
  raw,
  external_event_id, external_message_id, external_turn_id,
  external_tool_call_id, external_parent_tool_call_id,
  source_part_index,
  attachments,  -- JSON: Attachment[], same shape as tasks/notes/areas
  created_at
  UNIQUE (session_id, external_event_id, source_part_index)
    WHERE external_event_id IS NOT NULL
```

Files referenced by `chat_events.attachments` live under `<brain>/attachments/<file_name>` and are served via `GET /api/attachments/:file_name` — the same plumbing tasks/notes/areas use.

`type` on `chat_sessions` discriminates the three kinds: `orchestration`, `content`, `execution`. Behavior varies by type; schema is shared.

`id` columns are UUIDv7 (time-ordered) — sort order via `(created_at, id)` is stable, monotonic within a session, and no sequence column is required.

For in-app sessions (orchestration, content), `external_*` fields are null and our DB is authoritative.

For live execution sessions, `external_provider_type` and `external_session_id` identify the current provider binding, which can rotate on rollover. Historical imports keep their provider-qualified source identity, file fingerprint or service checkpoint, and synchronization status in `external_session_imports`. Agentex owns provider history normalization. Flow owns the read-only projection and explicit sync transaction.

Source uniqueness is provider-qualified for both current live bindings and historical imports. Event replay is idempotent within a Flow chat through the compound external-event unique key. How many sessions exist per user, agent, or surface remains the user's call.

Memory, if it becomes a distinct store, sits next to these tables rather than inside them — explicitly out of scope for this doc.

## The one-line version

Three distinct kinds of chat share a schema but not a UX. App-spawned execution sessions use Agentex live events plus the live reconciler. Explicit historical imports use Agentex `localHistory` for Claude and Codex or `savedHistory` for OpenCode, then Flow stores a read-only projection and synchronization ledger. Cursor remains live execution only. Retrieval runs over `chat_events`, not provider files or services. Source identity is provider-qualified, rollovers stay visible, and the UI does not pretend an imported chat is a writable live provider session.
