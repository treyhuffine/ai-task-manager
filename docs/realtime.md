# Realtime: How chat state flows from executor to UI

How the active-chat surface stays live without polling, how it survives crashes and disconnects, and how the moving pieces fit together.

## TL;DR

**One EventSource per active session pushes everything the chat UI needs.** New events, runtime running/idle, pending-input requests, and reconcile-in-progress signals all ride the same SSE channel. Snapshot fetches on mount + window focus stay around as a fallback if the stream is unavailable; the dedup logic makes overlap harmless.

**The DB is the source of truth, the Claude/Codex on-disk JSONL is the durable backstop.** Live executor events are persisted to `chat_events` and then broadcast to SSE subscribers from the same chokepoint. When the server crashes or the live stream misses an event, a transcript reconcile reads forward from disk and fills the gap.

**The pipeline has one chokepoint.** Every write to `chat_events` — live executor, CLI/MCP, direct user-message writes from the messages route — goes through `insertChatEvent`, which publishes the row to the bus after it lands. No bypass path exists; if a row makes it into the table, every connected client sees it.

## What this replaced

Previously each active chat polled at three different cadences:

| Hook | Endpoint | Interval |
|---|---|---|
| `useSessionEvents` | `/api/sessions/:id/events` | 3s |
| `useRuntimeStatus` | `/api/sessions/:id/runtime-status` | 2s |
| `usePendingInput` | `/api/sessions/:id/pending-input` | 1.5s |

That meant **~5 RTT/sec per open chat tab**, with the well-known two-clocks race where the "thinking" indicator and the trailing agent message disappeared up to 3 seconds out of sync. After the migration, an active chat tab makes **zero polled RTTs**; new events appear in the transcript within ~10ms of insertion.

## The data flow

```
agentex StreamEvent
        │
        ▼ (onEvent callback in adapter.ts)
persistStreamEvent ──► parseStreamEvent ──► CreateChatEventInput
                                                │
                                                ▼
                                  insertChatEvent (queries.ts)
                                                │
                                  ┌─────────────┴─────────────┐
                                  ▼                            ▼
                              SQLite                    publishChatEvent
                              (chat_events row)         (bus.ts)
                                                              │
                                              ┌───────────────┴───────────────┐
                                              ▼                                ▼
                                       SSE writer (tab A)           SSE writer (tab B)
                                              │                                │
                                              ▼                                ▼
                                       useSessionStream                 useSessionStream
                                       (setQueryData)                   (setQueryData)
                                              │                                │
                                              ▼                                ▼
                                       transcript renders             transcript renders
```

Three things ride the same per-session bus channel:

- `chat_event` — new row in `chat_events`. Carries the full row. Tagged with `id: <chat_event.id>` so the browser's EventSource sends it back as `Last-Event-ID` on reconnect.
- `runtime` — `{ running: boolean }`. Published from `adapter.ts:setRunning` whenever the executor flips the in-process `runningSessions` set.
- `pending_input` — `{ pending: PendingInput[] }`. Published from `pending-input.ts:notify` after `register` / `resolveRequest` / `rejectAllForSession`.
- `reconcile` — `{ status: 'started' | 'done' }`. Published from `reconcile.ts` when on-disk transcript replay is in flight.

## The bus (`src/lib/realtime/bus.ts`)

In-process pub/sub. State lives on `globalThis` under a Symbol key so it survives Next.js HMR reloads — same pattern as `executor/adapter.ts`'s `agentSessions` cache. Channels are strings; the per-session channel name is `session:<id>`.

```ts
publish(channel, message)        // synchronous fan-out to subscribers
subscribe(channel, listener)     // returns unsubscribe()

// Convenience helpers used by callers:
publishChatEvent(row)            // sessionChannel from row.session_id
publishRuntime(sessionId, running)
publishPendingInput(sessionId, pendingList)
publishReconcileStarted(sessionId)
publishReconcileDone(sessionId, replayed)
```

No replay buffer in memory. Subscribers that connect after a message was published miss it; reconnect is handled by the SSE route reading from `chat_events` directly (see below).

Single-Node-process design. If we ever shard to multiple Node instances, swap the bus implementation for SQLite `pragma data_version` polling + a wake channel, or Postgres `LISTEN/NOTIFY`. Public interface (publish/subscribe + helpers) stays the same.

## The SSE endpoint (`/api/sessions/:id/stream`)

One route. Lifecycle on connect:

1. **Subscribe to the bus first.** Any message published during step 2 still reaches the client. Client dedups on `chat_event.id`; `runtime` and `pending_input` are last-write-wins per session, so out-of-order arrivals self-correct.
2. **Replay missed `chat_event`s if `Last-Event-ID` header is set.** `listChatEventsAfter(sessionId, lastEventId)` query — capped at 1000 rows; if the client has drifted further than that, snapshot refetch via the events route fills the gap.
3. **Send connect-time `runtime` and `pending_input` frames.** Both are in-process module-state lookups (Set/Map); sub-microsecond, no DB hit. Saves the client from issuing two separate snapshot fetches just to hydrate the indicator and overlay.
4. **Send `ready`.**
5. **25s keepalive** (`: ping\n\n` comment lines) so proxies/load-balancers don't drop the connection during idle stretches.

Auth: cookie-based via the existing `proxy.ts` middleware. `proxy.ts` accepts either `Authorization: Bearer <token>` or the `SESSION_COOKIE_NAME` cookie. EventSource can't attach headers but cookies flow natively. No client-side auth wiring needed for SSE.

## The reconciliation primitive

The DB is canonical for normal operation, but it can fall behind in two cases: server crash mid-turn, or live executor stream missing events (rare, but possible with stdio glitches). Reconciliation closes those gaps from the provider's on-disk JSONL.

### When it runs

- **Cold start** — non-blocking sweep over every non-archived session with an `external_session_id`. Called from `instrumentation.ts` after the mirror init. Sequential, no DB-write contention.
- **On session visit** — POST `/api/sessions/:id/reconcile` fires from `useSessionReconcile` when the user opens a session. Fire-and-forget from the client's perspective; the indicator is driven by the SSE `reconcile: started` / `done` frames so any tab open to the session surfaces it consistently.

### The cursor

Three columns on `chat_sessions`:

- `external_transcript_path` — absolute path to the JSONL. Resolved once, cached.
- `external_sync_offset` — byte offset of the next byte we'd read. Advanced after each line processed.
- `external_sync_last_event_id` — for Claude, the wire uuid of the last replayed event. Belt-and-braces dedup; not used by Codex (no stable wire id).

Drift check is a single `fs.stat`: if the file size hasn't grown beyond `external_sync_offset`, no replay. If it has, stream-read from that offset and apply.

### First-ever reconcile per session

Special case. Existing `chat_events` rows from before reconciliation landed used minted uuid7s as `external_event_id`. After the parseStreamEvent change, new live writes use the wire uuid. If reconciliation replayed the JSONL for an existing session, the wire-uuid rows wouldn't collide with the historical minted-uuid rows on the partial unique index → duplicates.

Fix: when `external_sync_offset` is null, just initialize the cursor at the current file head and don't replay. From that point forward, both live and replay paths use the wire uuid and dedup correctly.

This makes the first reconcile per pre-existing session lossy for that session's historical drift — if a session had missed events from before the migration, we won't catch them. Acceptable; the app wasn't live, and going forward every new session gets correct coverage.

### Provider differences

| | Claude | Codex |
|---|---|---|
| Path discovery | `getClaudeTranscriptPath` — O(1), needs cwd | `getCodexTranscriptPath` — date-tree scan, needs only sessionId |
| Path encoding | `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl` | `~/.codex/sessions/YYYY/MM/DD/rollout-<TS>-<sessionId>.jsonl` |
| Yielded type | `StreamEvent` (translates directly via `parseStreamEvent`) | `CodexTranscriptLine` (raw + outer type + payload; needs version-specific translation) |
| Wire id | `eventId` populated → carries to `external_event_id` → DB dedup | No stable id → cannot dedup at DB level |
| Skip when `isRunning`? | No — wire-uuid dedup makes concurrent live + replay safe | Yes — defer to live stream while a turn is mid-flight |

The Codex on-disk format diverges from its wire format and is version-specific. The translator (`src/lib/executor/codex-on-disk.ts`) handles the variants observed in recent Codex versions:

- `response_item/message` (role=assistant) → `agent`
- `response_item/reasoning` → `thinking`
- `response_item/function_call` → `tool_call`
- `response_item/function_call_output` → `tool_result`
- `event_msg/task_complete` → `result`

Other event_msg variants (`agent_message`, `agent_reasoning`, `token_count`, `task_started`) are dropped — they duplicate `response_item` content or are pure telemetry. `session_meta` and `turn_context` are metadata.

## The "syncing" indicator

Renders only when (a) the server confirms drift exists and starts a replay, and (b) the client's SSE has delivered the `reconcile: started` frame. Disappears on `reconcile: done`. The composer stays enabled the whole time — replay is informational, not blocking. Cross-tab consistent.

## Identity & idempotency

`chat_events.external_event_id` holds the provider's wire-level event id when available, minted uuid7 otherwise. Partial unique index on `(session_id, external_event_id, source_part_index) WHERE external_event_id IS NOT NULL` makes idempotent inserts safe:

- Claude: wire `uuid` from each `StreamEvent` lands in this column. Live + replay → no duplicates.
- Codex: no wire id → minted uuid → no DB-level dedup → reconcile defers to live when `isRunning` to avoid concurrent paths.
- In-app user-message writes from the messages route: no `external_event_id` (null) → not in the partial unique index, so no dedup attempted. Fine: the messages route is the sole writer for `source: 'user'`.

## Derived UI: turn completion

When the agent is mid-turn, `ThinkingState` shows animated dots + an elapsed timer anchored to the latest user message. When `runtime.running` flips false, the indicator disappears and the composer is enabled — that's the canonical "you can respond now" signal. We don't render any other turn-state affordance; the running indicator + composer state is sufficient.

Note on agentex contracts: prior to 0.0.13, session-mode `result` events bypassed `onEvent` and only surfaced via `send()`'s `TurnResult` return value. That caused `chat_events` to never receive a `result` row, and an earlier "may be incomplete" indicator (since removed) fired on every clean completion as a result. 0.0.13 routes `result` through `onEvent` in session mode too, matching one-shot behavior — every turn boundary now lands in `chat_events` with `source: 'result'` carrying cost/usage/stopReason in `raw`. The change also added an awaited event chain (`_eventChain`), so handlers run serially in event order and `send()` resolves only after every handler for the turn has settled. For us this means `chat_events` is guaranteed to contain the result row before `runtime: false` publishes — no race between the DB-of-record and the UI's idle signal.

## What's still polled (and why)

The active-chat surface is fully push. Dashboard-level state is still polled because:

| Hook | Interval | Why |
|---|---|---|
| `useNeedsReviewSessions` | 5s | Cross-session list; updates infrequently; cost of a global push channel isn't justified |
| `AuthRecoveryCard` stuck-sessions | 30s | Slow-changing safety-net surface |
| `useClaudeAuthStatus` | 10s | Out-of-band logins from another terminal need a catch-up channel; SSE doesn't help since the change happens outside the app |
| `useSession` (no interval) | focus-only | Session row changes are rare; focus refetch is enough |
| Worktree provisioning setInterval | 1.5s | Short-lived (only during 2–5s worktree creation window) |

If any of these become noticeable, the same per-channel bus pattern extends naturally.

## Resume / reconnect / multi-tab

- **EventSource native reconnect.** On disconnect, the browser retries with the last `id:` it observed, sent as `Last-Event-ID`. The SSE route replays from `chat_events WHERE id > lastEventId` via `listChatEventsAfter`. UUIDv7 ids are monotonic-per-process, so id-comparison is a cheap, correct cursor without a separate sequence column.
- **Multi-tab.** Each tab opens its own EventSource. Bus fans out to all subscribers. No cross-tab coordination needed.
- **Laptop sleep / network blip.** Same path as reconnect — Last-Event-ID covers it.
- **Server restart mid-turn.** Live stream subscriber dies with the process. On boot, `instrumentation.ts` kicks the reconcile sweep, which reads forward from each session's saved offset, applies missed events through the normal write path (which broadcasts via the bus), and any reconnecting client sees the catch-up as live `chat_event` frames.

## Files

| File | Role |
|---|---|
| `src/lib/realtime/bus.ts` | The pub/sub primitive + helpers |
| `src/app/api/sessions/[id]/stream/route.ts` | Per-session SSE endpoint |
| `src/app/api/sessions/[id]/reconcile/route.ts` | On-visit reconcile trigger |
| `src/hooks/use-session-stream.ts` | Client EventSource → TanStack cache mutator |
| `src/hooks/use-session-reconcile.ts` | Fires reconcile on session mount; exposes `reconciling` boolean |
| `src/lib/executor/reconcile.ts` | Drift check + replay per provider |
| `src/lib/executor/codex-on-disk.ts` | Codex on-disk → CreateChatEventInput translator |
| `src/lib/db/queries.ts` (`insertChatEvent`, `listChatEventsAfter`, `listReconcilableSessions`) | Chokepoint + cursors |
| `src/lib/executor/adapter.ts` (`setRunning`, `persistStreamEvent`, `parseStreamEvent`) | Live publish points |
| `src/lib/executor/pending-input.ts` (`notify`) | Pending-input publish point |
| `instrumentation.ts` | Cold-start reconcile sweep |
| `src/components/executions/syncing-pill.tsx` | "Syncing transcript" indicator |

## Agentex contracts we depend on

- `@agentex/agent` ≥ 0.0.13.
  - Transcript helpers from 0.0.11: `getClaudeTranscriptPath`, `peekClaudeTranscript`, `readClaudeTranscript`, `getCodexTranscriptPath`, `peekCodexTranscript`, `readCodexTranscript`.
  - From 0.0.13: session-mode `result` events flow through `onEvent` (parity with one-shot), and `onEvent` handlers are awaited in event order — `send()` resolves only after every handler for the turn has settled. We rely on both: the former so `parseStreamEvent`'s `case 'result'` branch actually fires, the latter so the `chat_events` write completes before `setRunning(false)` publishes runtime idle.
- `StreamEvent.eventId` populated for Claude (wire uuid). Null for Codex — that's why Codex defers when `isRunning`.
- The on-disk format for Claude's JSONL is the same shape `parseStreamLine` consumes from stdout. For Codex it isn't; we own the translator.

## Outdated cross-references

- `docs/chat-sessions.md` includes the line "For CLI-backed executor sessions we spawned, agentex's stdio is the sole writer." That was true before this migration. Now there's a second writer for CLI sessions: the on-disk transcript reconciler. Both routes go through `insertChatEvent` and dedup correctly via wire-uuid (Claude) or by deferring while running (Codex), so the invariant "exactly one in-flight writer per session" still holds — just under a different mechanism.
