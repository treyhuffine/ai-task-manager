# Message queue v1 — implementation checklist

Reviewed by the agentex maintainer's agent. Architectural shape locked
in; this is the build sheet. Each box is independently meaningful so
we can pause, ship, or split a PR at any phase boundary.

---

## Design summary

Users want to type follow-up messages while the agent is still
working — Claude Code TUI behavior. Send arrow stays "send" when the
composer has text; stop button only takes the slot when the composer
is empty *and* a turn is in flight. Queued messages render as chips
above the composer with per-message × and an up-arrow pop-all.

We're building a **pre-send buffer in our Node process**, with the
SQLite `chat_events` table as the source of truth (no in-memory
shadow store). `agentex.session.send()` is only ever called between
turns. The Claude Code TUI shares its in-binary queue with the agent
loop and uses mid-turn drain — we're consciously giving that up for
turn-atomic semantics, in exchange for:

- Authoritative client-side state (no shadow of the CLI's internal
  queue, no cancel race, no "best-effort").
- Identical UX across Claude and Codex sessions.
- DB-persisted queue that survives Node restart.
- Up-arrow pop-back is a one-line server response.

The cost: a mid-turn message lands as a *new* turn after the active
one ends, rather than being injected into the current turn as a
`<system-reminder>`. For a chat-style UX this is a fine predictable
boundary; for long-running task work it loses the responsiveness
Claude's mid-turn drain offers. We accept that for v1; see "Future
direction" below.

**Sourced from**:
- `internal-docs/concurrent-send-integration-ai-task-manager.md`
  (the agentex 0.0.17 integration guide)
- Claude Code open-source TUI patterns
  (`/Users/treyhuffine/code/claude-code-open-source/src/utils/messageQueueManager.ts`,
  `useQueueProcessor.ts`)
- Agentex-agent review feedback (see /memory & inline review notes)

---

## Phase 0 — Revert the in-CLI shadow queue (cleanup)

Half-built work from the earlier Option-A direction. Get back to a
clean trunk before building the right thing.

- [x] Bump `@agentex/agent` from `^0.0.16` → `^0.0.17` in
      `package.json`, run `pnpm install`. *(already done)*
- [x] In `src/lib/executor/adapter.ts`:
  - [x] Revert `dispatch()` to its prior signature
        `(chatSessionId, userMessage, writer = localEventWriter)`.
        Keep the `already_running` gate exactly as it was.
  - [x] Migrate the call site to the new `SendHandle` shape:
        `const { result } = await agentSession.send(msg); await result;`
        (Phase-1 of the agentex integration doc — the only thing we
        keep from 0.0.17.)
  - [x] Remove `queueByChatSession` from `ExecutorState` and the
        globalThis init.
  - [x] Remove `pushQueue`, `removeFromQueue`, `setQueue`,
        `getQueue`, `listQueued`, `cancelQueued`,
        `clearQueueAndReturn`, `getHarnessCapabilities`.
  - [x] Remove the `publishQueued` import.
  - [x] Remove the `setQueue` call in `close()`.
- [x] In `src/lib/realtime/bus.ts`:
  - [x] Remove the `'queued'` variant of `SessionStreamMessage`.
  - [x] Remove `publishQueued`.
  - [x] Remove the `QueuedSend` type import.
- [x] In `src/app/api/sessions/[id]/stream/route.ts`:
  - [x] Remove the `case 'queued'` handler.
- [x] Delete `src/lib/executor/queue-types.ts`.
- [x] `pnpm ts` — clean. *(verified after Phase 2 wired up.)*

---

## Phase 1 — Data model

The DB column is the entire persistence layer for the queue. No
Node-side module state.

- [x] Add column to `chat_events` in `src/lib/db/schema.ts`:
      `queued_at TEXT` (ISO timestamp; nullable). Index on
      `(session_id, queued_at)` partial where `queued_at IS NOT NULL`
      so the per-session queue query is O(queue size).
- [x] Regenerate Drizzle migration:
      `pnpm db:generate` → review SQL → `pnpm db:push`.
      *(Generated as `drizzle/0014_condemned_star_brand.sql`.
      `db:push` is locked out by the running dev server — restart
      it and `getDb()` auto-applies the migration on first request,
      per the project's standard pattern.)*
- [x] Update `ChatEventRecord` / `CreateChatEventInput` in
      `src/db/types.ts` (derived from schema — picks up the new
      column automatically via `InferSelectModel`/`InferInsertModel`).
- [x] Confirm `insertChatEvent` in `src/lib/db/queries.ts` accepts
      `queued_at` on the input shape. Default null. *(Derived via
      `InferInsertModel<typeof chatEvents>` — flows through the
      existing `{ ...input, id }` spread without code change.)*

---

## Phase 2 — Server queries + dispatch drain

The drain happens inline inside `dispatch()`'s finally. Per the
agentex agent's Q1+Q2 answers, this is the cleanest hook (the awaited
`result` Promise *is* the turn-end signal) and re-entering
`session.send()` from inside the prior resolver is safe — the session
state machine has already returned to `idle` by then.

The loop has **two safety gates** between turns. The first absorbs the
client-side Stop race (interrupt + bulk-delete fire in parallel; if
interrupt lands while some DELETEs are still in flight, we must not
dispatch the leftover rows as a follow-up turn). The second prevents
N-failed-turns spam when a turn fails persistently (auth_required,
execution_error, max_turns/budget) — leave queued chips intact so the
user can fix the underlying problem and retry.

### Queries

- [x] Add to `src/lib/db/queries.ts`:
  - [x] `listQueuedChatEvents(sessionId: string): ChatEventRecord[]`
        — `WHERE session_id = ? AND queued_at IS NOT NULL ORDER BY
        created_at, id`.
  - [x] `clearQueuedFlags(sessionId: string): ChatEventRecord[]` —
        atomic: SELECT the queued rows, UPDATE
        `SET queued_at = NULL`, return the snapshot. Used by drain.
        Each row updated publishes via the existing
        `publishChatEvent` so the SSE channel delivers the
        post-drain version to the transcript.
  - [x] `deleteQueuedChatEvent(sessionId, eventId): boolean` —
        DELETE only when `queued_at IS NOT NULL` (so we can't
        accidentally nuke a real transcript row by id). Returns
        whether a row was removed.

### Executor state

- [x] In `src/lib/executor/adapter.ts`, add a `stoppingSessions:
      Set<string>` to `ExecutorState` (alongside the existing
      `runningSessions`). Stash on globalThis with the rest. HMR
      migration: initialize if absent on the existing state object.
- [x] Helpers (no SSE publish — the flag is internal coordination,
      not UI state):
  - [x] `markStopping(chatSessionId): void`
  - [x] `clearStopping(chatSessionId): void`
  - [x] `isStopping(chatSessionId): boolean`
- [x] Clear the flag in `_resetExecutorState()` and on `close()`.

### Dispatch drain loop

- [x] Rework `dispatch()` to loop with both gates:
      ```ts
      setRunning(chatSessionId, true);
      clearStopping(chatSessionId);   // fresh dispatch — drop any
                                      // stale flag from a prior cycle
      try {
        const agentSession = await ensureAgentSession(...);
        let nextMsg: string | null = userMessage;
        while (nextMsg !== null) {
          const { result } = await agentSession.send(nextMsg);
          const tr = await result;

          // Gate 1 — Stop intent. The interrupt route marks this
          // flag *before* it calls abort(), so by the time `result`
          // resolves (with status 'aborted'), the flag is already
          // visible. Break without draining so any chips that hadn't
          // been DELETE'd by the parallel client request survive as
          // queued rows — the user can pop them back into the
          // composer via ↑ or fire a fresh dispatch later.
          if (isStopping(chatSessionId)) break;

          // Gate 2 — Persistent failure. Anything other than a clean
          // completion (auth_required, execution_error, max_turns,
          // max_budget, aborted-without-stop-flag) means a follow-up
          // turn won't help and would just spam the user with N
          // identical failures. Leave queued rows alone so the user
          // can fix the underlying issue (re-auth, top up budget)
          // and the next dispatch picks them up via the normal path.
          if (tr.status !== 'completed') break;

          const drained = clearQueuedFlags(chatSessionId);
          // Defensive: skip empty/whitespace-only rows so we never
          // produce `\n\n\n\n` gaps in the merged prompt. Upstream
          // shouldn't be inserting empties (the route trims and
          // rejects on empty), but cheap insurance against a future
          // path that bypasses validation.
          const merged = drained
            .map((r) => r.content ?? '')
            .filter((s) => s.trim().length > 0)
            .join('\n\n');
          nextMsg = merged.length === 0 ? null : merged;
        }
      } finally {
        setRunning(chatSessionId, false);
        clearStopping(chatSessionId);
      }
      ```
- [x] The merged drain text is sent as a single new turn, but the
      individual `chat_events` rows survive (we just flipped
      `queued_at` to null). Transcript renders them as normal user
      events in their original order.
- [x] **Loop bounding**: each iteration consumes the queue snapshot
      taken at turn-end time. A user could keep queueing during the
      drain-turn, but their messages get picked up on the next
      iteration's `clearQueuedFlags` — bounded by user input rate,
      not infinite.

---

## Phase 3 — Routes

### POST `/api/sessions/[id]/messages`

Branches on `executor.isRunning(id)`. Same insert path; one new
field.

- [x] If `isRunning(id)`:
  - [x] Insert the user `chat_event` with `queued_at = new
        Date().toISOString()`. Content is the marker form
        (unexpanded), same as the idle path.
  - [x] **Do not** call `executor.dispatch`. The active turn's
        finally will pick it up.
  - [x] Return 201 with the row. **No 409.**
- [x] If not running: unchanged behavior — insert + dispatch +
      return 201.
- [x] Drop the `executor.isRunning(id) → 409` branch.
- [x] **Drain re-expansion**: extracted `expandMarkers` into
      `src/lib/attachments/expand-markers.ts` so the executor's
      drain loop can re-expand each queued row at drain time
      (queued rows store the compact marker form; the agent needs
      the same expanded form the live path produces).

### DELETE `/api/sessions/[id]/messages/[eventId]/queued`

- [x] New route. Calls `deleteQueuedChatEvent(sessionId, eventId)`.
- [x] Publishes a `chat_event_deleted` bus message (see Phase 4) on
      success so the live SSE channel removes the chip.
- [x] Returns `{ removed: boolean }`.

### Existing interrupt route

- [x] In `src/app/api/sessions/[id]/interrupt/route.ts`: call
      `executor.markStopping(id)` **before** `executor.abort(id)`.
      Order matters — `abort()` causes the in-flight turn's `result`
      Promise to settle (`status: 'aborted'`); when the drain loop
      resumes from `await result`, it reads `isStopping(id)` and
      bails before draining. Setting the flag first guarantees that
      check sees the right value regardless of when the client's
      parallel DELETEs land.
- [x] The route's return shape doesn't change — Stop button stays a
      parallel `Promise.all([…queued DELETEs, POST interrupt])` on
      the client. The server flag absorbs the race; we don't need to
      sequence the requests or fuse them into one mega-endpoint.

---

## Phase 4 — Realtime: delete frames

The existing chat_event SSE channel handles inserts. We need
deletions for the chip-removal path. One new variant on the bus.

- [x] In `src/lib/realtime/bus.ts`:
  - [x] Add `{ kind: 'chat_event_deleted'; sessionId: string;
        eventId: string }` to `SessionStreamMessage`.
  - [x] Add `publishChatEventDeleted(sessionId, eventId)`.
- [x] In `src/app/api/sessions/[id]/stream/route.ts`:
  - [x] Add `case 'chat_event_deleted':` — emit an SSE event named
        `chat_event_deleted` with `{ eventId }`.
- [x] In `src/lib/db/queries.ts` (`deleteQueuedChatEvent` impl):
  - [x] Publish on successful delete.

---

## Phase 5 — Client: SSE + cache

- [x] In `src/hooks/use-session-stream.ts`:
  - [x] Add a `chat_event_deleted` event listener.
  - [x] On frame: splice from the `['session', id, 'events']` cache
        by `eventId`. Invalidate rail if the deletion changes
        bucket membership (it shouldn't, but keeping the parallel
        with the existing handlers is cheap).
  - [x] **Bonus**: switched the existing `chat_event` handler from
        skip-on-dup to upsert-by-id, so the drain's
        `clearQueuedFlags` re-publish flows through and the chip
        flips to a transcript row without a refetch.
- [x] Confirm the existing `chat_event` insert handler treats the
      `queued_at` field as just-another-column. No client-side
      filtering changes — the transcript renderer needs the filter
      below, the composer chip list reads from the same cache.

---

## Phase 6 — Composer + transcript UI

### `src/components/executions/execution-composer.tsx`

- [x] New `QueueList` panel above the editor.
  - [x] Pulls from the same events cache, filters
        `queued_at != null`.
  - [x] Vertical stack — one row per queued event, top-to-bottom
        matches send-then-drain order. Each row shows up to 2 lines
        of content; full text on hover/title.
        *(v1 used horizontal chips; flipped to a list since these
        are sequential messages, not tags.)*
  - [x] `×` calls `DELETE
        /api/sessions/[id]/messages/[eventId]/queued`. Optimistic
        splice; revert on failure. Works the same on every provider
        — the queue is ours, not the harness's, so per-message
        delete is just a DB row splice.
- [x] Send/Stop button logic:
  - [x] Has text → Send button (existing arrow icon). On click:
        POST `/messages`. Server enqueues or dispatches based on
        running state. **No `isRunning` gate in the UI.**
  - [x] No text + `isRunning` → Stop button. On click:
        - [x] Snapshot the current queued chips client-side
              (before any DELETE round-trip — that text is what we
              dump into the editor).
        - [x] Fire `Promise.all([deleteAll(queued), interrupt()])`.
              Safe to parallelize because the server's
              `markStopping` flag (set by the interrupt route)
              absorbs the race in the drain loop.
        - [x] Replace the editor content with the snapshotted chip
              text joined by `\n\n`. Focus the editor.
  - [x] No text + not running → disabled Send.
- [x] `ChatInputEditor`: add an `onArrowUpAtEmpty` callback fired
      when ↑ is pressed in an empty editor. Wire it in the composer:
  - [x] Read queued events from cache.
  - [x] If any: DELETE each, then insert
        `events.map(e => e.content).join('\n\n')` into the editor,
        focus.

### Transcript

- [x] In whichever component renders the transcript event list
      (`src/components/executions/execution-transcript.tsx`):
      filter out rows where `queued_at != null`. Queued messages
      live only in the chips area until drained.
- [x] No "Queued" pill, no badge. When the row's `queued_at` flips
      to null (via the drain), the SSE re-delivers the row and it
      just appears in the transcript normally — same treatment as
      any other user event.
- [x] **SSE merge semantics**: the existing `chat_event` handler
      currently skips duplicates by id. Switch it to splice-replace
      on id match so post-drain row updates flow through. Safe
      forward-only change — no existing path emits updates today,
      so the splice-replace branch is currently unreachable except
      for our new drain path.
- [x] Drain publish: `clearQueuedFlags` re-publishes each updated
      row via the existing `publishChatEvent`. Client upserts.
      Chip filter `queued_at != null` flips them out of the chips
      area; transcript filter `queued_at == null` flips them in.

---

## Phase 7 — Edge cases + verification

- [x] **Process restart mid-drain**: verified by code reading —
      `clearQueuedFlags` reads `queued_at` from the live DB on each
      iteration, so rows persisted before the crash are picked up by
      the next dispatch's finally. No auto-dispatch on boot; user
      action is the trigger.
- [x] **Process restart mid-flight**: same path — `queued_at`
      survives in the DB. JSONL reconciler picks up missed agent
      events via the existing route.
- [x] **Empty drain after stop**: composer's `handleStop` builds
      `cancels = snapshot.map(...)`. With `snapshot.length === 0`,
      `Promise.all([onStop(), ...cancels])` collapses to just
      `onStop()`. Refill skipped via the `if (snapshot.length > 0)`
      guard.
- [x] **Two-tab race on cancel**: `deleteQueuedChatEvent` returns
      `res.changes > 0`. Second tab gets `{ removed: false }`;
      client's optimistic splice was already done. SSE
      `chat_event_deleted` fires once. Convergent.
- [x] **Chips lifecycle on Stop**: drain breaks on `isStopping`
      *before* `clearQueuedFlags` runs (line `if (isStopping(...))
      break;` precedes the drain). Rows with `queued_at != null`
      survive. Client's parallel DELETEs splice some; survivors
      stay as chips and can be ↑-popped.
- [x] **Failure-status semantics**: `if (tr.status !== 'completed')
      break;` runs before `clearQueuedFlags`. `queued_at` stays set;
      next dispatch's finally drains them. User's queued thoughts
      preserved across an auth/budget/exec failure.
- [x] `pnpm ts` — clean.
- [x] Automated tests for the three queue queries
      (`src/lib/db/queries.queue.test.ts`, 11 cases). Covers
      ordering, session scoping, the `queued_at IS NOT NULL` delete
      guard, cross-session refusal, and the post-clear payload shape
      the SSE re-publish carries. `pnpm test` — 264/264 green.
- [ ] Manual QA against a Claude session:
  - [ ] Type+send mid-turn → chip appears.
  - [ ] Click × on a chip mid-turn → chip vanishes.
  - [ ] Wait for the active turn to end → all remaining chips
        flow into the transcript, a new turn starts with the
        merged text.
  - [ ] Stop while running with chips → turn interrupts; the chips
        snapshot-at-click is in the composer; queued rows in the
        DB are either gone (DELETEs landed) or still queued (will
        re-drain on next dispatch). Either is acceptable; the
        composer text is the user-facing recovery.
  - [ ] Up-arrow on empty composer with chips → same as Stop's
        replace-into-editor, but no interrupt and the editor lands
        focused.
  - [ ] **Failure-break path**: invalidate Claude auth (e.g. revoke
        the OAuth token) and dispatch a message with queued
        follow-ups. The first turn fails with `auth_required`; the
        loop breaks; queued chips remain visible. Re-auth, type
        anything, send → the queued messages flow in with the new
        prompt instead of N consecutive failed turns.
- [ ] Repeat against a Codex session. Behavior should be
      indistinguishable from Claude — that's the whole point of
      pre-send.

---

## Future direction — hybrid mid-turn drain (deferred)

If the responsiveness loss bites for long-running task work, the
clean upgrade is provider-conditional dispatch, all behind one
capability flag:

- For Claude (`capabilities.concurrentSend && cancelQueuedMessage`):
  call `session.send()` mid-turn so Claude's native drain takes
  over. Cancel chips via `session.cancel(uuid)` and shadow what's
  outstanding.
- For Codex and everything else: keep the v1 pre-send buffer.

The route handlers, SSE channel, chip UI, transcript renderer, and
DB column from v1 are all reusable. Only the executor's `dispatch`
logic branches. Out of scope for v1; revisit if/when we see real
demand for mid-turn injection.

---

## Open library questions — answered

Per the agentex-agent review:

- **Q1 (where to hook drain):** the awaited `result` Promise's
  resolution *is* the turn-end signal. Drain in `dispatch`'s
  finally. ✅
- **Q2 (re-entering `send()` inside the prior resolver):** safe.
  By the time `result` resolves, agentex has set `state = idle` and
  emptied its pending list. A new `send()` finds idle state. No
  `queueMicrotask` needed. ✅
- **Q3 (UUID tracking):** not needed — we don't call
  `session.cancel`. ✅
- **Q4 (`queued_at` column vs `sessionParams.sessionId`):** orthogonal.
  The CLI resumes the model conversation by id; our buffer rebuilds
  the client-side chip list. ✅
- **Q5 (Stop + drain combined endpoint):** chose not to combine.
  Client fires the two requests in parallel — keeps endpoints
  single-purpose. ✅
