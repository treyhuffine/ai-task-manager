# Chat Sessions: Agents, Threads, and How the Conversation Persists

Decision doc for how chat works in this app. Written for future-me and anyone wondering why there's no thread sidebar.

## TL;DR

**There are three distinct kinds of chat, not one model with variants.** Each serves a different purpose and gets the UX that purpose deserves:

1. **Orchestration** — your main thread with the orchestrator. Always-on, in-app, ongoing relationship. One session, chronologically whole. Discover by going to the main surface; never listed.
2. **Content chat** — scoped to a task or note. "Talk to the AI about this piece of content." In-app, API-level interactions with the content. Sessions exist as loose conversations attached to the content they're about.
3. **Execution** — CLI-backed work sessions (Claude Code, Codex, other agentex providers). Discrete jobs with their own scope. Run interactively, autonomously, or on cron. Pull in tasks/notes as context via refs. Report back via notifications. These are the "isolated execution channels" — each one its own context-hungry Claude Code-style thread.

Other principles that hold across all three:

- **Agents are first-class database entities.** Agent = definition (prompt, cwd, harness). Session = an instance of that definition running on something. Same agent definition → many concurrent sessions is fine.
- **Full transcripts always.** No summaries replacing messages. Search/retrieval runs over transcripts; memory is a future index over them, not a precondition.
- **Two resets:** undo last turn, `+` to archive current and start fresh.
- **Background/cron/agent-initiated activity goes to notifications**, not into any active chat. Notifications are the entry point to cron-spawned executions.
- **Source of truth follows execution.** For in-app sessions (orchestration, content) our DB is authoritative. For CLI-backed executor sessions we spawned, agentex's stdio is the sole writer. For CLI-backed sessions the user spawned externally (their terminal, cron), file-sync reading the CLI's on-disk transcript is the sole writer. **Each session belongs to exactly one ingestion path** — no cross-path reconciliation needed, no duplicate risk.
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
  external_transcript_path  // observed path where the CLI wrote the transcript; null for in-app
  external_sync_offset      // bytes read through; for incremental transcript sync; null for in-app
  external_sync_last_event_id   // last external_event_id upserted; defensive check; null for in-app

  UNIQUE (external_session_id) WHERE external_session_id IS NOT NULL
```

**`type` discriminates the three kinds.** Each type has its own behavior:

- `orchestration` — main thread with orchestrator agent. App convention: one active session per user; `+` archives and starts new. `external_*` null. `surface_kind` null or `"main"`.
- `content` — scoped chat about a task or note. `surface_kind` and `surface_ref` point to it. `external_*` null. App convention: one active per `(user, agent, surface)` by default, but not DB-enforced — multiple is fine if the user wants it.
- `execution` — CLI-backed work session. `external_*` populated. Many can be active simultaneously. `surface_kind` is null; the session's connection to content is via `refs`, not partition. `label` carries a human-readable execution title.

**No DB-enforced uniqueness on partition.** The only uniqueness in this table is `external_session_id` (so we don't double-mirror one CLI session). Everything else — how many orchestration sessions, how many content sessions per task, how many concurrent executions of the same agent — is the user's call, with app-level defaults picking sensible behavior (show most-recent-active for a context; `+` to make a new one).

**`external_session_id` is mutable.** One `chat_session` can span multiple CLI sessions over its lifetime — if the CLI session rolls or dies, we update `external_session_id` on the same row and append a visible divider message. One DB session, continuing user-facing conversation, rotating CLI state underneath. That's what keeps the UI honest about what actually happened without fragmenting the user's view of "this execution."

We deliberately do **not** cache an "alive" boolean. Liveness is a runtime question — "can I resume this session right now?" — not a stored fact. We check **on send attempt only**: user hits send, we try `resumeSession`, if it fails we rollover. No background polling.

**`external_transcript_path` stores observed truth, not derived truth.** We could compute the path from `(cwd, external_session_id)` but that makes us dependent on our mental model of the CLI's internal naming, which could drift (escape rules, base dir moves, symlink resolution). For Codex, the path isn't even cleanly derivable — filenames embed the ISO creation timestamp. Storing what the CLI actually wrote makes the file reference robust. Derivation is kept only as a bootstrap fallback for migrations/imports and as a drift sanity check.

**`refs` is session-level.** JSON column with task/note/area ids the session has touched. Maintained as messages reference new things. Used for:
- Surfacing "executions that touched this task" on the task view
- Retrieval anchor points
- Notification routing

Session-level is the right granularity — the primary queries are "what sessions touched X?" and "what did this session touch?" Both answerable from one column. If we ever need "which turn inside a session referenced X," we can add message-level refs later; not needed now.

**Task/note deletion: sessions orphan, don't cascade.** `surface_ref` and `refs` entries are loose references, not foreign keys. When a task is deleted, any session pointing at it stays in the DB; it becomes unreachable through surface navigation but the transcript is preserved (the work may have produced decisions worth retrieving later via search).

**`external_sync_offset` is a performance field** — bytes already mirrored. On any sync trigger we `stat` the file and compare size against this offset. Equal → nothing new; skip. Greater → read new bytes from offset to EOF. `external_sync_last_event_id` is defensive: if the file shrinks or its head changes, we detect mismatch and full-rescan.

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
- `system` — session init, meta
- `result` — run / turn completion (ExecutionResult lives here; full object in `raw`)
- `rate_limit` — throttling signals
- `error` — API or harness errors
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

**Each execution session belongs to exactly one ingestion path**, decided when the session is created. No session is written to by both paths.

- **Sessions we spawn via agentex (the app-initiated case):** stdio events are the sole writer. Agentex emits a StreamEvent for every atomic thing; we parse, upsert, update the UI live.
- **Sessions the user spawned externally (their terminal, cron, etc.) that we import into our app:** the CLI's on-disk transcript is the sole writer. File-sync reads it incrementally.

This split exists because the two wire formats don't always carry the same identifiers (Codex rollout-file message entries, specifically, have no `id` field — so stdio-written rows and file-sync-read entries can't be correlated). Keeping a session on one path removes the correlation problem entirely.

Idempotency within a path is guaranteed by the unique constraint — re-reading the same stdio stream or re-parsing the same file section produces `ON CONFLICT DO NOTHING`. No created_at reconciliation needed because there's only one writer per session.

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
| `rate_limit` | system | content (summary), raw | token_count / rate_limit events |
| `error` | system | content (error message), raw | API or harness errors |
| `unknown` | system | raw only | Forward-compat for new provider event types |

### Attachments (multimodal content)

Providers deliver images, audio, and files as content blocks inside messages — in Anthropic's shape: `{type: "image", source: {type: "base64", media_type: "image/png", data: "<base64>"}}` embedded in the message's content array. One image encoded as base64 is ~4/3 the original byte size; for a modest screenshot that's several hundred KB of text. Storing that inline in `chat_events.content` and duplicating it in `raw` would bloat the DB fast.

Attachments get their own table, referenced by event:

```
chat_attachments
  id                  uuidv7 pk
  event_id            fk → chat_events
  session_id          fk → chat_sessions  (denormalized for per-session queries)
  kind                text   -- "image" | "audio" | "video" | "file"
  mime_type           text
  size_bytes          int
  storage_kind        text   -- "local_file" | "blob" | "external_url"
  file_path           text   -- for local_file (path under the app's attachment dir)
  blob                blob   -- for sqlite-blob storage (small items, fallback)
  url                 text   -- for external_url (CDN, user-provided link)
  content_hash        text   -- sha256 of the bytes; enables dedup when the same image is reused
  created_at          timestamp
```

**Adapter behavior.** When parsing a wire event that carries a media content block, the adapter:

1. Decodes the base64 → writes to local storage (file on disk under the app's attachment directory, or SQLite BLOB for small items)
2. Creates a `chat_attachments` row pointing at the stored bytes
3. In the `chat_events` row: `content` carries any text/caption/transcription if present; `raw` has the base64 stripped (replaced with a reference marker like `{type: "image", attachment_id: "<uuid>"}`) so `raw` stays small and debuggable

For rendering, UI joins events with their attachments. For retrieval, mime_type/size/hash are queryable without scanning base64.

**Why this shape is evolvable.** Audio (voice-to-voice sessions), video, and user-uploaded files all fit the same table with different `kind` values. Vision models that return generated images map through as attachments on assistant events. Future media types that don't yet exist in provider APIs land as `kind="file"` with their mime_type and don't require a schema change.

**Dedup via content_hash.** If a user pastes the same screenshot into three different sessions, we store the bytes once and reference them three times. For local-first with limited disk, this matters more than it would on a server.

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

The CLI also writes the same events to its JSONL/rollout file on disk — that's the CLI's own backup, not something we read for app-spawned sessions.

For **externally-spawned** sessions the user imports into the app (user ran `claude -r {id}` in their terminal, cron ran `codex exec`), we take the opposite path: no stdio, file-sync only. We parse the on-disk transcript and write to `chat_events`. That session's `external_writer` is effectively "file-sync"; stdio is never attempted.

UI renders from `chat_events` throughout — the source of the rows is invisible to the UI layer.

**What happens on rollover.** Any of these triggers a new CLI session: prior session file is gone, prior session failed to resume, user hit `+`, machine changed. In all cases:

1. We generate a handoff message describing the prior context (recent conversation, relevant tasks/notes, outstanding questions) — this is a real row in `chat_events` with `source: "system"` and distinct rendering
2. We invoke the CLI fresh with the handoff as the first user-visible content
3. New CLI session id populates `external_session_id` on the same `chat_session`
4. UI shows a visible divider — same thread, new CLI state underneath, honest about the rollover

> **TODO (revisit closer to implementation):** how the handoff message is actually *produced* — LLM summarization call vs. structured template over recent turns + refs vs. hybrid. This is its own design problem (scope, cost, latency, failure modes) and we should chat about it when we start building the rollover path, not now. The rest of the rollover mechanics don't depend on the choice.

**What happens cross-device.** CLI transcripts are local to a machine. If the user opens the UI on a second device, our DB mirror has all prior messages (they were synced before), but the CLI session file isn't on the new machine. Attempting to resume fails → rollover path runs → handoff message is generated → new CLI session on the new machine. The user's first message on the new machine lands in a fresh CLI session with carried context. They see the rollover happen.

**What happens if both the UI and a terminal try to write to the same CLI session concurrently.** Don't allow it. A per-`external_session_id` lock on our side serializes UI invocations. If the user is actively using the terminal, our UI shows "active elsewhere — waiting" rather than interleaving. Correct behavior is more important than parallel convenience here.

**The adapter layer is built on agentex.** We use [`@agentex/agent`](https://www.npmjs.com/package/@agentex/agent) as the transport for app-spawned sessions — it already provides provider implementations for Claude, Codex, Cursor, Gemini, and others. Our adapter wraps agentex with this app's persistence: translating StreamEvents into `chat_events` rows, handling rollovers, tracking observed transcript paths. For externally-spawned sessions (user imported), our adapter parses the CLI's on-disk transcript directly without agentex involvement. We don't reimplement CLI wrapping for app-spawned; we don't ask agentex to read arbitrary on-disk transcripts.

Adapter responsibilities (on top of agentex):

- `startSession(cwd, initialMessage) → { external_session_id, external_transcript_path, events }` — **app-spawned path.** Spawn via agentex; return the session id, observed transcript path (stored for reference, not read), and the stdio event stream.
- `sendMessage(external_session_id, message) → events` — **app-spawned path.** Continue a running session via agentex stdio; returns an event stream. Fails if session is gone (triggers rollover).
- `importExternalSession(transcript_path) → chat_session` — **externally-spawned path.** User points us at an existing CLI transcript; we create a `chat_session` row marked for file-sync ingestion and do an initial catch-up read.
- `syncTranscript(session) → new chat_events[]` — **externally-spawned path only.** Reads `external_transcript_path` from `external_sync_offset`, parses new entries, idempotent upsert. Used for on-open, startup, and periodic passes on imported sessions.
- `deriveTranscriptPath(agent, external_session_id) → string` — pure function, no I/O; useful for displaying the expected path to users during import and as a sanity check against stored paths.
- `parseStreamEvent(event) → chat_event | null` — maps agentex StreamEvents to `chat_events` rows (app-spawned path).
- `parseFileEntry(raw) → chat_event | null` — maps on-disk transcript entries to `chat_events` rows (externally-imported path). Different input shape from StreamEvents (see Claude/Codex adapter sections for the per-provider mapping tables).

v1 ships one adapter: Claude Code. Codex is the next adapter and its spec is documented below so we know the interface survives it. In-app sessions (orchestration, content) skip the adapter layer entirely — those are direct API calls whose events we write to `chat_events` directly.

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

The cwd escape is trivial: replace every `/` with `-`. Path is derivable from `(cwd, session_id)` — but we still **store** it on `chat_sessions` as observed truth, so our file reference doesn't depend on our model of Claude Code's internal naming staying stable (escape rules, base directory moves, symlink resolution). Derivation is kept as a bootstrap fallback when we're importing a session we didn't spawn and as a drift sanity check against the stored value.

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

**Compaction / recap entries.** When Claude Code's own context window overflows, it auto-compacts and inserts a pseudo-user message with:

```json
{
  "type": "user",
  "message": { "role": "user", "content": "This session is being continued... Summary: ..." },
  "isCompactSummary": true,
  "isVisibleInTranscriptOnly": true
}
```

The content is a structured summary (primary request, technical concepts, files, errors, pending tasks). The *process* runs in an `agent-acompact-*` subagent file; the *result* lands in the main transcript as this entry.

**This is a gift — but only for one case.** Claude Code's auto-compaction covers **in-session context overflow only**: when one live CLI session gets long, Claude Code compacts itself and writes the summary back into that session's transcript. We mirror that entry and render it as a divider. No summarizer needed for this case.

Every other rollover case still needs our own handoff summarization:
- `+` reset (user intentionally starting fresh)
- Dead-session resume failure (CLI session expired, file deleted, machine changed)
- Cross-device rollover (new machine has no transcript file)

For those, Claude Code's internal compaction doesn't help us — there is no live session to compact. We generate the handoff ourselves (LLM call or structured template over recent turns + refs, TBD at implementation time), write it as a `source="system"` row, and the new CLI session starts with it as the first user-visible content. `isCompactSummary: true` is a convenient marker for rendering our own handoff entries with the same visual treatment Claude Code uses.

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
| `type=file-history-snapshot` / `last-prompt` / `system` w/ `subtype=turn_duration` / `progress` / `permission-mode` / `attachment` / `queue-operation` | skip |
| Any other unknown `type` | 1 row: `source="unknown"`, full entry in `raw`; do not crash |

`created_at` = parsed `timestamp`. `raw` = the full JSONL entry, preserved verbatim via a tolerant Zod schema with `.passthrough()` so forward-compatible fields survive.

**ID derivation for Claude rows:**
- `external_event_id` = entry's `uuid` (globally unique within session; usable as-is)
- `external_message_id` = `message.id` if present (only on assistant entries); null otherwise
- `external_turn_id` = null (Claude doesn't surface turn scope in JSONL)
- `external_tool_call_id` = block's `id` on tool_use rows; `tool_use_id` on tool_result rows
- `external_parent_tool_call_id` = entry's `parent_tool_use_id` (populated on sub-agent rows)
- `source_part_index` = position within `message.content` when splitting a multi-block entry (0 for the common single-block case)

**Subagents.** For v1 we mirror subagent entries too (they live in the `subagents/` subdirectory, same JSONL format) but render them collapsed in the main transcript as a single "subagent ran → N steps, summary" node. We have the data; we hide by default for readability. A future version can elevate long-running subagents to real `agents` rows if that pattern emerges.

**Sync loop specifics:**

1. `stat(path).size` → compare to `external_sync_offset`
   - equal → nothing new, done
   - greater → read from offset to EOF as buffer, split on `\n`, parse each line as JSON
   - less → defensive: `external_sync_last_event_id` check; full rescan if the file was truncated
2. For each valid entry: filter, map to one or more `chat_events` rows, upsert with `ON CONFLICT DO NOTHING` (file-sync is the sole writer for externally-imported sessions; re-reading the same bytes is a no-op)
3. Update `external_sync_offset` and `external_sync_last_event_id` atomically after the batch
4. Partial-write handling: a line that fails JSON parse at the end of the buffer is treated as "still being written" — we back off one line and wait for the next event. Don't advance the offset past an unparseable line.

**Reliability verdict:** append-only, stable UUIDs, ISO timestamps, clear type discriminators, a `version` field on every entry for forward-compat detection, and a format that's been stable across months of real usage. The only realistic failure mode is a Claude Code format bump; tolerant parsing plus version-field logging handles that gracefully.

### The Codex adapter, concretely

This is the v-next adapter. Agentex v2 provider ships with `turnId: string | null` on `BaseStreamEventFields`, native UUIDv7 turn scoping, normalized reasoning → `thinking`, and auto-detection of v2 JSON-RPC vs legacy NDJSON wire formats. No upstream blockers. Spec below verified against real `codex app-server` capture.

**Codex has three wire formats — know which one you're reading.**

1. **v2 JSON-RPC** (`codex app-server`) — what agentex uses for session mode. Emits notifications like `{method: "item/completed", params: {item: {id: "msg_abc"}, threadId, turnId}}`. Items have globally unique IDs; every turn-scoped event carries a native UUIDv7 `turnId`.
2. **Legacy NDJSON** (`codex exec --json`) — what agentex uses for one-shot execute mode. Emits lines like `{type: "item.completed", item: {id: "item_0"}}`. Items have turn-local IDs, no `turnId`. Safe because execute mode is one turn per invocation, so `item_N` doesn't collide within a session.
3. **Rollout file** (`~/.codex/sessions/...jsonl`) — what Codex writes to disk as a permanent record. Uses envelope types `session_meta`, `turn_context`, `response_item`, `event_msg`. Message `response_item` entries have no id at all; turn_id lives in `event_msg` payloads.

**Agentex hides #1 and #2** — its auto-detecting parser emits the same `StreamEvent` shape for either. Our code consuming agentex stdio only sees one normalized stream.

**#3 is our problem** — if we want to import externally-spawned Codex sessions (user ran `codex exec` in their terminal), we parse the rollout file ourselves. That's the file-sync path described in the Reconciling section. App-spawned Codex sessions **do not** read the rollout file; stdio is the sole writer. See the Reconciling section for why the split.

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
- **rollout file** at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (what Codex writes to disk): wrapped in `session_meta`, `turn_context`, `response_item`, `event_msg` envelopes. This is the file-sync path, used **only for externally-spawned sessions** the user imports into our app. App-spawned sessions never read this file — see the Reconciling section for why.

Both ultimately represent the same items. The adapter normalizes either stream into the same `chat_events` rows.

**ID derivation for Codex rows:**
- `external_event_id` = the item's `id`. In v2 app-server (what agentex uses for sessions), this is globally unique (`msg_*` / `rs_*` / userMessage UUID). In the rollout file format, message items have no id — the file-sync path synthesizes from byte offset or line number for those. Either way, the compound unique key scopes via `external_turn_id` too.
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

**Session discovery.** Because rollout paths are date-sharded, we don't walk the whole tree at startup. For each `chat_session` with a stored `external_transcript_path` we `stat` directly — O(1) per session. For orphan/import flows, `session_index.jsonl` is a cheap lookup of existing sessions.

**Reliability verdict:** append-only, ISO timestamps, clear event types, `cli_version` for forward-compat detection. Weaker than Claude in two ways: no compaction summary (we proactively rollover), no message-level grouping (but the atomic-items design means we don't need it). Stronger in one way: exit codes surface for `command_execution`. Proactive rollover is the only meaningful Codex-specific behavior beyond mapping; everything else is event translation.

### Reconciling chats that happen outside the app

Users can create CLI sessions outside our app (`claude -r {id}` in a terminal, a cron-spawned `codex exec`, etc.). These sessions aren't visible to agentex stdio because we didn't spawn them. The only way to observe them is to read the CLI's on-disk transcript.

**Each execution session belongs to exactly one ingestion path**, fixed at session creation:

- **App-spawned sessions (the default):** stdio via agentex is the sole writer. We see every event in real time. The CLI's on-disk transcript is Codex's/Claude's own backup — we don't read it for these sessions.
- **Externally-spawned sessions that the user imports into our app:** file-sync reads the on-disk transcript and is the sole writer. We never try to spawn stdio against them.

This split exists because the stdio wire format and the rollout/JSONL on-disk format don't carry the same identifiers in all cases — notably, Codex rollout `response_item` message entries have no `id` at all, while the v2 stdio path has globally unique item IDs. Letting both paths write to the same session would produce duplicates with no way to correlate them. The split avoids the problem entirely.

**Why not cross-ingest as a safety net?** On paper, if agentex stdio crashes mid-session, reading the file could recover lost events. In practice this works cleanly only for Claude (JSONL `uuid` matches between stdio and disk) and not for Codex (format mismatch). Rather than build a provider-specific fallback with asymmetric reliability, we accept that app-spawned sessions rely on stdio's reliability. If that becomes a real problem under load, Claude-specific recovery is easy to add later (uuids match); Codex would require more.

**File-sync triggers, for external-spawned sessions only:**

1. **On-demand, when the user opens an imported session.** Byte-offset catch-up from `external_sync_offset` picks up any new entries since last view.
2. **Startup catch-up.** On app launch, for every active externally-spawned execution session, read to EOF and upsert missing entries.
3. **Periodic background pass.** Overnight (or hourly) cron keeps imported sessions current for search and notifications even when nobody has opened them recently.

App-spawned sessions skip all three — they have no `external_transcript_path` stored (or they have one but the writer flag marks them stdio-exclusive; implementation detail).

**What this does not try to do:**

- **Auto-import orphan sessions.** CLI sessions not linked to any `chat_session` row are ignored. Auto-scanning `~/.claude/projects/` or `~/.codex/sessions/` would flood the DB with sessions the user never asked for. Importing is a deliberate user action.
- **Cross-device file sync.** Transcript files are local to the machine that ran the CLI. If the user chats on their laptop terminal and opens our app on a desktop, the desktop can't see the laptop's file. The rollover path handles this honestly: resume fails → handoff summary → fresh CLI session on the new machine.
- **Hooks-based sync.** Claude Code has a hook system that could fire on message events. Possibly useful later, but it means asking users to install config into their CLI. stdio + file-sync covers the needs without that.

**The integrity invariant:** within a session's chosen ingestion path, the compound unique on `chat_events` — `(session_id, COALESCE(external_turn_id, ''), external_event_id, source_part_index) WHERE external_event_id IS NOT NULL` — makes repeated reads idempotent. Re-reading a file from an earlier byte offset, or processing the same stdio event twice (shouldn't happen, but), both hit `ON CONFLICT DO NOTHING` and move on. If the upstream file is rewritten or rotated, new ids get inserted; old ones don't duplicate. If a row is ever removed from the upstream file (shouldn't happen with append-only behavior, but in theory), we keep our mirror row — the DB can be forgiving in ways the CLI transcript cannot.

## UX rules

- **Orchestration thread follows you.** Main view → you see the orchestrator's main thread. No picker, no list.
- **Content chat lives with its content.** Opening a task or note shows the content chat for that item (or an empty pane if none exists yet; first message creates it). It doesn't write to the main thread. It's its own session, chronologically whole.
- **Execution sessions are entered, not browsed.** You get into an execution via (a) dispatching a new one (intentional act, from anywhere), (b) a notification (work happened / needs you), or (c) cross-references from a task/note that touched it. No list view of past executions.
- **Agents are the only navigable chat entities.** A small agents list (maybe 2–8 agents, not hundreds) replaces what would have been a thread list. Clicking an agent opens the agent's current context — for the orchestrator that's your main/content chat; for an executor it's the new-execution or recent-execution view.
- **When a task or note chat is first opened, the pane is empty.** That's fine. The agent still knows you — retrieval spans all transcripts. First message starts the content chat.
- **Full transcripts. No collapsed exchanges. No summarized past.** Orientation markers are OK. Collapsed tool-call detail is OK. Hidden messages are not.
- **CLI rollovers are visible.** When an execution's CLI session rotates (died, expired, machine changed, user hit `+`), the transcript shows a divider and the handoff message. Never a silent continuation claiming state the agent doesn't have.

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
- **A file content hash for change detection.** Hashing a multi-MB JSONL on every tick is wasteful. `stat().size` compared to `external_sync_offset` is a single syscall and tells us exactly what we need: "is there new content past where I've read?" Correctness is guaranteed by the idempotent upsert regardless.
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
- **Attachment storage strategy.** File-on-disk vs SQLite BLOB for `chat_attachments`. File-on-disk is simpler for large media and plays well with backup. BLOB keeps everything in one DB file and enables clean export. Pick when we have real usage; the schema supports either via `storage_kind`.

## Schema summary

Four tables (plus a notifications table, sketched separately). No `chat_threads`. No per-device partitioning. No lineage links. No cached liveness flags. No partition-key UNIQUE constraints.

```
agents
  id, user_id, kind, name, role, harness, config, status, created_at, archived_at
  -- config is JSON; for CLI-backed agents it includes cwd (device-local for v1)

chat_sessions
  id, user_id, agent_id, type, surface_kind, surface_ref, status, label, refs,
  external_session_id, external_transcript_path,
  external_sync_offset, external_sync_last_event_id,
  started_at, archived_at
  UNIQUE (external_session_id) WHERE external_session_id IS NOT NULL

chat_events
  id, session_id, role, source, content,
  tool_name, tool_input, tool_is_error, tool_exit_code,
  raw,
  external_event_id, external_message_id, external_turn_id,
  external_tool_call_id, external_parent_tool_call_id,
  source_part_index,
  created_at
  UNIQUE (session_id, COALESCE(external_turn_id, ''), external_event_id, source_part_index)
    WHERE external_event_id IS NOT NULL

chat_attachments
  id, event_id, session_id,
  kind, mime_type, size_bytes,
  storage_kind, file_path, blob, url,
  content_hash, created_at
  -- adapter strips media bytes out of chat_events.raw into this table
  -- content_hash enables dedup across sessions when the same bytes are reused
```

`type` on `chat_sessions` discriminates the three kinds: `orchestration`, `content`, `execution`. Behavior varies by type; schema is shared.

`id` columns are UUIDv7 (time-ordered) — sort order via `(created_at, id)` is stable, monotonic within a session, and no sequence column is required.

For in-app sessions (orchestration, content), `external_*` fields are null and our DB is authoritative.

For execution sessions, `external_session_id` points to the current live CLI session (mutable; rotates on rollover), and `external_transcript_path` stores the actual path the CLI wrote to — observed, not derived. `chat_events` rows are written by exactly one of two paths per session: stdio (via agentex, for app-spawned sessions) or file-sync (parsing the on-disk transcript, for user-imported sessions). Incremental file-sync tracked by `external_sync_offset` and validated by `external_sync_last_event_id`. Idempotency is by-path via the compound unique on `event_id + turn + part_index`.

Each execution session belongs to exactly one ingestion path. App-spawned sessions use stdio (via agentex); externally-imported sessions use file-sync reading the CLI's on-disk transcript. No cross-path ingestion — the format differences (especially for Codex) make that unreliable. Idempotency within a path is handled by the compound unique constraint; `ON CONFLICT DO NOTHING` for repeated reads.

The only uniqueness the DB enforces: session PK, event PK, `external_session_id`, and the compound event-uniqueness on `chat_events`. How many sessions exist per user/agent/surface is the user's call; app defaults pick sensible behavior without the schema fighting alternate patterns.

Memory, if it becomes a distinct store, sits next to these tables rather than inside them — explicitly out of scope for this doc.

## The one-line version

Three distinct kinds of chat — orchestration, content, execution — share a schema but not a UX. Agents are definitions; sessions are instances; same agent → many concurrent sessions is normal. `chat_events` stores one row per atomic thing that happened (user messages, assistant text, thinking, tool calls, tool results, system markers, run results, rate limits) with typed columns for tool metadata and full `raw` for audit. Multimodal content (images, audio, files) lives in `chat_attachments`, referenced by event. No DB-enforced partition constraints. Full transcripts. Two explicit resets. Retrieval (FTS5 now, embeddings later) runs over `chat_events`, not JSONL files. For execution sessions (CLI-backed, via agentex), each session belongs to exactly one ingestion path: app-spawned sessions use stdio (agentex) as the sole writer; externally-imported sessions use file-sync of the CLI's on-disk transcript. No cross-path ingestion. Rollovers are visible, compaction is mirrored (Claude Code) or proactive (Codex), paths are observed not derived, state is never faked. The word "session" lives in the database and nowhere in the UI.
