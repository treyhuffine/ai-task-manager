# Hosted third-party MCP Apps evaluation

The October 5 follow-up adds tldraw and temporary account views. See [the current seven-option report](plugins-evaluation-accounts.md) for setup, qualification states and the account adapter. The report below records the earlier three-public-app evaluation.

October 4, 2026. This extends the isolated milestone 0A host opened from Ri's Settings > Plugins > **Try interactive examples**. It connects to actual external MCP servers through the Mac Mini. A remote viewer needs only their existing Ri URL. The browser does not use its own localhost.

## Qualified public examples

| Example | Actual endpoint and observed server | Workflow |
| --- | --- | --- |
| Excalidraw | `https://mcp.excalidraw.com/mcp`, Excalidraw 1.0.0 | Create the sample workflow diagram, expand, add a label, save a checkpoint through the public server, return to the same view. |
| Microsoft Flint | `https://flint.data-formulator.ai/mcp`, flint-chart-mcp 0.5.1 | Send four synthetic monthly revenue rows, render the actual chart app, change its visual theme. |
| Building explorer | `https://europe-west4-mcp-metadata-demo.cloudfunctions.net/mcpBest`, metadata-demo-best 2.0.0 | Read a real public building profile, render its returned coordinates in the server's map, inspect its actual table. |

The [Excalidraw project](https://github.com/excalidraw/excalidraw-mcp) documents the public server and interactive editor. Its root URL redirects to `/mcp`. The evaluation uses that canonical path without enabling arbitrary redirects. The previous browser-admission failure from the original 0A experiment does not apply to this server-side connection. The pinned local build remains available explicitly as a separate manual fallback, never as a silent replacement.

[Microsoft's Flint guide](https://github.com/microsoft/flint-chart/blob/main/docs/tutorials/setup-flint-mcp.md) documents its hosted endpoint and `create_chart_view` MCP App. This evaluation sends inline synthetic data. Local files and data URLs are rejected.

[DaveGold's building-data project](https://github.com/DaveGold/mcp-metadata-demo) combines Dutch BAG and EP-Online data with MCP map/table/chart views. The tested variant returned the Rijksmuseum at Museumstraat 1, 1071XX Amsterdam, built in 1885, with no registered energy label in the returned profile. Only two fixed public addresses are permitted, the museum and Gustav Mahlerlaan 10. A generic public-demo query intent is sent. The hosted service logs queries and is rate limited. It is a public data demonstration, not a private building-data integration or an assessment of the property's current compliance.

All three servers passed anonymous initialization, tool discovery and actual `resources/read` HTML retrieval. Endpoint access, metadata discovery, rendering and interaction were checked separately. Hosted versions and content are observed values, not pinned upstream deployments. If an upstream changes its resource URI, network policy or permissions, the example fails locally with its original text result available.

## Temporary chat

Open a result and use **Chat about result**. Remove its reference to choose another open result. Either **Chat 1** or **Chat 2** can attach the same result with separate drafts and histories. Try the building table and ask “What address and construction year are shown? Can you change that record?”

The Claude subscription harness receives bounded sample/public context explicitly attached to that demo chat. It has no model tools for third-party attachments. It cannot fetch another record, edit the diagram or change the building records. No third-party account credentials are involved. The original view remains unchanged after the reply. HTML and UI-only tool-result metadata stay outside the chat DTO and prompt.

An app's latest context update replaces its prior attributed update. Excalidraw shares editing context. This can be a partial change summary, not a complete current document. The host does not claim arbitrary document persistence. The table currently provides sorting and a CSV button. Download is blocked by the reference host sandbox, and the table does not itself emit a selection-to-chat button.

Portable `ui/message` requests are staged with the app/view attribution beside existing typing only in the selected demo chat already attached to that invocation. They never send automatically. A controlled protocol test exercises this through the real nested bridge. It is distinct from a third-party widget emitting that message itself. These references and drafts belong to the two temporary demo chats, not ordinary Ri conversations.

The existing official Scenario Modeler remains local. Its chat can make one read-only MCP calculation per turn or, with explicit **Allow updates to the sample scenario**, apply the captured numeric result. Its stale-result, permission-change and acknowledgement checks are preserved.

## Isolation and replay

The public wrapper accepts only fixed HTTPS servers, allowlisted tools and exact UI resource URIs. It does not accept credentials, arbitrary URLs, browser cookies, Authorization headers, local files or Ri configuration. Upstream session/protocol headers come from that exact server's response. Redirects and automatic upstream retries are disabled.

Public tool calls carry stable invocation UUIDs. Concurrent or repeated deliveries return the captured original response without another upstream execution. Reusing a UUID with different input is rejected. Unknown or uncaptured outcomes are never retried. Excalidraw read/save checkpoint operations require a checkpoint created in the same capability session. Export-to-Excalidraw is excluded. Editing does send checkpoints to the third-party service, whose retention is outside Ri's control.

A session permits 80 tool calls, four open views and 20 demo chat turns. Inputs are bounded, HTML/results are limited to 20 MiB, and replay captures are limited to 512 KiB per response and 8 MiB total per session. The separate HTTPS sandbox retains an outer proxy and inner sandboxed iframe. Only the qualified `esm.sh` and OpenStreetMap tile origins may be added to resource CSP. Additional frame/network origins or view permissions fail closed. Neither app can read Ri's DOM or access desktop IPC.

Reload visibly ends the result session and discards both temporary chats. Expiry and End session do the same. No call is replayed. **Open** is always an explicit new invocation. Excalidraw's upstream service may retain a checkpoint after Ri's session ends. Restarting the example wrapper invalidates all its capability sessions. Starting it again restores the launcher without restoring results or rerunning tools.

The existing pinned host and SDK dependency graphs are unchanged. Four source overlays reproduce the tested host from the pinned sources. No Ri dependency, schema, stored credential key or gateway changes are required. This remains an evaluation rather than production Plugins account authorization, durable result reopening, full navigation/library promotion or packaged sandbox deployment across platforms.

## Account-based candidates

Credentials expand the candidate set, but do not alone establish portable UI compatibility. These are documentation-qualified candidates, not authenticated live tests in Ri.

| Service | Account/client admission | UI qualification remaining |
| --- | --- | --- |
| Asana | Register an MCP app with a client ID, client secret, exact redirect URL and permitted workspaces, then user OAuth at `https://mcp.asana.com/v2/mcp`. Dynamic registration is unsupported. | Interactive task/project previews and search are documented for Claude and ChatGPT. Their availability to Ri, actual resources and required host features must be checked after authorization. Standard tools are available to custom clients. |
| Amplitude | Supports HTTP/OAuth MCP clients at `https://mcp.amplitude.com/mcp` or the EU regional endpoint with the user's project permissions. | Chart tooling is documented. Check actual UI resource metadata and rendering after OAuth before claiming embedded compatibility. |
| Canva | User OAuth plus approval of the new host's OAuth client. Current docs say portal self-service is coming and direct new-client admission still uses a waitlist. | Qualify Ri admission and portable view resources separately. An existing Canva account or ChatGPT connection is insufficient. |
| Figma | Remote MCP requires an approved client or new-client waitlist as well as user authorization. | Canvas tools do not prove a portable embedded app. Qualify UI metadata separately. |

Sources: [Asana OAuth integration](https://developers.asana.com/docs/integrating-with-asanas-mcp-server), [Asana interactive tools](https://developers.asana.com/docs/mcp-tools-reference), [Amplitude MCP](https://amplitude.com/docs/amplitude-ai/amplitude-mcp), [Canva access](https://www.canva.dev/docs/apps/mcp/access/), [Figma remote clients](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/).

An authenticated pilot must go through Ri's existing integration runtime, account binding, agent-scope checks, approvals and revocation. Adding tokens to this public evaluation proxy would bypass those requirements. Account selection is still pending. No account-based candidate is displayed as a connected example.

## Verification

The reproducible commands are in the [evaluation README](../scripts/mcp-apps-eval/README.md#open-inside-a-remote-ri-home). [Browser evidence](plugins-evaluation-third-party/remote-verification.json) records 24 passing checks against the production-built Ri UI with a synthetic Home. [The final read-only verification](plugins-evaluation-third-party/read-only-verification.json) passed 18 checks, and [the standalone local regression](plugins-evaluation-third-party/local-verification.json) passed all 11 checks after the fourth overlay. Application tests passed 39 cases and the isolated wrapper passed seven tests. Typecheck, targeted ESLint, the pinned host build and the isolated Ri production build passed. The Ri build retains 50 existing broad filesystem-tracing warnings. Browser screenshots are captured only with synthetic Ri data. The verifier separates actual Claude read calls from controlled captured-result updates and controlled app-requested messages. It tests the public servers through the real Beamd HTTPS origins, no automatic replay, no Ri headers on the example origins, iframe isolation, focus return and narrow-screen navigation.

Actual UI evidence: [Flint chart](plugins-evaluation-third-party/ri-flint-chart.png), [public building map](plugins-evaluation-third-party/ri-building-map.png), [table with temporary chat](plugins-evaluation-third-party/ri-third-party-chat.png), [Ri entry](plugins-evaluation-third-party/ri-plugins-entry.png).
