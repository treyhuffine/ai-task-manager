# MCP Apps hands-on evaluation

Milestone 0A completed October 2, 2026, America/Denver. Browser evidence was captured October 3 UTC. Task: `01a0f91f-f818-78ab-9d75-77901a407b06`.

The working demo is [here](http://ri-mcp-apps.127.0.0.1.nip.io:48880) on the Mac running it. It provides preset buttons for the real Excalidraw MCP App and official Scenario Modeler. [Start, stop, setup and verification instructions](../scripts/mcp-apps-eval/README.md).

## Scope delivered

- [x] Pinned official basic host in a separate temporary installation, with its own dependencies and frozen lockfiles.
- [x] Real Excalidraw tools/resources and official Scenario Modeler tools/resources, using synthetic preset inputs.
- [x] Actual browser interactions, including editing and app-to-server callbacks.
- [x] Volatile results, explicit session-ended behavior and no automatic replay after reload or expiry.
- [x] Reference sandbox retained and separated from Ri's authenticated cookie origins.
- [x] Browser URL, simple lifecycle commands, screenshots and a reproducible clean setup.

The changes in the Ri checkout are this report, static evidence and the isolated setup recipe. No Ri schema, root manifest/lockfile, gateway, harness integration, credential storage, production navigation or live Home was changed. Milestone 0B and the production manager remain separate work. The full parent task is not complete.

## What actually worked

The [browser suite](../scripts/mcp-apps-eval/verify.mjs) passed 11 checks in a fresh Brave Chromium context, version `151.0.7922.173`, with browser sandboxing enabled. [Machine-readable evidence](plugins-evaluation-0a/verification.json).

| Interaction | Observed result |
| --- | --- |
| Initial discovery | Both local MCP clients connect and list real tools/resources. No tool executes merely by opening the page. |
| Scenario preset | `get-scenario-data` runs once. Its HTML displays sliders, projections and metrics. |
| Scenario adjustment | Growth increases from 5% to 5.5%. Ending MRR changes from $63.4K to $67.2K. Template comparison and Reset work. These controls cause no additional server tool calls. |
| Excalidraw preset | `create_view` runs once, producing a checkpoint and the real animated diagram resource. |
| Excalidraw edit | Edit opens the actual canvas editor. Typing “Ri demo note” causes the app-only `save_checkpoint` call and an attributed model-context update. |
| Return from editing | The same invocation renders the added text inline. `create_view` remains at one call. There is a visible Return to examples control. |
| Reload | Views disappear, Session ended is visible, and both original invocation counts remain one. |
| Legacy URL | A URL containing `call=true` does not invoke a tool or reconstruct a view. |
| Tool failure | Sending malformed synthetic element JSON to the actual server produces a visible Tool failed message. |
| UI failure | An injected resource response with the wrong MIME type fails within its view, with the original tool result still available. |
| Narrow view and expiry | A 390px viewport supports changing the modeler slider and seeing its metrics. Advancing the browser clock past 30 minutes closes the view without replay. |

The final suite's total calls were three `create_view`, three `get-scenario-data` and one `save_checkpoint`. The extra originals were deliberate failure, narrow-view and expiry test invocations. They were not reload retries. No uncaught browser errors occurred.

Cookie probes matching Ri's host-only cookies on `localhost` and `127.0.0.1`, plus a broader localhost cookie, do not reach either final demo hostname. A view's attempt to read the top document throws SecurityError. Both iframe sandbox attributes and the HTTP CSP were checked, and no Electron bridge exists in the view.

All three standalone typechecks and Vite builds passed. A clean setup in a second temporary folder succeeded with frozen lockfiles, and all three generated app HTML files matched the running installation byte for byte. Recipe syntax checks and targeted ESLint passed. Start/stop and repeated Start were exercised. An accidental Ri production-build attempt failed before acquiring its build lock due to an ENOSPC event. That attempt is not counted as validation of Ri, which this milestone does not change.

## Pins and compatibility

| Component | Tested pin |
| --- | --- |
| [Official basic host and Scenario Modeler source](https://github.com/modelcontextprotocol/ext-apps/tree/82221c0c8ce7661efa6771c9d461511b1650495f/examples) | Commit `82221c0c8ce7661efa6771c9d461511b1650495f`, version 2.0.3 |
| Host and modeler Apps SDK | `@modelcontextprotocol/ext-apps` 2.0.3 |
| MCP v2 client/server packages | 2.0.0, with React/React DOM 19.2.3 and Zod 4.3.5 |
| [Excalidraw source](https://github.com/excalidraw/excalidraw-mcp/tree/157aa23ceb1976008aadc89eb05e3444060f09d6) | Commit `157aa23ceb1976008aadc89eb05e3444060f09d6`, package version 0.3.2 |
| Excalidraw server graph | Apps SDK 0.4.2, MCP SDK 1.25.2, locked separately from the host |
| Excalidraw browser imports | React 19.0.0, Excalidraw 0.18.0 and morphdom 2.7.8 through upstream pinned CDN URLs |
| Tooling | pnpm 10.33.2, Node 26.5.0, Playwright Core 1.57.0 |

This is a tested interoperability subset between the specified host and Excalidraw versions. Ri's MCP stack was not upgraded. The Excalidraw dependency graph reports older Radix peer ranges that exclude React 19. The actual tested editor interactions work, but the warnings are not evidence of blanket React or provider compatibility. The complete dependency graphs are captured in the recipe's three lockfiles.

### Remote Excalidraw limitation

The [documented public endpoint](https://github.com/excalidraw/excalidraw-mcp#remote-recommended), `https://mcp.excalidraw.com`, redirects to `/mcp`. A credential-free POST initialization succeeded, negotiating MCP `2025-11-25` and returning Excalidraw server version 1.0.0 with tools/resources capabilities.

Direct browser admission failed. The live `/mcp` endpoint returned **HTTP 405 to OPTIONS**, even though its response advertised CORS. It also omitted `mcp-protocol-version` from the advertised allowed headers. This was confirmed from the final demo Origin. The browser rejected the preflight, and the reference host's SSE fallback also returned 405.

The delivered demo therefore uses the pinned local implementation at port 48883. No claim is made that Ri connected to the public service, or that the current remote endpoint was successfully rendered. A production Home's server-side MCP transport is a different experiment.

### Remaining limitations

- One local Chromium browser surface was qualified. No desktop IPC, remote HTTPS Home, Claude/Codex invocation capture or durable conversation reopening was implemented or tested.
- The reference sandbox is an example, not Ri's production sandbox packaging. The delivered host is HTTP and requires the public loopback DNS names to resolve. Excalidraw also requires `esm.sh` connectivity.
- The `.localhost` subdomain approach was rejected after a cookie probe failed in this browser. The final host uses `nip.io`, and its separate sandbox uses `sslip.io`. Both servers bind to loopback and require their exact Host names.
- Some upstream Excalidraw-generated text boxes clip slightly in fullscreen. The actual editing, checkpoint callback, inline return and added note work. Export/share and clipboard access were not qualified.
- Scenario Modeler's narrow header crowds its comparison/reset controls. Its slider, chart and metrics were exercised at 390px. Desktop is the better surface for the complete comparison workflow.
- App-requested messages and context are visible only in the reference host's bounded memory panels. There is no Ri composer, harness, private payload archive or automatic model turn in this demo.
- The preset Open buttons deliberately call tools with known synthetic arguments. They are not production standalone launch contracts, and do not establish that every MCP UI resource can become a global app.

## Product finding

Scenario Modeler demonstrates a concrete benefit: changing a parameter and comparing alternatives updates charts and metrics immediately, without asking an agent to recalculate each variation. This fits an inline result when the controls remain compact.

Excalidraw demonstrates a complementary workflow: an initial tool result becomes a real editable canvas, and a user edit produces a checkpoint and concise shared context without rerunning the original call. Inline is useful for inspection. Expanded presentation is substantially better for editing, with an explicit return path to the same result.

The two example cards make choosing and trying a capability easy without writing JSON. That supports the hypothesis that Plugins could be a useful discovery entry point. It does not yet test Ri's rail navigation, intended-chat targeting or preservation of an actual typed conversation draft. The user's hands-on assessment is the next product decision.

## Screenshots

Actual browser captures, not mockups:

- [Both apps inline](plugins-evaluation-0a/both-apps-inline.png)
- [Scenario comparison](plugins-evaluation-0a/scenario-comparison.png)
- [Excalidraw editing](plugins-evaluation-0a/excalidraw-editing.png)
- [Edited diagram returned inline](plugins-evaluation-0a/excalidraw-edited-inline.png)
- [390px modeler](plugins-evaluation-0a/scenario-narrow.png)
- [Reload/session ended](plugins-evaluation-0a/session-ended.png)
- [Actual tool error](plugins-evaluation-0a/tool-failure.png)
- [Malformed UI resource fallback](plugins-evaluation-0a/resource-failure.png)
