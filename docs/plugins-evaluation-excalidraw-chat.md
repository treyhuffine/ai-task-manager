# Excalidraw agent updates in the temporary Ri demo

October 5, 2026. This extends the isolated evaluation, with no database migration, account change or dependency upgrade. The scope is the synthetic diagram served by `https://mcp.excalidraw.com/mcp` inside the existing remote demo host. Production result storage, ordinary Ri chat integration and universal provider or harness support remain outside this experiment.

## Try it

Open Settings > Plugins at the Home's configured HTTPS address. Choose Excalidraw's **Open demo**, then **Chat about result**. Check **Allow updates to this diagram** and ask “Add a green Done step after Execute.” The agent prepares a revision through MCP and the host loads the captured result into the same result area. The demo chat and typed drafts remain in place.

Updates start disabled. Without the checkbox the agent reads the attachment and explains how to enable diagram updates. It should not send the user to a separate Excalidraw app. Manual editing remains available through the diagram's fullscreen editor. Chat 2 explicitly attaches the same live result and starts with its own update permission disabled.

## Boundaries

The qualified model path uses the existing subscription-backed Claude one-shot helper. A changing turn exposes only `read_me` and `create_view`. Widget-only `read_checkpoint` and `save_checkpoint`, exports, files, commands, skills, other accounts and Ri tools are not model tools. Other harnesses retain the existing explicit unsupported state rather than a silent provider switch.

The originating view uses the stable UUID of its captured MCP call. Its diagram capability names the current, session-owned checkpoint and checkpoint version. The server validates that exact binding before admitting a turn, accepting a tool call and committing a captured result. Another diagram's checkpoint, an account attachment, an expired session, a closed result or an unknown result has no write authority.

Every update starts with the exact attached `restoreCheckpoint`, followed by bounded drawing elements. One turn accepts at most one `create_view`. Excalidraw creates a child checkpoint, leaving the base intact. Original arguments and the complete result are captured inside the proxy before model projection. Private `_meta` stays in the UI capture and is excluded from model replies and context summaries.

Manual checkpoint writes advance the version immediately and remain unavailable for changes while pending. Unknown write outcomes disable changes rather than replaying the save. The host uses an app-only read of the owned checkpoint to publish a bounded current diagram summary. That lets later read-only turns see agent changes and manual labels without exposing a checkpoint tool to the model.

The pinned SDK installs default tool handlers during `AppBridge.connect()`. Its default UI callback uses `client.request()` and bypasses the client’s invocation wrapper. The evaluation replaces that callback after connection and before loading guest HTML. Each explicit UI operation gets its own stable invocation reference and app audience. Browser and model RPC counters are also mapped into a distinct upstream request namespace, with response references checked and mapped back.

Before applying a result, Ri rechecks the attached context revision and current checkbox. The isolated host also checks its source, parent origin, invocation and checkpoint version. It briefly blocks diagram input and waits for the qualified editor's two-second manual-save debounce to settle. A newer edit defeats the late result. The host then commits only the captured child checkpoint and remounts the inner guest from that snapshot. This clears upstream editor state while retaining the outer host, result identity and demo conversations. Rendering issues an app-only checkpoint read, never another `create_view`.

Unchecking permission while a call is already accepted does not undo server work. Its captured fork is left unapplied. Closing, reloading, expiry, duplicate delivery and failed UI initialization never repeat an accepted or uncertain update. Everything remains bounded session memory, and Excalidraw can retain checkpoints upstream independently of Ri.

## Verification

Run the commands in the [evaluation README](../scripts/mcp-apps-eval/README.md). The sixth overlay reproduces the host from the same pinned upstream commits and frozen dependency set. HTTP tests cover cross-diagram scope, model/app visibility, metadata separation, captured delivery, stale checkpoint writes, failed saves, unknown outcomes, closure and expiry. Application tests cover opt-in tool grants, restricted harness flags, bounded context and retry deduplication.

The [browser qualification](plugins-evaluation-third-party/excalidraw-agent-chat-verification.json) passed eight checks on October 5 using a production-built synthetic Ri Home, live HTTPS tunnels and the real public Excalidraw app. A real Claude turn added a green Done step while preserving a manual note and typing. A second real turn read both from the updated checkpoint. The remounted guest was refused access to its old checkpoint. Separate controlled replies using real upstream captures verified revoked permission and newer manual edits. Independent chat drafts and permissions, and reload without replay, also passed.

The final host also passed all 12 public demo regression checks and all six controlled account bridge checks. Those account fixtures do not qualify authenticated Asana, Figma or PostHog. Eleven HTTP tests, ten application tests, Ri typechecking, targeted lint, the host build and the production Webpack build passed. All six source overlays reproduced the qualified host exactly. No migration or credential change ran.
