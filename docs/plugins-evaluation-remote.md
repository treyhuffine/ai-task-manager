# MCP Apps inside a remote Ri view

Follow-up experiment, October 4, 2026. This addresses opening the milestone 0A examples from Ri on the Mac Mini while the viewer uses the Home's remote Beamd URL.

## Delivered interaction

Settings > Plugins has an experimental **Try interactive examples** button when the separate example host is running. It opens the real reference host in a large dialog in the same tab. **Return to Plugins** closes it and restores focus to the launcher. The Ri conversation remains mounted underneath.

The existing synthetic presets launch the actual Scenario Modeler and pinned Excalidraw fallback. Sliders, comparison, reset, canvas editing and checkpoint callbacks work through Beamd. The browser connects to separate HTTPS host and sandbox origins. It does not connect to its own localhost.

Reloading an example discards its results and visibly ends the session. Reloading Ri closes the dialog. Neither replays the original call. Open is an explicit new sample invocation. Closing a view does not cancel accepted server work.

## Boundary

The new Ri code is one card/dialog and an authenticated tRPC status/launch operation. The launch operation talks to a fixed loopback mint endpoint using a private temporary key. It returns a random 30-minute capability URL. The key is not returned to the browser. The public wrapper permits only the two fixed local synthetic fixtures and a small MCP method/tool allowlist. It strips cookies and Authorization headers instead of forwarding them.

The example host and sandbox are separate HTTPS origins from Ri and each other. The reference outer proxy and inner sandboxed iframe remain intact. CSP limits embedding to the configured Ri origin. The reference sandbox checks the exact host origin. Messages from the example host to Ri only report readiness, checked against the exact iframe source and origin. There is no Ri account, integration, tool, context or composer authority in this bridge. The child environment excludes Ri/provider credentials and Home settings.

Capabilities are held in memory, capped at 32 sessions and 80 fixture calls per session. Inputs are capped at 1 MiB and results at 20 MiB. Wrapper logs and private descriptors live outside the checkout. The installation retains the pins and frozen dependency graphs from [0A](plugins-evaluation-0a.md). Ri's dependency manifest, lockfile, database schema, credential store and existing integration gateway are unchanged.

## Verification

[Browser evidence](plugins-evaluation-remote/remote-verification.json) records ten passing checks against the actual production-built Ri UI with a separate synthetic Home. Only Ri requests were routed to that isolated Home. Both example origins and their MCP callbacks traversed live Beamd HTTPS tunnels.

- Initial discovery invoked no tool.
- Scenario growth, comparison and reset worked with one original call.
- Excalidraw editing saved a checkpoint and returned to the same invocation.
- Nested iframe DOM isolation and absence of desktop IPC were checked.
- Example reload and Ri reload did not replay tools.
- No Ri cookie or Authorization header reached either example origin.
- Return to Plugins restored focus and removed the view.
- A 390px Ri viewport retained the visible return path.

The HTTPS fixtures also passed seven checks in a synthetic parent without importing a Ri credential. The original local reference suite passed all eleven checks after the exact-origin overlay. Four launcher tests and eleven existing tRPC router tests passed. Two wrapper tests exercised origin validation, anonymous denial, private mint admission, unsupported operations, session capacity and expiry. `pnpm ts`, targeted ESLint and the isolated production build passed. The build emitted 50 existing broad filesystem-tracing warnings.

Actual screenshots from the synthetic Ri Home:

- [Plugins entry](plugins-evaluation-remote/ri-plugins-entry.png)
- [Interactive results inside Ri](plugins-evaluation-remote/ri-remote-examples.png)

## What this establishes

The interaction can be reached through a button in Ri without changing the viewer's browser tab or requiring a local server on their computer. Scenario variations provide immediate feedback. Expanded Excalidraw editing is usable and returns to its original result. This is enough to let the user assess whether the entry and interaction are useful.

This is an evaluation with fixed sample inputs. It does not implement production harness capture, chat-result correlation, account authorization, saved-result reopening, the full Plugins manager or packaged sandbox deployment across platforms. It does not qualify the public Excalidraw endpoint. The same documented browser-admission failure and local fallback from 0A apply. The reference host still exposes its evaluation input/result panels, and Excalidraw still requires its pinned upstream CDN imports.

The running foreground Ri needs to restart to load a changed Next build. Its old build is retained for rollback. Activation waits for running, pending and background harness work to finish, then uses the existing maintenance gate and normal stop/start lifecycle. This report's checked-in browser evidence is explicitly from the isolated Home, not an assertion that the old live Home was already running the new build.

[Start, stop and verification commands](../scripts/mcp-apps-eval/README.md#open-inside-a-remote-ri-home).
