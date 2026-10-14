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

## Chat naming

Ri owns when a chat gets named, the context, display rules, and the fallback
prompt/model. Agentex 0.0.45 provides the native-first `generateTitle` helper
with an explicit host-supplied fallback. The library supplies no naming prompt
or model and does not persist suggestions.

The fallback uses the device-local execution half of the one-shot helper
(`src/lib/harness/one-shot-runtime.ts`). The home supplies the naming prompt,
harness and model, so a connected runner never reads the home's database to
resolve those choices. The native request and fallback each have a 30-second
budget within a 70-second overall deadline, including metadata reads and cleanup.

- Work and content chats request a title after their first send is accepted.
  Their runner first reuses an existing native title, then invokes native
  generation if available, then uses Ri's callback. Claude uses
  `generate_session_title` with `persist: false`. Codex exposes native title
  reads/writes but no native generator, so Ri's callback supplies generation.
- Main chats remain unlabeled while live. Archive requests a fresh retrospective
  suggestion without reusing the initial native name. Manual names are retained.
  A closed Claude chat uses a short-lived native control session without
  resuming the archived work. That session supplies no custom generation prompt
  and is closed after the naming request.
- A title suggestion carries the revision captured when it was requested.
  `setGeneratedChatSessionLabel` accepts it only while that revision and title
  ownership still match. Every explicit rename or clear increments the revision
  and marks the name manual, so a late result cannot overwrite it. Legacy
  nonempty labels are treated conservatively as manually chosen.
- User renames remain Ri operations. Native synchronization uses `setTitle`,
  never direct writes to harness files or databases. Active sessions sync at
  once. Inactive sessions sync their current Ri name when next started/resumed.
  Automatic names first check for a rename made in the native client while
  offline. Existing native names are adopted without rewriting them. Clearing
  a Ri name remains a local choice when the native setter accepts only nonempty names.
  Native writes are serialized, and an older revision cannot follow a newer one.
- Connected devices receive durable `generate_title` and `set_title` commands.
  Generation runs in the background on the session's device and reports a
  journaled suggestion. The home applies the same revision guard. Naming does
  not block chat sends or the worker's command queue.
- Native title notifications are metadata, not transcript rows. A dedicated
  realtime title event refreshes the chat and rail. Explicit manual names and
  active main-chat naming policy take priority over those notifications.
- Initial generation failure uses truncation. Retrospective failure keeps the
  existing name/snippet. Unsupported or failed native generation calls the
  supplied Ri fallback. Cancellation never starts fallback work.

The execution's header title remains separate from its per-chat title. It is
seeded once, and its own revision preserves later header renames and clears.

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
  (the same default the orchestrator chat uses), falling back to Codex
  when no choice is saved. Existing saved choices are preserved.
- `backgroundModelFor(provider, tier)` — `fast` = the provider's cheap
  alias (`CHEAPEST_MODEL`: haiku / gpt-5.4-mini); `standard` = the user's
  `defaultModel` when it belongs to the provider, else the CLI's own
  default model. Cursor and OpenCode have no cheap alias or bundled catalog,
  so both tiers use the CLI's default model.

Antigravity background calls fail clearly before a provider is launched.
Its headless CLI honors auto-approval but does not enforce agentex's tool
filters or MCP isolation. Selecting it as the default does not silently
switch to another harness. Automatic titles use their existing snippet
fallback. A disabled rollout flag likewise refuses all background calls.
Antigravity's cheap-model entry is explicitly null because its discovered
slugs have no stable cheap alias.

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
attach the orchestrator MCP (and the integrations MCP where relevant) over
localhost + the local bearer token. Codex has no MCP wiring in agentex yet:
call sites check `harnessSupportsMcp()` and fall back to running at the app
data root, where the installed AGENTS.md surface routes the same actions
through the CLI (Bash stays available on that path for exactly this
reason). When agentex lands Codex MCP support, the fallback branch
disappears and the allowlists light up there too.

## Call sites

| Feature | File | Tier | Tools |
| --- | --- | --- | --- |
| Deck context gathering | `src/lib/ai/generate-deck.ts` | standard | `search`, `get_day_shape`, read-only integration actions |
| Deck structured generation | `src/lib/ai/generate-deck.ts` | standard | none (JSON) |
| Stream urgency lane | `src/lib/stream-triage/urgency.ts` | fast | none (JSON) |
| Image-capture extraction | `src/lib/capture/extract-image.ts` | standard | file reads (images already saved to the attachments dir) |
| NL MCP inner agent | `src/lib/mcp/agent.ts` | standard | read-only action allowlist (`query`) or the full surface (`update`) |
| Session label derivation | `src/lib/sessions/derive-label.ts` + `src/lib/runner/titles.ts` | native, then the chat's model | none |

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
