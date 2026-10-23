# Unified Home verification

Current corrections: [tenth review ledger](unified-home-review10.md), superseding the [eighth review](unified-home-review8.md), superseding the [seventh review](unified-home-review7.md), superseding the [sixth review](unified-home-review6.md), the [fifth review](unified-home-review5.md), the [fourth review](unified-home-review4.md), the [third review](unified-home-review3.md) and [second review](unified-home-review2.md). Shared/removed code and migrations: [review map](unified-home-review.md). Owner decisions: [unified-home-revisions.md](unified-home-revisions.md). Earlier completion claims are superseded by this ledger and the generated immutable-source manifest.

The branch starts at `fix/team-mcp-clarity` (`d40987bd`), incorporates main through `9528aabd` and preserves HUD ancestor `acae188a`. Main's new personal messaging/coordination remains integrated with the shared transcript and Team's existing contextual launch contract. The retired container implementation remains on local `archive/team-isolated-worker` at `a5697a25`. No push, merge to main, deploy, production restart or Docker operation.

## Per-requirement regression map

| Package | Evidence |
| --- | --- |
| W00 baseline/data | `spaces/unified-acceptance.test.ts`, populated personal/Team fixtures |
| W01 authority | HomeContext/boundary/draft tests, named capability conformance and type-aware role guard |
| W02 shared UI | Loaded Team ExecutionView/AgentView/AgentOverview, common task document/page/sheet, shared shell/rail/search/phone controls |
| W03 sync/actions | Sync failure, native-access/review regressions, bounded batches, offline/reconnect/revoke and same-second changes |
| W04 priority/source | Deck generation/Unicode injection, actual DeadlineBand/DeckMoreOptions/DeckTaskBrowser in `deck/team-sources.test.tsx`, same-name labels/private organization |
| W05 private Areas | Area-default tests, settings browser, migration and privacy canaries |
| W06 native access | Actual tools/call through all five MCP routes, real CLI flags/aliases, native-access separate Team process, unsupported targets and explicit publishing |
| W07 ordinary runtime | Execution authority/files/terminals, all five fake harnesses, common instrumentation recovery, failed-recovery child process and real descendant/timeout cleanup, dead unrecorded roots, clock-step birth identity and live-root refusal, chat-specific orphan quarantine/recovery, and record-queue concurrency |
| W08 chats | Private New/model/resume with no GET adoption, real AgentView/tool-tab/New hook URL pinning and reload, viewed-chat permission inheritance, legacy live Plan return, actual HTTP/WS disclosed identity, shared background stop/restart/AI-off, dirty/archive/start races, common results/reviewer/skill operations, saved Team settings despite failed shutdown with member interruption, content-chat Restart, Retry and success feedback, durable blocked connection decision notes, and merged main model/speed controls |
| W09 optional AI | Fresh AI-off settings, ordinary harness settings, per-member Voice, root registry, owner/member controls |
| W10 migration | Main 0000–0023 unchanged, one CLI-generated 0024, independent byte-identical regeneration and no alternate lineage. Ten predecessor-DDL upgrades with synthetic current-query-layer rows, compiled CLI/controller migration/restart, FTS/rowids/FKs, legacy conversion and private links |
| W11 acceptance | Full Vitest/gallery, actual CLI repair and alias paths, mounted cache/receipt/link controls, types, changed-source lint against current main, production/desktop builds, schema generation, touched browser suites and actual source Electron |

Decision 8 privacy: synchronization does not transmit private notes/chat text, rank, planning or Area rules (`spaces/review-regressions.test.ts`). Native reads do not import or expose personal records. Team proxy/member/client/session tests enforce Home/member authority and human-only approval. App permissions do not isolate the accepted OS account.

## Final source and results

After committing all source and docs:

```sh
RI_REVIEW_MAIN_REPO=/private/tmp/ri-review10-main-9528aabd \
RI_REVIEW_CHROMIUM='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' \
  python3 scripts/verify-unified-home.py /private/tmp/ri-unified-review10-final
```

Use a new destination on rerun. The script refuses dirty source, including staged and untracked files, and refuses overwriting evidence. It records HEAD and command in every log/manifest and checks ancestry. Builds/schema finish before tests because SDK builds replace generated assets used by app tests. Browser, Electron, production desktop journeys and the broad suite run separately so their windows cannot steal focus from each other. Every execution gate uses its own disposable Home/port via `pnpm iso`. Install frozen-lockfile dependencies first.

The final delivery links the generated manifest and reports exact source/counts. Acceptance requires every gate at exit 0, `sourceUnchanged: true` and `allPassed: true`. External evidence names the exact delivered commit, including documentation, without modifying that source. The verifier refuses changes to main 0000–0023 SQL/snapshots or journal entries at 9528aabd and requires exactly one new migration, 0024_breezy_rawhide_kid. It runs production-build standalone and personal desktop Team journeys after the other window tests. Status with `--untracked-files=all`, unstaged and staged diff checks run before/after. Lint includes every extant source changed from main `9528aabd`, including inherited starting-branch changes.

The previous final run was at `37716e77`, not `9ccecf2c`. Its weaker clean check missed staged/untracked files. The old lint baseline was 18 existing errors, not 17. Current main includes upstream fixes and changed-source lint now requires zero errors. Old committed captures/per-run artifacts were removed. Fresh screenshots and Electron metadata accompany the final manifest/archive.

The only real Home inspection was the explicitly read-only dev migration journal: 20 entries through main's `0019_groovy_may_parker`. No production database was opened or real Home migrated.

## Evidence categories and limits

- HTTP: actual instrumentation/proxy/routes in another Home process, ordinary send/interrupt, two members, signed-agent refusal/human approval, stop/restarts, native ID/authorship and stale runs. Fake provider.
- MCP/CLI/WebSocket: in-process tools/call handlers and separate HTTP Team listeners, subprocess signed-session CLI/repair/update, and a real Team WebSocket/appRouter exercise raw inputs and disclosed identity. Personal native flag registration tests remain in-process and are not CLI subprocess proof. No live provider is inferred from these transport tests.
- Compiled service: real CLI/controller migration/restarts, readiness-only HTTP fixture, no full Next/provider qualification.
- Runner: ordinary engine with scriptable fake providers for every registered harness. Orphan cleanup also uses real Node stand-ins. No real account/entitlement claim.
- Migration: genuine predecessor DDL, synthetic fixture rows mostly written through the current query layer, then actual safe server boot. This qualifies fixture preservation, not owner-data or historical-query-layer seeding. Compiled service migration/restart is an additional distinct path.
- Browser: Brave via Playwright's Chromium transport, real components/CSS, synthetic data/context adapters. Phone/desktop, drafts/search/rail/source labels/editors/settings and 40px Mac sheet clearance.
- Electron: actual Team window/menu helper/preload bundled from source, CDP keys/mouse/menu callback, package inventory. No signed-release/physical-input claim.
- Gallery: ordinary gallery build and gallery component/architecture tests in the broad suite.
- Voice: member preferences/fake-provider routes. Microphone hardware and recognition quality unqualified.

Shared OS-account and ambient MCP access on Cursor/OpenCode/Antigravity remain accepted limits. File activity covers app-mediated edits and terminal creation. Discovery covers registered/desktop-recorded/default roots, not an arbitrary unregistered historical custom root. Unacknowledged launcher cleanup can retain a safe reference and never deletes intervening edits/work.


The real-main skew gate uses a detached `9528aabd` checkout with its own installed dependency links, starts an isolated Team process and attempts new-protocol operations. Every Team fixture fakes provider discovery. Both compiled service and production-build desktop smoke are separate from fake-provider API proof. See review7 for current per-finding regressions, investigated races and limits, and review3 for the non-reproduced legacy activity report and skipped-suite accounting. The final response links the immutable manifest and source diffs. Review4 adds the production Team Chat destination to the explicit Brave gate and failed-recovery instrumentation to the journey gate. Preliminary runs and earlier manifests do not qualify this source.

Review5 adds actual AgentView tool-tab and New/model composition to the explicit Brave gate. Missing-chat Retry retains the Home sidebar. Scope tests include a private-history positive control, reload changes the saved pointer, preview restore includes a shared positive control, WebSocket inheritance uses non-default Auto edits, and archive/Resume overlaps a held real procedure. Remote queued-stop tests use real tRPC with worker-command fixtures. The review5 ledger records focused evidence, while only the external final manifest qualifies the complete source.

Review6 adds actual agentex 0.0.47 Cursor/Antigravity shutdown with controlled Node CLIs, personal New/Restart/Close, one-close retry joins, teardown-script refusal with preserved queues, paused/offline and cached-refresh mounted UI, signed Team CLI positive/negative subprocess controls, real MCP/HTTP alias parity and stronger remote labels/sibling-stop assertions. Doctor/update execute against a populated Team fixture and a read-only service-controller fixture, not just --help. Personal close now requires confirmation, a deliberate behavior change from main, with SDK headroom and a main-chat Restart control. The accepted OS account still permits credential impersonation when identity is omitted. A disclosed sender is retained in Team messages. This revision adds no migration.


Review7 closes the idle-send and native launch-alias regressions and the confirmed
consistency findings. It adds actual SDK recycle/archive and Cursor exec-launcher
process trees, real parent-crash orphan cleanup, lost-handle and SIGKILL/reap
controls, native MCP Plan/task/provider checks, JSON-only signed CLI calls,
action-route sender attribution, failed-first-send launch intent, mounted
personal/Team read recovery and a slow actual HTTP relay fixture. Contextual
Restart chat is absent on healthy idle and first-run screens. No migration is
added. The [review7 ledger](unified-home-review7.md) names exact tests and limits.
The earlier Electron focus failure has no proven concurrency cause, as corrected
in the review6 ledger. Final evidence is produced only after committing these
corrections and documentation.

The initial review7 run at `3ad664cc` is retained separately. Its broad suite
found incomplete test mocks, an obsolete discard-on-failed-recycle expectation
and a live-prompt/journal-persistence race in the remote-device test. The review7
ledger names each correction. The subsequent final manifest must cover the
follow-up committed source with all 14 gates, without reusing a prior pass.


Review8 merges main's Agent Activity/Tasks Board and adds its real browser suite
to the explicit window gate. Team Tasks retains the common inline board with
scoped filters/preferences. Successful settings/skill saves expose failed-close
recovery through runtime. Restart state follows the actual chat and failed
pinned New/History Resume refresh runtime. Kernel birth fingerprints recognize
Linux subreaper adoption, and ambiguous legacy records retain worktrees. The
native Linux kernel probes are skipped on this macOS host, while identity and
cleanup fixtures run. No new migration or production inspection occurs. See
[review8](unified-home-review8.md) for exact tests and limits. All 14 gates must
qualify the new committed source independently of review7 evidence.


At `6087547a`, an initial attempt hit host disk exhaustion. A complete subsequent
run passed twelve gates but its broad suite found a missing query-key factory in
the old History test mock and a five-second reviewer cancellation test timeout.
The [review8 ledger](unified-home-review8.md#final-verification-follow-up) records
the corrections and diagnostic limit. Final qualification requires all thirteen
gates rerun at the follow-up commit. Both earlier attempts remain external
historical evidence and do not qualify delivery.


Review9 integrates main `9528aabd` and its model/speed controls, updates the
OpenCode port-isolation patch to agentex 0.0.48, and restores Team Done defaults
without disabling agent activity. Real TeamBoard composition verifies column
preferences across Homes and viewers. The explicit Brave gate now also enables
the model-menu suite, including member selection without catalog administration.

Settings and recovery evidence includes actual Team tRPC operations, ordinary
fake-provider turns, owner interruption of current and queued work, real Node
leftovers, injected `/proc` birth observations, queue-concurrency controls and
mounted hooks/components. A blocked connection decision is recorded visibly
rather than silently dropped or automatically replayed after Restart. The
review9 ledger names every regression and its evidence category.

Review10 supersedes the old branch-lineage workaround after explicit owner authorization. Main 0000–0023 artifacts remain unchanged, 0024 is entirely CLI-generated, and the runner contains no model-speed lineage exception. The fresh verifier explicitly enables markdown-link, model-menu and usage browser suites and includes all coordination gallery interactions. Decision recovery reuses main's input reservation and acceptance operations. See the tenth review ledger for the current per-item map.

The tenth pass pins the patched agentex dependency for the duration of every
gate and refuses a baseline that shares node_modules links. Native harness
commands are disabled by default in the test sandbox. Only explicit controlled
stand-ins may execute. See the review10 ledger for the invalidated preliminary
run and the correction to test isolation.
