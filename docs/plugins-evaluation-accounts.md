# Seven third-party UI candidates in Ri

October 5, 2026. Open Settings > Plugins at your Home's normal HTTPS URL. The experimental table has four public demos and three account candidates. This extends the migration-free evaluation with a temporary account view through Ri's existing integration runtime. It is not completion of production milestones 0B through 6.

| Plugin | What opens | Current qualification |
| --- | --- | --- |
| Excalidraw | Hosted diagram with interactive editing, expansion and opt-in agent updates | Live tested over Beamd. Editing sends checkpoints upstream. [Diagram chat follow-up](plugins-evaluation-excalidraw-chat.md). |
| Microsoft Flint | Hosted chart with synthetic revenue, chart options and themes | Live tested over Beamd. |
| Building explorer | Public Dutch building lookup, map and sortable table | Live tested over Beamd. Public records are read only. |
| tldraw | Hosted canvas with a fixed sample script and editable label | The server returns real canvas data, but its SDK license gate removes the canvas on this HTTPS sandbox after five seconds. Ri shows a local explanation and captured data. Continued interactive use is not qualified. |
| Asana | Discovered task/project preview or search workflow | Account required. Registered OAuth client and exact redirect URL required. Authenticated Ri UI qualification pending. |
| Figma | Interactive tools actually advertised to the selected Ri connection | OAuth plus client admission required. A Figma account or tool-only connection does not establish portable UI support. Authenticated Ri qualification pending. |
| PostHog | Discovered query/analytics UI with schema-derived inputs | OAuth or personal API key. Authenticated Ri UI qualification pending. Existing OAuth accounts remain valid. |

The official Scenario Modeler also remains available in the preset host with opt-in calculation changes. Excalidraw now supports opt-in updates to the attached sample diagram using only its public reference and rendering tools. Flint and the building explorer now also have opt-in agent operations. The tldraw adapter is implemented, but its current license failure withholds edit permission. Account result chats can call the originating model-visible interactive tool on the selected account after an explicit grant, through the existing gateway and account policies. [All-app chat details](plugins-evaluation-agent-views.md). They see only context explicitly attached by the human. App-requested messages are staged for normal Send, and typing is preserved. This evaluation does not attach results to ordinary Ri conversations or provide generic document persistence.

## Connect an account

Use **Connect account** or **Manage accounts** in the table. These open Ri's existing account manager. The experiment creates no second credential store or permission system. With multiple accounts, explicitly select one in the table before opening a view. A single account is visibly labeled. **Try interactive view** becomes available only when the selected connection is active and advertises a model-visible tool with an MCP Apps resource.

For Asana, add the registered OAuth app in its existing account settings using the callback URL Ri displays, then authorize the account. [Asana's custom-client setup](https://developers.asana.com/docs/integrating-with-asanas-mcp-server) requires a client ID, client secret and exact redirect URL. [Interactive preview tools](https://developers.asana.com/docs/mcp-tools-reference) are documented for supported hosts, but their actual availability to Ri must be checked after authorization.

Figma is pinned to `https://mcp.figma.com/mcp`. [Its remote-client documentation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) requires an approved client or admission through its waitlist. Authorization, tool access and interactive resource support are separate checks. If admission fails or no portable view is discovered, Ri shows that state and preserves the account's ordinary tool usefulness.

PostHog retains its OAuth connection flow and adds **Use API key** when creating an account. Paste a personal API key in that existing Ri form. It is encrypted in the existing file-backed credential store, never sent to the iframe. Add a separate account to change connection methods rather than overwriting an OAuth account. [PostHog's MCP server](https://github.com/PostHog/posthog/blob/master/services/mcp/README.md) documents bearer authentication, and its [contribution guide](https://github.com/PostHog/posthog/blob/master/services/mcp/CONTRIBUTING.md) describes real query-result MCP Apps. The discovered workflow form uses the server's actual JSON schema and supplies a recent pageview query where applicable. Review and run it explicitly.

## Account execution and isolation

The reference host uses a credential-free, frame-bound MCP transport through the authenticated Ri parent and typed tRPC operations. Only a selected provider/account session can reach the existing integration runtime. Each tool call rechecks ownership, exact connection, current configuration, tool visibility, schema and existing approvals. The iframe never receives Ri cookies, credentials, agent access grants or desktop IPC. The public evaluation proxy still accepts no account credentials.

A required approval is displayed in Ri with the actual tool, account and arguments. **Approve once** uses the existing approval mechanism and explicitly retries the same gated invocation. It does not repeat an accepted upstream call. App-only tools remain hidden from model tool projections. Model-only tools cannot be called by a widget. UI-only result `_meta` is captured separately before the model projection and omitted from prompts, normal audit, transcript and capability snapshots. Capability reviews include only UI resource and visibility contracts from definition metadata.

Account resources must be advertised by that exact connection, use the MCP Apps HTML MIME type, and fit the 20 MiB resource bound. Additional resource network policy is limited to the explicitly allowed Google Fonts origins. Other remote connections, frames, permissions or malformed resources fail locally with the original text result still available. Authenticated providers may need additional qualification rather than a widened generic allowlist.

The packaged Ri renderer remains future work. This experiment keeps the separate HTTPS sandbox origin, outer proxy and inner sandboxed iframe from the isolated reference host. It requires the Mac Mini's temporary evaluation host and two owned Beamd tunnels. It does not establish desktop or arbitrary remote Home packaging.

## Lifetime and replay

Each authenticated view handle belongs to the launching viewer and account for at most 30 minutes. Closing the dialog revokes the handle. Restarting Ri loses all account handles. Disconnect, changed credentials, changed tool policy, expired connections or a different viewer invalidate access. The host gives each frame load a fresh channel ID, so delayed responses and approval prompts cannot bind to a reloaded frame. Accepted work continues independently of iframe lifetime, but authority is rechecked before returning its result.

Tool invocations use stable UUIDs, not name/argument matching. Concurrent or repeated deliveries return the original capture. Conflicting input for an existing invocation is rejected. Unknown outcomes and completed calls with uncapturable results are never retried. One session permits 80 calls, captures at most 512 KiB per result and 8 MiB total, and stores everything in process memory. No credentials or executable HTML are persisted by this adapter. No database migration is added.

Public table-row launches claim a one-time preset in their capability session. A reload or a second load of that same URL does not automatically repeat the initial call. Buttons are explicit new invocations. tldraw canvas and checkpoint callbacks are restricted to the session that created the canvas. Both public drawing services can retain edits upstream independently of Ri's session memory.

## Reproduce verification

Build and start using the [evaluation README](../scripts/mcp-apps-eval/README.md). The source overlays preserve the existing pinned dependency set. Full public/chat verification uses the separately built synthetic Ri Home:

```sh
RI_ROOT=/private/tmp/ri-plugin-ui-check RI_MCP_APPS_TEST_HOME_ORIGIN=http://127.0.0.1:48887 node --import tsx scripts/mcp-apps-eval/verify-remote.mjs --chat
RI_ROOT=/private/tmp/ri-plugin-ui-check RI_MCP_APPS_TEST_HOME_ORIGIN=http://127.0.0.1:48887 node --import tsx scripts/mcp-apps-eval/verify-account-flow.mjs
node --test scripts/mcp-apps-eval/public-servers.test.mjs scripts/mcp-apps-eval/remote-server.test.mjs
```

The account browser test uses controlled protocol fixtures in the actual built Ri UI. It verifies multiple-account selection, approval-before-execution, stable invocation retry, an app-only widget callback, wrong-frame rejection, cookie isolation, reload and teardown. It is explicitly not a live authenticated test of Asana, Figma or PostHog. Unit tests cover result capture before projection, hidden app-only tools, current account authority, private metadata, concurrent delivery, approval retry, unknown outcomes and revocation during accepted work.

The final build passed `pnpm build --webpack`, `pnpm ts` and targeted ESLint. Next's supported Webpack option was used after Turbopack exhausted temporary disk space. Existing dependency-expression warnings remain. Two shared REST wrapper signatures were corrected to preserve direct one-argument calls while exposing the required context signature to Next's production route validator. Their 26 regression tests pass.

The relevant application suites passed 217 tests, the MCP engine suites passed 68, and the isolated wrapper passed eight. [Public browser evidence](plugins-evaluation-third-party/seven-option-verification.json) records 20 checks against the production-built synthetic Home with live HTTPS third-party apps and real read-only Claude replies. [Controlled account browser evidence](plugins-evaluation-third-party/account-fixture-verification.json) records six checks with two upstream fixture executions. [The seven-option entry](plugins-evaluation-third-party/ri-seven-options.png) and [the account fixture after reload](plugins-evaluation-third-party/ri-account-fixture.png) show the built UI using synthetic Ri data.
