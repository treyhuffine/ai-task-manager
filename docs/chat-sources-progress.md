# Chat source implementation and qualification

October 8, 2026. Worktree: `/Users/agent/worktrees/ri-local-apps`, branch `local-apps-mvp`, base `1fc3ece1`. Ri task: `01a11c54-9482-7b1c-b7d3-33e581c5d972`, associated with the plugin-platform and Finances tasks.

October 19: mentions are always on and the `RI_CHAT_SOURCES` switch is removed ([below](#october-19-always-on)). The record that follows describes the opt-in period.

Implemented scope: sections 1 through 8 of [the source-mentions contract](app-connector-mentions-spec.md), plus remembered catalog setup and capability/status labels. Section 9's production connected-view host remains a separate parent-task delivery. The original worktree qualification is recorded below. The subsequent squash integration is recorded in [the platform progress log](local-apps-progress.md#october-8-squash-integration-with-main). Both feature flags remain opt-in.

## Completed work

- [x] Remember included-app setup across repeat/concurrent requests and Home restart. Show Preview app, Continue setup, Added, Disabled and Archived truthfully. Activation remains explicit.
- [x] Strict canonical source references, bounded parsing, inert history and independent `RI_CHAT_SOURCES` flag (removed October 19).
- [x] Metadata-only discovery, one Apps picker group, Chat/View pills, exact account drill-down and disambiguation of equal account labels.
- [x] Current chat and harness authorization, exact account/client pins, native access/reconnect cards and approval identity bound to message/source/invocation.
- [x] Shared describe/invoke operations, signed CLI forwarding to the Home, preflight before new sends, unchanged accepted retries and redispatch context.
- [x] Source chips, clipboard paste, backspace, draft restoration, both composer serializers and transcript support.
- [x] Explicit opening beside the current chat. Selecting a source does not open anything, fetch records, start a package or grant access.
- [x] Optional local adapter, tools-only IPC and MCP packages, native summaries and builder Try support.
- [x] Durable integration invocation receipts, concurrent retry deduplication and refusal to replay unknown outcomes after interruption.
- [x] Combined and independent tests, production builds, typechecks and scoped lint. Evidence below.
- [x] Specification and handoff reconciled with the implementation and its release boundaries.

## Product and runtime boundaries

Use one Apps group. Chat/View describe capabilities. Ready/Allow access/Reconnect/Unavailable describe current usability in the receiving chat. An externally advertised MCP view is described as unavailable here yet until section 9's host is qualified. The existing Settings, Plugins, Connectors flow remains available.

Until October 19, `RI_CHAT_SOURCES=1` enabled source discovery and bound calls. Local package mentions additionally require local apps to be enabled. Apps now default to enabled, with `RI_LOCAL_APPS=0` as an explicit opt-out. With local apps removed, connected-account mentions remain usable. With mentions disabled, historical chips remain readable and unavailable, and ordinary chat continues normally.

The current harness registry qualifies strict MCP isolation only for Claude Code. The installed runtime is checked again on send and call. Codex, Cursor, OpenCode and Antigravity are not newly qualified by this change. This is an existing harness boundary, not a mention-specific credential bypass. The shared CLI requires its signed calling chat and forwards execution to the running Home.

Local app calls retain their existing receipt/approval system. Integration calls use `getIntegrationsDir()/source-invocations` for durable attempt receipts, while validation, action approval, redaction and audit stay in the existing engine. Completed results are retained up to 512 KiB. Larger results and indeterminate attempts retain non-replayable records. This does not claim exactly-once execution by an external provider after a network failure.

## Verification

Qualified environment: macOS arm64, Node `26.5.0`, module ABI `147`, Next.js `16.1.6`, Vitest `4.1.4`. Actual Chromium engine `151.0.7922.173`, using installed Brave headlessly at a 390 by 844 viewport. Tests use disposable Homes, synthetic records and fixture connections. No personal mailbox or bank was queried.

| Check | Result |
| --- | --- |
| Combined targeted Ri suite | 176 tests in 15 files pass |
| Independent checkout with no local apps, app-kit, builder or Finances | 168 tests in 12 files pass |
| Full app-kit suite | 26 tests in 8 files pass, including real tools-only MCP and existing process/view checks |
| Real packaged Finances consumer | Separate artifact integration passes through the generic source adapter with the Finances display name and unchanged `finance_*` IDs |
| Feature flags | All four source/local-app combinations pass, including no optional adapter initialization when disabled |
| Catalog setup | Repeated, concurrent and restarted setup uses the same saved draft and still verifies archive integrity |
| Editor/browser | Exact account drill-down, Enter, IME Enter, Escape, backspace, pasted markers, mobile popup, reload, both outputs, file/task coexistence and delayed results across a chat switch pass |
| Authorization | Cross-chat and tool-origin references, missing grants, equal account IDs on different clients, forged account overrides, changed bindings, cancellation and revocation before result delivery are covered |
| Native account cards | Exact client selection, reconnect and replacement-connection rejection pass against the existing access flow |
| Builds and types | Combined and independent production builds and typechecks pass |
| Changed-surface ESLint | Zero errors, five existing unused-variable warnings in surrounding files |

Combined command:

```sh
pnpm test src/lib/chat-sources src/lib/integrations/source-invocations.test.ts src/lib/integrations/approval.test.ts src/lib/integrations/connection-requests.test.ts src/lib/local-apps/source-adapter.test.ts src/lib/local-apps/source-flags.test.ts src/lib/local-apps/catalog.test.ts 'src/app/api/sessions/[id]/messages/route.test.ts' src/components/chat/editor/mention-menu/ranking.test.ts src/components/chat/editor/history-recall.test.ts src/lib/process-state.test.ts
pnpm --filter @ri/app-kit test
RI_FINANCE_FIXTURE="$PWD/release/local-apps/catalog/ri-finance.tar.gz" pnpm test src/lib/local-apps/finance.test.ts
pnpm ts
```

Production builds use a new disposable `RI_ROOT`, both flags for the combined build, and only `RI_CHAT_SOURCES=1` for the independent build. Build tracing still reports existing broad dynamic filesystem-pattern warnings. The independent suite uses the combined command without the three local-app test files. Browser fixtures use the actual editor but are not a new full desktop release qualification or a product-layout review.

Logs and the mobile fixture capture are retained under `.work/chat-sources/evidence/` in the plugins worktree. The original log paths are `/tmp/ri-chat-combined-final.log`, `/tmp/ri-chat-independent-final.log`, `/tmp/ri-chat-kit-final.log`, `/tmp/ri-chat-finances.log`, `/tmp/ri-chat-combined-build-final.log`, `/tmp/ri-chat-independent-build-final.log` and `/tmp/ri-chat-eslint-final.log`.

## Independent delivery

The shared change is assembled in `/tmp/ri-chat-sources-independent`, detached at main baseline `cb996c47`, with its own dependency installation. The local runtime, builder, app-kit and Finances are absent. The only optional-registration seam removed from server composition is the local adapter and its builder/try guard. The shared parser, composer, domain, integrations, send path and source operations are unchanged.

A retainable patch against that baseline is `.work/chat-sources/shared.patch` in the plugins worktree. It includes the integration cancellation prerequisite already present on the plugins branch. The optional local work stays under `src/lib/local-apps`, `src/components/local-apps` and `packages/app-kit`, plus its small server-composition registration. The Finances consumer test is separate at `src/lib/local-apps/finance.test.ts`. None of the shared tests requires a Finances installation or contract.

Production connected MCP UI hosting, extracting its shared browser host, live provider qualification and new harness qualification are not claimed complete here. Section 9 remains unchecked in the specification and associated with the parent plugin-platform task.

## October 19: always on

The owner decided that Connector and app mentions are live everywhere, with no environment switch and no opt-out. `@Todoist` in a chat now behaves as it does in ChatGPT: the service is offered above notes, inserted as a chip with its logo, and the agent uses that exact account.

### Why the switch existed and what was pending

`RI_CHAT_SOURCES` arrived with the shared mentions slice on October 8 (`e7923db8`). It was a Home-evaluated opt-in so the Connector path could ship and be qualified separately from local apps, and be removed cleanly. Sections 1 through 8 were qualified then. Three things were left open:

- Section 9's connected-view host, which shipped on October 15 (`392b9cb9`), on by default.
- Harness qualification beyond Claude Code. Codex qualified on October 16 (`9e22fa9f`) from Codex CLI 0.160.0. Cursor, OpenCode and Antigravity still show a mention as Unavailable in this chat.
- A live provider check, which had never been run.

### Blockers found and fixed

- **Todoist's task list never rendered.** Its resource declares ChatGPT's dedicated origin (`openai/widgetDomain`) with an empty CSP. `prepareResource` refused any declared origin as a network need. The MCP Apps spec makes that field host-specific and ties it to network uses the declared domains already rule out, so a declared origin alone no longer refuses a view. Network domains and permissions still do ([connected MCP apps](connected-mcp-apps.md)).
- **Inline views were cut off at 240 px.** The frame's 0% flex basis resolved to its empty container's content, so every inline view collapsed to its minimum height whatever it reported. It now takes the reported height, capped at 80% of the window. Todoist's task list shows whole, and Microsoft Flint's chart, which asks for clipboard write, now renders instead of being refused.
- **Chips stacked in sent messages.** The user bubble is a flex column, so each piece of a message became its own row and chips stretched to its width. The segments now flow as one block.
- **An agent naming a bare tool got an opaque error.** Action ids carry the provider prefix (`mcp.todoist.find-tasks-by-date`). `describe_chat_source` and `call_chat_source` now name the full id.
- Per-keystroke discovery reads the integration metadata files. Against a copy of the production Home's 1 MB server file it costs 3 to 5 ms per call once warm, so it is not a blocker.

### Removed

- `chatSourcesEnabled()` and every `RI_CHAT_SOURCES` read: server composition (`src/lib/server/chat-sources.ts`), session reach (`src/lib/auth/session-token.ts`, now the same executions and agent main chats as the other session servers), the `/api/chat-sources/action` route's 404, and the orchestrator registry filter, so `describe_chat_source` and `call_chat_source` are always registered.
- The `enabled` dependency and its checks in `ChatSources`, the `chatSources.enabled` tRPC query, and the client branches that read it: the library's "not enabled" message in Use in chat, and the page's prompt-only fallback.
- The local-app source adapter still requires `localAppsEnabled()`. Connectors never depended on it.

### Live verification on the dev home

The agent browser is not signed into Todoist, so the real account was not connected to the dev home. Instead, Todoist's own open-source MCP server (`@doist/todoist-mcp` 13.6.1, MIT) ran locally against a synthetic Todoist API and was added as a custom server named Todoist. Its 47 tools and `find-tasks-by-date` resource URI (`ui://todoist/task-list@7387ecbcc2a1`) match the production Home's cached Todoist discovery, so the view is the same build.

- `@Todo` offered Todoist in its own Apps section. Selecting it inserted a highlighted chip, and Enter sent "What's on my list today?".
- The main chat's agent called `describe_chat_source`, then `call_chat_source` with the message's exact `source_ref` and `mcp.todoist.find-tasks-by-date`. The capture produced an inline result, and Todoist's real task-list view rendered in the conversation.
- The Todoist page showed Try in chat with its prompt and the recent result. Try in chat wrote the chip and prompt into the main chat. Todoist had no row in the Apps flyout or ⌘K.
- OpenAI's Bits & Bolts sample and a small self-contained fixture covered standalone screens: each got a flyout row and an Open command in ⌘K, and one click opened its global entrypoint with `{}` full screen. Bits & Bolts' own interface needs network domains, so it showed the unsupported explanation with its text result. The fixture rendered.
- Official logos, two accounts of one service, and the needs-access state are shown in the chat UI gallery's App and account mentions example, which renders the real chip and transcript code with fictional accounts. A second real account was not available.

