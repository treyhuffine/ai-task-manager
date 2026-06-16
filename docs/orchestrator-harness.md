# Orchestrator on the harness

The dashboard chat can run on three different brains, selected by
`user_state.orchestratorMode` (the Classic / Skills / MCP switch in the
Chat tab):

| Mode | Value | What runs |
|---|---|---|
| Classic | `legacy` | The hand-rolled streamText agent (`src/lib/ai/chat-tools.ts` + `agent-prompt.ts`). Ephemeral, in-process, direct API keys. |
| Skills | `harness_skills` | A real harness session (Claude Code) with cwd = the app data root. Actions via the CLI (`<cli> agent <action>`), taught by the data-root brief + the bundled `orchestrator` skill. No MCP servers attached. |
| MCP | `harness_mcp` | Same harness session, with the orchestrator HTTP MCP attached — one typed tool per registry action (`mcp__orchestrator__create_task`, …). |

`legacy` stays fully intact as the fallback path — nothing about it changed.
The point of the three-way switch is to A/B the harness approaches without
clobbering what works.

## How a harness orchestrator session works

1. The Chat tab (harness modes) ensures a persistent `type='orchestration'`
   chat session via `GET /api/orchestrator-chat` (created against the default
   orchestrator agent, `getOrCreateDefaultOrchestrator`). "New" archives it
   and starts fresh (`POST /api/orchestrator-chat`).
2. Sends go through the normal sessions API (`POST /api/sessions/:id/messages`)
   into `executor.dispatch` — the same adapter executions use.
3. `resolveCwd` resolves sessions without a workspace to the **app data root**
   (`~/flow`, `~/flow-dev` in dev). This is also what un-broke scheduled
   `targetKind='orchestrator'` fires, which previously threw
   `Session has no resolvable cwd`.
4. Before spawn, `ensureAgentSession` installs the **surface**
   (`src/lib/orchestrator/harness-surface.ts`):
   - `CLAUDE.md` + `AGENTS.md` at the data root — the role brief (domain
     model, entity-marker syntax, conventions, mode-specific tool guidance).
     Content sits inside `<!-- flow:managed -->` markers; user edits outside
     the markers survive regeneration.
   - The skills-mode CLI command **bakes the data root inline**
     (`FLOW_ROOT='…' pnpm --silent --dir <repo> cli:dev` in dev,
     `FLOW_ROOT='…' flow` in prod). The harness's Bash tool starts a fresh
     shell from the user's profile — server env does NOT reach CLI
     subprocesses, and without the inline root a skills-mode write lands in
     the default (prod) brain. Caught live by the level-4 smoke.
5. Per-session config (`orchestratorSessionConfig`) — typed agentex ≥0.0.20
   `ProviderConfig` fields, not raw argv. Codex ignores them until its
   wiring lands upstream (so the write guard doesn't hold there; the
   adapter warns):
   - both harness modes: `disallowedTools: ['Write','Edit','NotebookEdit']`
     (writes must flow through actions — the markdown mirror is one-way and
     direct edits bypass embeddings/mirror/attachment invariants) and
     `strictMcpConfig` (the session sees exactly the MCP surface we
     attach; a stray `.mcp.json` or user-level servers can't leak in).
   - `harness_mcp`: `mcpServers: [{ type: 'http', url, headers }]` — the
     orchestrator MCP URL + local bearer token. agentex stages the config
     as a 0600 temp file and passes `--mcp-config` itself; the host-staged
     `tmp/orchestrator-mcp.json` is gone (install removes stale copies —
     they carry a token).
6. Events stream through the existing pipeline (agentex `StreamEvent` →
   `chat_events` → SSE). MCP tool calls render through the same
   `tool-display.ts` humanization the execution view uses; `[[task:id]]`-style
   markers in agent prose render as interactive chips (`EntityAwareText`,
   wired into agent rows in `execution-event.tsx`).

## Chat naming + history

- **Titles are list affordances, and only intent-stable threads get them.**
  Executions keep first-message haiku titles (one task, one intent — the
  same `deriveAndSetSessionLabel` pipeline as before). Orchestration chats
  are relationship-shaped: they carry **no title while live** (the messages
  route skips derivation for `type='orchestration'`), render in History as
  time + last-user-message snippet, and get a **retrospective summary at
  archive time** (`deriveRetrospectiveLabel` — samples the opening message
  plus recent exchanges, fired from the new-chat/resume archive sites;
  failure leaves the snippet). Labels freeze once archived; re-archiving a
  resumed thread re-summarizes. We deliberately don't scrape Claude Code's
  own session titles: they're lazy summary records in its JSONL,
  Claude-only, and not surfaced through agentex's stream.
- The **History** menu in the chat mode bar lists interactive orchestrator
  chats (`GET /api/orchestrator-chat/history`; scheduled-fire chats excluded).
  Picking one resumes it (`POST /api/orchestrator-chat/resume`): the current
  chat is archived, the target flips active, and the harness restores full
  conversation context via its persisted `externalSessionId` on the next
  send. Resumed chats run under the *current* mode's flags regardless of the
  mode they started in.

## Mode semantics

- Switching into a harness mode always starts a **new session** — the flags
  above are read at process spawn, so a fresh process is the clean cut.
- Scheduled orchestrator fires are harness sessions regardless of the
  dashboard toggle; when the toggle is `legacy` they default to the MCP
  surface (`resolveOrchestratorMode` in `src/lib/executor/adapter.ts`).
- Permission mode defaults to `bypass` (matches executions). The
  `--disallowed-tools` guard holds even in bypass.

## Execution oversight

The orchestrator can watch and steer executions (both harness modes; legacy
is frozen and doesn't get these):

- `list_executions` — rail view across workspaces with live `running` /
  `awaitingInput` flags.
- `get_session_messages` — condensed transcript tail (`session-oversight.ts`
  drops noise, one-lines tool calls, truncates content) + pending-prompt
  detail derived from the event log.
- `send_session_message` — message into a session, delivered **through the
  server's messages route**, never `executor.dispatch` from the handler.
- `get_pending_input` / `answer_pending_input` — fetch and resolve the
  permission/question prompts a session is blocked on, via the server's
  pending-input endpoints (the resolvers are in-memory server state). This
  matters because a blocked turn never sees queued messages — answering is
  the only way to unblock. Doctrine in the brief: answer questions when the
  user's intent is clear; permission prompts default to being surfaced to
  the user.

Process-ownership rule (`src/lib/orchestrator/server-client.ts`): the server
process owns every harness subprocess, the running set, and pending-input
resolvers. Registry handlers run in-server (MCP) *or* in a short-lived CLI
process (skills mode) — so DB reads go direct, while live flags and sends go
over the server's HTTP API with the local token. When the server is
unreachable, live flags degrade to unknown (and sends fail with a clear
error) rather than lying.

Scheduled oversight comes free: orchestrator-target schedules fire with this
same surface, so "every morning, check executions and nudge stalled ones" is
just a `create_schedule` with `target_kind=orchestrator` — which the
orchestrator itself can create on request.

## Stream triage

The orchestrator owns the capture inbox (`list_stream` → `promote_stream` /
`dismiss_stream`, plus `create_stream_item` to file ambiguous captures INTO
it). `promote_stream` is the one compound action in the registry: it creates
the task/note AND stamps the stream row's promotion links
(`promotedToType/Id/At`) in a single call — same two steps the stream UI
does client-side, but atomic from the agent's perspective. Raw text and
attachments carry into the created entity; the agent's job is shaping the
title (imperative for tasks), not rewriting the user's words. Dismissals are
attributed (`dismissedBy: 'agent'`) and items stay searchable — triage, not
deletion. "Triage my stream every morning" is a one-line
`target_kind=orchestrator` schedule.

## The registry is the contract

Both harness modes act through `src/lib/orchestrator/registry.ts` — the CLI
and the MCP are generated from it. The legacy chat agent's whole surface now
exists there: tasks, notes (`update_note` included), stream triage, areas,
deck (`get_deck`, `update_deck`, `regenerate_deck` — direct pipeline call,
no HTTP hop), `search` (hybrid; degrades to FTS without `OPENAI_API_KEY`),
and user state. Archive-over-delete is intentional: there are no delete
actions.

## Known gaps (v1)

- **No typewriter streaming** — harness events land at block granularity.
  agentex ≥0.0.20 supports it natively (`includePartialMessages` →
  `assistant_delta`/`thinking_delta` events, purely additive — the
  consolidated `assistant` event still fires with a matching `messageId`);
  the remaining work is ours: forward deltas through `chat_events`-less SSE
  and reconcile in the chat UI. Note: agentex documents `thinking_delta` as
  the only possible carrier of thinking prose, but don't expect it to fix
  empty thinking rows — Claude Code ≥2.1.155 emits zero `thinking_delta`
  even with partial messages on (verified 2026-06-04, see
  `docs/agentex-thinking-capture-spec.md`); prose returns only if upstream
  policy changes.
- **Codex**: the surface files install for any provider, and the typed
  session config (`disallowedTools`/`strictMcpConfig`/`mcpServers`) is
  passed everywhere — but Codex ignores those fields upstream
  (`capabilities.mcp` false, no argv tool filtering), so no write guard /
  MCP there yet. Codex wiring (config overrides, `--skip-git-repo-check`,
  AGENTS.md-only steering) is next.
- **Attachments**: the brief teaches the session to `Read`
  `attachments/<name>` (in the home dir) when a message carries `[[file:…]]` markers —
  works for text/images the harness can read natively; no extract-text
  pipeline (docx etc.) on this path yet.
- **Quick actions** ("What's next?" etc.) render in Classic mode only.
- ~~`agentex@0.0.19`: `ProviderConfig.mcpServers` generates a `--mcp-server`
  flag that doesn't exist in Claude Code ≥2.1.x~~ — fixed upstream in
  0.0.20 (we wrote the spec: `docs/agentex-mcp-and-controls-spec.md`).
  MCP attachment now goes through typed `mcpServers`; `extraArgs` is down
  to the permission-mode flag.

## Files

- `src/lib/orchestrator/harness-surface.ts` — surface install, brief
  rendering, typed per-session config (`orchestratorSessionConfig`,
  `orchestratorMcpServer`) (+ tests in `harness-surface.test.ts`)
- `src/lib/config/claude-md-template.ts` — managed markers + base brief
- `src/lib/executor/adapter.ts` — cwd fallback, orchestration branch in
  `ensureAgentSession`
- `src/app/api/orchestrator-chat/route.ts` — ensure/new session
- `src/components/chat/harness-chat.tsx` — the harness chat column
- `src/components/dashboard/content-panel.tsx` — mode switch (`ChatModeBar`)
- `skills/orchestrator/SKILL.md` — bundled skill (CLI/MCP conventions)
