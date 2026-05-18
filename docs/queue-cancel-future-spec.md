# Future — per-message queue cancel (Claude Desktop style)

Status: deferred design. Build only if/when fire-and-forget proves
insufficient. Successor to the chip queue we removed in
`docs/conductor-migration-spec.md`.

## What this adds

The ability to retract a message a user just sent before the agent has
processed it — Claude Desktop's behavior: each pending user message in
the chat thread shows a subtle visual state (dim/blur/spinner) and an
× button. Click × → message vanishes from the chat. When the agent
addresses the message, the visual state transitions to a normal user
message.

**Claude-only.** Codex's protocol has no per-message cancel verb
(verified against the auto-generated TS bindings — only `turn/interrupt`
which kills the whole turn). Codex sessions render user messages without
the × button. Capability flag drives this.

## Why this is the *future* spec, not the v1 spec

Conductor and the Claude VS Code extension don't do this. They push and
forget. The reasons to add it later, not now:

- It requires watching the transcript file for drain detection, which
  is more code than it sounds and ties us to Claude's on-disk format.
- The cancel race is real: between user click and `session.cancel()`,
  the message may have been drained mid-turn. The UX has to gracefully
  handle "already delivered."
- We don't have data yet on whether users actually need this. Ship
  Conductor-style first; revisit if regret-then-retract becomes a
  common pattern in real usage.

## What we'd build, in shape

### Data model

- [ ] Add `pending_uuid TEXT` column to `chat_events`. Set when the
      executor calls `session.send()` and captures the returned
      `SendHandle.uuid`. Cleared by either:
      - the cancel path (success → row deleted),
      - the drain watcher (row's message has been processed → null).
- [ ] No partial index needed — `pending_uuid IS NOT NULL` is rare and
      transient, and the chip-equivalent UI reads from the same
      `chat_events` rows by id, not by a separate query.

### Executor adapter

- [ ] `dispatch()` captures `const { uuid, result } = await session.send(...)`
      and persists the `uuid` to the corresponding `chat_events` row via
      a new `setPendingUuid(eventId, uuid)` query.
- [ ] Add a per-session "drain watcher" service. While any rows have
      `pending_uuid IS NOT NULL` for a session, the watcher polls the
      transcript file via `provider.transcript.find` + raw JSONL read
      (the typed reader doesn't surface `attachment.queued_command`
      entries today — see "agentex library quality-of-life" below for
      the optional improvement).
      - Poll interval: 1-2 seconds.
      - For each `type:"attachment", attachment:{type:"queued_command",
        source_uuid:X}` line found, look up the `chat_events` row with
        `pending_uuid === X`, clear `pending_uuid`, publish via SSE so
        the client transitions UI state.
      - Stop polling when no rows are pending.

### Routes

- [ ] New: `DELETE /api/sessions/[id]/messages/[eventId]/cancel` (or
      reuse the old `/queued` endpoint path). Resolves the row, reads
      `pending_uuid`, calls `executor.cancel(sessionId, uuid)`. Returns
      `{ cancelled: true, ...row }` or `{ cancelled: false, ...row }`.
- [ ] New executor method: `cancel(sessionId, uuid)`:
      - Calls `agentSession.cancel(uuid)`.
      - If `cancelled: true`: delete the `chat_events` row, publish
        `chat_event_deleted` (re-add this bus frame), return `true`.
      - If `cancelled: false`: the message reached the model. Clear the
        `pending_uuid` (transition to "delivered"), republish the row,
        return `false`.

### SSE bus

- [ ] Re-add the `{ kind: 'chat_event_deleted'; sessionId; eventId }`
      variant and `publishChatEventDeleted`. We removed it in the
      Conductor migration; bring it back.

### UI

- [ ] In the chat thread renderer: for user-role events with
      `pending_uuid IS NOT NULL`, apply a "pending" visual treatment
      (dimmed background, subtle pulse, or whatever matches the app's
      visual language).
- [ ] Render an × button next to the pending bubble, **gated on
      `provider.capabilities.cancelQueuedMessage`**. Codex sessions
      never show the ×.
- [ ] On × click: call DELETE route. Optimistic UI splice. On
      `{cancelled: false}` response, transition the row from pending to
      delivered (the SSE upsert will deliver the updated row anyway,
      but optimistic gives instant feedback).
- [ ] No separate chip queue area. The pending bubbles live in the
      chat thread alongside delivered messages — that's the Claude
      Desktop pattern.

### Stop button enhancement (optional)

The Conductor Stop is "interrupt the active turn." With this feature,
we can make Stop also nuke the queue:

- [ ] On Stop click: iterate all `chat_events` rows with `pending_uuid
      IS NOT NULL` for the session, call `executor.cancel(sessionId,
      uuid)` for each in parallel. Then call `executor.abort(id)`.
- [ ] Result: a clean "stop everything" — active turn aborts AND
      queued messages are retracted (for Claude; for Codex, only the
      active turn aborts because no cancel verb exists).

This is optional but probably worth doing alongside the cancel UI for
UX consistency.

## Agentex library — quality-of-life improvements (optional)

The above can be built entirely on top of `@agentex/agent@0.0.17` —
the protocol surface is already there. But two small library additions
would make the app code cleaner:

1. **Typed accessor for `queued_command` attachments**: today the
   `provider.transcript.read()` iterator surfaces `StreamEvent` types
   only; `attachment.queued_command` entries don't appear in that
   union. The app has to parse raw JSONL. A small addition:

   ```ts
   provider.transcript.findQueuedCommandAttachments({
     filePath: string;
     fromOffset?: number;
     sourceUuids?: string[];
   }): AsyncIterable<{
     sourceUuid: string;
     prompt: string;
     offset: number;
     timestamp: string;
   }>
   ```

   ~20 lines in `claudeTranscriptOps`. Bump to `@agentex/agent@0.0.18`.

2. **Drain notification event** (more ambitious): synthesize a
   `queued_message_drained` event into the existing `onEvent` stream
   by having agentex watch the transcript file internally. Saves the
   app from polling. More complex (file watching is platform-specific,
   needs proper cleanup on session close). Probably not worth it unless
   the polling approach proves noisy.

For a first cut, lean app-side. Library additions can come later if
the polling code starts to feel hairy.

## Migration scope (from Conductor v1 to this)

For the agent building this, here's the additive diff:

**DB**
- Add `pending_uuid TEXT` column to `chat_events`.

**Executor**
- `dispatch()` writes `pending_uuid` to the row after `session.send()`.
- New `cancel(sessionId, uuid)` method.
- New drain watcher service (polls transcript while pending rows exist).

**Routes**
- New DELETE route for cancel.
- Stop route optionally iterates per-pending cancels before interrupt.

**Bus**
- Re-add `chat_event_deleted` frame and `publishChatEventDeleted`.

**UI**
- Pending visual on user messages in chat (where `pending_uuid != null`).
- × button on pending user messages, gated on capability.
- Optional: bulk-cancel on Stop click.

**Tests (manual QA)**
- Send → see pending state briefly → message transitions to delivered
  when agent drains it (visible in transcript).
- Send → click × quickly → message vanishes from chat.
- Send → click × after drain → row transitions to delivered (lost race
  is fine, message is in the chat).
- Codex: send → pending state → transitions to delivered. No × button
  shown.

## Things that stay simple

Everything from the Conductor migration that worked (chat_events,
SSE, transcript rendering, expandMarkers, executor `agentSessions`
cache, ensureAgentSession, recycleForModeChange) is untouched. This
spec is purely additive on top of Conductor v1.

## When to actually build this

Signals to revisit:

- Users explicitly ask for the ability to retract a message.
- Telemetry shows users hitting Stop multiple times in quick
  succession (proxy for "I want to nuke the queue, not just the active
  turn").
- A specific use case (long autonomous task with lots of mid-turn
  user guidance) needs the precision.

Until then, fire-and-forget is the right product call.
