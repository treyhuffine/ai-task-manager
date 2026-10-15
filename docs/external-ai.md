# Outside assistants and your personal Home

Settings → External AI connects an assistant you already use, such as Claude Code or the Codex CLI, to your personal Ri. It can search, read and update tasks, notes, areas and the priority deck. This includes private notes and private planning on tasks brought into My Ri from teams. Shared task edits still go through their team's normal command path. A team's separate External AI connection remains limited to that team's shared work.

1. For access from another computer, set an HTTPS remote address in Settings → Devices. Use any supported tunnel or your own HTTPS setup. The computer hosting the Home must stay on and reachable. Ri does not configure a tunnel automatically here.
2. Open Settings → External AI and choose Connect an external assistant.
3. Choose your client. A connection label is optional, useful for distinguishing devices or installations.
4. Follow the instructions in the dialog. Save its key now, since it is shown only once. CLI instructions put it in a dedicated shell environment variable and keep the literal key out of command arguments. For a personal Home the connection is named `ri-home` and uses `RI_HOME_TOKEN`.
5. Ask the assistant to find your tasks or save a note. The connection list then shows when it was used. Disconnect revokes just that connection on its next request.

With no remote address, the dialog gives the local address and explains that it works only on the computer hosting Ri. Configure the remote address before setting up an assistant elsewhere. If you change the address later, update the MCP URL in existing client configurations, or disconnect and create a fresh connection.

An MCP connection supplies tools to the assistant you are already running. It does not create a chat inside Ri or require a new AI provider key. Search uses the Home's existing semantic-search setup when available and falls back to keyword search. The connection key authenticates to Ri, not to Claude or OpenAI. Clients must support Streamable HTTP and bearer-token authentication. The instructions target terminal clients. They are not an OAuth connection flow for hosted chat apps, and desktop apps may not inherit shell-profile environment variables.

## Implementation and boundary

The endpoint is `/api/orchestrator/mcp`. Tools reuse the orchestrator registry and domain queries, including mirrors, embeddings and shared-task forwarding. `HOME_CONTENT_ACTIONS` in `src/lib/external-ai/policy.ts` is the explicit tool allowlist. New registry tools do not automatically become external tools. The proxy permits only this endpoint for a personal external key, strips caller-supplied authority headers and marks its scope. MCP discovery and dispatch enforce the scope. Dispatch checks the live key again before each tool, including revocation and expiry. A supplied Ri session credential never makes an external assistant a Ri chat.

Personal external credentials use the existing `api_keys.role = ai_client`, with both `device_id` and `member_id` null. Only a personal viewer can manage them, through `externalAi` tRPC. Creation returns a plaintext token once, while lists contain only display metadata. A team AI client still requires an active member. Device-bound AI keys remain invalid in a personal Home. Host-key backfill assigns only sign-in keys, so startup cannot attach external clients to the host. No migration is required.

These keys cannot sign into a browser, open a WebSocket, use the natural-language `/api/mcp`, start agents or chats, use terminals, change settings, or read attachment files. Search excludes the private capture stream. Body updates support `expected_body_revision` so clients can avoid replacing newer text. Existing viewer and signed-session MCP behavior is unchanged.

Coverage: `src/lib/external-ai/home-mcp.test.ts` drives the real MCP client SDK through the proxy and handlers on disposable Homes. It covers CRUD, search, stale note edits, mirrors, scope discovery and calls, forged headers, revocation, expiry, host backfill, normal viewer behavior, address validation and team isolation. `team-settings.browser.test.ts` covers both personal and team connection flows on desktop and phone layouts.
