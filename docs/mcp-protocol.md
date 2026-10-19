# MCP protocol versions

Ri speaks MCP 2026-07-28 as a client and as a server, and still serves and reaches older peers. Both sides use the v2 TypeScript SDK (`@modelcontextprotocol/client`, `server` and `core` 2.3.1). `@modelcontextprotocol/sdk` 1.x and `mcp-handler` are gone from Ri's own dependencies. 1.x stays installed only as a dependency of Mastra and the shadcn CLI. MCP Apps hosting uses `@modelcontextprotocol/ext-apps` 2.0.3 (`docs/connected-mcp-apps.md`).

## Ri as a client

Every MCP server Ri connects to (hosted catalog servers, servers you add, managed sources, local apps) goes through `packages/integrations/src/mcp/client.ts`.

- Over HTTP, Ri opens with the 2026-07-28 probe (`server/discover`). A server that answers it is used statelessly on 2026-07-28: no session, no `initialize`, and a `subscriptions/listen` stream for tool list changes.
- A server that fails the probe falls back to the 2025 handshake (`initialize`, ending at 2025-11-25 or whatever older version the server picks). Fallback happens only for an unusable answer to the probe (5xx, unknown method or version, malformed response) or a probe that takes more than 10 seconds. A 401 or 403 is never evidence of an old server: it goes to sign-in as before, so a 2026 server behind OAuth is never pinned to the old protocol.
- A fallback is remembered on the server's record (`protocol.negotiation: "fallback"`) for a day. Until then Ri skips the probe and connects with `initialize` directly, so an old server costs one probe a day rather than one per connection.
- A local process (stdio) starts on the 2025 handshake. The SDK probes stdio by starting a second copy of the process, which doubled 1Password's process and prompt, so Ri leaves stdio on the handshake every stdio server supports.
- Ri advertises the MCP Apps extension (`io.modelcontextprotocol/ui`) and OpenAI's form extension (`extensions["openai/elicitation"]`, with standard `elicitation.form`) in its client capabilities on every connection.
- What the server said about itself is kept on its record (`McpServerEntry.protocol`): the negotiated version and era, how it was reached, its extension capabilities (`openai/settings`, `openai/mentions` and others, from `capabilities.extensions` and the legacy `capabilities.experimental`, 8 KiB at most) and its `serverInfo` (name, title, version, description, an `https` website and up to four icons, each an `https` or image `data` URL of 64 KiB at most). Each MCP server's page shows the version as a chip, for example "MCP 2026-07-28". An older version gets a tooltip that says Ri falls back to it automatically.
- Tool lists are fetched fresh each time (`cacheMode: "refresh"`). A server that repeats a pagination cursor fails with a plain error instead of looping.
- HTTP redirects are followed, as SDK 1.x followed them (`redirectPolicy: "follow"`). The v2 default refuses cross-origin redirects, which broke servers that move their endpoint.

### OAuth under the v2 SDK

- New dynamic client registrations send `application_type`: `native` for a loopback or custom-scheme redirect (the desktop flow), `web` otherwise.
- The authorization response's `iss` parameter (RFC 9207) is passed to the SDK on every callback route, desktop included.
- The SDK checks that an authorization server's metadata names the issuer Ri asked for (RFC 8414). Docusign's MCP server names `account.docusign.com` while its metadata is served from the MCP host, so its catalog entry declares the alias (`issuerAliases` in `packages/integrations/src/providers/hosted-mcp.ts`). For a provider with aliases, Ri checks the issuer itself against the pinned pair and refuses anything else before sending credentials, and the SDK's own check is skipped for that provider only.
- The resource indicator is kept per grant (`resourceIndicator` in the sealed OAuth state). SDK 1.x normalized the indicator (adding a trailing slash to a bare origin), and v2 sends the server's value verbatim. A grant made under 1.x keeps its normalized indicator, so its refresh tokens keep working. A new grant uses the server's exact value.

## Ri as a server

All of Ri's MCP endpoints are built on one wrapper, `src/lib/mcp/http-server.ts` (`riMcpHandler`), around the SDK's `createMcpHandler` with its stateless legacy leg. One handler answers 2026-07-28 clients and 2025-era clients at the same URL: the orchestrator (`/api/orchestrator/mcp`), the natural-language endpoint (`/api/mcp`), integrations (`/api/integrations/mcp`), coordination, email, browser and results (`/api/orchestrator/<surface>/mcp`), and the team endpoint.

- Tool schemas are zod 3 raw shapes, published as the same JSON Schema SDK 1.x published (`zodToJsonSchema`), so clients that cached a tool list see no change. A parameterless tool keeps the bare `{type: "object", properties: {}}` schema.
- Request headers reach every tool handler, so the signed chat credential still identifies the calling chat.
- Each Claude Code chat now keeps a `subscriptions/listen` stream open to the endpoints it uses. The SDK closes the per-request server before streaming, sends a keepalive every 15 seconds and allows 1024 streams per handler.
- Only `…/mcp` answers. The old SSE transport (`…/sse` and `…/message`, which `mcp-handler` served) is gone. Every harness Ri configures uses `…/mcp`.
- An unknown tool now answers with a protocol error (`-32602`, "Tool … not found") rather than a tool result with `isError`, as the 2026 SDK does for both eras. A tool that fails still returns `isError`.

### Verified with real harnesses (October 19, 2026)

On the dev home, a Claude Code chat and a Codex chat (agent main chats, which carry the orchestrator server) each ran `list_tasks` and `create_note`. A message from the Claude chat reached the Codex chat, and an `ask_agent` question from Codex was answered by Claude and resumed the Codex chat. Executions ran `get_session_context`, `list_email_accounts` and `browser_status` on the coordination, email and browser servers in both harnesses. Through a logging proxy, Claude Code 2.1.302 negotiated 2026-07-28 (`server/discover`, `subscriptions/listen`, `tools/list`, `tools/call`) and Codex 0.162.1 negotiated 2025-06-18 through `initialize`.

## Checking a server

Open Settings, Plugins, MCP servers, choose the server and click Re-test. The chip beside its status shows the version it negotiated. For a catalog provider the same facts are on its record in `<app-root>/.config/integrations/mcp-servers.json` under `protocol`.

## Tests

- `packages/integrations/src/__tests__/mcp-client.test.ts`: both eras against real HTTP servers, the fallbacks (5xx on discover, a stalled probe, a remembered legacy server), no fallback on 401, list-changed through a listen stream, MRTR elicitation, advertised capabilities, the repeated-cursor guard, and stdio in both modes.
- `packages/integrations/src/__tests__/mcp-client-errors.test.ts`: error classification, deadlines and when a probe failure retries.
- `src/lib/mcp/http-server.test.ts`: one handler serving both eras with request headers, schema parity with SDK 1.x, and argument validation.
- `src/lib/integrations/mcp-servers.test.ts`: what is kept from `server/discover` and `initialize`, and the fallback memory.
- The OAuth suites under `src/lib/integrations/mcp-oauth*.test.ts`: `application_type`, the Docusign issuer pin and a forged issuer, and resource indicator continuity across a refresh.
