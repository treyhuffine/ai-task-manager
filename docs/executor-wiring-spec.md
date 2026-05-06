# Executor Wiring: Implementation Spec

Self-contained plan for wiring `@agentex/agent` so user messages in
`ExecutionView` actually spawn a Claude Code session and the transcript
fills with real agent output. Builds on `docs/workspaces-spec.md` (which
landed the data model + UI shell) and `docs/chat-sessions.md` (which
defined how sessions, events, and adapters fit together).

## Goal

When the user types a message in `ExecutionView` and hits Enter:

1. The user row already lands in `chat_events` (already shipped).
2. The first message **also** spawns a Claude Code session in the
   workspace's worktree (or `workspace.cwd` for non-git workspaces).
3. Subsequent messages send a new turn into the same agent session.
4. Stream events from agentex get parsed into `chat_events` rows live —
   assistant text, thinking blocks, tool calls, tool results, run
   completion. The transcript repaints as rows arrive.
5. The "working" indicators in the rail and header pick up state from a
   server-tracked runtime map so multiple clients (and reloads) all see
   the same truth.

After this slice, the rail goes from "looks like a chat app" to "is one."

## Architecture

```
Client (browser, ExecutionView)
  ─ POST /api/sessions/:id/messages { content }
  │
Route handler:
  1. Insert user chat_event       (already shipped)
  2. (NEW) Look up session, agent, workspace
  3. (NEW) Hand off to adapter.dispatch(sessionId, content)
  4. Return 201 immediately       (don't await the agent)

Background — adapter (module-scoped, in-process):
  - Map<chat_session_id, AgentSession> keeps live agent sessions hot.
  - First message creates a session via @agentex/agent's createSession.
  - Subsequent messages call session.send().
  - StreamEvents flow through the onEvent callback:
      adapter parses → EventWriter.write({...}) → DB row.
  - On run_completed: clear from runtime map.

Client polls:
  - /api/sessions/:id/events every 3s              (already shipped)
  - /api/sessions/:id/runtime-status every 3s     (NEW)
```

The adapter is in-process, single-machine. No worker, no queue, no SSE.
Polling is fine for v1 because Claude Code emits block-level events
(complete assistant turns, complete tool calls), not tokens — the lag
between event-arrives-on-server and event-shows-in-UI is bounded by the
poll interval.

## EventWriter (the seam)

Per the workspaces spec's "Deferred: cross-machine execution" section,
the executor writes through a small interface so the future remote case
can swap implementations without touching the parser:

```ts
export interface EventWriter {
  write(event: CreateChatEventInput): Promise<void>;
}

// v1, server-only — the only implementation today.
export const localEventWriter: EventWriter = {
  async write(event) { insertChatEvent(event); },
};
```

Cost: ~10 lines. Behavior identical to writing inline. The day a remote
executor wants to write to a canonical server's DB, the writer becomes
an HTTP POST and nothing else moves.

## StreamEvent → chat_events mapping

`@agentex/agent`'s `StreamEvent` union has 6 variants. Each maps to one
`chat_events` row:

| `StreamEvent.type` | `source`     | `role`      | `content`        | tool fields                                               | `raw` |
|---|---|---|---|---|---|
| `system`           | `system`     | `system`    | `subtype`        | —                                                          | full event |
| `assistant`        | `agent`      | `assistant` | `text`           | —                                                          | full event |
| `thinking`         | `thinking`   | `assistant` | `text`           | —                                                          | full event |
| `tool_call`        | `tool_call`  | `assistant` | —                | `tool_name = name`, `tool_input = input`, `external_tool_call_id = callId` | full event |
| `tool_result`      | `tool_result`| `tool`      | `content`        | `tool_is_error = isError`, `external_tool_call_id = toolCallId` | full event |
| `result`           | `result`     | `system`    | `text`           | —                                                          | full event (carries cost, isError) |

`created_at` comes from the StreamEvent's `timestamp` (provider-supplied,
monotonic within a turn). `external_event_id` we'll synthesize per event
since agentex StreamEvents don't carry a stable id — we use
`<external_session_id>:<turn_index>:<event_index>` so retries within a
single turn are still idempotent under the partial unique constraint.

The bump-outcome logic stays as it is in `insertChatEvent`: rows with
`source IN ('agent', 'result')` advance `last_outcome_event_at`.

## Adapter responsibilities

`src/lib/executor/adapter.ts` exports two functions:

```ts
async function dispatch(
  chatSessionId: string,
  userMessage: string,
  writer?: EventWriter,
): Promise<void>;

async function abort(chatSessionId: string): Promise<void>;
```

`dispatch` is fire-and-forget from the route handler — the route
returns 201 immediately, the dispatch promise resolves when the turn
completes (background). Internally:

1. Look up the chat_session, agent, workspace.
2. Resolve the worktree cwd (`session.worktree_path ?? workspace.cwd`).
3. Get-or-create an `AgentSession` for this chat_session id:
   - Cache in module-scoped `Map<chat_session_id, AgentSession>`.
   - On miss, call `provider.createSession({ cwd, onEvent, sessionParams })`.
     If `external_session_id` is already on the row, pass it as
     `sessionParams` to resume; otherwise start fresh.
   - On success with a fresh session, write `external_session_id` back
     to the chat_session row.
4. Mark the chat_session as running in `runtimeStatusMap`.
5. Call `agentSession.send(userMessage)`.
6. While the turn runs, the `onEvent` callback fires repeatedly — each
   event flows through the parser → `writer.write(...)`.
7. When `agentSession.send()` resolves, clear the running flag.

`abort` calls `agentSession.interrupt()` and clears the running flag.
Used by Stop buttons (future). Not wired in v1 UI but the function
exists.

## Runtime status

Module-scoped `Set<chat_session_id>` lives next to the adapter. Two
endpoints:

```
GET /api/sessions/:id/runtime-status → { running: boolean }
```

Client hook polls this. The `dashboard-context.streamingSessionIds`
state derives from the per-session poll responses, so a page reload
after starting an execution still shows the working indicator.

A separate "list all running" endpoint isn't worth the work in v1 —
the rail surfaces this via the per-row poll the session-row already
does for diff stats.

## Lifecycle: edge cases

- **Process restart between turns.** Agent session map empties. Next
  message: re-create with `sessionParams = { resumeId: external_session_id }`.
  Claude Code persists JSONL on disk so the underlying provider can
  resume. The new in-memory `AgentSession` wraps the existing CLI
  state.
- **Resume fails (CLI session gone, machine moved, etc.).** Fall back
  to a fresh start. The chat_session row's `external_session_id`
  updates. Per chat-sessions.md we'd want a "rollover handoff message"
  written as a `system` event to keep the UI honest. **Deferred to
  v1.5** — for v1 we just start fresh and accept the visible jump.
- **Concurrent send to same session.** Refuse: if the session is
  already running, the second message returns 409. UI prevents this
  (composer disables while running) but server-side check is required
  for safety.
- **Tool permission requests** (Bash, Write, etc.). Auto-allow all in
  v1 via `onUserInputRequest = async () => ({ allow: true })`. The UI
  for permission prompts is a separate slice.
- **Cost / token tracking.** `result` events carry `cost`. We persist
  the full `raw` so the value is queryable later, but no UI for it now.

## Files to create / modify

**New:**
- `src/lib/executor/event-writer.ts` — `EventWriter` interface +
  `localEventWriter` impl.
- `src/lib/executor/adapter.ts` — agent session map, dispatch, abort,
  parser. ~200 lines.
- `src/app/api/sessions/[id]/runtime-status/route.ts` — `{ running }`
  endpoint.

**Modified:**
- `src/app/api/sessions/[id]/messages/route.ts` — after the user-row
  insert, call `adapter.dispatch(...)` (no await).
- `src/lib/api/sessions.ts` — `runtimeStatus` method.
- `src/hooks/use-execution.ts` — `useRuntimeStatus(id)` poll hook.
- `src/components/executions/execution-view.tsx` — disable composer
  while runtime status says `running` (reuse existing `disabled` prop).
- `src/contexts/dashboard-context.tsx` — sync `streamingSessionIds`
  from per-session runtime polls (the rail's "● working" indicator).

## Implementation order

1. **EventWriter + types.** Trivial. Lands the seam.
2. **Adapter.** Most of the work. Standalone function (no API) so we can
   verify the parser with hand-fed events first.
3. **Wire messages route.** Two-line change after step 2.
4. **Runtime status endpoint + hook.** Simple.
5. **Sync into dashboard-context.** Wire the working indicator.
6. **Smoke end-to-end.** Send a real message, watch the transcript fill.

## Punted (next slice or later)

- **SSE / WebSocket streaming.** Polling is fine for block-level events.
  Revisit when we want typewriter UX.
- **Codex / Cursor / other providers.** Claude Code only.
- **Tool permission UI.** Auto-allow.
- **AskUserQuestion / MCP elicitation.** Auto-decline.
- **Rollover handoff message generation.** v1 just starts fresh.
- **Stop button in the composer.** Adapter exposes `abort`; UI lands
  later.
- **Cron / scheduled execution.**
- **Externally-spawned session import** (file-sync path from
  chat-sessions.md).
- **Cost / token tracking UI.** Data is stored in `raw`, not surfaced.

## TL;DR

Add `src/lib/executor/{event-writer.ts, adapter.ts}`. Wire the messages
route to call `adapter.dispatch(...)` after the user-row insert. Add a
runtime-status endpoint and client hook. Smoke. After this slice, the
chat is two-way and the workspaces feature actually delivers.
