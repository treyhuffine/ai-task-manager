# Ninth review corrections

Reviewed source: `57595477`. Work continues on
`refactor/unified-home-experience`, incorporating main `17a58dbb`.
HUD ancestor `acae188a` remains required. No production access, deployment,
push, merge to main or Docker is part of this work.

- [x] Integrate main's model menu and speed controls, preserving shared Home
  authority and both released migration histories.
- [x] Restore four default Team task columns independently of agent activity.
  Verify real board composition and Home/viewer preference isolation.
- [x] Persist Team agent settings despite an unconfirmed subsequent shutdown.
  Interrupt current work, block unsafe reuse, and preserve strict lifecycle paths.
- [x] Compare Linux kernel birth identity before wall-clock start time, for
  harnesses and recorded owners.
- [x] Quarantine readable leftover records to their owning chats, retain global
  refusal for unreadable recovery state, provide process-specific recovery, and
  release the shared record queue before waiting for shutdown.
- [x] Expose Restart for blocked content chats, derive send-error recovery from
  current message state, retain Restart feedback and error clearing, and
  preserve connection decision notes when delivery is blocked.
- [x] Correct review8 evidence descriptions and update W07, W08 and section 11.

These implementation checks have focused behavioral evidence. Final acceptance
separately requires all 13 verifier gates at the final clean committed source,
with `sourceUnchanged` and `allPassed` true in a fresh external manifest.
A prior manifest does not qualify this source. The delivery links the manifest,
exact commit, full and incremental diffs, logs and captures outside the checkout.

## Corrections and evidence

All paths below are relative to the repository root.

| Finding | Correction and regression evidence |
| --- | --- |
| Team Done hidden | `src/components/tasks/task-kanban.tsx` accepts initial columns separately from agent activity. `TaskSurface` supplies the contextual default. `src/components/board/board.browser.test.ts` mounts actual TeamBoard, TaskSurface and TaskKanban, verifies Done and agent links, changes columns, and switches Home/viewer before returning. Personal Board still defaults to three columns. Browser uses a synthetic HTTP/data/context fixture. |
| Team settings save fails | `src/lib/server/operations/workspaces/[id].ts` validates and persists configuration before interrupting work, retaining chat admission through the operation or joining a control already holding it. `stopTeamAiWork` remains strict by default. Only saved configuration permits an unconfirmed close, keeping its handle and send block. `src/lib/team/ai/settings-save.test.ts` exercises actual Team tRPC operations and ordinary fake-provider turns, repeated saves, invalid-folder refusal before persistence, saved folder changes reaching the recovered harness, member-send refusal, failed and successful Restart, running/queued interruption, and overlapping explicit close. Personal and skill regressions remain. |
| Main integration | Main `17a58dbb` is incorporated, including web-link previews, shared model menu and speed controls. Team main-chat, execution and sibling launch policies carry speed. Members pick enabled models/speeds without host catalog/default administration. Browser speed preferences are scoped by Home and viewer. `src/lib/sessions/team-main-chat.test.ts`, `src/lib/executor/speed.test.ts`, `src/lib/executions/provider-speed.test.ts` and the real component suite `src/components/chat-ui/model-menu/model-menu.browser.test.ts` verify these paths with fake provider/data adapters. The existing OpenCode port-isolation patch is preserved via pnpm's patch CLI for agentex 0.0.48. |
| Clock-sensitive identity | Kernel birth proof takes precedence over wall-clock start time. Legacy records retain their conservative fallback. `src/lib/worker/process-lifetime.test.ts` covers the predicate. `src/lib/runner/harness-processes.clock.test.ts` uses real Node processes and ps with injected Linux `/proc` observations, waits until a real process receives TERM, verifies close stays unconfirmed while alive, then confirms only after exit. Identity fixtures retain PID reuse, unreadable birth and unrelated-owner controls. Generic worker command identity remains unchanged. |
| Global orphan outage and queue wait | `HarnessProcessRecoveryError` carries owning chat IDs and actual surviving PIDs/executable names, excluding command arguments. Startup flags only those chats. Malformed/unreadable records and failed process inspection still fail closed. A failed `ps` call is never proof of exit. Known signal failures retain chat-scoped records. Restart rechecks orphan records even without a cached handle. Actual Team operations and a live Node stand-in in `src/lib/team/ai/settings-save.test.ts` prove unrelated work runs, affected work refuses, and exit plus Restart clears recovery. `src/lib/runner/harness-processes.identity.test.ts` checks start/startup record concurrency and accurate descendant diagnostics over fixture records. Shutdown waits run outside the shared queue, retaining concurrent writes and changed snapshots. The existing idle race test now pauses the actual process-snapshot await instead of depending on that removed queue stall. |
| Content-chat recovery and stale Retry | `HarnessChatSession` exposes the same Restart control whenever a chat has an unconfirmed close. The send hook checks shared failed-message status, so a separate successful bubble Retry clears stale observer error state. The contextual Restart stays mounted for transient success feedback. `src/components/chat/harness-chat-recovery.test.tsx` mounts shared controls and real hooks with synthetic transport/composer leaves for task/note/skill sessions, Retry, same-chat error clearing, positive explanation rendering and successful Restart. Unacknowledged failed messages remain available for Retry. |
| Gallery service validation | The standalone smoke exposed a stale fixture: it returned validation errors but did not expose the production form protocol's new message and retained `again` values. The fixture now supplies those values, with catalog assertions and a real Submit/validation/answer/decline browser journey. Production form behavior is unchanged. The shared-conversation example now imports main's model-menu components and the retired, gallery-only `model-picker.tsx` is removed. Browser assertions use accessible controls rather than a tooltip-overwritten data attribute. |
| Dropped connection note | If the asking chat cannot receive a decision notification, the complete note and recovery explanation are persisted visibly as a system event. Restart does not unexpectedly replay work. `src/lib/executor/settings-recycle.integration.test.ts` uses real query operations and runner close flags, verifies the saved response and full note, and refuses duplicate decisions without another event. A separate case uses the real asynchronous delivery helper with a refused dispatch to verify the full note survives a later failure too. |

No replacement Team board, transcript, composer, model picker or runtime is
introduced. The shared/removed component map from `unified-home-review.md`
continues to apply. Genuine differences remain in contextual defaults,
authority, member controls and Home launch policies.

## Migration 0022 and immutable histories

Main includes `0020_aspiring_rocket_raccoon` while the branch already contained
immutable `0020_unified_home_members` and `0021_small_echo`. Branch 0000–0021 SQL,
snapshots and original journal entries remain byte-identical to `b2495707`.
Main's original SQL, snapshot and journal are retained verbatim under
`drizzle/lineages/main-model-speed/` and compared against `17a58dbb` by the verifier.

`pnpm db:generate`, through `pnpm iso`, generated
`0022_ordinary_the_professor.sql` and its snapshot/journal entry. SQL was not
edited by hand. It adds four nullable text columns:

- `chat_sessions.service_tier`
- `harness_settings.default_service_tier`
- `triggers.service_tier`
- `user_state.default_service_tier`

The SQL SHA-256 is
`f2b2436de32a79c60f052be847474de9e5dd8edf9aae9ee55ecd70b36257bf19`,
identical to main's speed migration. It performs no rebuild or backfill.
Existing selections stay NULL unless the person chose a speed.

The safe runner recognizes only main's exact original speed receipt after the
common 0019, with the expected schema columns. It preserves that receipt and
applies missing branch changes, then appends the canonical 0022 receipt without
repeating already-applied ADD COLUMN statements. Fresh and branch Homes run
0022 normally. No existing journal row is rewritten or deleted.

`src/lib/spaces/area-defaults-migration.test.ts` rehearses populated personal
and Team upgrades from 0018, 0019, branch 0020, 0021 and main speed 0020, retaining
content, native history, speed selections, original receipts, rowids, FTS/FKs,
private links and sealed credentials across repeated server boot.
`src/lib/db/model-speed-lineage.test.ts` verifies read-only and migration refusal
for unknown/tampered/duplicate histories and missing columns, plus transactional
rollback and safe retry after a later migration fails. Fixtures use predecessor
DDL with synthetic rows, mostly populated through the current query layer.
No owner-data or historical-query-layer qualification is claimed.

Process birth data and recovery diagnostics remain local JSON/runtime state.
Those corrections require no database schema change. No real Home migration is
applied or inspected by this pass.

Concurrent process snapshots are retained and prevent a successful close
confirmation until the latest recorded descendants are checked. A regression
captures a new descendant during the shutdown wait, verifies that cleanup
refuses confirmation and retains the record, then succeeds on the next check.

## Evidence categories and limits

- Team settings and speed: actual tRPC handlers through the in-process
  Request/Response adapter, ordinary runner, fake provider and disposable Home.
- HTTP/server restart: the existing separate-process Team HTTP journeys run in
  the full verifier, with fake providers. These are distinct from the adapter
  tests above.
- Process identity: real Node stand-ins and ps with injected `/proc`, plus pure
  observations/fixture records. Native `PR_SET_CHILD_SUBREAPER` tests remain
  skipped on this macOS host. No native Linux kernel pass is inferred.
- UI: Brave component/CSS fixtures with synthetic context/data, and mounted
  linkedom controls with real hooks. Model menu browser tests are explicitly
  enabled by the verifier. Source Electron and production-build Team desktop
  journeys remain separate gates.
- Migration: disposable populated SQLite fixtures and safe server boot, never
  production. Both immutable migration histories are enforced by the verifier.

Signed-in provider accounts, signed release packaging and microphone hardware
remain unqualified. Shared Team server OS-account authority remains the accepted
product limit. Earlier remote notification/history-order reports are outside
this correction pass. The reviewer cancellation timeout has no proven ENOSPC
cause. The old 1.90-second diagnostic included setup and was not the individual
case's execution time.


## Gallery smoke follow-up

The initial additional smoke found an outdated service-validation fixture and
an obsolete model-trigger selector. Both are corrected, with production menu
components reused and the retired picker removed. The HTML spinner had a fixture ownership error: it reported no agent, so the
shared file hook correctly refused to load the file. The fixture now binds its
fictional folder to an agent. The smoke scrolls the lazy card into view before
awaiting its bounded thumbnail or intentional full-preview fallback, then still
opens and interacts with the actual HTML document. The production file-scope
check remains intact.

An unmodified detached main `17a58dbb` was also built and exercised with the same
Brave executable and shared installed dependencies. Its full smoke failed
earlier at a disabled question Submit button. This establishes a baseline
failure, not proof that the HTML timeout had the same cause. Logs of these
preliminary runs remain separate from final committed-source qualification.

The corrected full smoke passed all 20 examples, interactive journeys and
light/dark desktop/phone layouts. Final delivery separately records its result
at the committed source alongside the 13-gate manifest.

## Final-suite follow-up

The first complete verifier at `cd344c02` passed twelve gates. Its broad suite
found older tests hardcoding a removed Chromium revision, exact row/selection
assertions missing the new nullable speed field, and a runtime mock missing the
new recovery diagnostic. Browser tests now honor `RI_REVIEW_CHROMIUM` or
Playwright's installed default. Migration tests still compare every old field,
rowid and search result and explicitly require the new column to be NULL.
Model and runtime tests assert the added fields. The scheduled-preparation
clock test now pauses message preparation after main's new initial model
validation, preserving its timeout and no-queued-send assertions.

That run also exposed a real lifecycle ordering issue: archive closed the SDK
before marking the running member turn as stopped, producing a failed turn.
The Home policy now records stop intent before confirmed close without touching
queued work. Successful archive or chat close cancels the active member turn.
Failed process confirmation remains strict, and a late dirty or teardown
refusal keeps queued requests. The early interruption message does not claim
that an execution was archived. `src/lib/sessions/team-lifecycle.test.ts` covers
both actual archive and chat-close procedures with another member's running
and queued work and an unaffected sibling. Existing late-dirty, teardown and
failed-close regression suites retain their assertions.

The failed complete run and focused diagnostics remain historical evidence.
Only a fresh all-green 13-gate manifest at the final clean commit qualifies
delivery.

The next run at `73748774` passed all 7,939 assertions, but correctly failed
the broad gate on two unhandled imports during teardown of
`src/test/regressions/homes-p2-recheck-extra.test.ts`. The Home HTTP fixture
preloaded result operations but omitted their dynamically loaded executor
dependency. It now awaits the executor graph before readiness, matching server
startup and preventing a final worker receipt from beginning that graph during
test-environment teardown. The failed run remains archived and does not qualify
delivery. This follow-up changes only fixture startup and this evidence record.
