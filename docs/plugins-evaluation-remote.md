# MCP Apps inside a remote Ri view

Follow-up experiment, October 4, 2026. This addresses opening the milestone 0A examples from Ri on the Mac Mini while the viewer uses the Home's remote Beamd URL.

## Delivered interaction

Settings > Plugins has an experimental **Try interactive examples** button when the separate example host is running. It opens the real reference host in a large dialog in the same tab. **Return to Plugins** closes it and restores focus to the launcher. The Ri conversation remains mounted underneath.

The current presets launch hosted Excalidraw, Microsoft Flint, a public building map/table and the local official Scenario Modeler. [Third-party qualification and credential candidates](plugins-evaluation-third-party.md) records the actual endpoints, interactions and limits. Sliders, comparison, reset, canvas editing and checkpoint callbacks work through Beamd. The browser connects to separate HTTPS host and sandbox origins. It does not connect to its own localhost.

Scenario Modeler also has a small **Chat about scenario** bubble. Its two temporary chats keep separate drafts and message histories. Chat 1 initially attaches the open scenario. Chat 2 requires **Attach scenario**. Removing that reference disables Send until another view is attached. Slider changes update the attached context. These references are confined to the two demo chats, not ordinary Ri conversations.

Ask “What monthly growth rate do you see? Calculate month 12 MRR using the server.” The agent runs through Ri's existing subscription harness helper and calls the actual `get-scenario-data` MCP tool. This pilot requires the configured Claude harness and its subscription sign-in. It does not silently switch harnesses. Native tools, ambient MCP servers, hooks, project/user settings and transcript persistence are disabled for this bounded call.

Chat starts read only. **Allow updates to the sample scenario** permits a request such as “Set growth to 7%.” The host registers a stable turn reference, captures the original MCP result before the model-facing projection, and delivers it to the same view through AppBridge. Rendering the captured result does not call the original tool again. The chat reports application only after the view acknowledges matching inputs. New slider edits, removal of context or revocation of update permission during the reply prevent application. There is no durable chat history or saved-result archive. Reload ends both demo chats.

Reloading an example discards its results and visibly ends the session. Reloading Ri closes the dialog. Neither replays the original call. Open is an explicit new sample invocation. Closing a view does not cancel accepted server work.

## Boundary

The new Ri code is one card/dialog, a temporary chat and authenticated tRPC status/launch/chat operations. The launch operation talks to a fixed loopback mint endpoint using a private temporary key. It returns a random 30-minute capability URL. The key is not returned to the browser. The public wrapper permits only the fixed public servers, two local synthetic fixtures and a small MCP method/tool allowlist. It strips cookies and Authorization headers instead of forwarding them.

The example host and sandbox are separate HTTPS origins from Ri and each other. The reference outer proxy and inner sandboxed iframe remain intact. CSP limits embedding to the configured Ri origin. The reference sandbox checks the exact host origin. Ri checks the exact host iframe source and origin for readiness, bounded numeric sample or public-view context, staged app messages and acknowledgement messages. Ri sends only an invocation/revision/turn reference back to that exact host. The host retrieves its own captured result. There is no Ri account, integration or ordinary composer authority in this bridge. The child environment excludes Ri/provider credentials and Home settings.

Capabilities are held in memory, capped at 32 sessions and 80 fixture calls per session. Inputs are capped at 1 MiB and results at 20 MiB. Wrapper logs and private descriptors live outside the checkout. The installation retains the pins and frozen dependency graphs from [0A](plugins-evaluation-0a.md). Ri's dependency manifest, lockfile, database schema, credential store and existing integration gateway are unchanged.

Each session permits at most 20 chat turns and one active model reply. A turn permits at most one upstream calculation. Read-only input equality and all five numeric ranges are checked at the proxy, independently of the model. Captured chat results are capped at 256 KiB. Ri retains at most 256 request promises for deduplication, with the same session lifetime. Changed retries, unknown outcomes and expired sessions are refused rather than replayed. Only the reply and numeric tool summary return through the chat DTO. HTML and original result metadata stay in the isolated host.

## Original scenario-chat verification

The evidence below records the preceding two-example revision. See the third-party report for the current expanded catalog and verification.

[Browser evidence](plugins-evaluation-remote/remote-verification.json) records eighteen passing checks against the actual production-built Ri UI with a separate synthetic Home. Only Ri requests were routed to that isolated Home. Both example origins and their MCP callbacks traversed live Beamd HTTPS tunnels.

- Initial discovery invoked no tool.
- Scenario growth, comparison and reset worked with one original call.
- Excalidraw editing saved a checkpoint and returned to the same invocation.
- Nested iframe DOM isolation and absence of desktop IPC were checked.
- Example reload and Ri reload did not replay tools.
- No Ri cookie or Authorization header reached either example origin.
- Return to Plugins restored focus and removed the view.
- A 390px Ri viewport retained the visible return path.
- A real Claude call read the current 6.5% growth rate and the MCP server's month-12 MRR of $75,553.43, preserving a newer typed draft.
- The same view was explicitly attached to Chat 2 without transferring Chat 1's draft.
- Controlled replies backed by actual captured MCP results updated the app and received an acknowledgement.
- Late replies after slider edits, permission revocation or context removal did not overwrite the view.
- Wrong-frame context messages were ignored. Reload discarded both demo conversations without a replay.

The HTTPS fixtures also passed seven checks in a synthetic parent without importing a Ri credential. The original local reference suite passed all eleven checks after the exact-origin overlay. Thirty-eight tests passed across the launcher, demo chat, existing one-shot helper and tRPC router. Three wrapper tests exercised origin validation, anonymous denial, private mint admission, unsupported operations, session capacity/expiry, read-only enforcement, cross-session denial, original-result capture, duplicate delivery and unknown outcomes without replay. `pnpm ts`, targeted ESLint and the isolated production build passed. The build emitted 50 existing broad filesystem-tracing warnings.

Actual screenshots from the synthetic Ri Home:

- [Plugins entry](plugins-evaluation-remote/ri-plugins-entry.png)
- [Interactive results inside Ri](plugins-evaluation-remote/ri-remote-examples.png)
- [Temporary chat with scenario context](plugins-evaluation-remote/ri-demo-chat.png)

## What this establishes

The interaction can be reached through a button in Ri without changing the viewer's browser tab or requiring a local server on their computer. Scenario variations provide immediate feedback. Expanded Excalidraw editing is usable and returns to its original result. This is enough to let the user assess whether the entry and interaction are useful.

This is an evaluation with fixed sample inputs. It does not implement production harness capture, chat-result correlation, account authorization, saved-result reopening, the full Plugins manager or packaged sandbox deployment across platforms. The current follow-up qualifies the public Excalidraw endpoint through a server-side connection. The original 0A browser-admission failure remains recorded as historical evidence. The reference host still exposes its evaluation input/result panels, and Excalidraw still requires its pinned upstream CDN imports.

The demo chat qualifies Claude against one stateless synthetic MCP calculation. Changing the view is not a mutation of business data in an external service. It does not establish Codex support, arbitrary app schemas, app-requested messages in normal Ri composers, production account binding or tagging into existing Ri chats. Those retain the runtime and persistence requirements in the specification.

The running foreground Ri needs to restart to load a changed Next build. Its old build is retained for rollback. Activation waits for running, pending and background harness work to finish, then uses the existing maintenance gate and normal stop/start lifecycle. The historical checked-in browser evidence here is from the isolated Home. Current third-party verification is recorded separately in the follow-up report.

[Start, stop and verification commands](../scripts/mcp-apps-eval/README.md#open-inside-a-remote-ri-home).
