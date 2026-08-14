# External Agent History Import and Sync

Status: implemented, pending Agentex 0.0.31 publication and final Flow dependency update

Date: 2026-07-14

Repositories:

- Flow: `~/dynamism/ai-task-manager`
- Agent runtime: `~/dynamism/agentex`

This document is both the implementation specification and the task list. It replaces the earlier Claude and Codex only draft. The status markers below describe the code as of 2026-07-14.

## 1. Outcome

Flow lets a person discover, import, and explicitly synchronize useful saved conversations from:

- Claude Code
- Codex CLI and Codex Desktop rollouts
- OpenCode

Cursor remains a supported live execution harness, including Cursor-routed Grok models, but it is not a saved-history import source. Cursor does not currently expose a stable public saved-history interface that Agentex can support honestly.

The external tool remains the source of truth. Flow stores a normalized, read-only projection so imported history is searchable and remains readable if the original source later disappears.

The ownership boundary is strict:

- Agentex owns provider-specific discovery, history reads, event normalization, stable event identity, source fingerprints or opaque checkpoints, runtime authentication, and compatibility with provider format changes.
- Flow owns user selection, workspace mapping, the import ledger, transactional persistence, synchronization policy, status, API routes, and UI.
- Flow does not walk provider directories or call OpenCode history endpoints directly.
- Neither repository writes to an imported source session.

## 2. Release state

| Area | State | Release note |
| --- | --- | --- |
| Claude local history API | Complete | Uses Agentex `localHistory` |
| Codex local history API | Complete | Uses Agentex `localHistory` |
| OpenCode saved history API | Complete locally | Added in Agentex 0.0.31 |
| Cursor saved history import | Excluded | No stable supported source contract |
| Flow import ledger and migration | Complete | Migration `0004_broad_rachel_grey.sql` |
| Flow Claude, Codex, and OpenCode discovery | Complete | Provider failures stay isolated |
| Initial import | Complete | Explicit selection only |
| Repeatable manual sync | Complete | Settings sync actions and refresh API |
| Background or on-open sync | Deferred | Existing live-session reconciliation is separate |
| Existing-user release prompt | Deferred | No prompt-version persistence in this pass |
| Agentex publication | Blocked on release action | Publish 0.0.31 from Agentex |
| Flow registry dependency | Blocked on publication | Update package and lockfile from 0.0.30 to 0.0.31 |

Agentex 0.0.31 is implemented on local `main`. Flow is validated against that local build. A clean Flow install still resolves 0.0.30 until 0.0.31 is published and the lockfile is refreshed.

## 3. Product decisions

### 3.1 Import is deliberate

Opening Settings performs discovery. Flow persists nothing until the person selects chats and chooses Import.

Imported chats can later be selected again and synchronized. The UI also provides a per-chat Sync or Retry action.

This pass does not:

- Auto-import every conversation
- Run a periodic background synchronizer
- Sync an imported chat merely because it was opened
- Show a one-time upgrade prompt
- Continue writing into the imported external session

### 3.2 Supported source behavior

Claude and Codex are file-backed sources. Agentex discovers and reads their local transcript stores through `provider.localHistory`.

OpenCode is a service-backed source. Agentex starts or reuses an authenticated local OpenCode service and uses `provider.savedHistory`. Flow receives provider-neutral session metadata and normalized events. It does not receive OpenCode storage paths or database details.

Cursor is excluded from saved-history discovery. Flow can start, resume, and live-capture Cursor sessions through Agentex, but it does not inspect Cursor's private local state for archived conversations.

### 3.3 Main useful sessions only

Discovery requests:

- Root sessions only
- At least one meaningful human message
- Archived sessions included

Provider bookkeeping, probes, empty sessions, and subagent-only records are excluded by Agentex.

### 3.4 Imported chats are historical

Initial import creates an archived execution and an archived execution chat with `surface_kind = 'imported_agent'`.

The transcript is read-only in Flow. A future Continue action may create a new Flow-owned chat with a handoff, but it must not append to the imported source session.

Imported events preserve provider timestamps and useful raw payloads. Flow renders them through the normal transcript view and indexes message-bearing rows through its existing database search path.

### 3.5 Provider-qualified identity

External session IDs are only unique within one provider. The durable source identity is:

```text
(provider_type, external_session_id)
```

The browser receives an opaque selection key containing the provider and a base64url encoded external ID. It never receives a trusted transcript path.

Live CLI bindings use the same provider qualification in `chat_sessions`:

```text
(external_provider_type, external_session_id)
```

Historical imports do not occupy the live binding columns. Their provenance and synchronization state live in `external_session_imports`.

### 3.6 Missing source behavior

If an imported source disappears, Flow keeps the imported transcript and marks the ledger `missing` only after that provider completed a successful enumeration.

If discovery fails because authentication, the provider service, or its response is broken, Flow preserves the prior status. A failed enumeration is not evidence that every old source was deleted.

If a source working directory no longer exists, initial import creates an archived placeholder workspace. It does not create a broken active project.

## 4. Agentex contract

### 4.1 Capabilities and provider surfaces

Agentex exposes two history surfaces because file storage details do not belong in the service-backed contract.

```ts
interface ProviderCapabilities {
  localHistory?: boolean
  savedHistory?: boolean
}

interface ProviderModule {
  localHistory?: LocalHistoryOps
  savedHistory?: SavedHistoryOps
}
```

Provider support is:

| Provider | `localHistory` | `savedHistory` |
| --- | --- | --- |
| Claude | Yes | No |
| Codex | Yes | No |
| OpenCode | No | Yes |
| Cursor | No | No |

`attachHistory()` remains separate. It attaches to a known host-owned `SessionRecord` for crash recovery. Saved-history discovery begins without known session IDs and includes human prompts for import.

### 4.2 Service-backed saved history

The public Agentex 0.0.31 contract is:

```ts
interface SavedHistoryOps {
  probe(options?: SavedHistoryProbeOptions): Promise<SavedHistoryProbeResult>
  discover(options?: SavedHistoryDiscoverOptions): AsyncIterable<SavedHistorySession>
  read(
    session: SavedHistorySession,
    options?: SavedHistoryReadOptions,
  ): AsyncIterable<SavedHistoryYield>
}
```

Discovery options include:

- `directory` as an optional provider-session directory filter
- `cwd` as runtime context only
- `includeArchived`
- `mainSessionsOnly`
- `requireUserMessage`
- `limit`
- derived environment and configuration overlays

`SavedHistorySession` exposes provider-neutral metadata only:

- Provider type
- External session ID
- Working directory
- Title
- Start and update timestamps
- Branch and Git origin when known
- Archive state
- Whether a human message exists

`SavedHistoryYield` contains:

- A normalized event with a stable `eventId`
- An opaque provider-owned `HistoryCheckpoint`
- A `partIndex` for multiple normalized rows from one source part

Hosts use `(provider, session id, event id, part index)` for idempotency. A checkpoint is persisted only after the corresponding event transaction commits.

### 4.3 OpenCode implementation

Agentex:

1. Acquires an authenticated OpenCode runtime using the caller's environment and configuration overlays.
2. Uses the global `/experimental/session` catalog when supported.
3. Falls back to the older `GET /session` list for compatible active-session discovery.
4. Reads `/session/:id/message` with bounded backward pagination.
5. Filters nested sessions and sessions without a human message.
6. Normalizes user, assistant, thinking, tool, tool-result, error, and terminal events.
7. Releases the runtime after probe, discovery, or read.

Discovery and reading have hard limits on pages, sessions, messages, and response bytes. A candidate that is concurrently deleted or individually malformed may be skipped. Authentication failures, service failures, invalid systemic responses, and global safety-limit failures abort discovery.

### 4.4 Checkpoint behavior

OpenCode checkpoints are opaque to Flow. The current checkpoint version includes a canonical SHA-256 revision for the source message represented by the checkpoint.

This matters for active sessions. OpenCode can mutate the tail message after an earlier sync. An incremental read rejects a checkpoint whose source revision no longer matches. Flow then requests `bounded_full_resync` and replaces only the imported external projection after the replacement has been staged successfully.

A deleted session produces a stable `source_missing` error for saved-history reads. Existing attachment behavior remains backward compatible.

### 4.5 Derived providers

Derived providers wrap saved-history options with their environment and configuration overlays. OpenCode provider authentication therefore uses the derived provider's isolated credential store rather than the default store.

### 4.6 Public exports

Agentex exports all saved-history types, `HistoryCheckpoint`, and `CapabilityStatus` from the package root. Public type tests protect those exports.

## 5. Flow data model

### 5.1 `external_session_imports`

The import ledger has one row per imported source:

```text
id
created_at
updated_at
chat_session_id
provider_type
external_session_id
source_kind                  file | service
source_path                  server only, file sources only
source_size
source_modified_at_ns
source_content_sha256
source_updated_at
sync_offset
sync_last_event_id
history_checkpoint           opaque JSON, service sources only
status                       importing | current | changed | missing | error
last_scanned_at
last_synced_at
last_error
```

Required constraints:

- Unique `chat_session_id`
- Unique `(provider_type, external_session_id)`
- Cascade ledger deletion when the imported chat is deleted
- Index `status`

The ledger owns historical import state. `chat_sessions.external_*` fields remain reserved for the current live CLI binding.

### 5.2 Migration 0004

Migration `0004_broad_rachel_grey.sql`:

1. Creates `external_session_imports` and its indexes.
2. Replaces global live-session ID uniqueness with provider-qualified uniqueness.
3. Adds `chat_sessions.external_provider_type`.
4. Moves legacy `surface_kind = 'imported_agent'` rows into the new ledger.
5. Clears live binding fields from those imported chats.
6. Backfills provider type for existing live Claude, Codex, Cursor, and OpenCode bindings.

Legacy file imports have no trusted content hash. Their first later sync performs a full staged replay rather than assuming the old byte offset is safe.

### 5.3 Event identity

Imported events use the existing unique key:

```text
(chat_session_id, external_event_id, source_part_index)
```

`ON CONFLICT DO NOTHING` makes incremental replay idempotent. Replacement sync deletes only rows with an external event ID in that imported chat. It does not delete unrelated app-owned rows.

## 6. Flow workflows

### 6.1 Discovery

`discoverExternalAgentSessions()` runs all supported providers concurrently.

For Claude and Codex it calls:

```ts
provider.localHistory.probe()
provider.localHistory.discover(...)
```

For OpenCode it calls:

```ts
provider.savedHistory.probe(runtime)
provider.savedHistory.discover({
  ...runtime,
  includeArchived: true,
  mainSessionsOnly: true,
  requireUserMessage: true,
})
```

Flow then:

1. Validates absolute working directories and bounded external IDs.
2. Deduplicates by provider-qualified source identity.
3. Joins discovered candidates with the ledger.
4. Reports `current` or `changed` from the source fingerprint or update timestamp.
5. Adds ledger-only missing rows so an imported chat does not vanish from Settings.
6. Marks a ledger missing only when its provider enumeration completed.
7. Groups chats by literal normalized working directory.

Different worktrees are not merged merely because they share a Git remote.

### 6.2 Initial import

For each selected source Flow:

1. Resolves the opaque key against a fresh trusted server-side discovery result.
2. Reuses a workspace whose normalized `cwd` matches.
3. Creates an active workspace for an existing directory or an archived placeholder for a missing directory.
4. Creates an archived execution, archived chat, and `importing` ledger row in one transaction.
5. Reads and normalizes the source into bounded staging memory, committing it as a sequence of windows.
6. Commits each window plus the ledger position it leaves behind in one database transaction.
7. Removes the new skeleton and any unused newly created workspace if import fails.

Each selected chat is an independent unit. One failed source does not roll back successful imports of other selected chats.

### 6.3 File synchronization

Claude and Codex synchronization uses Agentex fingerprints and reads.

Before treating source growth as append-only, Flow verifies the SHA-256 hash of the previously synchronized prefix. It forces a full staged replay when:

- The path changed
- The source shrank
- The same-sized content changed
- The old prefix hash changed
- A legacy row has an offset but no verified hash

Flow fingerprints before and after reading. Size, nanosecond mtime, and full SHA must remain stable. If the source changes during the read, the pending window is discarded and the sync fails.

The committed offset advances to stable EOF, including provider records that normalize to no Flow event.

### 6.3.1 Commit windows

Transcript size is unbounded in practice: a long agent session can reach hundreds of megabytes, several times that once normalized. Flow therefore never holds a whole transcript in memory. Normalized events accumulate to a fixed byte budget and are then committed as one window, so memory tracks the window size rather than the source size.

Each window leaves the ledger describing exactly the prefix it committed: `sync_offset` and `source_size` at the window boundary, and `source_content_sha256` over `[0, boundary)`. Consequences:

- An interrupted sync keeps the work it already read. The next sync verifies that prefix hash and resumes from the boundary instead of replaying from zero.
- A partly synchronized transcript reports `changed`, never `current`, because the recorded prefix is shorter than the source.
- The prefix hash is rolled forward as bytes are consumed, so windowing costs one extra sequential read of the source rather than a re-hash per window.

A window may only close on a source-record boundary. One transcript line, or one provider part, can normalize into several events that share an offset or checkpoint, and committing a position mid-group would skip that group's remaining events on resume.

A replacement's delete rides along with its first window rather than running up front, so a read that fails before producing anything leaves the previous transcript intact.

### 6.4 OpenCode synchronization

OpenCode synchronization starts from the ledger's opaque checkpoint.

- A valid checkpoint performs an incremental read.
- No checkpoint performs a bounded full read.
- `history_checkpoint_not_found` triggers a bounded full resync, but only from a standing start. Once a window has committed, the ledger already holds a newer checkpoint and the next sync resumes from it.
- A no-op incremental read preserves the existing checkpoint.
- `source_missing`, malformed history, a provider error, or a provider size-limit error preserves the old transcript.

The first window of a replacement deletes the old external rows in the same transaction that writes its own, so a failure before then leaves the old transcript untouched.

### 6.5 Concurrency

Flow serializes import or sync work by provider-qualified ledger identity. Two requests for the same source cannot stage from the same old state and commit out of order.

Requests for different imported sources may run concurrently. Database transactions remain the final atomic boundary for transcript and checkpoint updates.

### 6.6 Status

Public UI status is:

- `not_imported`
- `importing`
- `current`
- `changed`
- `missing`
- `error`

`not_imported` is a discovery-only status and is not stored in the ledger.

Failed synchronization stores a bounded safe error string. It does not expose secrets or transcript content in normal logs.

## 7. Flow API and UI

### 7.1 API

`GET /api/imports/agents`

- Probes and discovers Claude, Codex, and OpenCode on the Flow host
- Returns source summaries, projects, sessions, import status, and opaque keys
- Does not expose transcript paths or credentials

`POST /api/imports/agents`

```json
{
  "sessionKeys": ["opencode:opaque-id"]
}
```

- Imports new selections
- Synchronizes already imported selections
- Accepts at most 1,000 unique keys
- Returns separate imported, synchronized, skipped, workspace, event, and failure counts

`POST /api/imports/agents/refresh`

```json
{
  "chatSessionIds": ["flow-chat-id"]
}
```

- Resolves imported chats through the ledger
- Reuses the same trusted discovery and synchronization pipeline
- Supports explicit callers without exposing provider source identity to the browser

### 7.2 Settings experience

Settings shows source cards for Claude Code, Codex, and OpenCode.

The import panel:

- Groups chats by project directory
- Shows up to three chats until a project is expanded
- Supports project and individual selection
- Keeps already imported chats selectable
- Labels current, changed, missing, and failed sources
- Offers per-chat Sync or Retry
- Offers bulk Import, Sync, or Import and sync
- Refreshes discovery separately through Refresh list
- Keeps missing-only imported chats visible
- Reports imported and synchronized outcomes separately

The panel text states that Flow reads local history without changing it.

## 8. Safety invariants

The implementation must preserve all of these:

1. Provider source stores are read-only.
2. Flow never appends a prompt to an imported source session.
3. Browser responses never reveal trusted transcript paths or credentials.
4. Source identity includes provider type.
5. Missing status requires a completed provider enumeration.
6. A failed initial import leaves no empty chat, execution, ledger, or unused workspace.
7. A replacement that fails before its first window leaves the prior transcript and checkpoint intact.
8. A source that changes during read is retried later. The retry resumes from the last committed window.
9. Concurrent syncs for one source cannot commit out of order.
10. Checkpoints and offsets advance only with the event transaction, and only to a source-record boundary.
11. Staging memory is bounded by the commit window, not by transcript size. No source is too large to import.
12. Raw payloads and errors are handled without logging secrets by default.

## 9. Verification requirements

### 9.1 Agentex

Required unit and contract coverage:

- Root export and public type tests
- Saved-history capability parity
- Global OpenCode project discovery
- Archived and root-session filtering
- Human-message eligibility
- Directory filter separate from runtime cwd
- Authenticated runtime acquisition and release
- Derived environment and credential overlays
- Bounded session and message pagination
- Stable event IDs and part indexes
- User, assistant, thinking, tool, result, and terminal normalization
- Incremental checkpoint reads
- Mutable tail invalidation
- Bounded full resync
- Stable `source_missing`
- Isolation of deleted or candidate-local malformed sessions
- Propagation of systemic authentication, service, and invalid-response failures
- Backward compatibility for `attachHistory`, Claude `localHistory`, and Codex `localHistory`

Release gate:

- Typecheck passes
- Build passes
- Focused saved-history tests pass
- Full Agentex suite passes

### 9.2 Flow

Required coverage:

- Claude, Codex, and OpenCode discovery
- Provider-qualified same-ID behavior
- Opaque selection keys
- Existing and missing-directory workspace mapping
- Initial import event order and timestamps
- Repeat import becomes synchronization
- Incremental file growth
- Stable EOF after filtered records
- Truncation and same-sized rewrite full replay
- Prefix rewrite with larger source full replay
- Legacy unverified hash full replay
- Source mutation during read rollback
- Multi-window import of a transcript larger than one commit window
- Resume from the last committed window after an interrupted read
- OpenCode incremental checkpoint synchronization
- Mutable or stale checkpoint full replacement
- No-op checkpoint preservation
- Deleted or malformed source transcript preservation
- Failed full-resync transcript preservation
- Failed first-import cleanup
- Concurrent same-ledger synchronization serialization
- Provider enumeration failure does not mark imports missing
- Missing-only UI state
- Migration from 0003 with legacy imported and live-bound rows
- Cross-provider same external ID allowed
- Same-provider duplicate external ID rejected

Release gate:

- Focused Vitest suites pass
- TypeScript passes
- Scoped ESLint has no errors
- Full test suite passes or every unrelated failure is documented
- Production build passes

## 10. Combined implementation task list

### Agentex 0.0.31

- [x] Add `savedHistory` capability and provider surface.
- [x] Add and export provider-neutral saved-history types.
- [x] Export `CapabilityStatus` from the package root.
- [x] Wrap saved history with derived provider environment and configuration.
- [x] Implement authenticated OpenCode global discovery.
- [x] Separate provider `directory` filtering from runtime `cwd`.
- [x] Include archived root sessions with meaningful user messages.
- [x] Implement normalized OpenCode history reads with user messages.
- [x] Implement stable event identity and opaque checkpoints.
- [x] Detect mutable tail revisions.
- [x] Implement bounded full resync and stable missing-source errors.
- [x] Bound catalog and message inspection.
- [x] Keep Claude and Codex local-history behavior compatible.
- [x] Keep OpenCode attachment behavior compatible.
- [x] Abort discovery on systemic auth, server, and response failures.
- [x] Add focused regression coverage.
- [x] Pass typecheck, build, focused tests, and full suite.
- [ ] Publish `@agentex/agent` 0.0.31.

### Flow schema and migration

- [x] Add `external_session_imports`.
- [x] Add provider-qualified ledger uniqueness.
- [x] Add `chat_sessions.external_provider_type`.
- [x] Replace global live external-ID uniqueness with provider-qualified uniqueness.
- [x] Backfill legacy imported chats into the ledger.
- [x] Clear historical import state from live binding columns.
- [x] Backfill provider type for existing live bindings.
- [x] Add a 0003 to 0004 migration fixture covering imported and live rows.

### Flow service and API

- [x] Use Agentex `localHistory` for Claude and Codex.
- [x] Use Agentex `savedHistory` for OpenCode.
- [x] Remove provider storage parsing from Flow import code.
- [x] Add provider-qualified opaque selection keys.
- [x] Add ledger-aware discovery and missing rows.
- [x] Add explicit initial import.
- [x] Add explicit repeatable synchronization.
- [x] Add staged and atomic replacement.
- [x] Commit long transcripts in bounded, resumable windows.
- [x] Verify file prefix and stable full fingerprint.
- [x] Preserve service checkpoints on no-op reads.
- [x] Preserve existing transcripts on failed sync.
- [x] Clean up failed initial import skeletons.
- [x] Serialize concurrent work for one ledger.
- [x] Add the refresh-by-chat endpoint.
- [x] Enforce selection bounds and bound staging memory by commit window.

### Flow UI

- [x] Add OpenCode to the import source cards.
- [x] Keep imported chats selectable.
- [x] Add current, changed, missing, and error labels.
- [x] Add per-chat Sync and Retry.
- [x] Add bulk Import, Sync, and mixed actions.
- [x] Keep missing-only rows visible.
- [x] Report imported and synchronized counts separately.
- [x] Add focused UI tests.

### Documentation and release

- [x] Update this implementation spec and task list.
- [x] Update chat-session architecture ownership notes.
- [x] Update the harness expansion spec with OpenCode history and Cursor scope.
- [ ] Publish Agentex 0.0.31.
- [ ] Update Flow `package.json` to `@agentex/agent: ^0.0.31`.
- [ ] Refresh `pnpm-lock.yaml` from the registry package.
- [ ] Perform a clean install validation.
- [ ] Run final Flow full suite and production build against the registry package.
- [ ] Smoke test Settings discovery, OpenCode import, OpenCode sync, Claude import, and Codex import with real supported binaries.

## 11. Deferred task list

These are not hidden launch requirements for this pass:

- [ ] Add background, startup, or imported-chat-open synchronization if product usage warrants it.
- [ ] Add a one-time existing-user discovery prompt and persisted dismissal version.
- [ ] Add search, pagination, or virtualization inside the import catalog for unusually large stores.
- [ ] Add a Continue action that creates a new Flow-owned chat with an explicit handoff.
- [ ] Add cross-process database compare-and-swap if Flow moves from one local server process to multiple concurrent writers.
- [ ] Add Cursor saved-history import only after Cursor exposes a stable supported history API or Agentex can define a durable compatibility contract with acceptable maintenance risk.
- [ ] Add provider-specific diagnostics UI without exposing transcript content or secrets.

## 12. Acceptance criteria

This implementation is ready to ship when:

1. A clean Flow install resolves published Agentex 0.0.31 or newer.
2. Settings discovers eligible Claude, Codex, and OpenCode chats on the Flow host.
3. A person can import selected chats without changing any provider source.
4. Imported chats appear archived with provider provenance and useful event fidelity.
5. A person can explicitly sync one or several imported chats.
6. File append, rewrite, truncation, and concurrent mutation paths cannot corrupt the prior projection.
7. OpenCode incremental and full-resync paths cannot corrupt the prior projection.
8. A missing source remains readable in Flow.
9. Provider discovery failure does not falsely mark all prior imports missing.
10. Concurrent sync requests for one source cannot roll history or checkpoints backward.
11. Legacy prototype imports migrate without losing their transcripts.
12. Cursor is presented honestly as live execution only, not as an import source.
13. Agentex and Flow release gates pass against the published dependency.

## 13. Final architecture

```text
Claude files ----> Agentex localHistory ----+
                                             |
Codex files -----> Agentex localHistory -----+--> Flow discovery/import service
                                             |      |
OpenCode API ----> Agentex savedHistory -----+      +--> external_session_imports
                                                    +--> archived execution/chat
                                                    +--> normalized chat_events

Cursor ----------> Agentex live execution only
```

Agentex knows provider history formats. Flow knows product persistence and synchronization policy. The browser sees projects, chats, status, and opaque keys. It never becomes a provider transcript parser or a credential boundary.
