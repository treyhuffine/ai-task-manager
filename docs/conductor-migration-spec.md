# Conductor-style migration — replace the chip queue

Status: ready to execute. Successor to `docs/message-queue-spec.md`.

This spec converts the current Option B implementation (Node-side pre-send
buffer with `queued_at` column, drain loop, chip UI, stopping flag) into a
fire-and-forget design where the harness's own queue handles ordering and
mid-turn injection. No UI for managing queued messages — user messages
appear in the chat thread the instant they're sent, regardless of whether a
turn is in flight. Matches Conductor and the Claude VS Code extension.

## Why we're changing

The chip queue we built gave up mid-turn injection — queued messages
couldn't influence the in-progress turn. For long-running task work the
user wants to be able to say "also do X" while the agent is mid-task and
have it folded into the current response. Fire-and-forget lets the harness
do that natively (Claude via `<system-reminder>` mid-turn drain; Codex via
active-turn merge).

Trade-off accepted: no per-message cancel. Stop kills the active turn; if
the user had queued additional messages, those run as a follow-up turn.
The future `docs/queue-cancel-future-spec.md` adds Claude-only per-message
cancel back if we want it later.

## What the user-facing UX looks like

- Send button is **always** enabled when the composer has text. No
  "already running" gate at the UI level. No 409 from the server.
- During a turn, user-typed messages appear in the chat thread immediately
  as normal user events (no chip, no dimming).
- The agent's response addresses them — Claude as `<system-reminder>`
  in the active turn, Codex as additional userMessage items merged into
  the active turn.
- Stop button appears only when the composer is empty AND a turn is in
  flight. Click → interrupt the active turn. Note: any messages the user
  sent before clicking Stop are still in the harness's queue and will run
  as a follow-up turn. Document this; don't try to hide it.

## What stays the same

- `chat_events` table (minus the `queued_at` column).
- SSE chat stream (`publishChatEvent` insert events).
- Transcript renderer.
- `expandMarkers` extraction (good refactor regardless).
- `agentex.session.send()`, `interrupt()`, `close()` calls.
- The executor's `agentSessions` cache, `ensureAgentSession`,
  `recycleForModeChange`.

## What gets removed (subtraction-heavy migration)

Everything queue-management-related. See checklist below.

---

## Phase 0 — Plan summary

- [x] Read this entire spec before starting. The phases are
      independently shippable, but Phase 1 (schema) gates everything
      downstream — if you migrate the schema after the route changes,
      you'll briefly insert rows with no destination column.
- [ ] Branch off main: `git checkout -b conductor-migration`. *(skipped — done on main per existing workflow; can split into a PR before push.)*

---

## Phase 1 — Schema cleanup

- [x] In `src/lib/db/schema.ts` — `chatEvents` table:
  - [x] Remove the `queued_at: text('queued_at')` column.
  - [x] Remove the `idx_chat_events_queued` partial index.
- [x] Regenerate the Drizzle migration:
      `pnpm db:generate` → review SQL → `pnpm db:push`.
      *(Generated as `drizzle/0015_shiny_jasper_sitwell.sql`:
      `DROP INDEX` + `ALTER TABLE … DROP COLUMN`. Will apply on next
      dev server boot via `getDb()` auto-migrate.)*
- [x] In `src/db/types.ts` — `ChatEventRecord` and `CreateChatEventInput`
      should regenerate without `queued_at`. Confirm. *(Derived via
      `InferSelectModel`/`InferInsertModel` — picks up the schema
      change automatically; `pnpm ts` clean.)*

---

## Phase 2 — Executor adapter simplification

### State

- [x] In `src/lib/executor/adapter.ts` — `ExecutorState`:
  - [x] Remove `stoppingSessions: Set<string>`.
  - [x] Remove the HMR migration that ensures `stoppingSessions` exists.
- [x] Update the destructure that pulls out the state members.
- [x] In `_resetExecutorState()`: remove `stoppingSessions.clear()`.

### Helpers

- [x] Remove `markStopping`, `clearStopping`, `isStopping` exports
      entirely. They have no callers after Phase 3.

### Inflight counting

The current `runningSessions: Set<string>` flips on the *first* dispatch
and off when it ends. With concurrent send, multiple `dispatch()` calls
can overlap (one mid-turn, another arriving while it's still in flight) —
the existing Set would flicker `false` when the inner one's finally runs
while the outer is still going. Convert to a per-session reference count.

- [x] Add `inflightCount: Map<string, number>` to `ExecutorState`. HMR
      migration: initialize if absent. Reset in `_resetExecutorState`.
- [x] New internal helpers, alongside the existing `setRunning`:

      ```ts
      function startInflight(id: string): void {
        const n = (inflightCount.get(id) ?? 0) + 1;
        inflightCount.set(id, n);
        if (n === 1) setRunning(id, true);
      }
      function endInflight(id: string): void {
        const n = (inflightCount.get(id) ?? 1) - 1;
        if (n <= 0) {
          inflightCount.delete(id);
          setRunning(id, false);
        } else {
          inflightCount.set(id, n);
        }
      }
      ```

  These are the only places `setRunning(id, true/false)` is called from
  the dispatch path. The flag transitions on 0→1 and N→0 only, so SSE
  subscribers get clean edges.

### `dispatch()` itself

- [x] Replace the entire drain loop with a single send + await. The new
      shape:

      ```ts
      export async function dispatch(
        chatSessionId: string,
        userMessage: string,
        writer: EventWriter = localEventWriter,
      ): Promise<void> {
        const session = getChatSession(chatSessionId);
        if (!session) throw new ExecutorError('not_found', `Session not found: ${chatSessionId}`);
        const agent = getAgent(session.agent_id);
        if (!agent) throw new ExecutorError('not_found', `Agent not found: ${session.agent_id}`);
        const cwd = resolveCwd(session);
        if (!cwd) throw new ExecutorError('invalid_state', 'Session has no resolvable cwd');

        // Capability gate. Concurrent providers (claude, codex) let
        // dispatch overlap. Non-concurrent providers — none today, but
        // future adapters might add some — fall back to "one turn at a
        // time" semantics by rejecting overlap with `already_running`.
        const provider = getProvider(agent.harness);
        if (
          !provider.capabilities.concurrentSend &&
          inflightCount.has(chatSessionId)
        ) {
          throw new ExecutorError(
            'already_running',
            'This provider does not support concurrent send.',
          );
        }

        startInflight(chatSessionId);
        try {
          const agentSession = await ensureAgentSession({
            chatSessionId,
            harness: agent.harness,
            cwd,
            existingExternalSessionId: session.external_session_id,
            permissionMode: session.permission_mode,
            model: session.model,
            effort: session.effort,
            writer,
          });
          const { result } = await agentSession.send(userMessage);
          await result;
        } finally {
          endInflight(chatSessionId);
        }
      }
      ```

- [x] In `close()`: replace the `clearStopping(chatSessionId)` line with
      `inflightCount.delete(chatSessionId)` so a torn-down session can't
      hold a stale count.

### Imports

- [x] Remove the `clearQueuedFlags` import from
      `@/lib/db/queries`.
- [x] Remove unused imports in `adapter.ts` once the loop is gone:
      `expandMarkers` is still needed by the route layer; the import
      from this file may not be — confirm via the typechecker.
      *(Removed `expandMarkers` and `Attachment` imports from adapter;
      `pnpm ts` clean.)*

### Queries (`src/lib/db/queries.ts`)

- [x] Remove `listQueuedChatEvents`.
- [x] Remove `clearQueuedFlags`.
- [x] Remove `deleteQueuedChatEvent`.
- [x] Remove the `publishChatEventDeleted` import (it'll be deleted from
      the bus in Phase 5).
- [x] Confirm `insertChatEvent`'s input shape doesn't reference
      `queued_at` after the schema regen.
- [x] **Also**: deleted `src/lib/db/queries.queue.test.ts` — the 11
      tests covered the queries we just removed.

---

## Phase 3 — Route simplification

### POST `/api/sessions/[id]/messages`

- [x] Remove the `isRunning` branch and the `queued_at: now` insert.
      The route should always:
  1. Validate the session.
  2. Insert the user `chat_event` (no `queued_at` field).
  3. Call `executor.dispatch(id, expandedContent)` (fire-and-forget).
  4. Return 201 with the row.
- [x] Remove the `executor.isRunning(id) → 409` branch entirely. The
      executor's own capability check throws `already_running` for
      providers that don't support concurrent send; let that propagate.
      For Claude and Codex it never fires.
- [x] Confirm `expandMarkers` is still imported from the shared module
      (`@/lib/attachments/expand-markers`). The route's marker expansion
      runs once before dispatching.

### DELETE `/api/sessions/[id]/messages/[eventId]/queued`

- [x] Delete the file `src/app/api/sessions/[id]/messages/[eventId]/queued/route.ts`.
- [x] Delete the now-empty `[eventId]` directory if Next.js doesn't
      complain about empty route folders (it shouldn't).

### Interrupt route (`src/app/api/sessions/[id]/interrupt/route.ts`)

- [x] Remove the `executor.markStopping(id)` call. The new dispatch path
      has no drain loop to race against, so no flag is needed.
- [x] Keep the comment block about idempotency — that's still accurate.
- [x] The route is now just `await executor.abort(id); return Response.json({ ok: true })`.

---

## Phase 4 — UI cleanup

### `src/components/executions/execution-composer.tsx`

- [x] Remove the `QueueChips` component (and any related imports/types).
      *(Was renamed to `QueueList`; entire component removed.)*
- [x] Remove the `useQueuedMessages` import and call site.
- [x] Remove the `cancelQueued` mutation hook.
- [x] Remove the `handleArrowUpAtEmpty` callback.
- [x] Remove the "bulk cancel queued" handler (the one that called
      `cancelQueued.mutate({ eventId })` for every chip).
- [x] Send button:
  - [x] **Has text → Send button.** No `isRunning` check. Click → POST
        `/messages`. Server inserts + dispatches.
  - [x] **No text + isRunning → Stop button.** Click → call
        `onStop()` (the existing interrupt handler).
  - [x] **No text + not running → disabled Send.**
- [x] Remove the snapshot-chips-before-Promise.all logic from the Stop
      handler. It's just `onStop()` now; no chips to snapshot.

### `src/components/chat/editor/chat-input-editor.tsx`

- [x] Remove the `onArrowUpAtEmpty` prop and its keyboard handler. If
      the editor uses ↑ for history navigation today, keep that;
      otherwise the key reverts to its default behavior.
      *(Also removed the `setText` imperative handle method that
      was only used by the pop-back flow.)*

### `src/components/executions/execution-transcript.tsx`

- [x] Remove the `if (e.queued_at != null) return false;` filter from
      the event visibility logic. No row has `queued_at` anymore.

### Hooks

- [x] Remove `src/hooks/use-queued-messages.ts` (or wherever
      `useQueuedMessages` lives). *(Lived inline in `use-execution.ts`;
      both `useQueuedMessages` and `useCancelQueuedMessage` removed.)*
- [x] In `src/hooks/use-session-stream.ts`: remove the
      `chat_event_deleted` event listener and its handler. The SSE
      channel no longer emits that frame. *(Also reverted the
      `chat_event` insert handler from upsert-on-id to skip-on-dup
      — the upsert was only load-bearing for the drain republish,
      which is now gone.)*
- [x] In `src/hooks/use-execution.ts` (if it exposed any queue-related
      helpers like `cancelQueued`): remove them. *(Also removed the
      runtime-status peek + `optimisticQueuedAt` stamp from the send
      mutation's optimistic placeholder.)*

### API client (`src/lib/api/sessions.ts`)

- [x] Remove any function that called `DELETE /messages/:id/queued`.

---

## Phase 5 — Realtime bus + SSE

- [x] In `src/lib/realtime/bus.ts`:
  - [x] Remove the `{ kind: 'chat_event_deleted'; ... }` variant from
        `SessionStreamMessage`.
  - [x] Remove `publishChatEventDeleted`.
- [x] In `src/app/api/sessions/[id]/stream/route.ts`:
  - [x] Remove the `case 'chat_event_deleted':` handler.

The SSE channel now only emits `chat_event` (insert/upsert) events for
user messages. No deletes. Concurrent send produces multiple
`chat_event` frames in sequence, which the client already handles.

---

## Phase 6 — Verification

- [x] `pnpm ts` — clean.
- [x] `pnpm test` — 253/253 green. (The 11 obsolete queue tests were
      removed alongside the queries they covered; everything else
      passes unchanged.)
- [ ] Manual QA against a Claude session:
  - [ ] Send a single message at idle → assistant responds normally.
        No regression.
  - [ ] Send a long-running task (e.g. "run `sleep 15` then describe
        the additional messages I sent"), then while the agent is
        sleeping send two more messages. All three appear in the chat
        thread immediately. The assistant's eventual response addresses
        all three (Claude's mid-turn drain).
  - [ ] Send a long-running task, then click Stop while the agent is
        sleeping. The turn aborts. The original message stays in the
        chat. Send a follow-up message → starts a fresh turn.
- [ ] Manual QA against a Codex session — same three scenarios. The
      mid-turn injection path is different (Codex merges into the active
      turn rather than draining mid-turn) but the user-visible behavior
      is the same: all messages appear in chat, all get addressed.
- [ ] **Provider capability sanity check**: open a session with a
      hypothetical non-concurrent provider (mock or skip if none
      exists). Confirm the second `dispatch` call throws
      `already_running`. If no test target exists, write a comment in
      `dispatch()` explaining the path is unexercised today.
- [ ] Smoke any other parts of the app that depended on the queue:
  - [ ] Slash-command flow (`/api/sessions/[id]/slash-commands`).
  - [ ] PR creation route (`/api/sessions/[id]/pr`).
  - [ ] Any cron / scheduled-send paths.
  These call `executor.dispatch` directly. They should be fine but
  worth a sanity check.

---

## What's gone after this migration

For the agent doing the work — a quick "things I removed" summary so
the PR diff is clear:

- DB column `chat_events.queued_at` + its partial index.
- Migration file (whatever it's called).
- Executor: `stoppingSessions`, `markStopping`, `clearStopping`,
  `isStopping`, the drain loop in `dispatch`, the failure-status gate,
  the Stop-flag race ordering.
- Queries: `listQueuedChatEvents`, `clearQueuedFlags`,
  `deleteQueuedChatEvent`.
- Route: `DELETE /api/sessions/[id]/messages/[eventId]/queued`.
- Bus: `chat_event_deleted` frame, `publishChatEventDeleted`.
- Client: queue chip UI, ↑ pop-back handler, bulk cancel,
  `useQueuedMessages`, `chat_event_deleted` SSE handler.
- 409 from POST `/messages` for `already_running`.

What got added (small):

- Executor `inflightCount: Map<string, number>` + `startInflight` /
  `endInflight` helpers, used by `dispatch()` to handle overlapping
  sends without flickering `runningSessions`.
- Provider capability check in `dispatch()` that throws
  `already_running` only when `provider.capabilities.concurrentSend ===
  false` (a no-op for Claude and Codex today).

---

## Out of scope for this migration

- Per-message cancel. See `docs/queue-cancel-future-spec.md` for the
  future plan if/when we want it back.
- Watching the transcript for drain events. Not needed; messages just
  appear in chat the moment they're sent.
- Any agentex library changes. The 0.0.17 surface already provides
  everything this migration needs.
