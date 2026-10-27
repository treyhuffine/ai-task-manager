# Connect your agent

Settings → Connect your agent connects an outside agent, such as Claude Code, Codex or Cursor, to Ri's MCP. It can search, read and update tasks, notes, areas and the priority deck in your personal Ri. This includes private notes and private planning on tasks brought into My Ri from teams. Shared task edits still go through their team's normal command path. A team's own Connect your agent section gives an agent the team's shared work only.

To use a team from your personal Ri, follow [Testing a team through personal Ri](team-testing.md). It covers both MCP CRUD and running a shared task with your personal agent.

## The list

Every agent Ri knows is one accordion item, most popular first: Claude Code, Codex, Cursor, VS Code, then the Claude app, Gemini CLI, Windsurf, OpenCode, Antigravity, Goose, Kiro and LM Studio, then ChatGPT (listed with why it can't connect yet), another Ri and any MCP client. `AI_CLIENTS` in `src/lib/external-ai/client-config.ts` is the single source of each one's steps, install link, setup prompt, configuration file and skill folder. The personal settings page and a team's settings render the same list (`src/components/settings/connect-agents.tsx`), each with its own address and names.

Each item holds, in this order:

1. **Set up**, on a personal Ri, for an agent installed on the computer running Ri. In one action it makes the agent's key, writes Ri's server into the agent's user-level configuration the agent's own way, and installs Ri's skills for it. The item then shows it connected, with when its key was last used, and Disconnect removes the entry Ri wrote and revokes the key.
2. **The agent's own install link** where it has one that opens the app directly: Cursor (`cursor://anysphere.cursor-deeplink/mcp/install`), VS Code (`vscode:mcp/install`), Goose (`goose://extension`) and LM Studio (`lmstudio://add_mcp`). The key is in the link, so Ri never uses an agent's web redirect (`cursor.com/en/install-mcp`, `kiro.dev/launch/...`), which would send the key to a web server. Kiro's only link is a web page, so Kiro gets Set up and its steps instead. The desktop app opens only these exact links from its main frame (`agentInstallUrl` in `desktop/trust.ts`).
3. **Copy setup prompt**: a prompt with a new key that an agent on another computer follows to set itself up.
4. **The steps by hand**, complete, with copy buttons. The step that holds the key shows a placeholder and Create key until the key exists. A key is shown only while Settings is open.
5. **The agent's keys**, each with when it was last used and Disconnect. Keys stay revocable per agent: `api_keys.client` records which agent a key was made for. Keys from before it was recorded are filed by their default name ("Claude Code", "Codex", "My Ri"), and any other under Any MCP client.

The agents Ri sets up on this computer, and how:

| Agent | Where Ri writes | How |
| --- | --- | --- |
| Claude Code | `~/.claude.json` (`$CLAUDE_CONFIG_DIR`) | `claude mcp add --transport http --scope user ri <url> --header "Authorization: Bearer <key>"` |
| Codex (CLI and the Codex app in ChatGPT.app) | `~/.codex/config.toml` (`$CODEX_HOME`) | `codex mcp add ri --url <url>`, then the key as `[mcp_servers.ri.http_headers]`, read back with `codex mcp get ri --json` |
| Cursor (editor and CLI) | `~/.cursor/mcp.json` | file, `mcpServers.ri = { url, headers }` |
| VS Code | the profile's `mcp.json` (`~/Library/Application Support/Code/User/mcp.json` on a Mac) | file, `servers.ri = { type: "http", url, headers }`, what `vscode:mcp/install` writes |
| Claude app | `claude_desktop_config.json` | file, through `npx mcp-remote <url> --header "Authorization:${RI_AUTH_HEADER}" --transport http-only` with the key in `env` |
| Gemini CLI | `~/.gemini/settings.json` | file, `type: "http"` with `url` (`httpUrl` is deprecated) |
| OpenCode | `~/.config/opencode/opencode.json` | file, `mcp.ri = { type: "remote", url, enabled, oauth: false, headers }` |
| Antigravity | `~/.gemini/config/mcp_config.json` | `agy mcp add --header ... ri <url>`, then the file narrowed to its owner |
| Kiro | `~/.kiro/settings/mcp.json` | file, `mcpServers.ri = { url, headers }` |

Files are edited in place with `jsonc-parser`: comments and everything else stay, a linked file (a dotfiles folder) is written where it really is, and the result is mode 600. A file that isn't valid JSON is left alone. An entry under Ri's name that isn't a Ri's is left alone too. Windsurf, Goose and LM Studio have steps but no Set up: Windsurf became Devin Desktop in June 2026 and which of its two files an install reads isn't documented, Goose keeps its extensions in YAML, and LM Studio's file has no documented place.

The key goes where the agent reads it: in its own user-level configuration, never in a project's files, and never through a shell, so it reaches no shell history. Steps a person follows keep it out of history too. Claude Code's put it in a shell-profile variable that its stored header names (`${RI_MCP_TOKEN}`), and the other steps are file edits. ChatGPT can't connect: it reaches an MCP server only from OpenAI's cloud with an OAuth sign-in or none, so it can't send a key. The Claude app's own connectors have the same limit (a key only in a limited beta, from Anthropic's cloud), which is why it uses the local bridge.

What's connected is read back from each agent's configuration, never stored on the side. Ri's entry is the one under its server name whose key is one of this Ri's working keys. A personal Ri is `ri` and a development one `ri-dev` (`personalMcpNames`), so trying a change never replaces the connection to the real one. A team is `ri-<team>`. If someone removes the entry by hand or revokes its key, the item shows that. Setting an agent up again replaces Ri's earlier entry and revokes the earlier key.

Sources, checked 2026-10-27 against each agent's docs and, where installed here, its CLI: [Claude Code](https://code.claude.com/docs/en/mcp), [Codex](https://learn.chatgpt.com/docs/extend/mcp), [Cursor](https://cursor.com/docs/context/mcp) and [its install links](https://cursor.com/docs/context/mcp/install-links), [VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration), [mcp-remote](https://github.com/geelen/mcp-remote), [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/), [Devin Desktop (Windsurf)](https://docs.devin.ai/desktop/cascade/mcp), [OpenCode](https://opencode.ai/docs/mcp-servers/), [Antigravity](https://antigravity.google/docs/mcp), [Goose](https://github.com/aaif-goose/goose/blob/main/documentation/docs/getting-started/using-extensions.md), [Kiro](https://kiro.dev/docs/mcp/configuration/), [LM Studio](https://lmstudio.ai/docs/app/mcp/deeplink), [ChatGPT](https://developers.openai.com/apps-sdk/build/auth).

## Agents and the CLI

Ri's main chat, or any agent on the computer running Ri, connects an agent when asked ("connect Codex to Ri") with the `connect_agent`, `disconnect_agent` and `list_agent_connections` actions (`src/lib/orchestrator/agent-connection-actions.ts`). They're refused for a caller on another device, since they change files on the computer running Ri, and on a team. A person at a terminal uses the same actions as `ri mcp connect <agent>`, `ri mcp disconnect <agent>` and `ri mcp list`. Agents are named by their id, with or without dashes (`claude-code`, `gemini-cli`), or a short name (`claude`, `gemini`, `code`, `agy`).

## Skills

Connecting an agent on this computer puts Ri's skills (`agent-work-tasks-notes_ri` and `agent-browser_ri`) in that agent's own skill folder in the same action (`inspectSkillFolders` and `installGlobalSkills` in `src/lib/agent-skills/shipped.ts`). Another live Ri's copy of the same skills counts as installed, and someone's own skill under the name stays. First-run setup still installs them for every harness, so agents here can use the `ri` command even before they connect. The end of the section shows them with one-click install and uninstall. An agent on another computer gets the essentials over MCP itself: the content server's instructions carry the skill's writing conventions (`contentInstructions` in `src/app/api/orchestrator/[transport]/route.ts`).

## Address

For access from another computer, set an HTTPS remote address in Settings → Devices. Use any supported tunnel or your own HTTPS setup. The computer running Ri must stay on and reachable. Ri does not configure a tunnel automatically here. With no remote address, the steps give the local address and say it works only on the computer running Ri. Set up always writes the local (loopback) address, since the agent runs beside Ri. If you change the remote address later, update existing configurations by hand, or disconnect and connect again.

A connection supplies tools to the agent you're already running. It does not create a chat inside Ri or require a new AI provider key. Search uses the existing semantic-search setup when available and falls back to keyword search. The key authenticates to Ri, not to Claude or OpenAI. A refused key gets a plain 401 with no OAuth challenge, so agents don't start a sign-in Ri doesn't offer.

For a team, join as a member first. Each key belongs to the signed-in member, and its writes are attributed to that member as AI actions. Making another key does not create another person. Set up belongs to a personal Ri, which runs on the member's own computer, so a team's list has the steps, links and setup prompt. A personal Ri's key acts as its owner and is not a multi-user signup mechanism.

OAuth sign-in for Ri's MCP is out of scope for now, and tracked in the Ri task "Make sure we have super easy device auth and not passing around API keys".

## Implementation and boundary

The endpoint is `/api/orchestrator/mcp`. Tools reuse the orchestrator registry and domain queries, including mirrors, embeddings and shared-task forwarding. `HOME_CONTENT_ACTIONS` in `src/lib/external-ai/policy.ts` is the explicit tool allowlist. New registry tools do not automatically become external tools, and the agent connection actions are not among them. The proxy permits only this endpoint for a personal external key, strips caller-supplied authority headers and marks its scope. MCP discovery and dispatch enforce the scope. Dispatch checks the live key again before each tool, including revocation and expiry. A supplied Ri session credential never makes an external assistant a Ri chat.

Personal external credentials use the existing `api_keys.role = ai_client`, with both `device_id` and `member_id` null, and `client` naming the agent (migration `0026_ai_client_kind`). Only a personal viewer can manage them, through `externalAi` tRPC: `create` (a key for one agent, returned once), `list`, `revoke`, `address`, and for this computer `local`, `setUp` and `disconnectLocal`. A team AI client still requires an active member (`team.aiClients`, with `address` for its steps). Device-bound AI keys remain invalid in a personal Ri. Host-key backfill assigns only sign-in keys, so startup cannot attach external clients to the host.

These keys cannot sign into a browser, open a WebSocket, use the natural-language `/api/mcp`, start agents or chats, use terminals, change settings or read attachment files. Search excludes the private capture stream. Body updates support `expected_body_revision` so clients can avoid replacing newer text. Existing viewer and signed-session MCP behavior is unchanged.

Coverage:

- `src/lib/external-ai/client-config.test.ts`: every agent's steps, the copy rules, install-link encodings, the setup prompt, and the Codex table read back by Codex.
- `src/lib/external-ai/local-setup.test.ts`: Set up and Disconnect on a disposable Ri with every configuration in a temporary home folder. Claude Code, Codex and Antigravity run their real CLIs where installed. It also covers files edited in place, refusals that leave no key behind, and stale entries.
- `src/lib/external-ai/home-mcp.test.ts`: drives the real MCP client SDK through the proxy and handlers on disposable Homes. It covers CRUD, search, stale note edits, mirrors, scope discovery and calls, forged headers, revocation, expiry, host backfill, normal viewer behavior, address validation and team isolation.
- `src/lib/orchestrator/agent-connection-actions.test.ts`: the actions and their refusals.
- `src/components/team/team-settings.browser.test.ts`: the personal and team lists on desktop and phone layouts.
