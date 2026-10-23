# Third review corrections

Historical ledger, superseded by [fourth review corrections](unified-home-review4.md). The routing, current-chat, archive/close and lost-receipt claims below describe intended behavior at that revision. Review4 records the remaining defects found in those paths and their actual regressions.

Reviewed source: `c466b519`. Corrections: `69911a4d`. Main was incorporated at `7a26c975` and `0569a882`, through local main `41dfe4dc`. The HUD ancestor `acae188a` is preserved. This ledger supersedes earlier parity claims for these paths.

No production Home, real provider account, Docker, deployment, push or merge to main is part of this work. Tests use disposable Homes and fake harnesses. Final qualification requires the external manifest produced by `scripts/verify-unified-home.py` at the delivered HEAD to report every gate at exit 0, `sourceUnchanged: true` and `allPassed: true`. The final response links that manifest. An earlier exploratory run is not final evidence.

## Decisions and bounded scope

- A connected personal Home represents its signed-in person for Team approvals. Disclosed agent callers (`x-ri-session`) are refused on HTTP and WebSocket relays.
- Background work uses the currently running turn's chat credential. Attribution can move to that turn's requester. There is no owner-only agent action. This accepted limit does not require credential redesign.
- Team agents use the server OS account. Team-wide control, owner/member capabilities and deferred isolation remain as decided. Warnings name the Team server and its OS account, which remains accurate for remote viewers.
- Static guards support runtime authorization. The role guard remains a bounded developer check, not a general JavaScript policy analyzer for every possible alias, regex or container. Named-action checks and actual member/agent request tests enforce authority. The review's exhaustive analyzer request is intentionally declined.
- Packaging validation follows the actual entry inventory, covers common static preload declarations and executes shipped code. It does not execute arbitrary JavaScript to discover preloads.

## Routing and authority

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| H1 raw destinations | MCP preserves raw keys until dispatch. Camel/snake targets normalize or refuse before action validation, unknown target spellings refuse, targeted Team aliases survive. External-content scope remains unchanged. | `api/orchestrator/[transport]/route.test.ts`, `spaces/native-access.test.ts`, `external-ai/home-mcp.test.ts` |
| H3 Files | Create, rename, delete, directories and conflict resolution use named `editAgentFolder` admission and common owner-file operations. Successful edits carry member/sign-in activity. | `team/capability-conformance.test.ts`, `team/ai/native-turn.test.ts`, actual Team boundary integration |
| M1 version skew | Protocol 2 is required by new native clients. Updated Homes retain protocol 1. An older server gives an update message. Discovery probes capability before advertising native operations. | `spaces/mixed-version.test.ts` starts a real pinned main-code Team process |
| M2 permissions | Agent launch inherits sender restrictions. Widening needs a signed-in person. Identity from member keys also preserves disclosed session identity. | Actual runner and signed in-process tRPC POST in `team/ai/native-turn.test.ts`, main/sibling policy tests |
| M6 lifecycle | UI, Team MCP, native access and Team session tools share viewer-lifecycle preflight and explicit `runtime_choice`. Retry receipts precede asynchronous effects, member/sign-in revalidation follows them. | Actual Team MCP with active work in `native-turn.test.ts`, native-access and lifecycle tests |
| M10 capabilities | Revert needs editContent with human/member provenance. Preview writes and restore need editAgentFolder, preview/read endpoints need read. Executions must belong to shared Team chats as well as the workspace. | Named-action denial matrix in `capability-conformance.test.ts` |
| Relay and scope | Both relays refuse disclosed session callers for prompt authority. Actor-building policies classify session-bearing member requests as agents. | `trpc/space-ws-relay.test.ts`, proxy/session and native-turn tests |
| Errors and discovery | Transient upload/tool failures are retryable, local failures do not report a Team outage, discovery includes search_sessions. | Native-access, command, remote and real skew tests |
| Attribution | Shared push, both pull operations, preview controls and terminal input/close log member/sign-in. Terminal activity records control changes, never command bytes. | `home/shared-activity.test.ts`, `terminal/team-terminal.test.ts` through actual authenticated tRPC/SQLite with synthetic side effects |

## Runtime and collaboration

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| H2 startup | Guard each recovery step, log errors, do not await preview shutdown. Critical recovery failure makes Team AI unavailable and skips resume, while content still serves. One common idle sweep. | Failure injection for both Home paths in `home/execution-startup.test.ts`, actual Team CRUD with AI on/off in `execution-recovery.integration.test.ts` |
| M3 current chat | Per-member current pointers, set by New and Resume. Model changes add/select a chat without changing another member's selection. GET stays read-only, first send creates. Session mutation controls stay disabled until that chat exists, and the composer explains its initial Home defaults. | `sessions/team-main-chat.test.ts`, `workspaces/team-catalog.test.ts` |
| M4 bounded close | Five-second close limit. Kill only a tracked process with matching PID and process identity. Unconfirmed close stays blocked and retryable. Archive follows successful close and queue withdrawal. | `runner/session-close-timeout.test.ts`, real Node stand-ins in `runner/harness-processes.test.ts`, failed archive/retry via real runner in `native-turn.test.ts` |
| M5 queue | Do not claim another member's turn while the runner is busy, has an active send or background work. | `team/ai/chat.test.ts` covers background and self-initiated activity |
| Crash catch-up | Team startup and explicit reconciliation use the ordinary transcript reconciler without orphan redispatch. | `team/ai/transcript-recovery.test.ts`, isolated native transcript file |
| Stalled receipt | Common health checks reconcile. Team maintenance cancels a delivered turn only after repeated idle observations or a dead runner, then admits the next turn. No duration cap on active/background work. | Lost real adapter completion receipt in `native-turn.test.ts` |
| Lifecycle edges | Failed close never archives first, AI-off stop returns an honest result, history Resume works with AI off, forApp reuses a blank chat. Cancelled output is excluded from fresh history, conservatively for ambiguous old output. | Native-turn, turn-prompt, main-chat and chat queue tests |
| Compatibility duplication | Team chat creation delegates to addMainChat. Archive delegates to ordinary retirement and queue withdrawal. Stop delegates to the shared queue/runtime operation. Transcript cancel uses ordinary sessions.interruptPost. | Ordinary interrupt queued-cancel regression and failed archive/retry in native-turn tests |

## Shared UI

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| M7 review/chips | Shared read/edit admission and per-resource authority for review, review context and task chips. Typed tRPC keys. | Capability tests, loaded Team ExecutionView and actual Team boundary integration |
| M8 Results completion | Results mounts the ordinary LifecycleGuardProvider inside the Home/Work boundaries. | `components/home/team-boundary.integration.test.tsx` completes a real Team task through actual tRPC |
| M9 voice | Team defaults to Browser speech, offers only Browser, skips host probes/management and refuses host-only saved choices. Unsupported browsers get accurate browser guidance. | `hooks/use-voice-input.test.ts`, member settings API in capability tests, browser settings coverage |
| Personal-only calls | Gate transfer/review/local apps/connected app tabs with a Home capability. Share PR/diff stats/backlinks/referencing chats/pending input. Unbound chat scopes do not poll file trees. | Real boundary integration verifies legacy chat GET without tree polls, loaded workbench tests and browser suites |
| Details and creation | Task/note sheets and task page share EntityDetailHeader and EntityActionsMenu. Existing common status, history, editor, task document, backlinks and referencing-chat controls remain shared. Board/phone/search use one contextual create hook with mine/Area/Decisions defaults. | Team detail/search/phone and task control browser suites, actual boundary integration |
| Navigation and errors | Results agent links select Agents. Home documents and dashboard have an error boundary. Empty agent views create no shared chat until send. | Resource-link/boundary tests, actual read-only catalog GET |
| Released references | Opening retained active work on a released reference does not re-add it deliberately. | Native-access regression with a released reference and existing execution/chat |
| Legacy activity | Report not reproduced. Repeated derived-schema boot and legacy agent binding preserve last_activity_at. No speculative timestamp rewrite. | `team/legacy-order.test.ts` |
| Copy and cleanup | Accurate New/history tooltip, AI-off settings guidance, stale rail variable removed. Server-account warning retained for remote viewers. | Main-chat, settings browser and startup suites |

The contextual Team panel wrappers remain for audience, assignment, revision conflicts and private inclusion controls. They no longer own independent header/menu implementations. There is no second Team transcript, composer, model picker or execution engine.

## Storage, packaging and evidence

- Generated `0021_small_echo.sql` appends `member_preferences.current_main_chats`, a private JSON map. No rebuild, rowid change or destructive backfill. Existing chats remain shared, existing NULL creators remain unknown. Earlier SQL/snapshots 0000-0020 and existing journal entries are unchanged. Populated rehearsals cover personal and Team upgrades from 0018, 0019 and 0020, plus a stable second boot, rowids, FTS, FKs and sealed credentials. No production migration was inspected or applied in this pass.
- Attachment bytes/receipts use asynchronous durable temp-write, sync, rename and directory sync. Runtime path joins have tracing annotations. Binary proxy upload and explicit publication are compared by SHA-256 in `spaces/forward.test.ts`.
- Electron-builder files derive from SHELL_ENTRYPOINTS. Preload inventory covers nested sources, common constants, shorthand, templates and registered preload calls. Desktop tests load shipped `dist/desktop/team-navigation.cjs` and inspect actual web preferences. Production Team smoke exercises the actual main.ts menu and built service/app in isolated desktop fixtures.
- The separate `http-restart.test.ts` process fixture calls instrumentation before writes and persists/reuses its first owner token, member identity, settings and folders. It verifies AI-off and chat permission preferences after another process restart. The native-turn reset is simulated in-process and is not process-restart qualification.
- Root-registry coverage exercises its real path branch with a temporary mocked OS home, beyond the VITEST-specific folder.
- Section 11 of the spec is restored with per-row evidence and qualification limits. The review map and review2 statements are corrected. The testing guide applies explicit browser/Electron opt-ins after `pnpm iso`.

## Verification categories and omissions

The immutable verifier records ordinary production, desktop shell and `.next-desktop` app builds, schema generation/check, typecheck, changed-source lint, full Vitest, explicit Brave suites, shipped-preload Electron, real-main version skew, compiled service upgrades and both production-build desktop Team journeys. Every command uses a disposable Home. Build/schema run before dependent tests. Desktop journeys run separately from other window focus checks.

The old count of 21 environment-gated candidate files versus 20 skipped files was not a missing run: `spaces/forward.test.ts` contains one gated Chromium case while its other cases execute, so the file is counted as passed. Main added another gated browser suite and this revision adds gated real-main version skew. Counts of candidate files, wholly skipped files and individual skipped tests are distinct. The dedicated browser gate now also enables the forward SVG isolation case, and the journey gate enables version skew/service boot. Unrelated artifact-browser and browser-engine E2E opt-ins remain explicitly skipped in the broad suite. Exact totals are in the final manifest/logs.

Fake-provider tests qualify routing, state, permissions and ordinary runner lifecycle. Brave fixtures qualify real UI/CSS against synthetic data adapters. Actual Team boundary tests use authenticated tRPC/SQLite. Source Electron plus production-build desktop smoke qualify those paths, not a signed packaged release, physical input, real provider subscriptions or microphone quality. Shared OS-account/ambient tools, background attribution, personal-relay authority and unregistered historical custom roots remain the accepted limits above.
