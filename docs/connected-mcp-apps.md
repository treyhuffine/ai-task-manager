# Connected MCP apps

Connected MCP interfaces use the same account and integration engine as their tools. There is no second installation, copied account, synthetic Ri package, or separate demo server. Settings → Plugins retains its existing UI.

## User experience

Chat is where a connected service is used. Only real application UI makes it an app you open: a screen that opens on its own.

- A connection whose server offers an interface, a standalone screen or a tool whose result renders, appears once in the Apps library. It can be found under Apps or Connectors. Tools-only connections retain their current management and chat paths.
- Only a service with a standalone screen (below) gets a row in the rail's Apps flyout and an Open <name> command in ⌘K, while one of its accounts can open it, named for the service (the catalog's `toolkitName`), beside installed apps (`docs/rail.md`). A service whose interface only comes back as a tool result, such as Todoist's task list, has neither. It is used from chat with `@` and stays in the library and Connectors.
- `/apps/~connected/<server-id>` shows the service and exact account, connection management, Try in chat, and the recent results it can reopen. It has no tool forms, since the agent chooses tools and inputs in chat. Try in chat opens the main chat with the service's chip and a starter prompt written after it, ready to send, as ChatGPT's Try fills "@Todoist What's on my list today". Official catalog entries may carry a curated prompt (`starterPrompt` in `integration-meta.ts`: Todoist "What's on my list today?", MagicPath its manifest's first prompt). Anything else gets "What can you do with <name>?". Nothing is sent and no access changes. A Home with mentions off gets the prompt alone.
- Open app appears only for a standalone screen. It calls that entrypoint with `{}` through the ordinary approval gate, with no input form, and the returned view fills the app page full screen. Choosing the app in the rail's Apps flyout or ⌘K (`?open=<entrypoint>`) opens the screen the same way. Once open, the URL names the screen (`?screen=<capture>`), so a refresh reopens it without calling the entrypoint again, and the page lists it under recent results to reopen full screen. An entrypoint that rejects `{}` shows its error plainly, with Try again as a new request. Leaving while it opens cancels it. A tool name such as `home` does not imply a launcher, and no other tool runs from the page.
- A completed, authorized model tool call can add an interactive result to its chat. Expanding it beside the conversation moves the live iframe with `moveBefore` where supported, retaining the guest's state and the chat draft. Older browsers fall back to remounting the captured result. Opening, refreshing, or expanding never reruns the original model tool call.
- UI operations use the existing approval system. The native card identifies the proposed operation. Allow once retries the same invocation, while Decline does not execute it. Closing a view or leaving a workflow cancels its pending requests and unused approval grants, including approval responses that arrive late. An operation already admitted to execution may finish. App approvals do not wake the agent to repeat the operation.
- UI messages append a draft and never send automatically. The most recently updated live view can attach its acknowledged model context to the next human send in that exact chat. Sending during the first context update waits for its acknowledgement before attaching the revision. A source mention identifies the account separately from selected view data. Context remains untrusted app data and confers no permissions.
- A source chip's Open <service> opens its latest live result beside that chat, or the account's Apps page when no result exists. Existing harness and account restrictions remain in force.

Connected views are enabled by default. `RI_MCP_APPS=0` disables them independently of `RI_LOCAL_APPS`. Mentions are always on. This supersedes the earlier opt-in rollout in the mentions spec. Discovery uses cached metadata. Existing servers need their usual discovery refresh after upgrading to preserve newly supported metadata aliases. Production is not restarted by implementation or tests.

## Supported interfaces

The initial profile accepts self-contained HTML with inline scripts and embedded assets. It supports standard `_meta.ui.resourceUri` (and `ui/resourceUri`), `text/html;profile=mcp-app`, tool visibility, authenticated `resources/read`, ordinary MCP results, `tools/call`, model-context updates, text chat suggestions, HTTPS links, height changes, and inline/expanded display.

A standalone screen is a global entrypoint: a tool whose `_meta["openai/ui"].entrypoints` includes `{ "type": "global" }`. It is documented as the "Sidebar apps" extension in OpenAI's plugin docs and its [MCP extensions spec](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#global-entrypoint): ChatGPT lists it in the sidebar and opens it full screen, the server must accept `{}` as its arguments, and `ui.visibility` is ignored when it opens. So an app-only launcher counts, and runs with whichever tool audience its visibility admits. Thread and file entrypoints open beside a conversation or for a file, are not standalone screens, and are not supported yet. Resource `availableDisplayModes` only chooses how a result first displays.

The compatibility adapter recognizes `openai/outputTemplate`, `text/html+skybridge`, `openai/widgetAccessible`, and global `openai/ui` entrypoints. It supplies `window.openai` tool input, output, private tool-response metadata, theme, widget state, tool calls, draft suggestions, display requests, and external links through the same bridge. It does not claim to implement every ChatGPT-specific extension.

Interfaces requiring external scripts, network domains, or undeclared capabilities receive an explicit unsupported explanation. A declared dedicated origin alone (`ui.domain`, or ChatGPT's `openai/widgetDomain`) does not: the MCP Apps spec makes its format host-specific and ties it to network uses (OAuth callbacks, CORS, API key allowlists) that the declared domains already rule out, so the view renders on Ri's own sandbox origin under the restrictive CSP. Requested permissions (`ui.permissions`: camera, microphone, geolocation, clipboard write) do not either. The spec has apps not assume them and lets the host decline, so Ri renders the view and grants none. Todoist's task list declares ChatGPT's domain, and Microsoft Flint's chart asks for clipboard write. Both were refused until October 19. Excalidraw loads its code from esm.sh, so it still shows the explanation with its text result.

An inline view is exactly as tall as it reports with `ui/notifications/size-changed`, which the host clamps to 160 to 900 px, and it starts at 420 px until the first report. It is capped at 80% of the window, and the view scrolls inside only past that. Until October 19 a flex rule collapsed every inline view to 240 px, which cut off the end of Todoist's list. `view-size.browser.test.ts` pins the height with the real component and CSS. On an app page, an open result carries Close in its own header row. A full-screen screen titled the same as its app shows no title row, since the page header already names it. Their tools and text results remain usable. The first profile does not provide connected-view file uploads/downloads, arbitrary resource browsing, or picture-in-picture. Total Finance's actual service is not qualified by the synthetic calculator fixtures. Its advertised resource must be checked against this profile after the owner restarts or refreshes their server.

## Implementation and authority

- `packages/mcp-apps-host` contains the shared `AppBridge`, opaque relay, CSP, and browser lifecycle. `packages/app-kit` re-exports it and inlines it at build time, so the packed SDK never depends on this workspace-only package. The connected adapter has no local builder, app-kit, or domain dependency.
- The integration engine's trusted `prepareMcpResult` hook binds the resolved connection, caller, attempt, redacted original input, and current authority before dispatch. Its returned observer receives the original MCP result after successful execution and rechecks that bound authority. A late result cannot inherit replacement credentials, capabilities or tool permissions. Capture failure cannot turn a completed operation into a retryable failure. Private `_meta` is absent from model results and audit previews.
- `lib/mcp-apps/service.ts` discovers capabilities, binds captures to exact accounts and chats, reads only the declared UI resource on that account, and dispatches UI calls through `runAction` with app audience. Every operation checks current account status, credentials/capability revision, tool overrides, and chat access before execution and before releasing results. Viewer procedures also recheck the signed-in key before and after work.
- The transcript stores only a native `mcp_app_result` event and opaque capture ID. HTML and private results remain in Home-owned `processState`. Captures and view sessions expire after 30 minutes or restart. Expiration leaves the original text intact and asks for a new result. It does not replay an old call.
- Native launch preparation creates a server-owned view and invocation before any effect. Retries of an expired, evicted, or unknown launch fail instead of creating another invocation. Within a view, identical in-flight deliveries coalesce. Completed or uncertain failures are never replayed. Only a pre-effect approval pause permits a retry of the same input and identity.
- Cancellation is bound to the exact viewer, view and invocation. Bounded cancellation receipts reject delayed first deliveries and approved retries. Cleanup remains available after provider access changes, clears only the matching pending approval and unused grant, and also runs when an in-flight request creates an approval after cancellation. Browser cancellation is best-effort if its connection to the Home is lost.
- Limits: 32 captures and 32 view sessions, 80 invocations per view, 512 KiB per result, 8 MiB cumulative result storage per view, 64 KiB input, and 12 MiB prepared HTML. Context is capped at 8 KiB and 10 updates per second. Guest messages have independent 1 MiB and 100/second containment limits.
- Frozen context is stored only on an accepted human message and reauthorized on dispatch and recovery. Local authoritative app context and remote untrusted context remain separate fields.

## @ search

A server can offer its own items in the composer's @ menu, OpenAI's [composer at-mentions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#composer-at-mentions): Bits & Bolts offers the parts in its library. It advertises `openai/mentions` with a `searchTool`, or the deprecated `_meta["openai/extensions"]["mentions/search"]` marker on a tool when the capability is absent.

- Ri asks every such server the chat may use, in parallel, with `{query}` as the app, on the server's exact account. Workspace scopes and account pins apply as they do to a chat's other app use. Each server has three seconds, so a slow one only leaves its group out. The mixed picker asks once something is typed and shows up to five items per app. `@app:` asks even for an empty query, as the spec allows, and shows every item the app returned, at most 20. Typing is debounced and recent answers are reused for a few seconds.
- A server is skipped, with its reason kept in the response, when its search tool is missing, turned off, not marked `readOnlyHint: true`, or not visible to apps, as the spec requires. A search runs on every keystroke, so it never stops for approval: a search tool the person set to Ask first is skipped and says so, rather than raising a card per letter.
- Items are `resource_link`s or OpenAI's `{type: "resource", resourceUri, title}` form. Invalid items and duplicates are dropped one by one. Item icons pass through `safeMcpIcons`, and remote ones load without a referrer.
- Choosing an item inserts the same chip an account mention uses. Its source reference names the account and carries the item's URI, title and name (`mentionedResourceSchema` in `chat-sources/reference.ts`). The URI is the identity. The title is only what the chip shows. The chip reads as the item and is exactly as available as its account.
- When the message is sent, and again on every dispatch, the account is rechecked for that chat before anything is read. A chat that lost the account cannot send the mention. Ri then reads each item through the server's `resources/read` and gives the agent an `<ri-mentioned-resources>` block: app, title, URI, name, MIME type and text content, as untrusted data. Text is capped at 32 KiB per item and 96 KiB per message. A binary item is named without its bytes, and a read that fails says why without failing the message.
- `RI_MCP_APPS=0` turns @ search off with the rest of connected apps.

## Bits & Bolts test server

[Bits & Bolts](https://github.com/openai/mcp-extensions/tree/main/plugins/bits-and-bolts) is OpenAI's sample app for its MCP extensions (Apache-2.0): a CAD parts library with a sidebar app, a thread tab, a file viewer, settings, @ search and forms. Ri uses it as the conformance fixture for connected apps, and it is also a useful app to try. `pnpm bits-and-bolts` runs it as a local MCP server.

```sh
pnpm bits-and-bolts start    # build it if needed, then serve http://localhost:3917/mcp
pnpm bits-and-bolts status   # the URL, and whether it is up
pnpm bits-and-bolts stop     # end the server
```

- The first `start` fetches openai/mcp-extensions at a pinned commit and builds it in `~/.local/share/ri-bits-and-bolts` (`BITS_AND_BOLTS_HOME`), outside this checkout. Later starts reuse the build. Changing the pinned commit or the launcher rebuilds it.
- It serves Bits & Bolts' own local store, the same tools, catalog and app as its stdio plugin, on `127.0.0.1` only, with no sign-in. Its screens are self-contained, so they render inside Ri. One handler speaks MCP 2026-07-28 and 2025-era clients. The launcher is `scripts/bits-and-bolts/launcher.mjs`.
- The parts library, imported parts and settings live in `~/.local/share/ri-bits-and-bolts/library` and survive restarts. The log is `server.log` beside it.
- Nothing starts it at login. It runs until `stop`, a restart of the computer, or the process ending. `BITS_AND_BOLTS_PORT` changes the port.
- The repository's remote build (`build:remote`) is not part of this command. Its screens load model files from its own origin, and Ri's sandbox refuses views that need network domains.

To use it in Ri, start the server, then open Settings, Plugins, Add MCP server. Name it "Bits & Bolts", set Server URL to `http://localhost:3917/mcp` and Auth to None, then Add and connect. Ri accepts `http://` only for localhost, which works because the Home's own server connects to it. Bits & Bolts then appears in Apps, the rail's Apps flyout and ⌘K, and Open app shows its parts library full screen. This works from any device that can open the Home, since the app's interface reaches the browser through Ri.

To turn it off, switch its connection off or remove it in Settings, Plugins, MCP servers, then run `pnpm bits-and-bolts stop`. A connection left on while the server is stopped shows as unreachable until it is started again.

## Qualification

Tests use synthetic accounts and independent MCP fixtures, not personal services. Browser tests exercise standard and legacy interfaces through the actual shared bridge. Product tests render the actual inline card and companion, approve a callback, preserve a draft, attach acknowledged context, and verify one live iframe survives expansion and return on desktop and mobile.

```sh
pnpm --filter @ri/app-kit build
pnpm ts
pnpm exec vitest run --maxWorkers=1 src/lib/mcp-apps src/components/mcp-apps src/lib/chat-sources src/components/local-apps/library-model.test.ts src/components/local-apps/library.browser.test.ts src/lib/integrations/mcp-capabilities.test.ts src/lib/integrations/approval.test.ts src/lib/integrations/approval-events.test.ts src/lib/process-state.test.ts src/lib/client/app-chat-intent.test.ts src/lib/client/mcp-app-context.test.ts src/lib/client/mcp-app-invocation.test.ts src/lib/executor/adapter.result-review.test.ts src/lib/executor/adapter.instructions.test.ts src/lib/executor/adapter.turn-liveness.test.ts
pnpm --filter @integrations/engine test src/__tests__/mcp-view-capture.test.ts src/__tests__/mcp.test.ts
pnpm --filter @ri/app-kit test test/view-host.test.ts
```

The fixtures prove browser containment and remote-view independence from the local app kit. They do not constitute a packaged Electron or personal Total Finance end-to-end qualification.

October 15, 2026 verification: app-kit build and root typecheck passed. The targeted root regression run passed 138 tests in 21 files, the workflow-page browser test and two router tests passed separately, the integration engine passed 35 tests, and the existing local-host browser regression passed. The inline browser test also passed again after renaming the tRPC procedure to `invoke`, because `call` is reserved by tRPC. This is 177 distinct passing tests. Browser fixtures used Playwright 1.62.1, Chromium 151.0.7922.34 and Node 26.5.0. Targeted lint has no errors, with one existing unused-import warning in the integration runtime.

The subsequent review fixes passed 74 root tests in 12 files and 36 integration-engine tests in two files. These cover authority changes during execution, the first context acknowledgement during Send, cancellation before a response or approved retry, exact approval cleanup, and leaving a native workflow while a response is pending. Root typecheck passed and targeted lint reported no errors, with the same existing warning. An independent GPT-6.1 Sol re-review found all three findings resolved and independently passed 47 tests across six files.

The complete Next.js 16.1.6 production build passed with `next build --webpack`, `NEXT_DIST_DIR=.next-mcp-apps-check`, a disposable Home, all Home paths explicitly overridden and a 4 GiB Node heap. It completed TypeScript, route collection and static-page generation. The build reports an existing dynamic-import warning from `officeparser`/`file-type`. Earlier attempts were interrupted by a process termination and disk exhaustion. Temporary build output was removed afterward. Production assets, credentials and services were untouched.

- [x] Cached discovery, one service card and exact existing account selection.
- [x] Original-result capture, private metadata separation, bounded sessions and no replay on reopen.
- [x] Shared standard and legacy browser bridge, with the existing local host regression retained.
- [x] Apps pages, inline results, expansion, native approvals, draft preservation and acknowledged context.
- [x] Exact account/viewer checks, app-visible tools, revocation and expired-handle rejection.
- [x] Full isolated production build.
- [ ] Packaged desktop qualification.
- [ ] Actual Total Finance service qualification.
