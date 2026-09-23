# Background AI through the subscription harness

Every server-side background AI call runs through the user's default
subscription harness (Claude Code, Codex, ...) — the same runtime the
orchestrator chat, document chat, and executions already use. No background
feature bills a model API key. The one sanctioned direct OpenAI API use in
the app is **embeddings** (`src/lib/embeddings/`), which silently no-op
without `OPENAI_API_KEY` (search degrades to FTS-only).

This replaced the API-key era where deck generation, the stream urgency
lane, image-capture extraction, and the NL MCP inner agent each called
`openai(MODEL_STANDARD || 'gpt-5.4-mini')` directly.

## The helper: `src/lib/harness/one-shot.ts`

Generalizes the pattern `deriveAndSetSessionLabel` pioneered
(`src/lib/sessions/derive-label.ts`): resolve the harness, spawn one
tightly-bounded `provider.execute` through `@agentex/agent`, read
`result.summary`.

- `runHarnessText(opts)` — one bounded call, returns the final text.
- `runHarnessJson(opts)` — adds a JSON-only instruction (the call site
  supplies a hand-written `shape` string kept next to its zod schema),
  parses tolerantly (`extractJsonObject` strips fences/prose), validates
  with zod, and retries once with the rejection reason before throwing.
- `resolveBackgroundHarness()` — `defaultHarness` from user state
  (the same default the orchestrator chat uses), falling back to `claude`.
- `backgroundModelFor(provider, tier)` — `fast` = the provider's cheap
  alias (`CHEAPEST_MODEL`: haiku / gpt-5.4-mini); `standard` = the user's
  `defaultModel` when it belongs to the provider, else the CLI's own
  default model.

### Safety posture

- `strictMcpConfig` always — ambient MCP (stray `.mcp.json`, user-scope
  servers) never leaks into a background call.
- Tool-less calls run `skipPermissions: true`, `maxTurns: 1`, and deny
  `Write`/`Edit`/`NotebookEdit`/`Bash`.
- Tool-using calls attach explicit `mcpServers` plus an `allowedTools`
  allowlist and run with `unattendedPermissionPolicy: 'deny'` — everything
  outside the allowlist is refused.

### Tool wiring per harness

Claude supports MCP attachment (`capabilities.mcp`), so tool-using calls
attach the orchestrator MCP (and the connectors MCP where relevant) over
localhost + the local bearer token. Codex has no MCP wiring in agentex yet:
call sites check `harnessSupportsMcp()` and fall back to running at the app
data root, where the installed AGENTS.md surface routes the same actions
through the CLI (Bash stays available on that path for exactly this
reason). When agentex lands Codex MCP support, the fallback branch
disappears and the allowlists light up there too.

## Call sites

| Feature | File | Tier | Tools |
| --- | --- | --- | --- |
| Deck context gathering | `src/lib/ai/generate-deck.ts` | standard | `search`, `get_day_shape`, read-only connector actions |
| Deck structured generation | `src/lib/ai/generate-deck.ts` | standard | none (JSON) |
| Stream urgency lane | `src/lib/stream-triage/urgency.ts` | fast | none (JSON) |
| Image-capture extraction | `src/lib/capture/extract-image.ts` | standard | file reads (images already saved to the attachments dir) |
| NL MCP inner agent | `src/lib/mcp/agent.ts` | standard | read-only action allowlist (`query`) or the full surface (`update`) |
| Session label derivation | `src/lib/sessions/derive-label.ts` | fast (predates the helper) | none |

The NL MCP agent harvests its `entities` / `innerSteps` payload from
harness `tool_call` / `tool_result` stream events instead of ai-sdk steps:
MCP tool names carry the action (`mcp__orchestrator__<action>`), and on the
CLI path the action envelope (`{ok, action, result}`) printed on stdout
names it. Uncited/hallucinated ids remain impossible — entities come only
from observed successful results.

## What was deleted with the migration

- `POST /api/chat` and the whole in-process chat stack it fronted
  (`src/lib/ai/adapters/*`, `chat-tools.ts`, `agent-prompt.ts`,
  `inline-text-attachments.ts`, `extract-pdf-for-openai.ts`,
  `src/lib/attachments/normalize-image.ts`, the `unpdf` dependency). All
  chat surfaces are harness sessions; attachments flow through
  `expandMarkers`.
- OpenAI STT (`openai/whisper-1`, `openai/gpt-4o-*-transcribe`). Providers
  are Parakeet (local Docker sidecar) and Groq, plus the browser Web Speech
  fallback. A stored `openai/*` voice model resolves through
  `resolveVoiceModel` in `src/lib/stt/transcribe.ts`, which drops unknown
  ids down to auto-pick instead of erroring.

## What still touches OpenAI intentionally

- Embeddings: `text-embedding-3-small` on every entity write and search
  query (`src/lib/embeddings/embed.ts`, `search.ts`, `backfill.ts`).
- The dev playground (`/api/playground/chat`) — an explicit manual
  model-testing page.
- Manual scripts: `db:triage` / `db:retriage` / `eval:triage` default to
  OpenAI unless `--provider claude` is passed.

## Env vars

- `MODEL_STANDARD` / `MODEL_FAST` / `MODEL_CAPABLE` no longer drive any
  runtime feature — only the manual triage/eval scripts read them.
- `MCP_MODEL` still pins the NL MCP inner agent's model id explicitly,
  overriding the default-agent selection.
