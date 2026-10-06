# Agent interaction across the seven UI candidates

October 5, 2026. This expands the migration-free reference-host experiment. It does not complete production milestones 0B through 6, ordinary chat-history integration or packaged sandbox hosting.

Open Settings > Plugins at your Home's normal remote URL. The table retains all seven options. A public Open demo launches that app and scrolls to its actual view. Open Demo chat, attach the result and enable the relevant permission before requesting an operation. Chat 2 needs its own attachment and permission. Typing, removal and no automatic Send behavior remain unchanged.

| Option | Agent operation | Access and qualification |
| --- | --- | --- |
| Excalidraw | Add or revise elements on the exact captured checkpoint, then read the updated diagram | Public service. Real Claude and browser verification, including manual edits, stale results, permission removal and no replay. |
| Microsoft Flint | Change chart type, title, theme or synthetic data with `create_chart_view` | Public Microsoft service. Real Claude changes the chart and reads its updated context. |
| Building explorer | Look up either published sample address and change between a map and a table | Public data service. Real Claude uses lookup data to render the requested view. It cannot alter building records. |
| tldraw | Add bounded rectangles, ellipses or text and explicitly delete shapes on the same canvas | Public tldraw service. The agent adapter prepares bounded changes, but the hosted SDK license gate blocks continued UI rendering on this HTTPS sandbox. Ri preserves captured data and withholds edit permission. Continued interactive use is not qualified. |
| Asana | Revise the discovered task/project preview or search workflow attached to chat | Existing account setup and registered OAuth client. Shared adapter and approval tests pass. Live authenticated UI qualification needs a connected account. |
| Figma | Call the discovered interactive diagram workflow attached to chat | Existing OAuth setup and provider client admission. Shared adapter tests pass. An account or tool-only endpoint does not establish portable UI availability. |
| PostHog | Revise the discovered analytics query workflow attached to chat | Existing OAuth or personal API-key setup. Shared adapter and controlled query UI tests pass. Live authenticated UI qualification needs a connected account. |

Example requests: “Add a green Done step” for Excalidraw, “Change this to a line chart” for Flint, “Show Gustav Mahlerlaan 10 in a table” for buildings, and “Add a green Done box” for tldraw. For account workflows, run the initial schema-derived form explicitly and ask chat to revise those inputs. The model receives the current bounded data and earlier messages, without HTML or UI-private `_meta`.

## Call binding and capture

Public operations retain the fixed endpoint/resource allowlists, credential-free child process, two separate HTTPS origins, nested iframe sandbox and controlled network policy. The model sees only the selected adapter's tools. Each operation has a stable invocation UUID. Accepted outcomes are captured before model projection. The host obtains that capture, validates the current reference and permission, and applies it once. Reading a capture, rendering, a second viewer and reload do not repeat the original call.

Flint uses the actual server-advertised chart schema. Building changes perform a real bounded lookup before constructing the map/table input from its result. Drawing changes use the exact owned canvas or checkpoint. Unknown outcomes are not retried. Closed, pending, changed or expired view references cannot apply a late capture.

The tldraw server returns an accepted exec before the guest executes it. Ri distinguishes a prepared operation from a successful widget callback. Context updates carry actual structured shape state. Changing execution/status prose for an unchanged scene does not invalidate a pending edit. Actual scene changes and changed checkpoint data do. Initial view permissions wait for rendering, actual shape context and the completed save. The sandbox recognizes the SDK's `tl-license-expired` failure marker and reports a fixed error without extracting DOM content. Ri waits beyond the five-second license check before granting edits and preserves text when it fails. This can indicate an expired, invalid or wrong-domain key. [The SDK's license documentation](https://tldraw.dev/sdk-features/license-key) explains these gates. A valid provider build for the sandbox domain is required, and Ri does not change the key or bypass the gate. Public canvas scripts encode user/model strings as JSON literals inside a fixed sequence of editor calls.

Account chat is a restricted branch of the existing `/api/integrations/mcp` gateway. An expiring host-only ticket exposes exactly the originating model-visible UI tool, pinned to the selected connection and launching viewer. App-only callbacks retain the separate app audience through the existing frame-bound adapter. Model registration advertises only the selected connection's schema, excluding the ordinary toolkit's cross-account union. Every registration, call, approval retry and capture rechecks the current account. The iframe receives no Home bearer key or provider credential.

Existing runtime schema validation, tool overrides, redaction, approvals, ownership and revocation remain mandatory. An approval retry uses the same invocation and is allowed only for an operation paused before execution. Completed or unknown calls are never rerun. Approval and capture are bound to the originating result. A result that loses its UI authority leaves its text available.

## Limits and evidence

Demo conversations and captures are bounded process/tab memory. Restart and reload end them. The renderer still needs the temporary host on the Mac Mini and its two owned Beamd tunnels. The browser never uses its own localhost. Claude is the qualified demo harness. This does not claim general third-party document persistence, every host extension or compatibility with every listed provider tool.

No Asana, Figma or PostHog account was connected in this Home during implementation. Those rows include setup and the shared interaction path, with controlled tests rather than claims of authenticated provider success. Provider client admission, actual `_meta.ui.resourceUri`, HTML resource compatibility and required network policy are checked separately. Additional unqualified domains and host features are rejected locally.

The [evaluation README](../scripts/mcp-apps-eval/README.md) gives reproduction commands. `verify-view-chat.mjs` exercises the real public services and real Claude, checks visible UI changes and readback for Flint/buildings, verifies the current tldraw license fallback, preserves drafts and checks reload counts. `verify-account-flow.mjs` exercises selection, original widget approvals, app-only callbacks, account chat approval, captured rendering, wrong-frame rejection, cookies and teardown with controlled fixtures. `account-evaluation.test.ts` covers each credential provider's shared gateway binding and private metadata separately from rendering.

[Recorded verification](plugins-evaluation-third-party/agent-views-verification.json): 26 Ri unit tests, 16 protocol tests, 11 public agent checks, 7 account fixture checks, 11 renderer/isolation checks and 8 Excalidraw regression checks. Typecheck, targeted lint, isolated production/CLI builds and exact pinned-overlay reproduction passed. These counts include the explicit tldraw failure path and controlled account tests.
