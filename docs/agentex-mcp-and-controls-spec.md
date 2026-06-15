# Spec: agentex MCP attachment + session controls

**Status:** SHIPPED upstream as `@agentex/agent@0.0.20` (2026-06-06) and consumed by Flow — orchestrator sessions now pass typed `mcpServers`/`strictMcpConfig`/`disallowedTools` (`src/lib/orchestrator/harness-surface.ts`, `orchestratorSessionConfig`); Flow's `extraArgs` is down to the permission-mode flag and the host-staged `tmp/orchestrator-mcp.json` is gone (agentex stages its own 0600 config). `includePartialMessages`/`assistant_delta` shipped too but Flow doesn't consume deltas yet. Kept for the rationale record. Originally written against `@agentex/agent@0.0.19`, validated against Claude Code CLI 2.1.165.
**Audience:** the agentex repo's coding agent. Everything here was found while wiring Flow's orchestrator onto harness sessions (Flow = host app embedding agentex sessions; see `docs/orchestrator-harness.md` in the Flow repo for the consumer side).
**Priorities:** P0 is a shipped bug. P1s are features Flow currently fakes through `extraArgs` and wants first-class. P2 is a smaller correctness ask.

---

## P0 — `ProviderConfig.mcpServers` emits a flag that doesn't exist

### Current behavior (bug)

Both arg builders emit, per server:

```js
// dist/providers/claude/execute.js (~L92) and session.js (~L141)
if (config.mcpServers) {
    for (const mcp of config.mcpServers) {
        args.push("--mcp-server", mcp.name, "--", mcp.command, ...(mcp.args ?? []));
    }
}
```

There is no `--mcp-server` flag in Claude Code (checked 2.1.165; not present in any 2.x changelog). The real surface is:

```
--mcp-config <configs...>   Load MCP servers from JSON files or strings
--strict-mcp-config         Only use MCP servers from --mcp-config,
                            ignoring all other MCP configurations
```

So any consumer setting `config.mcpServers` today gets a spawn with an unknown flag. Nobody has noticed because the field is effectively unused — Flow attaches MCP via `extraArgs: ['--mcp-config', <file>]` specifically to route around this.

Also: `McpServerConfig` is stdio-only (`{name, command, args?, env?}`), while Claude supports HTTP/SSE servers (`{type: 'http', url, headers}`) — which is the shape hosts embedding a local server actually need.

### Desired behavior

1. **Extend the type** to a discriminated union (keep the legacy shape valid as the stdio arm):

```ts
export type McpServerConfig =
  | {
      name: string;
      /** stdio transport (default when `type` omitted — back-compat) */
      type?: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      name: string;
      type: 'http' | 'sse';
      url: string;
      headers?: Record<string, string>;
    };
```

2. **Generate a config file, not argv.** Build the Claude-shaped JSON
   (`{"mcpServers": {"<name>": {…}}}`), write it into the session's staging
   area, and pass `--mcp-config <path>`.

   - Reuse the existing skills-staging pattern: `buildSkillsDir()` already
     creates a per-session temp dir (`agentex-skills-*`) whose lifecycle is
     owned by the session/execute call and passed via `--add-dir`. Stage
     `mcp-config.json` the same way (same dir is fine), **mode 0600**, and
     clean it up wherever the skills dir is cleaned up.
   - **Do not pass inline JSON in argv.** HTTP server headers carry bearer
     tokens; argv is world-readable via `ps`. This is the reason Flow uses a
     file too.

3. **Add `strictMcpConfig?: boolean`** to `ProviderConfig` → `--strict-mcp-config`.
   Embedding hosts need the session's MCP surface to be *exactly* what they
   attach — without it, a stray `.mcp.json` in the cwd or the user's
   user-scope servers leak into a product-controlled session. Default `false`.

4. **Flag ordering invariant (already true, keep it):** `config.extraArgs` must
   remain appended *after* all generated flags so hosts can override.

5. **Codex:** the codex provider has no `mcpServers` handling at all (grep
   confirms). Out of scope to implement here, but:
   - make `capabilities.mcp` truthful per provider (claude `true` once fixed;
     codex `false` until wired);
   - when codex lands, the mapping is config-driven, not argv: either
     `-c 'mcp_servers.<name>.url=…'` style overrides on `codex exec`, or a
     generated config file. Codex supports stdio and streamable-HTTP servers
     (`[mcp_servers.<name>]` with `url` / `bearer_token_env_var` /
     `http_headers`). Note its permission layer may prompt per MCP tool unless
     `default_tools_approval_mode` is set.

### Acceptance

- Unit test that snapshots the generated argv + the staged file for: one stdio
  server, one http server with headers, both together, plus `strictMcpConfig`.
- Argv contains `--mcp-config <staged-path>` and never `--mcp-server`.
- Staged file mode is 0600 and is removed on `close()` (and after `execute()`).
- A live smoke (claude auth present): session with an http server pointing at a
  local fixture MCP; assert a `tool_call` event with name `mcp__<name>__<tool>`.

---

## P1 — First-class tool allow/deny

Flow runs orchestrator sessions that must never edit files directly (writes go
through its action surface). Today it passes:

```ts
config.extraArgs = ['--disallowed-tools', 'Write,Edit,NotebookEdit', '--strict-mcp-config', ...]
```

Make it config:

```ts
interface ProviderConfig {
  /** Tool names/patterns to pre-approve. Claude: --allowed-tools. */
  allowedTools?: string[];
  /** Tool names/patterns to deny. Claude: --disallowed-tools. Deny wins. */
  disallowedTools?: string[];
}
```

- Claude: join with commas (`--disallowed-tools "Write,Edit,NotebookEdit"`).
  Patterns like `Bash(rm *)` and `mcp__server__*` pass through verbatim.
- Codex: no argv equivalent (its mechanism is `.rules` files / permission
  profiles) — ignore the fields there and document that, or expose a
  capability flag (`capabilities.toolFiltering`). Ignoring is acceptable for
  now; silent ignore must be documented on the field's JSDoc.

### Acceptance

- Argv snapshot tests for each field, both providers (codex: absent).
- Live: claude session with `disallowedTools: ['Write']` → asking it to write a
  file produces a denied tool result, not a file.

---

## P1 — Partial assistant-text deltas (typewriter)

Hosts polling block-level events can't render a typewriter. Claude supports
true token deltas in stream-json via `--include-partial-messages`
(`content_block_delta` / `text_delta` events). agentex should expose them
opt-in and additively:

```ts
interface ProviderConfig {
  /**
   * Emit incremental assistant text as `assistant_delta` events.
   * Claude: passes --include-partial-messages. Providers without
   * delta support ignore this (no delta events are emitted).
   */
  includePartialMessages?: boolean;
}

// New StreamEvent variant (additive — existing consumers unaffected):
| ({
    type: 'assistant_delta';
    /** Incremental text chunk, append-only within (messageId, blockIndex). */
    text: string;
    /** Content block index within the message, for multi-block replies. */
    blockIndex: number;
  } & BaseStreamEventFields)
```

Semantics — the contract that keeps existing consumers safe:

- Deltas are **purely additive**: the consolidated `assistant` event still
  fires exactly as today when the block completes. A host that ignores
  `assistant_delta` sees identical behavior to 0.0.19.
- `messageId` on deltas matches the eventual `assistant` event so hosts can
  reconcile optimistic delta text against the durable row.
- Off by default. When off, the flag isn't passed and parser behavior is
  unchanged.
- Thinking deltas: do **not** promise prose. Claude ≥2.1.155 withholds thinking
  text (signature-only) — see Flow's `docs/agentex-thinking-capture-spec.md`.
  If `thinking_delta` chunks ever carry text again, emitting a parallel
  `thinking_delta` event under the same flag is welcome, but spec it as
  best-effort.
- Watch interaction with `--output-format stream-json`: partial messages add
  `stream_event`-wrapped lines; the parser must pass unknown wrapper lines
  through its existing forward-compat path rather than misclassifying them.

### Acceptance

- Parser unit test from a captured stream-json fixture with partial messages:
  N `assistant_delta` events with monotonically growing text, then one
  consolidated `assistant` whose text equals the concatenation.
- With the flag off: fixture replay produces zero delta events (bit-identical
  to current behavior).

---

## P2 — Stable event identity for Codex

`BaseStreamEventFields.eventId` is `null` for codex (the CLI emits no per-event
uuid), and `messageId` (`item_N`) is turn-local. Hosts therefore can't build an
idempotency key, which makes live-capture + transcript-replay double-write the
same turn — Flow's full analysis: `docs/codex-reconcile-duplication-spec.md`
(Flow repo).

The agentex-sized ask (narrow, no cross-shape correlation):

- `transcript.read()` for codex should yield a **deterministic, replay-stable
  per-line identity** — e.g. derived from `(rollout file identity, byte
  offset)` which `TranscriptYield.offset` already knows — surfaced as
  `eventId` on the parsed event (a documented synthetic scheme like
  `codex:<threadId>:<offset>` is fine).
- Live app-server events: where a native `turnId` exists (v2 JSON-RPC),
  populate a composite-derived `eventId` (`<threadId>:<turnId>:<itemId>:<type>`)
  so at least live-vs-live replays are idempotent.
- Document that live and on-disk shapes differ (`command_execution` vs
  `exec_command`/`write_stdin`) so ids will not match *across* the two
  readers — cross-shape dedup stays a host concern.

---

## Housekeeping

- **Changelog/doc note for 0.0.19's `timeoutSec` change:** it now arms a
  per-send deadline on sessions (it previously applied only to `exec()`).
  Behavior is good; it just needs to be loud in the changelog since hosts that
  set `timeoutSec` for exec-style runs now get session turns interrupted.
- Ship all of the above as **0.0.20**, no breaking changes: `mcpServers`
  legacy stdio shape keeps parsing, all new fields optional, new event type is
  additive.

## Appendix — how Flow consumes this today (the consumer contract)

Per orchestrator session, Flow currently passes:

```ts
config.extraArgs = [
  // permission mode (unchanged, keep working):
  '--permission-mode', mode,            // when not bypass
  // would migrate to disallowedTools:
  '--disallowed-tools', 'Write,Edit,NotebookEdit',
  // would migrate to strictMcpConfig:
  '--strict-mcp-config',
  // would migrate to mcpServers (http arm):
  '--mcp-config', '<app-root>/tmp/orchestrator-mcp.json',
];
```

where the JSON file is `{"mcpServers": {"orchestrator": {"type": "http",
"url": "http://localhost:<port>/api/orchestrator/mcp", "headers":
{"Authorization": "Bearer <token>"}}}}` (mode 0600). After this spec ships,
all of that collapses into typed `ProviderConfig` fields and Flow's
`extraArgs` drops to just the permission-mode flag.
