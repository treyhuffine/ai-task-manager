# Spec: Capture assistant *thinking* prose in the Claude provider

**Audience:** agentex maintainers (`@agentex/agent`, `packages/agent/src/providers/claude/`)
**Status:** proposed — forward-looking; see "Current upstream reality" before estimating impact.
**Author context:** filed from a wrapper app that renders `chat_events` produced by agentex's
`StreamEvent`s. Thinking rows arrive empty; this spec explains why and what agentex should change.

---

## TL;DR

1. agentex spawns the `claude` **CLI binary** with `--input-format stream-json --output-format
   stream-json --verbose` and **parses only finalized `assistant` messages**
   (`providers/claude/parse.js` → `type === "assistant"`). It never enables partial-message
   streaming and never parses `stream_event` deltas.
2. For **extended-thinking** turns, the finalized `assistant` message contains a thinking block
   whose prose has been **stripped** — only the encrypted `signature` survives:
   `{"type":"thinking","thinking":"","signature":"Ero…"}`. So `parseStreamLine` maps it to a
   `thinking` StreamEvent with `text: ""`, and downstream consumers render an empty block.
3. The human-readable thinking prose only ever exists in the **streaming deltas**
   (`stream_event` → `content_block_delta` → `delta.type === "thinking_delta"`). To capture it you
   must (a) pass `--include-partial-messages` and (b) accumulate `thinking_delta` text per
   content-block, emitting it as the `thinking` StreamEvent instead of the empty finalized block.

## Current upstream reality (measured 2026-06-04, Claude Code 2.1.163)

⚠️ Capturing the deltas is **necessary but not currently sufficient**. On the current CLI, the
thinking content block streams a `signature_delta` but **no `thinking_delta` prose at all** — the
prose is withheld upstream. Verified end-to-end, including via the official
`@anthropic-ai/claude-agent-sdk` `query()` with `thinking: {type:'enabled', budgetTokens}` +
`includePartialMessages: true`:

```
thinking_delta_prose = 0   signature_delta = 1   final thinking block = empty
```

Historical transcripts on disk that *do* contain full thinking prose are all from Claude Code
**≤ 2.1.154**; every session **≥ 2.1.155** is empty regardless of entrypoint (`cli`, `sdk-cli`,
`sdk-ts`). So this is a client-version / API-policy change, not an invocation bug.

**Conclusion:** implement the capture path below so agentex is *ready* the moment Anthropic
re-enables thinking prose (or for any model/provider that still emits it — e.g. older Sonnet
sessions did). It will not retroactively surface thinking on a CLI that withholds the deltas.

## Reproduction

```bash
# Finalized assistant message has empty thinking + signature only:
printf '%s\n' '{"type":"user","message":{"role":"user","content":"Think hard then prove sqrt(2) is irrational."}}' \
 | claude --input-format stream-json --output-format stream-json --verbose \
          --include-partial-messages --max-thinking-tokens 10000
# Observe in the stream: content_block_start{type:thinking}, content_block_delta{signature_delta},
# content_block_stop — and NO content_block_delta{thinking_delta}. final message thinking == "".
```

## What to change

### 1. Spawn flags — `providers/claude/session.ts` (and `execute.ts`)

Add to the args array:

```diff
  "--input-format", "stream-json",
  "--output-format", "stream-json",
  "--verbose",
+ "--include-partial-messages",
```

Optionally set `env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts"` for parity with the official SDK (cosmetic;
does not affect thinking capture on its own — measured).

Thinking budget: when the caller requests thinking, pass `--max-thinking-tokens <N>` (the SDK's
`thinking:{type:'enabled',budgetTokens:N}` lowers to this flag). `--thinking adaptive` is the
SDK's default when no budget is given.

### 2. Parse `stream_event` deltas — `providers/claude/parse.js`

`parseStreamLine` currently handles `type === "assistant"` (finalized) only. Add a `stream_event`
branch that accumulates thinking prose per content-block index and flushes a populated `thinking`
StreamEvent. Sketch:

```ts
// module-scoped, keyed by `${eventUuid|messageId}:${index}`
const thinkingBuffers = new Map<string, string>();

if (type === "stream_event") {
  const ev = event["event"];                 // the raw Anthropic stream event
  const idx = ev["index"];
  const key = `${messageId ?? sessionId}:${idx}`;
  if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") {
    thinkingBuffers.set(key, "");
    return [];                                // nothing to emit yet
  }
  if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
    thinkingBuffers.set(key, (thinkingBuffers.get(key) ?? "") + (ev.delta.thinking ?? ""));
    return [];
  }
  if (ev.type === "content_block_stop" && thinkingBuffers.has(key)) {
    const text = thinkingBuffers.get(key) ?? "";
    thinkingBuffers.delete(key);
    if (!text.trim()) return [];              // empty → skip (don't emit empty thinking)
    return [{ type: "thinking", text, ...baseFieldsFromEvent(event, messageId) }];
  }
  return [];                                  // ignore text_delta/signature_delta/etc.
}
```

### 3. De-duplicate against the finalized empty block

The finalized `assistant` message still arrives with an empty thinking block. Either:

- **(preferred)** in the `type === "assistant"` branch, **skip** thinking blocks whose
  `thinking` is empty (they're superseded by the streamed prose), or
- emit nothing for thinking in the finalized branch when partial messages are enabled.

This mirrors the existing Codex behaviour, which already skips empty reasoning summaries
(`codex-on-disk.ts`).

### 4. Stable per-block event ids (robustness, independent of thinking)

`baseFieldsFromEvent` sets `eventId = event.uuid`, i.e. **the same id for every block** in one
assistant message (thinking + text + tool_use share it). Wrappers that dedupe rows on a wire id
can drop sibling blocks. Recommend deriving a per-block id, e.g. `eventId = `${uuid}:${index}``,
so thinking/text/tool rows from one message are individually addressable.

## Acceptance

- A thinking turn yields a `thinking` StreamEvent whose `text` is the full reasoning prose (when
  the CLI emits `thinking_delta`).
- No empty `thinking` StreamEvents are emitted.
- Text/tool_use events are unaffected; ordering preserved (thinking before the text it precedes).
- Verified against `claude --include-partial-messages` once upstream re-exposes `thinking_delta`.
