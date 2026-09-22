# Spec: Codex live↔on-disk transcript duplication

**Status:** fixed 2026-09-22. The bug went live once Codex saw real use: in
the prod DB, 1,317 rows across 11 Codex sessions were second copies of turns
the live stream had already written. See [What shipped](#what-shipped).
**Area:** `src/lib/executor/{reconcile.ts, adapter.ts, codex-on-disk.ts}`
**Severity:** high. Every turn captured live was re-added in a second, noisier
shape the next time the user sent a message or reopened the session.

> **Update (agentex 0.0.20, 2026-06-06):** upstream now mints replay-stable
> synthetic `eventId`s for Codex — live app-server events get
> `codex:<threadId>:<turnId>:<itemId>:<eventType>`, transcript reads get
> `codex:<rolloutSessionId>:<lineStartByteOffset>`. The two schemes
> deliberately do NOT match (different wire vocabularies), so cross-shape
> dedup — this spec's whole problem — remains ours.

## Summary

For **Codex**, two independent writers persist the *same* logical events into
`chat_events`, in *different shapes*, with *different ids* — and nothing dedups
them except a coarse byte-offset cursor that the live path never advances. So a
reconcile that runs after a turn the live stream already captured **re-inserts
that turn**.

Claude is immune for one reason only: its wire-level uuid lands in
`externalEventId`, so live and replay collide on the partial unique index and
replay is idempotent. Codex has no stable wire id.

## The two writers

1. **Live** — `adapter.ts` `onEvent` → `persistStreamEvent` fires for *every*
   provider. Codex's app-server protocol collapses a whole PTY interaction into
   one clean `command_execution` tool_call + one tool_result (`aggregated_output`
   + real `exit_code`). `externalEventId` = the item id.
2. **Reconcile** — `reconcile.ts` → `mapCodexLineToInput`, fires on **every
   session-open** (`use-session-reconcile.ts`) and on cold-start. Re-reads
   Codex's on-disk rollout (`~/.codex/sessions/…`) where the same interaction is
   `exec_command` + `write_stdin`×N + their `function_call_output`s.
   `mapCodexLineToInput` **mints a fresh `uuidv7()` per line** → no id overlap.

Same command → live row `command_execution` **and** reconcile rows
`exec_command`/`write_stdin`. Different ids → both survive.

## Why the byte cursor doesn't save us

Dedup rests entirely on `chat_session.externalSyncOffset` (a byte offset into
the rollout). Confirmed: **only `reconcile.ts` ever writes it**; the live path
never advances it.

1. First reconcile anchors the cursor at the current on-disk size (no replay).
2. A turn runs; live writes `command_execution`; **the cursor does not move.**
3. Next reconcile (reopen session / cold start, `isRunning` now false) sees the
   turn's bytes past the cursor → **replays them** → duplicates the turn as
   `exec_command`/`write_stdin`. Cursor advances to head.

The existing `isRunning` guard only prevents *concurrent* double-writes *during*
a turn. It does nothing about replaying a *completed* turn the live stream
already captured. So duplication is a matter of *when* reconcile next runs, not
*if*.

## User-visible effect

Each command appears twice — once as the clean live `Run <cmd>`, once as the
folded on-disk `exec_command` + `write_stdin` spam — and turn tool-counts
balloon. The transcript's plumbing-fold (`isPlumbingTool`) hides the
`write_stdin` noise but not the duplicated command itself.

## Fix options

### A. Anchor the cursor at turn-end (recommended, smallest)
When a Codex turn completes (the `send()`/turn-handle resolves, `isRunning`→
false), peek the rollout and set `externalSyncOffset = currentSize` **without
replaying**. A normal post-turn reconcile then sees no drift → no dupes.
Reconcile only ever replays when turn-end anchoring didn't run — i.e. a crash.

- Pro: keeps the *clean* live shape as the stored representation; ~15 lines in
  the executor turn-end path + a test.
- Caveat: a crash mid-turn leaves the cursor back; cold-start reconcile then
  replays the whole crashed turn while live may have partially written it → a
  one-turn dup for the crashed turn only. Acceptable (rare), or harden with C.

### B. Single writer — reconcile is authoritative
Don't persist Codex live events to `chat_events`; stream them to the UI via the
realtime bus only, and let reconcile be the sole DB writer.

- Pro: structurally impossible to dup.
- Con: `chat_events` only fills at turn-end (no durable mid-turn history from a
  cold reload); stores the noisier on-disk shape (mitigated by the plumbing-fold).

### C. Stable id alignment (most robust, most work)
Give reconcile a deterministic `externalEventId` (e.g. `call_id` for
tool_call/result; a stable hash for message/reasoning) **and** make the live
path mint the same key, so the partial unique index dedups them — matching how
Claude already works. The `write_stdin` rows still have no live counterpart, but
they're plumbing (folded). Pairs well with A to cover the crash case.

## Recommendation

Ship **A** now (turn-end anchoring) — it removes the happy-path duplication with
minimal surface area and preserves the clean live shape. Layer **C** later if
crash-recovery fidelity matters. Avoid B unless we decide the on-disk rollout
should be the canonical Codex history.

## Also nearby (separate, smaller): on-disk `apply_patch` is dropped
`codex-on-disk.ts` only maps `function_call`/`function_call_output`. Codex
records `apply_patch` (file edits) as `custom_tool_call` (verified: 68 across 9
sessions, with an `input` patch body). It has no branch for that type → replayed
Codex edits are silently missing from the transcript. One-branch fix: map
`custom_tool_call` (name `apply_patch`, `input` = patch text) to a `tool_call`
row so the humanized "Edit <file>" UI renders it.

## What shipped

Neither A nor C as written. A is timing-based (the rollout's last lines can
land after the live turn-end signal, so the anchor lands short and the final
message duplicates anyway). C needs the live and on-disk readers to agree on
one id scheme, which agentex explicitly leaves to hosts. What shipped instead
is a turn-level ownership rule that needs no id alignment:

1. **The live adapter records the turn.** `attributionFields` in `adapter.ts`
   now writes `event.turnId` to `chat_events.external_turn_id` (Codex
   app-server only, null for Claude). That column was previously never set.
2. **Reconcile skips turns the live stream owns.** `reconcileCodexSession`
   loads `listChatEventIdentities(sessionId)`, builds `codexLiveCoverage`
   (turn ids + provider item ids), and runs every rollout line through
   `createCodexReplayFilter` before mapping it. The filter tracks the current
   turn from the lines that carry one (`task_started`, `turn_context`,
   `item_completed`, and newer `response_item`s via
   `internal_chat_message_metadata_passthrough.turn_id`), and drops the whole
   turn when it's covered. That includes plumbing with no live twin, like
   `write_stdin`. Item ids (`msg_…`, `rs_…`, `call_…`) are a backstop for a
   cursor that starts mid-turn, before any turn marker. Legacy `item_N` ids
   repeat across turns and are ignored.
3. **Replay is idempotent, even across rollout rewrites.** Replayed rows are
   keyed `codex-item:<payload type>:<Codex item id>` (the `call_id`, `msg_…`,
   `rs_…`, or for `task_complete` the turn id) instead of a fresh uuidv7, so
   re-reading a line is a no-op insert. Byte offsets would not do: newer
   Codex versions rewrite old rollouts in place (adding `ordinal` to every
   line and `"content": null` to reasoning), which shifts every offset and
   sends the cursor back over lines already stored. That happened in prod: 74
   rows in one session were second copies replayed from a rewritten file.
   Lines with no usable id fall back to agentex's offset-based line id.

**Invariant:** only the live adapter sets `external_turn_id` on Codex rows.
Replayed rows leave it null. If they set it, a turn still being written by the
Codex CLI would count as covered after its first reconcile and stop
replaying halfway.

**What still replays, correctly:** turns the live stream never saw. That means
turns run from the Codex CLI against the same thread, or turns Codex starts
itself (goal and multi-agent continuations). In prod, one session held 6.5k
such rows. None were duplicates.

**Accepted gap:** if the server dies mid-turn, the unseen tail of that turn is
not replayed, because the turn is already covered. The health check's orphan
redispatch recovers an unanswered turn.

**Existing data** was cleaned directly in the prod DB (no migration) by
`personal/codex-dedupe/dedupe-codex-replays.ts`, after a backup to
`<app-root>/.work/backups/data-2026-09-22-pre-codex-dedupe.db`. It backfilled
`external_turn_id` from `raw.turnId` on 53,268 live Codex rows, deleted 1,317
replay rows whose line the new filter drops, and deleted 74 repeated replays
from the rewritten rollout. An independent classifier (turn id read from
each stored row's own payload) found the same 1,317. The script is idempotent
and matches rows to lines by timestamp + payload type + Codex id, since
rewritten rollouts break raw-JSON and offset matching.

**Still open:** rollouts now record full app-server items as
`event_msg/item_completed` (`CommandExecution`, `AgentMessage`, `FileChange`,
…), with the same ids and turn ids as the live stream. Replaying unseen turns
from those records, using the live parser, would give them the clean live
shape and fix the `apply_patch` gap below for free. That belongs in agentex's
Codex normalizer. `custom_tool_call` (code-mode `exec`, `apply_patch`) is
still unmapped by `codex-on-disk.ts`.
