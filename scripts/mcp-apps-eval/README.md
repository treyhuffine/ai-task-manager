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

Setup requires Git, Node 20.19 or later and pnpm 10.33.2. It fetches the exact commits in `sources.json`, applies `evaluation.patch`, installs three frozen pnpm lockfiles and typechecks/builds all three examples. It does not install into Ri. The tested Node version was 26.5.0.

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

The follow-up experiment adds **Try interactive examples** at the top of Settings > Plugins. It opens the reference host inside a large dialog and returns to Plugins in the same tab. The underlying Ri conversation stays mounted. This is an experimental entry to the synthetic demo, not a production integration with chat results or accounts.

First build and run Ri with this change. Then, on the Home computer, run:

```sh
pnpm exec tsx scripts/mcp-apps-eval/remote.ts
```

The Home must already have its HTTPS remote URL configured and Beamd available. Start opens two owned Beamd tunnels, ports 48885 and 48886, in addition to the four isolated local servers. It prints the Ri Plugins URL. The browser uses these HTTPS origins, never its own localhost. Use **Open diagram example** or **Open scenario example**, then **Return to Plugins**.

The app's authenticated tRPC launcher mints a 30-minute capability for the synthetic fixtures. The public examples have no anonymous catalog or launch endpoint. Their child process has no Ri or provider credentials. The host and sandbox use distinct origins, retain the reference nested iframe, and validate the embedding origin. The readiness message is their only bridge to Ri. There is no Ri tool, composer or context authority in that bridge.

Session capabilities and launch keys live only in private temporary files and memory. Do not share a view's capability URL. Reloading the example ends its result session. Reloading Ri closes the dialog. Neither action repeats the original tool call. Choose Open explicitly to start again. Excalidraw still uses the pinned local fallback and requires its upstream CDN.

To verify the real Ri entry through its public HTTPS URL:

```sh
node --import tsx scripts/mcp-apps-eval/verify-remote.mjs
node --test scripts/mcp-apps-eval/remote-server.test.mjs
```

The browser test authenticates only the top-level Ri page with the Home's existing viewer token, using Ri's normal bootstrap. It never gives that token to an example frame or child process. Only sample data is submitted to the fixtures. `--sandbox` instead uses a synthetic parent and imports no Ri credential. `RI_MCP_APPS_TEST_HOME_ORIGIN=http://127.0.0.1:48887` with a matching isolated `RI_ROOT` tests a separately built synthetic Ri Home while the examples still traverse Beamd. Screenshots are captured only in that isolated mode.

Stop only the remote wrapper and its two owned tunnels:

```sh
pnpm exec tsx scripts/mcp-apps-eval/remote.ts stop
```

The local standalone servers remain available until `stop.mjs` is run. The experiment's button is hidden when its private descriptor is absent or its process is gone. Ri remains running. This experiment does not qualify production sandbox packaging, harness invocation capture, account permissions or saved-result reopening. See [the remote follow-up report](../../docs/plugins-evaluation-remote.md).
