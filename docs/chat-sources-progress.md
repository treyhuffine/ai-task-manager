# Chat source implementation and qualification

October 8, 2026. Worktree: `/Users/agent/worktrees/ri-local-apps`, branch `local-apps-mvp`, base `1fc3ece1`. Ri task: `01a11c54-9482-7b1c-b7d3-33e581c5d972`, associated with the plugin-platform and Finances tasks.

Implemented scope: sections 1 through 8 of [the source-mentions contract](app-connector-mentions-spec.md), plus remembered catalog setup and capability/status labels. Section 9's production connected-view host remains a separate parent-task delivery. The original worktree qualification is recorded below. The subsequent squash integration is recorded in [the platform progress log](local-apps-progress.md#october-8-squash-integration-with-main). Both feature flags remain opt-in.

## Completed work

- [x] Remember included-app setup across repeat/concurrent requests and Home restart. Show Preview app, Continue setup, Added, Disabled and Archived truthfully. Activation remains explicit.
- [x] Strict canonical source references, bounded parsing, inert history and independent `RI_CHAT_SOURCES` flag.
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

`RI_CHAT_SOURCES=1` enables source discovery and bound calls. Local package mentions additionally require local apps to be enabled. Apps now default to enabled, with `RI_LOCAL_APPS=0` as an explicit opt-out. With local apps removed, connected-account mentions remain usable. With mentions disabled, historical chips remain readable and unavailable, and ordinary chat continues normally.

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
