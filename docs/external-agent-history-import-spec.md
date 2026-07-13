# External Agent History Import

Status: implementation-ready specification

Date: 2026-07-10

Repositories:

- App: `~/dynamism/ai-task-manager`
- Agent runtime: `~/dynamism/agentex`

Implementation contract:

> This specification requires coordinated changes in both repositories. Phase 1 is implemented, tested, and released as `@agentex/agent` `0.0.29` from `~/dynamism/agentex`. Later phases are implemented in `~/dynamism/ai-task-manager` against `0.0.29` or newer. Flow must not replace the Agentex phase with another provider-specific parser.

## 1. Executive summary

Flow should let a person discover and import projects and chat history created by local agent tools, beginning with Claude Code and Codex.

The source data already exists on disk:

- Claude Code stores project-scoped JSONL transcripts under `~/.claude/projects`
- Codex stores active and archived JSONL rollouts under `~/.codex/sessions` and `~/.codex/archived_sessions`
- Codex also maintains local indexes that may contain titles and other thread metadata

The product experience should resemble Codex's Claude Code import flow:

1. Detect supported local agent stores
2. Show recognizable projects and recent chats
3. Let the user select whole projects or individual chats
4. Import without modifying the source stores
5. Preserve provenance and transcript fidelity
6. Keep imported history available and updateable when the source transcript grows

The implementation boundary is:

- Agentex owns provider-specific discovery, metadata extraction, transcript normalization, stable event identity, source fingerprinting, and compatibility with provider format changes
- Flow owns project grouping, user selection, database persistence, workspace mapping, synchronization policy, import status, history navigation, and UI

The existing Flow prototype is valuable and should be refactored, not discarded. Its UI, API shape, database mapping, transaction logic, and integration tests are the starting point. The provider filesystem knowledge currently embedded in Flow moves into Agentex.

## 2. Final product vision

### 2.1 One local work history

Flow is the durable index of a person's work across agents. A project may have chats created by Claude Code, Codex, Flow, and future supported harnesses. The user should not need to remember which agent created a conversation or where that agent stored it.

Imported chats appear in Flow's History with clear provider provenance. They use the same transcript renderer, search, references, and project context as Flow-created chats.

The external agent remains the source of truth for its local transcript. Flow stores a normalized projection so history stays fast, searchable, and available even if the source file later disappears.

### 2.2 Import is deliberate

Flow never silently imports every detected chat. Discovery is automatic when the import surface opens, but persistence requires an explicit user selection.

This avoids:

- Flooding Flow with short probes, empty sessions, subagents, and abandoned experiments
- Creating workspaces for every temporary worktree ever used
- Pulling sensitive history into Flow without user intent
- Making a background scan feel like an unexplained mutation

### 2.3 Imported history is linked, not frozen

An imported chat keeps a read-only link to its source transcript.

If the source grows after import, Flow can ingest the appended events. The imported chat remains a historical projection and is never treated as a live Flow-owned CLI session.

If the source is deleted or moved, the imported Flow history remains intact and is marked as detached from its source.

If the user chooses to continue imported work, Flow starts a new Flow-owned chat against the same workspace or execution context. Flow does not begin writing into the imported source session.

### 2.4 Projects remain simple

An external project is initially identified by the literal absolute working directory recorded by the provider.

Flow reuses an existing workspace when its normalized `cwd` matches. When no workspace exists:

- An existing directory becomes an active workspace after the user imports at least one chat from it
- A missing directory becomes an archived placeholder workspace so its history remains labeled without creating a broken active project

Flow does not automatically merge different worktrees or directories merely because they share a Git remote. Their code state may differ. A later explicit consolidation feature may use Git metadata to suggest merges.

### 2.5 History scales beyond the first import

Importing hundreds of chats must not make older chats unreachable. History requires cursor pagination or equivalent incremental loading before the UI permits imports beyond the current fixed history limit.

Recent chats are the default import view. All detected history remains available behind project expansion, search, or a Show all action.

## 3. Product decisions

These decisions are binding for the first production version.

### 3.1 Supported sources

Initial sources:

- Claude Code
- Codex CLI and Codex Desktop local rollouts

Not included:

- Standard Claude web or desktop conversations
- ChatGPT web conversation history
- Cloud-only agent tasks without a local durable transcript
- Subagent transcripts as standalone chats
- Agent configuration, skills, plugins, hooks, or MCP migration

Configuration migration may be designed separately. This specification is only for projects and chat history.

### 3.2 Main sessions only

Discovery includes only sessions that contain at least one meaningful human message.

Exclude by default:

- Claude sidechains and nested subagent transcripts
- Codex subagent-only threads
- Probe sessions
- Metadata-only sessions
- Sessions containing only developer instructions or environment context
- Empty or unreadable transcripts

Agentex may expose an advanced option for hosts that need these records, but Flow does not request them.

### 3.3 Source stores are read-only

Flow and Agentex must not mutate, rename, archive, delete, compact, or append to source transcripts during discovery or import.

The only writes occur in Flow's own database and content stores.

Tests must fingerprint fixture source files before and after discovery and import to prove this invariant.

### 3.4 Imported chats are historical

Imported chats and their executions are archived after the initial import. They appear in History, not in active work queues.

They are considered read when first imported, so an old agent response does not appear as a new unread result.

Source synchronization may append events to an imported archived chat without changing its active or read state.

### 3.5 No permanent dedupe by session ID alone

Provider type and external session ID form the source identity:

```text
(provider_type, external_session_id)
```

Source modification time, size, and content hash describe a particular observed version.

A previously imported source session may be updated when its fingerprint changes. It must not be permanently skipped merely because its session ID already exists.

### 3.6 Full useful transcript fidelity

Import these event kinds when present:

- Human messages
- Assistant messages
- Readable thinking or reasoning summaries
- Tool calls
- Tool results
- Meaningful system markers such as compaction, interruption, errors, and terminal results

Drop provider bookkeeping that does not help a person understand the conversation:

- Titles duplicated into metadata
- Last-prompt mirrors
- File-history snapshots
- Permission-mode snapshots
- Mode snapshots
- Queue bookkeeping
- Token counters
- Duplicate event envelopes
- Encrypted reasoning without a readable summary

Raw provider payloads remain attached to normalized events for audit and future migrations.

### 3.7 Imported history is never a second writer

Flow may read appended source events, but it never sends a prompt to an imported external session.

Continue creates a new Flow-owned chat. This prevents two applications from writing to the same Claude or Codex session and avoids ambiguous ownership of permissions, pending input, and process state.

### 3.8 Existing-user discovery is optional and non-blocking

Onboarding performs full discovery when the Import step opens. If no supported history is available, the step shows a simple empty state and allows immediate continuation.

For a person upgrading an existing Flow installation, Flow performs one cheap, bounded provider-store presence probe after the first dashboard load for the release that introduces this feature.

The upgrade probe:

- Runs asynchronously after normal dashboard data has loaded
- Checks only for supported provider homes and plausible main-session files
- Does not parse transcript content, derive titles, or persist imported history
- Always runs on the machine hosting the Flow runtime
- May be initiated from a remote browser, but never inspects or implies access to the browser device's filesystem
- Labels remote results as data found on the Flow host
- Never blocks normal app use

When the probe finds plausible provider data, Flow may show one dismissible, non-modal card such as `Claude Code or Codex data was found on your Flow host` with an `Import history` action. The presence probe may produce false positives because it does not open transcript contents. Do not claim that eligible history exists and do not show an exact chat count until full discovery runs through explicit user navigation.

The card opens the normal import surface, where full discovery begins. Prompt handling is persisted in `user_state.externalHistoryPromptVersion` and prevents the release prompt from appearing again. Settings remains the permanent import route.

Flow never auto-imports history, opens a modal, or blocks the dashboard for this upgrade experience.

## 4. Current implementation assessment

The uncommitted Flow implementation already provides:

- Claude and Codex home resolution through Agentex
- Local transcript discovery
- Project grouping by normalized `cwd`
- Project and individual-chat selection
- Settings and onboarding surfaces
- Server-side resolution of trusted session keys
- No source path exposure in the browser response
- Archived execution and chat creation
- Original timestamp preservation
- User, assistant, thinking, tool call, tool result, and result ingestion
- Duplicate import prevention
- An end-to-end fixture test

Keep these pieces.

The current implementation also contains responsibilities that belong in Agentex:

- Walking Claude and Codex storage layouts
- Filtering Claude sidechains
- Parsing provider session IDs
- Extracting Claude titles and user messages
- Extracting Codex titles, cwd, branch, and user messages
- Reading Codex indexes
- Deciding which provider records are duplicates or bookkeeping
- Normalizing provider transcript lines

Known product gaps to correct during the refactor:

1. History is capped at 200 rows while import accepts up to 1,000 chats
2. Real local stores include sessions without human messages, currently 43 on the inspected machine
3. Imported sessions never receive events appended after import
4. Claude imports currently surface file-history, mode, and permission bookkeeping
5. A failed import can leave an empty active workspace
6. Missing source directories become broken active workspaces
7. The integration test exceeds Vitest's default five-second timeout on a cold run

Spike validation completed before this specification:

- The fixture integration test discovers Claude and Codex sessions, imports both, preserves expected event order, and skips a repeated import
- A read-only scan of the real local stores found 496 candidate transcript files before eligibility filtering across 71 cwd groups
- One real Codex transcript with 101 source events imported successfully into a temporary Flow database
- One real Claude transcript with 158 source events imported successfully into a temporary Flow database

This evidence proves that the storage locations, metadata recovery, event mapping, and Flow persistence model are viable. It does not make the current provider-specific Flow implementation the final architecture.

## 5. Ownership boundary

| Concern | Agentex | Flow |
| --- | --- | --- |
| Locate provider home directories | Owns | Consumes |
| Understand provider directory layout | Owns | Must not duplicate |
| Enumerate local sessions | Owns | Requests and filters product view |
| Parse provider metadata | Owns | Displays normalized metadata |
| Identify main session versus subagent | Owns | Requests main sessions |
| Determine whether a session has human input | Owns | Requires true |
| Normalize transcript events | Owns | Maps normalized events to `chat_events` |
| Stable event identity and cursors | Owns | Persists and deduplicates |
| Cheap and strong source fingerprints | Owns | Persists and compares |
| Tolerate provider format versions | Owns | Receives typed errors and warnings |
| Group sessions into projects | Provides cwd and Git metadata | Owns |
| Select projects and chats | No | Owns |
| Create workspaces and executions | No | Owns |
| Decide active versus archived state | No | Owns |
| Store import provenance and sync state | No | Owns |
| Schedule rescan and synchronization | No | Owns |
| History UI and pagination | No | Owns |
| Search and embeddings | No | Owns |
| Continue imported work | Provides normal session creation | Owns product flow |

## 6. Agentex specification

### 6.1 New capability

Add an optional local history capability to `ProviderModule`:

```ts
export interface ProviderCapabilities {
  localHistory?: boolean
}

export interface ProviderModule {
  localHistory?: LocalHistoryOps
}
```

Set `localHistory: true` for Claude and Codex only after their implementations and fixtures pass.

Do not add discovery to `TranscriptOps`. `TranscriptOps` starts from a known session identity and serves durable reattachment. Local history starts without known IDs and includes human messages that are intentionally absent from live `StreamEvent` handling. These are related but distinct contracts.

Agentex `0.0.29` also exposes `durableHistory` and `attachHistory()` for a known persisted `SessionRecord`, including service-backed OpenCode history. That API remains intact. `localHistory` is the separate unknown-session discovery surface used by import and migration tools. Implementations may reuse transcript and attachment internals, but callers must not need a `SessionRecord` before discovery.

### 6.2 Discovery types

Add provider-neutral history types under `packages/agent/src/history`:

```ts
export interface LocalHistoryDiscoverOptions {
  includeArchived?: boolean
  mainSessionsOnly?: boolean
  requireUserMessage?: boolean
  cwd?: string
  limit?: number
  env?: Record<string, string>
}

export interface LocalHistoryProbeOptions {
  /** Maximum plausible session files to inspect before returning. */
  limit?: number
  env?: Record<string, string>
}

export interface LocalHistoryProbeResult {
  providerType: string
  homeAvailable: boolean
  historyAvailable: boolean
  /** File-count estimate only. It is not an eligible-session count. */
  approximateCount?: number
}

export type LocalHistoryArchiveState = 'active' | 'archived' | 'unknown'

export interface LocalHistorySourceFingerprint {
  size: number
  modifiedAtNs: string
  sha256?: string
}

export interface LocalHistorySession {
  version: 1
  providerType: string
  externalSessionId: string
  transcriptPath: string
  cwd: string | null
  title: string | null
  startedAt: string | null
  updatedAt: string
  branch: string | null
  gitOriginUrl: string | null
  archiveState: LocalHistoryArchiveState
  hasUserMessage: boolean
  source: LocalHistorySourceFingerprint
}
```

`modifiedAtNs` is a string because nanosecond values may exceed JavaScript's safe integer range.

Discovery returns literal absolute paths. Agentex is a local runtime library. A network host such as Flow must never serialize `transcriptPath` to an untrusted client.

### 6.3 Normalized history events

Reuse the existing `StreamEvent` vocabulary and add only the human-message variant that live agent streams intentionally omit:

```ts
export type LocalHistoryUserEvent = {
  type: 'user'
  text: string
} & BaseStreamEventFields

export type LocalHistoryEvent = StreamEvent | LocalHistoryUserEvent

export interface LocalHistoryYield {
  event: LocalHistoryEvent & { eventId: string }
  lineStartOffset: number
  nextOffset: number
  partIndex: number
}
```

Do not maintain a second reduced normalization vocabulary. Reusing `StreamEvent` preserves fields such as tool exit code, cost, token usage, terminal reason, background-task details, goal state, and future additive event variants.

`LocalHistoryYield.event.eventId` is the canonical source-record identity. It must be non-null and deterministic for the same source transcript version. The normalized-event import identity is `(providerType, externalSessionId, event.eventId, partIndex)`. There is no second envelope-level event ID that can drift from the normalized event.

Recommended identities:

- Claude: provider event UUID, with `partIndex` disambiguating several events from one line
- Codex: provider type, external session ID, and line-start byte offset, with `partIndex` disambiguating several events from one line
- Synthetic user events: the provider record identity when available, otherwise provider type, external session ID, and line-start byte offset

The host checkpoints only after all parts sharing `nextOffset` have committed.

### 6.4 Local history operations

```ts
export interface LocalHistoryReadOptions {
  fromOffset?: number
}

export interface LocalHistoryFingerprintOptions {
  sha256?: boolean
}

export interface LocalHistoryOps {
  probe(
    options?: LocalHistoryProbeOptions,
  ): Promise<LocalHistoryProbeResult>

  discover(
    options?: LocalHistoryDiscoverOptions,
  ): AsyncIterable<LocalHistorySession>

  read(
    session: LocalHistorySession,
    options?: LocalHistoryReadOptions,
  ): AsyncIterable<LocalHistoryYield>

  fingerprint(
    session: LocalHistorySession,
    options?: LocalHistoryFingerprintOptions,
  ): Promise<LocalHistorySourceFingerprint>
}
```

`probe()` is the upgrade-notice primitive. It performs a bounded filesystem presence check without opening transcript contents, deriving titles, or claiming that every plausible file is an eligible session. It must be materially cheaper than `discover()`.

Discovery uses bounded filesystem concurrency and must not read whole transcripts into memory.

The cheap discovery fingerprint includes size and modification time. SHA-256 is optional and computed only for selected or previously imported sessions that require a strong comparison.

### 6.5 Claude implementation

Add `packages/agent/src/providers/claude/history.ts`.

Responsibilities:

- Resolve `CLAUDE_CONFIG_DIR` and the normal Claude home
- Enumerate top-level UUID JSONL files under project directories
- Exclude nested subagent files and sidechains by default
- Recover literal cwd from provider-controlled envelope fields
- Require an absolute cwd for Flow-compatible candidates
- Extract `ai-title` metadata when available
- Fall back to the first meaningful human prompt for the title
- Extract branch metadata when present
- Preserve original timestamps
- Normalize user, assistant, thinking, tool call, tool result, result, error, recap, away-summary, and bridge-status events
- Drop file-history snapshots, mode snapshots, permission-mode snapshots, title records, last-prompt mirrors, attachment bookkeeping, queue operations, progress records, and pure timing telemetry
- Tolerate malformed lines without hiding the rest of a valid transcript

The existing Claude transcript parser and helpers should be reused internally. Do not create a second independent parser when shared lower-level functions can serve both durable attachment and history import.

### 6.6 Codex implementation

Add `packages/agent/src/providers/codex/history.ts`.

Responsibilities:

- Resolve `CODEX_HOME`
- Use rollout JSONL files as the canonical v1 source for history, byte offsets, fingerprints, and incremental reads
- Use `session_index.jsonl` and Codex SQLite indexes opened read-only as optional metadata sources
- Keep Codex App Server outside the v1 import path because initialization and listing may reconcile or write Codex state even when the requested operation appears read-only
- Reconsider App Server history only after Agentex introduces opaque source handles and provider-neutral cursors that do not require file paths, fingerprints, or byte offsets
- Enumerate active date-sharded rollouts and archived rollouts
- Deduplicate a thread briefly present in both locations
- Read session ID, cwd, timestamps, Git metadata, source kind, and archive state from `session_meta`
- Support documented legacy formats defensively
- Read titles from `session_index.jsonl` when present
- Read titles from the current Codex SQLite thread index when available
- Fall back to the first meaningful human prompt
- Exclude developer instructions, environment context, and metadata-only threads
- Reuse `codexLineToStreamEvents` for assistant, thinking, tool, and result normalization
- Add normalized user-message extraction for history reads
- Drop duplicate `event_msg` mirrors and token telemetry
- Open SQLite indexes read-only and tolerate a missing, locked, or schema-incompatible index

Codex's internal format changes frequently. Flow must not know these details.

### 6.7 Required Codex event identity correction

Agentex currently creates a replay-stable synthetic `eventId` in `readCodexTranscript()`, but `codexLineToStreamEvents()` resets the normalized event field to `null`. `attachCodexSession().catchUp()` also returns `eventId: null` unconditionally.

Before Flow adopts Agentex local history:

- `codexLineToStreamEvents()` must propagate `CodexTranscriptLine.eventId`
- File-backed Codex catch-up must return the deterministic transcript identity
- Comments and changelog text that claim Codex transcript events never have IDs must be corrected
- Tests must prove that two reads of the same rollout produce identical event identities

The local history wrapper still owns `partIndex` because one provider source record may normalize into multiple events.

### 6.8 Agentex error model

Provider history failures should be typed and recoverable:

```ts
export type LocalHistoryErrorCode =
  | 'home_missing'
  | 'permission_denied'
  | 'source_missing'
  | 'unsupported_format'
  | 'source_changed_during_read'
  | 'invalid_session'
  | 'io_error'
```

One damaged session must not fail discovery of all other sessions.

Discovery may yield warnings through an optional diagnostic field or callback, but Flow's normal UI only needs provider availability, counts, and per-session import failures.

### 6.9 Agentex packaging and documentation

Add:

- `packages/agent/src/history/types.ts`
- `packages/agent/src/history/index.ts`
- Claude and Codex history implementations
- Barrel exports from `packages/agent/src/index.ts`
- A `./history` package export if subpath exports are used for other leaf modules
- Unit fixtures for every supported provider format
- README documentation showing discovery and incremental reads
- CHANGELOG entry

The feature ships in a new Agentex package version before Flow removes its fallback implementation.

## 7. Flow specification

### 7.1 Import provenance table

Add a dedicated table. Do not overload the live CLI binding fields on `chat_sessions` as the only import ledger.

```ts
export const externalSessionImports = sqliteTable(
  'external_session_imports',
  {
    id: text().primaryKey(),
    ...timestamps,
    chatSessionId: text()
      .notNull()
      .unique()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    providerType: text().notNull(),
    externalSessionId: text().notNull(),
    sourcePath: text().notNull(),
    sourceSize: integer().notNull(),
    sourceModifiedAtNs: text().notNull(),
    sourceContentSha256: text(),
    syncOffset: integer().notNull().default(0),
    syncLastEventId: text(),
    status: text({
      enum: ['importing', 'current', 'changed', 'missing', 'error'],
    })
      .notNull()
      .default('importing'),
    lastScannedAt: text(),
    lastSyncedAt: text(),
    lastError: text(),
  },
  (table) => [
    uniqueIndex('external_session_imports_source_uq').on(
      table.providerType,
      table.externalSessionId,
    ),
    index('external_session_imports_status_idx').on(table.status),
  ],
)
```

All types derive from the Drizzle schema in `src/db/types.ts`.

Live Flow-created sessions continue to use `chat_sessions.externalSessionId`, `externalTranscriptPath`, and live reconciliation fields. Imported historical sessions use `external_session_imports` as their authoritative source link.

New imported chats do not populate the live CLI binding fields on `chat_sessions`. They retain `surfaceKind = 'imported_agent'` and provider-facing `surfaceRef` for presentation, while the import table owns source identity and synchronization.

During migration, existing `surfaceKind = 'imported_agent'` rows are backfilled into the new table from their current external fields. After a successful backfill, clear `externalSessionId`, `externalTranscriptPath`, `externalSyncOffset`, and `externalSyncLastEventId` on those imported chat rows. This releases the old global external-session uniqueness constraint and prevents the live-session reconciler from treating historical imports as writable CLI bindings.

### 7.2 Flow import service after refactor

`src/lib/import/external-agents.ts` remains, but it becomes a product service rather than a provider parser.

It owns:

- Calling Agentex history discovery for supported providers
- Comparing descriptors to `external_session_imports`
- Grouping by normalized cwd
- Reusing or creating Flow workspaces
- Mapping Agentex `LocalHistoryEvent` values to `chat_events`
- Import transactions and checkpoints
- Resuming failed or interrupted imports
- Synchronizing changed imported sources
- Returning browser-safe discovery data

It must not import `node:fs`, `node:readline`, or provider transcript parsers.

Delete or move from Flow:

- `readJsonlPrefix`
- `listJsonlFiles`
- `listClaudeFiles`
- `claudeUserText`
- `codexUserText`
- `loadCodexTitles`
- `claudeCandidate`
- `codexCandidate`
- `codexCwdFromRecords`
- `readRawJsonl`
- `parseClaudeTranscript`
- `parseCodexTranscript`

The Flow mapper from `LocalHistoryEvent` to `CreateChatEventInput` remains small and provider-neutral.

For imported events, map `LocalHistoryYield.event.eventId` to `chat_events.external_event_id` and `LocalHistoryYield.partIndex` to `chat_events.source_part_index`. The existing unique index on `(session_id, external_event_id, source_part_index)` is the idempotency boundary. Do not synthesize a second Flow-only event identity.

### 7.3 Import transaction and resumability

Do not load an arbitrarily large transcript fully into memory before writing.

Per selected session:

1. Revalidate the descriptor through Agentex
2. Reject a descriptor without a meaningful human message
3. Resolve an existing workspace or decide the new workspace status
4. In one transaction, create any workspace, archived execution, archived chat, and `external_session_imports` row with status `importing`
5. Stream normalized history in line-aligned batches
6. Insert events idempotently using Agentex `(eventId, partIndex)` identity within the provider session
7. Commit `syncOffset` only after every part for a source line commits
8. Compute a strong source fingerprint after the read
9. If the source changed during the read, continue from the committed offset or mark `changed`
10. Mark the import `current` only when the stored fingerprint matches the completed read

If a batch fails:

- Preserve successfully committed batches
- Mark the import `error`
- Store a safe error summary
- Let Retry continue from `syncOffset`

Do not leave an untracked empty active workspace. Any created workspace is tied to an import ledger row in the initial transaction.

### 7.4 Workspace mapping

Workspace lookup compares normalized absolute cwd across active and archived workspaces.

Rules:

- Reuse an exact existing workspace regardless of workspace status
- Do not create a duplicate active workspace for an archived match
- Create an active workspace only when the directory currently exists
- Create an archived placeholder workspace when the directory is missing
- Preserve literal cwd even when missing so future restoration can reconnect it
- Do not auto-collapse separate worktrees by Git remote
- Do not run setup scripts or create worktrees during import

Imported execution rows remain archived and carry available branch metadata. They do not claim a worktree that Flow did not create.

### 7.5 Source synchronization

Flow checks imported source fingerprints:

- When the import surface opens
- When an imported chat opens
- On an explicit Scan again action
- During a bounded cold-start sweep for imports previously marked `changed` or `error`

Do not scan every provider transcript every minute.

State transitions:

```text
not imported -> importing -> current
                    |           |
                    v           v
                  error <---- changed
                                |
                                v
                              current

current -> missing
missing -> current       when the source returns
```

Append-only growth reads from `syncOffset`.

If the source shrinks, changes before the checkpoint, or produces a different strong hash for the already-imported prefix, mark it `changed`. Rebuilding must delete only events owned by that import and then replay them idempotently. It must not delete user-authored Flow events.

### 7.6 API

Keep `/api/imports/agents`, but extend it deliberately.

#### Discovery

```http
GET /api/imports/agents?limit=50&provider=all&cursor=...
```

Response includes:

- Provider availability and totals
- Recent project groups
- Per-session import status
- A browser-safe opaque selection key
- Pagination cursor or `hasMore`

Never return transcript paths.

#### Import

```http
POST /api/imports/agents
{
  "sessionKeys": ["opaque-key"]
}
```

The server resolves opaque keys against a fresh Agentex discovery result. It never accepts a caller-provided source path.

#### Refresh

```http
POST /api/imports/agents/refresh
{
  "chatSessionIds": ["..."]
}
```

Refresh is idempotent and may return per-session progress or failures.

Large imports may begin synchronously for v1, but the database model and API result must support later background progress without schema redesign.

### 7.7 UI

Retain the existing Settings and onboarding import panel.

Onboarding behavior:

- Start full discovery when the Import step opens
- Show a lightweight empty state when no supported history exists
- Allow immediate continuation whether discovery is empty, unavailable, or skipped
- Never make import a prerequisite for finishing onboarding

Existing-user upgrade behavior:

- Schedule one Agentex `localHistory.probe()` call after the first normal dashboard load for this feature release
- Show one dismissible, non-modal import card only when the probe reports plausible provider data and the prompt has not been handled
- Use provider availability wording rather than an exact eligible-chat count unless full discovery has already run through explicit user navigation
- Open the standard import panel from the card action
- Persist handled state so the card does not return on later launches
- Run discovery and import against the Flow runtime host, including when the viewer is remote
- Tell remote viewers that the data is on the Flow host and never imply that the browser device was scanned
- Do not auto-import, open a modal, or block dashboard interaction

Prompt persistence:

```ts
externalHistoryPromptVersion: integer().notNull().default(0)
```

Add this field to `user_state`. Keep a code constant such as `EXTERNAL_HISTORY_PROMPT_VERSION = 1`. The dashboard schedules the release probe only when the stored version is lower than the current constant.

Set the stored version to the current constant when the person:

- Dismisses the card
- Opens the import surface from the card
- Opens the import surface independently through Settings
- Completes or skips the onboarding import step
- Successfully imports history
- Completes the release probe and no plausible provider data is present

Opening the importer is enough to count as handled. A person should not be prompted again merely because they reviewed the available data and chose not to import it.

Existing-user card placement:

- Desktop: inside `WorkspaceNav`, after `NeedsReviewSection` and before the Workspaces heading
- Mobile: inside `MobileAgentsView`, after `NeedsReviewBlock` and before the Workspaces heading
- Hide the card in the collapsed desktop rail
- Never place the card in the global HUD or a modal

Actionable work remains above the import prompt on both desktop and mobile.

Required refinements:

- Show recent unimported chats first
- Keep project rows collapsed by default
- Support project and individual-chat selection
- Hide empty sessions
- Show Current, Update available, Missing source, Importing, and Error states
- Provide Retry for failed imports
- Provide Update for changed sources
- Show provider, date, branch, and project path
- Keep imported rows disabled for initial import selection unless an update is available
- Explain that source files are read without modification
- Explain that Continue starts a new Flow chat
- Keep failure details available without dumping raw provider payloads

The panel must remain usable with hundreds of projects and thousands of chats. Use pagination, search, or virtualized lists as needed.

### 7.8 History navigation

Replace the fixed 200-row history ceiling with cursor pagination before bulk import is enabled.

History ordering uses:

```text
COALESCE(last_outcome_event_at, started_at) DESC, id DESC
```

The API returns a stable composite cursor. The client incrementally loads older rows.

Workspace history must include archived imported executions even when the workspace is archived or missing locally.

### 7.9 Continue imported work

Opening an imported chat offers Continue in Flow.

Continue:

1. Resolves the workspace
2. Starts a new Flow-owned execution or chat according to the normal product rules
3. Uses the selected default harness unless the user chooses another
4. Provides a bounded handoff containing the imported chat's recent useful context
5. Never resumes or writes to the imported external session

The original imported chat remains immutable except for source synchronization.

## 8. Refactor map

### 8.1 Agentex additions

| File or area | Change |
| --- | --- |
| `packages/agent/src/types.ts` | Add optional `localHistory` capability and matching `localHistory` surface |
| `packages/agent/src/history/*` | Add provider-neutral types and exports |
| `packages/agent/src/providers/claude/history.ts` | Add discovery and normalized history reads |
| `packages/agent/src/providers/codex/history.ts` | Add discovery, index metadata, and normalized history reads |
| Provider index modules | Advertise capability and lazily expose history implementation |
| Package exports | Export history types and operations |
| Provider fixtures | Cover current and legacy disk formats |
| README and CHANGELOG | Document local history discovery and import use |

### 8.2 Flow changes retained

| File or area | Keep |
| --- | --- |
| `src/components/settings/sections/imports-section.tsx` | Selection and status UI |
| `src/app/api/imports/agents/route.ts` | Authenticated browser-safe API boundary |
| `src/lib/import/types.ts` | Flow API view models |
| Settings navigation | Imports section |
| Welcome import step | Reuse the import panel |
| Import integration test | End-to-end Flow persistence coverage |

### 8.3 Flow changes refactored

| File or area | Refactor |
| --- | --- |
| `src/lib/import/external-agents.ts` | Replace filesystem parsing with Agentex history calls |
| `src/lib/executor/adapter.ts` | Keep live event mapping, remove import-only provider noise responsibility |
| `src/lib/executor/codex-on-disk.ts` | Replace remaining duplicated Codex normalization with Agentex normalization |
| `src/lib/executor/reconcile.ts` | Continue owning Flow checkpoints and DB writes, consume Agentex events |
| `src/lib/db/schema.ts` | Add `external_session_imports` and `user_state.externalHistoryPromptVersion` |
| `src/lib/db/queries.ts` | Add import ledger and paginated history queries |
| `/api/sessions/history` | Add stable pagination |
| `docs/chat-sessions.md` | Replace the claim that imported transcripts bypass Agentex |

### 8.4 Unrelated concurrent changes

The current worktree contains changes outside external history import, including realtime session streaming and morning-deck review behavior. They should be reviewed and committed separately so the import change has a coherent diff and rollback boundary.

## 9. Delivery sequence

### Phase 1: Agentex local history API

1. Add provider-neutral history types and capability
2. Add the bounded, content-free provider history probe
3. Implement Claude discovery and reads
4. Implement Codex discovery and reads
5. Populate stable Codex event IDs during history normalization
6. Add fixtures for real observed formats
7. Add strong fingerprint support
8. Document and release a new Agentex version

Gate:

- Flow can list the same eligible Claude and Codex sessions without knowing either provider's disk layout
- Empty, subagent, and bookkeeping-only sessions are absent
- Normalized event fixtures contain no known bookkeeping noise

### Phase 2: Flow refactor and ledger

1. Upgrade Agentex
2. Add the `external_session_imports` migration, `user_state.externalHistoryPromptVersion`, and derived types
3. Replace Flow discovery and parsing with Agentex history calls
4. Add normalized event mapper
5. Make import streaming, checkpointed, and resumable
6. Backfill any existing imported rows created by the prototype

Gate:

- Existing import UI behavior remains recognizable
- A real Claude and Codex sample import with original timestamps and useful event fidelity
- Reimport is idempotent
- A changed source becomes updateable
- A missing source does not destroy imported history

### Phase 3: Product completeness

1. Add paginated History
2. Add recent-first discovery and Show all
3. Add the versioned existing-user presence probe and dismissible import card
4. Add import status, Retry, and Update UI
5. Add missing-workspace handling
6. Add Continue in Flow
7. Update product documentation

Gate:

- Importing more than 200 chats leaves every chat discoverable
- No failed import leaves an unexplained active workspace
- The import panel remains usable with at least 5,000 synthetic sessions

### Phase 4: Cleanup

1. Remove Flow's provider-specific discovery helpers
2. Remove duplicated Codex on-disk normalization
3. Remove transitional import fields only if no live-session path needs them
4. Split unrelated concurrent changes into separate commits

## 10. Testing requirements

### 10.1 Agentex unit fixtures

Claude fixtures:

- Simple user and assistant chat
- Thinking, tool call, and tool result on shared lines
- AI title metadata
- Sidechain and nested subagent exclusion
- File-history, mode, and permission-mode noise exclusion
- Compaction and away summary retention
- Malformed line recovery
- Missing cwd
- Non-absolute cwd
- Transcript appended during read

Codex fixtures:

- Current wrapped rollout format
- Archived rollout
- Active and archived duplicate
- `session_index.jsonl` title
- SQLite title fallback
- Missing and locked SQLite index
- Environment-context filtering
- User, assistant, reasoning, tool, and result events
- Metadata-only and probe session exclusion
- Legacy rollout where still supported
- Malformed line recovery

Shared assertions:

- Presence probes are bounded and do not open transcript contents
- Presence probes distinguish a missing home from a present home with no plausible sessions
- Codex v1 discovery and reads do not start or call App Server
- Source files are byte-identical before and after
- Event IDs and `(eventId, partIndex)` normalized-event identities are stable across repeated reads
- History events reuse `StreamEvent` fields without dropping exit code, cost, terminal reason, usage, or other supported metadata
- Checkpoint resume produces no gaps or duplicates
- Strong fingerprints change when content changes

### 10.2 Flow integration tests

- Discovery response contains no transcript path
- Onboarding starts discovery only when the Import step opens
- An empty or unavailable onboarding scan allows immediate continuation
- The existing-user presence probe runs after normal dashboard loading and does not block it
- The existing-user probe does not open or parse transcript content
- Provider history presence produces one non-modal import card
- No card appears when supported provider homes or plausible sessions are absent
- Dismissing the card persists and prevents it from returning on later launches
- Opening the importer from the card, Settings, or onboarding persists the current prompt version
- Completing a no-data release probe persists the current prompt version
- The card action opens the standard import surface without importing anything
- Desktop renders the card after Needs Review and before the Workspaces heading, and hides it in the collapsed rail
- Mobile renders the card after Needs Review and before the Workspaces heading
- Remote browser use scans only the Flow runtime host and labels results as host data
- Remote browser use never implies or attempts a scan of the browser device's filesystem
- Invalid or forged selection keys cannot read arbitrary files
- Existing workspace is reused by normalized cwd
- Archived workspace is reused rather than duplicated
- Missing cwd creates an archived placeholder
- Claude and Codex imports create archived executions and chats
- Imported chat starts read
- Full useful event ordering is preserved
- Duplicate import does not create duplicate rows
- Appended source lines update the existing imported chat
- Missing source retains prior events and marks status
- Failed import resumes from the committed line boundary
- Empty sessions cannot be imported
- Concurrent imports of the same source converge on one ledger row
- Workspace and chat creation cannot split across a failed initial transaction
- More than 200 imported chats remain discoverable through pagination

Use a test timeout appropriate for SQLite initialization or reduce fixture setup cost. The committed test command must pass without an undocumented CLI override.

### 10.3 Real-store diagnostics

Provide a read-only diagnostic script that prints only counts and structural metadata:

- Provider availability
- Eligible and excluded session counts
- Project count
- Archive-state count
- Format warnings
- Discovery duration

Do not print prompts, titles, cwd values, tool inputs, or transcript content by default.

## 11. Security and privacy invariants

1. API clients never provide a source filesystem path
2. API responses never reveal transcript paths
3. Import routes remain behind normal Flow authentication
4. Agentex opens source stores read-only
5. The existing-user upgrade probe does not read transcript contents or persist transcript metadata
6. A remote browser may initiate a scan of the Flow runtime host, but Flow never claims that the browser device's local agent history was inspected
7. Discovery ignores symlinks unless explicitly supported and tested
8. Cwd must come from provider-controlled metadata, not arbitrary human prompt text, whenever the provider format offers such metadata
9. Legacy cwd recovery is marked lower confidence and cannot silently grant a workspace broader filesystem access
10. Raw transcript payloads never enter logs or error responses
11. Source content hashes are stored, but source content is not duplicated outside normalized Flow events
12. Deleting an import from Flow never deletes the provider source

## 12. Observability

Record structured local metrics without transcript content:

- Discovery duration by provider
- Sessions examined, eligible, excluded, imported, updated, missing, and failed
- Events imported by normalized kind
- Bytes read
- Retry count
- Source-changed-during-read count
- Import and synchronization duration

Logs may include provider type, Flow session ID, external session ID, status, and safe error code. Avoid cwd and transcript path in normal logs.

## 13. Acceptance criteria

The feature is complete when:

1. Agentex exposes provider-neutral local history presence, discovery, and reads for Claude and Codex
2. Flow contains no Claude or Codex directory walking or title parsing
3. Flow imports selected projects and chats without modifying source stores
4. Empty, subagent, probe, and bookkeeping-only sessions are not offered
5. Useful user, assistant, thinking, tool, error, and result events render in original order
6. Known provider bookkeeping does not render as chat events
7. Imported provenance uses provider type plus external session ID
8. Changed source transcripts update existing imported chats idempotently
9. Missing source transcripts do not remove imported history
10. Missing project directories do not create broken active workspaces
11. Failed imports are resumable and do not leave unexplained workspace rows
12. Every imported chat remains discoverable even after more than 200 imports
13. Continue in Flow starts a new Flow-owned chat and never writes to the imported source session
14. Default test, typecheck, and lint commands pass
15. Existing users receive at most one dismissible, non-blocking import prompt for the feature release when plausible provider data is present
16. No provider transcript content is read before the person explicitly opens the import surface, and no history is imported before the person selects it
17. Prompt handling is persisted through `user_state.externalHistoryPromptVersion` for dismissal, import-surface review, onboarding completion, successful import, and a completed no-data probe
18. Codex v1 uses rollout files as the canonical history and synchronization source and does not invoke App Server
19. `provider.localHistory` matches `provider.capabilities.localHistory`, and normalized history reuses `StreamEvent` plus one user-event variant
20. `docs/chat-sessions.md` and Agentex documentation describe the same ownership boundary

## 14. Final architecture

```text
Claude Code store             Codex store
        |                          |
        +-----------+--------------+
                    |
                    v
          Agentex local history API
          - provider discovery
          - metadata normalization
          - event normalization
          - stable cursors and IDs
          - source fingerprinting
                    |
                    v
             Flow import service
          - user selection
          - workspace mapping
          - import ledger
          - batch persistence
          - incremental synchronization
                    |
                    v
        Flow workspaces and chat history
          - one searchable history
          - provider provenance
          - source remains untouched
          - continue through a new Flow chat
```

The durable principle is simple:

> Agentex understands agents. Flow understands the person's work.
