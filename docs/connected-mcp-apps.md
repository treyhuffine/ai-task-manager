# Connected MCP apps

Connected MCP interfaces use the same account and integration engine as their tools. There is no second installation, copied account, synthetic Ri package, or separate demo server. Settings → Plugins retains its existing UI.

## User experience

- A connection that advertises UI tools appears once in Apps, with both Open and Use in chat. It can be found under Apps or Connectors. Tools-only connections retain their current management and chat paths.
- While one of its accounts can open it, the same app gets a row in the rail's Apps flyout and an Open <name> command in ⌘K, named for the service (the catalog's `toolkitName`), beside installed apps (`docs/rail.md`).
- `/apps/~connected/<server-id>` shows the exact account, available workflows, connection management, and recent live results. A workflow runs only after the person provides its inputs and explicitly starts it. A tool name such as `home` does not imply a launcher. Explicit `openai/ui` global entrypoints receive an Open app label.
- A completed, authorized model tool call can add an interactive result to its chat. Expanding it beside the conversation moves the live iframe with `moveBefore` where supported, retaining the guest's state and the chat draft. Older browsers fall back to remounting the captured result. Opening, refreshing, or expanding never reruns the original model tool call.
- UI operations use the existing approval system. The native card identifies the proposed operation. Allow once retries the same invocation, while Decline does not execute it. Closing a view or leaving a workflow cancels its pending requests and unused approval grants, including approval responses that arrive late. An operation already admitted to execution may finish. App approvals do not wake the agent to repeat the operation.
- UI messages append a draft and never send automatically. The most recently updated live view can attach its acknowledged model context to the next human send in that exact chat. Sending during the first context update waits for its acknowledgement before attaching the revision. A source mention identifies the account separately from selected view data. Context remains untrusted app data and confers no permissions.
- With `RI_CHAT_SOURCES=1`, a source chip opens its latest live result beside that chat, or the account's Apps summary when no result exists. Existing harness and account restrictions remain in force.

Connected views are enabled by default. `RI_MCP_APPS=0` disables them independently of `RI_LOCAL_APPS` and `RI_CHAT_SOURCES`. This supersedes the earlier opt-in rollout in the mentions spec. Discovery uses cached metadata. Existing servers need their usual discovery refresh after upgrading to preserve newly supported metadata aliases. Production is not restarted by implementation or tests.

## Supported interfaces

The initial profile accepts self-contained HTML with inline scripts and embedded assets. It supports standard `_meta.ui.resourceUri` (and `ui/resourceUri`), `text/html;profile=mcp-app`, tool visibility, authenticated `resources/read`, ordinary MCP results, `tools/call`, model-context updates, text chat suggestions, HTTPS links, height changes, and inline/expanded display.

The compatibility adapter recognizes `openai/outputTemplate`, `text/html+skybridge`, `openai/widgetAccessible`, and global `openai/ui` entrypoints. It supplies `window.openai` tool input, output, private tool-response metadata, theme, widget state, tool calls, draft suggestions, display requests, and external links through the same bridge. It does not claim to implement every ChatGPT-specific extension.

Interfaces requiring external scripts, network domains, dedicated origins, or undeclared capabilities receive an explicit unsupported explanation. Their tools and text results remain usable. The first profile does not provide connected-view file uploads/downloads, arbitrary resource browsing, or picture-in-picture. Total Finance's actual service is not qualified by the synthetic calculator fixtures. Its advertised resource must be checked against this profile after the owner restarts or refreshes their server.

## Implementation and authority

- `packages/mcp-apps-host` contains the shared `AppBridge`, opaque relay, CSP, and browser lifecycle. `packages/app-kit` re-exports it and inlines it at build time, so the packed SDK never depends on this workspace-only package. The connected adapter has no local builder, app-kit, or domain dependency.
- The integration engine's trusted `prepareMcpResult` hook binds the resolved connection, caller, attempt, redacted original input, and current authority before dispatch. Its returned observer receives the original MCP result after successful execution and rechecks that bound authority. A late result cannot inherit replacement credentials, capabilities or tool permissions. Capture failure cannot turn a completed operation into a retryable failure. Private `_meta` is absent from model results and audit previews.
- `lib/mcp-apps/service.ts` discovers capabilities, binds captures to exact accounts and chats, reads only the declared UI resource on that account, and dispatches UI calls through `runAction` with app audience. Every operation checks current account status, credentials/capability revision, tool overrides, and chat access before execution and before releasing results. Viewer procedures also recheck the signed-in key before and after work.
- The transcript stores only a native `mcp_app_result` event and opaque capture ID. HTML and private results remain in Home-owned `processState`. Captures and view sessions expire after 30 minutes or restart. Expiration leaves the original text intact and asks for a new result. It does not replay an old call.
- Native launch preparation creates a server-owned view and invocation before any effect. Retries of an expired, evicted, or unknown launch fail instead of creating another invocation. Within a view, identical in-flight deliveries coalesce. Completed or uncertain failures are never replayed. Only a pre-effect approval pause permits a retry of the same input and identity.
- Cancellation is bound to the exact viewer, view and invocation. Bounded cancellation receipts reject delayed first deliveries and approved retries. Cleanup remains available after provider access changes, clears only the matching pending approval and unused grant, and also runs when an in-flight request creates an approval after cancellation. Browser cancellation is best-effort if its connection to the Home is lost.
- Limits: 32 captures and 32 view sessions, 80 invocations per view, 512 KiB per result, 8 MiB cumulative result storage per view, 64 KiB input, and 12 MiB prepared HTML. Context is capped at 8 KiB and 10 updates per second. Guest messages have independent 1 MiB and 100/second containment limits.
- Frozen context is stored only on an accepted human message and reauthorized on dispatch and recovery. Local authoritative app context and remote untrusted context remain separate fields.

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
- [x] Apps workflows, inline results, expansion, native approvals, draft preservation and acknowledged context.
- [x] Exact account/viewer checks, app-visible tools, revocation and expired-handle rejection.
- [x] Full isolated production build.
- [ ] Packaged desktop qualification.
- [ ] Actual Total Finance service qualification.
