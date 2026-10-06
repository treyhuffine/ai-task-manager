# MCP Apps evaluation, milestone 0A

This runs the official basic host, official Scenario Modeler and a pinned local Excalidraw MCP App. Its dependencies, builds and volatile checkpoints live outside Ri in `/private/tmp/ri-mcp-apps-0a` on this Mac. The repository contains the setup recipe, source patch, separate lockfiles and verification code.

Open [the demo](http://ri-mcp-apps.127.0.0.1.nip.io:48880) on the machine running it. Choose **Open diagram example** or **Open scenario example**. No tool JSON is required.

For the diagram, click **Edit**, add text or move a shape, then **Return to examples**. For the modeler, move Growth Rate, choose a comparison and use Reset. These buttons invoke actual MCP tools and load their actual HTML resources. Each Open is a deliberate new invocation, not a saved result reopening.

## Start and stop

Run from the ai-task-manager checkout:

```sh
node scripts/mcp-apps-eval/start.mjs
node scripts/mcp-apps-eval/stop.mjs
```

Start returns the URL and leaves a supervised process running. Stop checks the recorded process identity and stops only this demo. Closing a browser tab does not stop the servers.

If the temporary installation has been removed, recreate it first:

```sh
node scripts/mcp-apps-eval/setup.mjs
node scripts/mcp-apps-eval/start.mjs
```

Setup requires Git, Node 20.19 or later and pnpm 10.33.2. It fetches the exact commits in `sources.json`, applies the evaluation, embedding, conversation, third-party, account-demo, diagram-chat and view-chat patches in order, installs three frozen pnpm lockfiles and typechecks/builds all three examples. It does not install into Ri. The tested Node version was 26.5.0.

To use another isolated folder, set `RI_MCP_APPS_EVAL_DIR` to the same absolute path for setup, start, stop and verify. A folder inside the Ri checkout is rejected. The servers intentionally use fixed ports 48880 through 48883 and refuse to start over an existing listener.

Logs are at `/private/tmp/ri-mcp-apps-0a/demo.log`. If a connection fails, the page shows it. Reload reconnects the clients, then explicitly choose an example again. An unknown tool outcome is not automatically retried.

## Session behavior and isolation

- Inputs and results stay in tab memory, limited to four open results. Messages are limited to 20 and shared context to 32 KiB. The HTML resource limit is 20 MiB.
- Reload discards results and shows **Session ended**. Legacy `call=true` URLs cannot execute tools. End session and the 30-minute expiry tear down views.
- Excalidraw uses its existing bounded memory checkpoint store. Its edit cache is changed from localStorage to iframe memory. Server checkpoints disappear when the server stops. Closing a result discards its editable view.
- Host and sandbox use different domains, `nip.io` and `sslip.io`, which resolve to loopback. Both bind only to `127.0.0.1` and validate their Host names. Ri's localhost cookies are not shared with them.
- The reference outer proxy and inner sandboxed iframe remain in place, with frame-bound messaging and HTTP CSP. Server children receive a small environment allowlist, without Ri settings or provider credentials.

DNS for the loopback domains and `esm.sh` access are required. Excalidraw's upstream UI uses that CDN for its pinned React 19.0.0 and Excalidraw 0.18.0 modules and fonts. The demo is plain HTTP with synthetic inputs, and is an evaluation of these examples rather than a production security boundary.

## Verify and remove

```sh
node scripts/mcp-apps-eval/verify.mjs
```

Verification launches an installed Chromium browser with a fresh, credential-free context and the Chromium sandbox enabled. On this Mac it uses Brave. Elsewhere set `RI_MCP_APPS_BROWSER` to the browser executable. It resolves Playwright 1.57.0 from the isolated host, not Ri. Evidence is written to the temporary folder's `evidence` directory.

Stop the demo, then remove its temporary folder in Finder to reclaim the installation. The recipe can rebuild it later. Removing the temporary folder does not affect Ri's Home, credentials or dependencies.

See [the evaluation report](../../docs/plugins-evaluation-0a.md) for tested interactions, screenshots, exact revisions and limitations.

## Open inside a remote Ri Home

The follow-up experiment adds **Try interactive examples** at the top of Settings > Plugins. Its seven-row table opens public demos and reuses Ri account setup for Asana, Figma and PostHog. It opens the reference host inside a large dialog and returns to Plugins in the same tab. The underlying Ri conversation stays mounted. Account views are a bounded development experiment. Ordinary Ri chat results remain outside this experiment. See [account setup and qualification](../../docs/plugins-evaluation-accounts.md).

First build and run Ri with this change. Then, on the Home computer, run:

```sh
pnpm exec tsx scripts/mcp-apps-eval/remote.ts
```

The Home must already have its HTTPS remote URL configured and Beamd available. Start opens two owned Beamd tunnels, ports 48885 and 48886, in addition to the four isolated local servers. It prints the Ri Plugins URL. The browser uses these HTTPS origins, never its own localhost. Choose **Open demo** in a table row or **Try interactive examples** for all presets, including **Open canvas example**, then **Return to Plugins**.

The app's authenticated tRPC launcher mints a 30-minute capability for the fixed public servers and synthetic fixtures. The public examples have no anonymous catalog or launch endpoint. Their child process has no Ri or provider credentials. The host and sandbox use distinct origins, retain the reference nested iframe, and validate the embedding origin. The bridge carries readiness, bounded numeric scenario or public-view context, staged app messages and captured-result references with exact source/origin checks. It has no Ri account, integration or ordinary composer authority.

Open **Scenario Modeler**, then **Chat about scenario**. The first demo chat attaches that scenario. Ask “What monthly growth rate do you see? Calculate month 12 MRR using the server.” It uses the configured Claude subscription harness with only the fixed sample MCP tool attached. If a different harness is configured or Claude is not signed in, the demo reports that limitation without switching providers.

Chat is read only initially. Check **Allow updates to the sample scenario**, then ask “Set growth to 7%” to let the agent calculate and apply a captured result. Change a slider and ask another question to see UI context flow back to the agent. Switch to **Chat 2** and choose **Attach scenario** to reference the same view in a separate temporary conversation. Each chat keeps its own draft. Removing the reference prevents Send. These are two demo conversations, not regular Ri chat records. Reload discards messages, references and results without replaying work.

For a third-party result, choose **Chat about result**. Remove the current reference to pick another open result, or attach it explicitly in **Chat 2**. Ask about the building address/year, chart rows or diagram context. The agent reads that bounded attachment. Each chat starts read only. Enable updates for a chart or canvas, view changes for buildings, or calls on the visibly selected account. Building records themselves remain read only. Account calls still pass existing approvals and current access checks.

For **Microsoft Flint**, enable chart updates and ask “Change this to a line chart.” For **Building explorer**, enable view changes and ask “Show Gustav Mahlerlaan 10 in a table.” For **tldraw**, the current hosted SDK license gate removes the UI after five seconds on this HTTPS sandbox. Ri now reports this and retains captured data for read-only chat. Continued interactive use needs a valid provider build for this host. If that qualification passes, enable canvas updates and ask “Add a green Done box.” These use the hosted third-party servers. Canvas changes use bounded structured shapes compiled into a fixed script, with the exact owned canvas ID. The model cannot submit arbitrary JavaScript. The host delivers a captured operation once, and the app reports whether it executed. Read-only follow-up replies see the updated context.

For **Asana**, **Figma** and **PostHog**, connect and select an account, run an advertised interactive workflow, then open its demo chat. Enable **Allow calls on this account** for an agent revision using that workflow tool. Only the model-visible tool that produced the attached result is exposed through Ri's existing integration gateway. It cannot switch accounts or invoke app-only tools. Review **Approve once** when current account policy requires it. Tool-only or unqualified views retain a usable text fallback. Live authenticated qualification requires account access and provider admission. See [all-app chat qualification](../../docs/plugins-evaluation-agent-views.md).

For **Excalidraw**, check **Allow updates to this diagram** in the demo chat, then ask “Add a green Done step after Execute.” The configured Claude harness can use only Excalidraw's public `read_me` and `create_view` tools. Each update restores the exact attached checkpoint, including saved manual edits, and creates a new checkpoint. The host loads that captured checkpoint into the same result area without repeating the accepted call. Manual edits, revoked permission or a removed reference defeat a late result. A second chat needs its own explicit attachment and update permission. Reload still ends the demo rather than replaying it. See [the diagram chat evaluation](../../docs/plugins-evaluation-excalidraw-chat.md).

Session capabilities and launch keys live only in private temporary files and memory. Do not share a view's capability URL. Reloading the example ends its result session. Reloading Ri closes the dialog. Neither action repeats the original tool call. Choose Open explicitly to start again. The remote presets use hosted Excalidraw, Microsoft Flint and the public building-data service. Excalidraw sends editing checkpoints to its upstream server and requires its upstream CDN. Export is excluded. The standalone local demo retains its pinned Excalidraw fallback. There is no automatic remote-to-local substitution.

To verify the real Ri entry through its public HTTPS URL:

```sh
node --import tsx scripts/mcp-apps-eval/verify-remote.mjs
node --test scripts/mcp-apps-eval/remote-server.test.mjs scripts/mcp-apps-eval/public-servers.test.mjs
```

Add `--chat` to the browser verification with the isolated test Home to exercise one real read-only Claude MCP call and controlled captured-result updates against the real app. Both `--chat` and `--read-chat` also verify a real read-only Claude reply about third-party building data, explicit tagging into either demo chat and controlled `ui/message` staging without automatic Send. Read-only third-party attachments have no model tools. The controlled scenario cases cover stale slider edits, update permission revocation, detached context, wrong-frame messages, preserved typing and reload. They deliberately distinguish renderer verification from a live changing model call:

```sh
RI_ROOT=/private/tmp/ri-plugin-ui-check RI_MCP_APPS_TEST_HOME_ORIGIN=http://127.0.0.1:48887 node --import tsx scripts/mcp-apps-eval/verify-remote.mjs --chat
```

To qualify agent edits against the real public Excalidraw server with a separately built synthetic Ri Home configured for Claude:

```sh
RI_ROOT=/private/tmp/ri-plugin-diagram-home RI_MCP_APPS_TEST_HOME_ORIGIN=http://127.0.0.1:48887 node --import tsx scripts/mcp-apps-eval/verify-diagram-chat.mjs
node --test scripts/mcp-apps-eval/diagram-chat.test.mjs scripts/mcp-apps-eval/remote-server.test.mjs scripts/mcp-apps-eval/public-servers.test.mjs
```

The browser check makes one real agent update, preserves a manual label and typed draft, reads the revised diagram in another real Claude turn, and exercises controlled late replies using real captured checkpoints. `--live` explicitly checks the synthetic sample through the normal running Ri Home instead. That mode does not run controlled reply fixtures or capture a screenshot of the real Home.

The browser test authenticates only the top-level Ri page with the Home's existing viewer token, using Ri's normal bootstrap. It never gives that token to an example frame or child process. Only sample data is submitted to the fixtures. `--sandbox` instead uses a synthetic parent and imports no Ri credential. `RI_MCP_APPS_TEST_HOME_ORIGIN=http://127.0.0.1:48887` with a matching isolated `RI_ROOT` tests a separately built synthetic Ri Home while the examples still traverse Beamd. Screenshots are captured only in that isolated mode.

Stop only the remote wrapper and its two owned tunnels:

```sh
pnpm exec tsx scripts/mcp-apps-eval/remote.ts stop
```

The local standalone servers remain available until `stop.mjs` is run. The experiment's button is hidden when its private descriptor is absent or its process is gone. Ri remains running. This experiment does not qualify production sandbox packaging, harness invocation capture, account permissions or saved-result reopening. See [the remote follow-up report](../../docs/plugins-evaluation-remote.md) and [third-party qualification and credential candidates](../../docs/plugins-evaluation-third-party.md).

Multi-app agent verification uses the production-built synthetic Home and actual public servers:

```sh
RI_ROOT=/private/tmp/ri-plugin-diagram-home RI_MCP_APPS_TEST_HOME_ORIGIN=http://127.0.0.1:48887 node --import tsx scripts/mcp-apps-eval/verify-view-chat.mjs
node --test scripts/mcp-apps-eval/view-chat.test.mjs
```
