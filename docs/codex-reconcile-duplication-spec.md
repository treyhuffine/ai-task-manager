# Spec: Codex live↔on-disk transcript duplication

**Status:** proposed — latent bug, not yet observed (no Codex tool rows in dev or prod DBs as of 2026-06-05; the app has been driven with Claude).
**Area:** `src/lib/executor/{reconcile.ts, adapter.ts, codex-on-disk.ts}`
**Severity:** high once Codex is used for multi-turn sessions — every turn captured live gets re-added in a second, noisier shape.

> **Update (agentex 0.0.20, 2026-06-06):** upstream now mints replay-stable
> synthetic `eventId`s for Codex — live app-server events get
> `codex:<threadId>:<turnId>:<itemId>:<eventType>`, transcript reads get
> `codex:<rolloutSessionId>:<lineStartByteOffset>`. The two schemes
> deliberately do NOT match (different wire vocabularies), so cross-shape
> dedup — this spec's whole problem — remains ours. What changes: each
> writer is now individually idempotent for free (`externalEventId` lands
> on both paths), and Option C's "mint a stable key on the live path"
> half is done upstream; only the reconcile-side alignment would remain.
> Recommendation unchanged: ship A, layer C later.

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
