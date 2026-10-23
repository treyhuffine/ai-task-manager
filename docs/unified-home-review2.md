# Second review corrections

Reviewed source: `37716e77e3f41335aec2e57e73a692c4c8c16524`. This ledger supersedes earlier completion claims. Main through `d26d8cea` was merged in `a0a3fdd3`, preserving HUD ancestor `acae188a`. Work remains on `refactor/unified-home-experience`. No merge to main, push, deploy, production restart or Docker operation.

## Findings

| Finding | Correction and regression evidence |
| --- | --- |
| C1 | Archive/review hooks use WorkContext. `use-archive-execution.team.test.tsx` and real loaded ExecutionView/AgentView/AgentOverview in `executions/team-render.test.tsx` |
| H1 | Main 0019 preserved, generated 0020 appended. Four populated personal/Team 0018/0019 upgrades in `area-defaults-migration.test.ts`, schema generation and compiled-service boot |
| H2 | Ordinary New/model/resume adds a Team chat. `sessions/team-main-chat.test.ts`, two members with running/queued work |
| H3 | Await close, compare original handle, scope prompts to handle, block after failed close. `ai/stop-collision.test.ts`, delayed and failed close recovery |
| H4 | Phone slots hidden above mobile breakpoint. Actual shell/rail and CSS at 390/1280px in `team-shell.browser.test.ts` |
| M1 | Refuse unsupported explicit Home targets before unknown-key stripping. `spaces/native-access.test.ts`, create_area/rank_task/create_stream_item leave personal data unchanged |
| M2 | Common Home startup recovery. Actual instrumentation in `team/startup.test.ts`, surviving real stand-in process, `ai/http-restart.test.ts` and stale runs |
| M3 | Prompt buttons use server answer/approve capabilities. Typed runtime key and independent permissions in `pending-input-area.test.tsx` |
| M4 | Shared attention/titles, source-Home editor links. `team/capability-conformance.test.ts` and scoped title/navigation helpers |
| M5 | Common lifecycle guard/workstream coordination. `ai/native-turn.test.ts`, complete/Keep then archive/Stop, notice author and current task scope on resume |
| M6 | Named action checks after membership admission, type-aware role guard. REST/tRPC stop independent from editContent, denied sends and nine syntax evasions |
| M7 | Chat file edits and agent-started prompts retain member/sending chat. `ai/native-turn.test.ts`, ordinary file operations and sender labeling |
| M8 | Refresh released references, restore unchanged prepared state on cancel, protect edits/work. `spaces/review-regressions.test.ts`, mounted launcher and abandoned async intent tests |
| M9 | Bounded referenceChanges batches, revision cursors and changed bodies only. `sync-failure.test.ts`, five requests for 21 assignments + 30 added + 15 saved, same-second edits and >500 pagination |
| M10 | Navigation preload shipped, window preload inventory checked. `desktop/package-files.test.ts` and actual Team window/menu/preload Electron CDP test |
| M11 | Per-OS-user root registry plus desktop/default paths. `shared-computer.test.ts`, custom root registered after Team creation, metadata only |

## Low findings

- Conversion excludes interrupted/cancelled requests and their partial replies. Refused sign-in cannot bind a legacy chat. Chat queue tests cover both.
- Standalone task/note routes scope drafts by Home and redirect Team URLs into shared surfaces. Results have WorkContext. New-tab rows and body links retain source Home.
- Permanent shared draft refusals stop retries and release the leave guard while retaining the draft. `document-saves.test.ts` covers 403 and author conflicts.
- Installed skill changes recycle sessions when idle, include idle sessions and preserve accepted turns. Shared skill tests cover this.
- Superseded by review3: guarded cleanup failures leave the Home serving and critical recovery failure makes Team AI unavailable. Sign-in revocation cancels only its own accepted work. Member removal and AI disable retain their scoped cancellation behavior.
- Native errors preserve permanent/nonretryable status. BAD_REQUEST does not mark a healthy connection failed. Destinations never fall back.
- UI/native publication shares regular-file validation and refuses symlinks. Authenticated upload receipts reserve UUIDs before bytes, deduplicate retries/concurrency and reject changed input. Attachment/native tests cover interrupted byte writes.
- Local idempotency_key retains the old ignored behavior. Unsupported remote-only local fields refuse before writing.
- Deck quoting escapes U+0085/U+2028/U+2029. Injection and real DeadlineBand/DeckMoreOptions/DeckTaskBrowser tests cover provenance.
- Runtime and agent name invalidations reach typed keys. File-copy preview/personal destination use typed factories. Native agent tools use team_ai scope.
- Retired worker/rtt admission, auth/token modules, sole-control/admission helpers and fixtures are removed. Skills uses configureAgents.
- Personal task sheet/page share PersonalTaskDocument and planning. Rail width/layout/rows, persistence and shortcut are shared. Search commands/prefixes/recents are shared. Actual Team rail/search browser regressions cover these.
- Embedded voice uploads target the selected Team. Team Voice reuses the common section without host management. Shared-computer detection is owner-only. AI-off sends explain the owner action.
- Owner decision: a connected personal Home counts as its person for Team approvals. HTTP and WebSocket relays refuse callers disclosing a session credential. Server human-only admission remains the prompt boundary.
- Stale docs/settings fixtures were corrected. Old committed captures and manifests were removed because they described earlier source.

## Evidence and limits

Read-only dev journal inspection found 20 entries through main's `0019_groovy_may_parker`. All hashes match main. No production DB was opened. Four migration rehearsals include rowids, FTS/FKs, sealed credentials, private references/ranks/Areas/planning and links.

The HTTP journey now calls ordinary send/interrupt and actual instrumentation. It checks signed-chat refusal specifically at human-only admission and a human success. Compiled CLI/controller tests migrate/restart personal and Team Homes with a readiness-only HTTP fixture. A real Node stand-in tests orphan cleanup. Providers remain fake, without account qualification.

Electron exercises the real Team window, production history-menu helper and navigation preload using CDP keys/mouse and menu callback invocation. It proves no personal bridge or Node access in that fixture. Package inventory catches missing preloads. No signed-release or physical-input claim.

Browser checks use **Brave**, through Playwright's Chromium transport. Components/CSS are real, data/context adapters synthetic. Gallery build/tests are included. The final external manifest names exact committed source and checks staged, unstaged and untracked files before and after. Acceptance requires every gate at exit 0, `sourceUnchanged: true` and `allPassed: true`.

Accepted limits: Team-wide human control, member folders/terminals and the server OS account. Claude/Codex support strict MCP configuration. Cursor/OpenCode/Antigravity may load ambient MCP tools, disclosed by registry capabilities. The registry cannot locate an arbitrary historical custom root before startup/desktop records it. Unacknowledged launcher cleanup may retain a safe reference. Real account entitlement, microphone quality and signed release qualification remain unclaimed.

Public compatibility adapters remain to preserve contracts and URLs, with named capabilities and ordinary lifecycle operations. Internal duplicate execution/auth paths are removed.


Third review corrections, final-source requirements and current limits are recorded in [review3](unified-home-review3.md). New migration 0021 is forward-only and preserves all earlier artifacts. Earlier statements about startup failure, per-member current chat, Files/review parity and voice are superseded there.
