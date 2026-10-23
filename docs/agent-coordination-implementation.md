# Agent coordination implementation and evidence

Source: [final specification](agent-coordination-controls-proposal.md). Updated 2026-10-23.

## Scheduled automation follow-up

Enabling a schedule authorizes communication needed for its assignment. Each trigger-fired chat starts with the existing chat-level Allow automatically preference, including fresh chats in an existing recurring execution. The schedule keeps its existing enabled state. No additional permission table, per-recipient grant or permission column is required. Human Pause incoming and Stop remain independent controls.

- [x] Initialize all trigger-fired chat creation paths with Allow automatically
- [x] Verify one-time, recurring, orchestrator and manual/webhook fires under Ask first defaults
- [x] Report a scheduled run ending with unresolved send approval as an actionable failure
- [x] Complete chat-menu access for embedded chats and clarify scheduling guidance
- [x] Verify focused tests, typecheck, lint and browser behavior and reconcile this follow-up with the specification

For landing on current main, all 207 focused tests across 25 suites pass, including five Chromium schedule-control tests. Seven additional shared-chat boundary checks pass across two suites. The new menu and settings respect the shared transcript capability boundary, and saved agent chats keep their own permission target when opened from history. Runtime tests exercise an actual scheduled one-way send and delegation through Ri's dispatcher, runner, signed calls, durable deliveries, recipient execution and automatic return using the stand-in harness. Default Ask first remains effective for unrelated interactive chats. A later human policy change creates an approval, marks the scheduled run failed and identifies what needs attention. Notification text uses the structured block reason even if the agent's reply claims success, and run lists prefer the failure reason.

Typecheck and production build pass, including local app catalog qualification and static generation. CLI/service builds and the compiled plain-Node boot check pass. Scoped ESLint has no errors. Existing warnings are `isCreateSubtask` and `_revoked` in `queries.ts` and `cn` in the trigger detail page. Five Chromium schedule-control tests pass. The coordination gallery passes all states and interactions on desktop and phone in both themes. Standalone dialog checks pass at 1440 × 900, 500 × 630 and 390 × 844, with screenshots inspected. No production restart, database change or historical replay is part of this follow-up.

## Contextual controls and forwarding layout

- [x] Ordinary idle chats and completed exchanges have no collaboration row above the composer
- [x] Approved unfinished work, one-way deliveries and pending returns show linked participating chats with Pause incoming
- [x] Incoming pause remains visible while idle, with waiting messages and Resume
- [x] Standing preferences and a pause control remain reachable from the execution, agent main and orchestrator chat menus
- [x] Approval cards state that an unapproved message has not been sent, including messages attempted by scheduled runs
- [x] Send to chat stays centered without transforms or horizontal overflow, preserving the nested model picker and dialog focus restoration

Activity uses indexed coordination queries in both directions. It excludes proposals, denied sends and completed history, tracks a one-way input only while its producing run is active, and follows queued returns through their request before destination pinning. No transcript scan or new schema is involved. The historical related-chat query is removed from the polling response.

Verification: 92 focused coordination, query-plan and gallery tests pass across 12 suites. Typecheck, scoped ESLint and diff whitespace checks pass. Browser qualification covers all coordination states on desktop and phone in both themes, approval decisions, idle and finished visibility, pause/resume, permission changes, forwarding, model and effort selection. Standalone dialogs additionally pass at 1440 × 900, 500 × 630 and 390 × 844, including long unbroken chat titles, long agent names, centering, viewport margins, horizontal overflow, model picker wheel scrolling, closing and reopening. Screenshots were inspected. Interactive gallery tests use a fixed chat viewport so the preview's automatic iframe resizing cannot move pointer targets as its simulated log grows. Standalone previews independently verify actual viewport centering, overflow and wheel scrolling. No production restart or database migration occurred.

## Fresh-review corrections

The fresh review was correct about the behavioral defects. Its nine supplied repro cases all failed before the fixes. They now live in the normal repository suites with their assertions retained. The original tests had bypassed important adapter and worker admission paths, so their passing result did not establish criteria 5, 16, 19 and 20 or all human-input batching claims.

- [x] Exact requester authorization and scheduled return routing (F1, F2)
- [x] Assignment-aware human input, reserved input exclusion and remote serialization (F5, F6, F7)
- [x] Retryable dispatch and real worker admission, with bounded retry backoff (F3, F4)
- [x] Permission updates, actual acceptance audits and producer-specific Stop (F8, F9, F10)
- [x] Historical authorship, bounded status reads, source-side forwarding failures and actual builder query plans
- [x] Final full regression result after repairing the test environment and fixtures

| Finding | Correction and regression evidence |
| --- | --- |
| F1 | Delegation never receives the requester exemption. Direct exempt sends pin the exact verified requester. A replacement main chat follows Ask. `review-regressions.test.ts` |
| F2 | One shared address helper excludes scheduled and non-main surfaces from stable main addresses. Scheduled answers return to their originating chat. `review-regressions.test.ts` |
| F3 | Human forwards respect concurrency capability. Busy, budget and known transport failures retain the reservation and back off. A permanent refusal settles only its own send, preserving folded context. Mocked race, real nonconcurrent runner and real budget-gate tests |
| F4 | Ordinary human device sends do not depend on coordination admission. Coordination checks defer network, server and malformed-response failures. Only explicit refusal is terminal. Retry delay grows from one second to thirty seconds. Real worker-handler and local-runner tests include interrupted admission |
| F5 | Composer and forward paths share the same assignment-aware context selector. Unrelated required work stays pending. Unverified producer context cannot import another reserved assignment. `review-runtime.test.ts` |
| F6 | Reserved assignments and pending device commands count as occupied work regardless of an idle device mirror. Existing reservations take precedence even when request timestamps tie. Offline/reconnect tests cover two assignments and an ordinary send followed by an assignment |
| F7 | Complete input batches are reserved before preparation. Human preparation also claims its pending input until acceptance or durable device queuing. A reserved native input is not folded into another send. Admission rejects acceptance by a different run, except a verified owed continuation. Initial requests read during an independent human turn resume with inspection framing. Real local and device tests |
| F8 | Queuing a human device command creates no direction audit. Verified acceptance records it. Local direction is also recorded after acceptance. Offline Stop test and existing device human-steering test |
| F9 | Signed agents cannot change tool permission modes through generic session PATCH. Human changes remain available. `session-permissions.test.ts` |
| F10 | Stop settles the verified producing assignment. Unaccepted reservations survive Stop on another human turn, including their device commands. Held-reservation and real offline/reconnect tests |
| Smaller findings | Incoming status responses return at most 200 recent rows. A failed human forward creates a durable source-side failure card. Historical failures use system provenance through appended migration 0021. Query-plan tests execute the actual query builders |

## Second-review follow-up

- [x] Reject signed agents on policy, Hold, approval and human-forward mutations, including calls carrying the Home's viewer key
- [x] Separate unaccepted coordination reservations from move-held fires, preserving restart identity without taking the scheduled execution gate while queued
- [x] Verify the follow-up with regressions, typechecking, lint and builds

The router uses the existing verified actor resolver on all four human mutations. A regression supplies a real signed chat credential together with the viewer key and confirms that all four operations are forbidden without changing preferences, Hold, delivery state or either transcript. Reads remain available under their existing scope. A genuine viewer can still approve the same delivery.

Coordination reservations start queued with `coordination_wait`, and Hold or transient dispatch failures return them to that reason. Boot keeps the queued reservation and its run identity. It is not a move-held fire and does not take the scheduled execution gate until started. Starting clears the reason. Interrupted local running work is still failed on boot, and terminal runs cannot be requeued. Query-level regressions and the real budget-gate recovery case verify this behavior. Existing move-held scheduled-fire tests remain unchanged and pass. No schema migration is needed.

Keep migrations 0020 and 0021 separate. A check of known local Homes does not establish that a migration has never reached another Home. The migration-history rule requires an appended correction.

Follow-up verification passes: 33 focused tests across the router, waiting-run recovery, fresh-review runtime regressions and unchanged scheduled-fire suites. The complete current run passes **7,373 tests across 826 files**, with 92 opt-in tests skipped across 15 files, exit 0 and no unhandled errors (`pnpm exec vitest run --maxWorkers=2`). `pnpm ts`, `pnpm cli:build` including its plain-Node boot check, and `pnpm exec next build` pass. Production compilation, typechecking and static page generation complete without broad tracing patterns. Scoped ESLint has no errors. Its two unused-variable warnings in `queries.ts` already exist in HEAD. `git diff --check` passes. No production restart or database migration occurred.

## Integration with current main

Main advanced after the reviewed 7,373-test run. Its existing migrations `0020_aspiring_rocket_raccoon.sql` and `0021_polite_spyke.sql`, their journal entries and snapshots are preserved byte for byte. This branch's unshipped coordination migrations are appended as `0022_agent_coordination_controls.sql` and `0023_coordination_system_authorship.sql`, preserving their SQL bytes. Snapshot lineage includes both main's provider speed and usage settings and the coordination schema. Earlier review sections describe the draft's original 0020/0021 numbering.

The launcher and forward dialog share main's unified model, effort, variant and provider speed picker. Explicit new-chat forward choices persist in the frozen launch payload. Delegation retains main's `service_tier` input and retry identity checks. Worker admission deferral and bounded retries compose with main's recycle queue, preserving controls during idle waits. Closing a chat retires its older deferred sends so a retry cannot reopen it. Added integration regressions cover these intersections.

- [x] Verify merged schema, preserved migration prefix and upgrade from current main
- [x] Verify coordination, model settings, worker recycling, admission and control regressions
- [x] Verify typecheck, lint, builds and the forwarding gallery
- [x] Finalize the verified squash result on current main, preserving unrelated local work

`pnpm db:generate` reports no schema changes. A byte comparison preserves every migration SQL file from main and its existing journal entries, along with both 0020/0021 snapshots. The appended coordination SQL is byte-identical to the reviewed draft. A new populated current-main upgrade test preserves speed and usage preferences, migration history, rowids, exact text, search and FK integrity. The older populated-0014 test additionally expects main's nullable `service_tier` column while retaining its complete row-preservation checks.

The repeated read-only production-data rehearsal copies 469 old requests, 101 returned deliveries, 986 referenced events, 1,366 chats, 614 executions, 5,445 runs and five worker commands. All 24 migrations apply to the disposable snapshot. Identities, text and rowids remain intact. Integrity, coordination FK and exact search checks pass. Four old failure notices become system events, changing eligible search rows from 986 to 982. Accepted work is not replayed and no chat is launched. Production is read-only throughout.

Typecheck, CLI build and its plain-Node boot check, production Next build and scoped lint pass. All 16 opt-in model-menu browser tests pass using Playwright's installed Chromium. Coordination gallery interactions pass on desktop and phone in both themes, and updated forwarding screenshots were inspected. The existing move-held tests, fresh-review regressions, worker admission and deferred-command tests remain in the combined test coverage.

The first integrated broad run exposed seven failures beyond the reviewed branch. Three strict runner-boundary assertions caught main's new direct rate-limit-store import reaching the Home's realtime bus. The runner now hands telemetry to an optional sink observer. Only the Home's sink records it and publishes page refreshes. Worker journals omit that observer. A real local runner test verifies persisted limits, one refresh and no transcript telemetry row. All 59 strict boundary assertions pass unchanged. Two route assertions now include main's nullable speed field while preserving exact selections. The preparation-clock regression gates catalog work under an active run rather than blocking main's newly added foreground selection lookup. The permission/recycle test now waits for durable native identity independently of its live prompt snapshot. Its original failure was an expected-null identity racing a correctly resumed native session, not lost work or a failed permission answer. These corrections retain every behavior assertion.

Final integrated verification: all 103 targeted checks across seven suites pass, including the complete 23-case connected-worker suite, all earlier failures and the real local account-telemetry test. The final broad run passes **7,559 tests across 840 files**, with 122 opt-in tests skipped across 18 files. Its sole failure is a 30-second timeout in the unchanged legacy MCP UI browser fixture. That complete four-test suite passes on an immediate isolated rerun in 5.8 seconds. No MCP host implementation, assertion or timeout was changed to obtain that rerun. The first integrated run had passed that suite. This transient browser qualification is recorded instead of claiming a completely green broad run.

Final typecheck, scoped lint, CLI build with plain-Node boot verification and production Next build pass after the runner-boundary correction. There are no broad tracing patterns. Model-menu browser checks (16 tests), desktop/phone coordination gallery checks in both themes and the copied-data migration rehearsal also pass. The source tree incorporates main at `83cd1abe` before its squash delivery. The merge verifies an identical committed tree and preserves main's six unrelated edited files and pre-existing worktree status. No server restart or production migration is part of this delivery.

## Implementation checklist

- [x] Schema, derived types, forward migration, historical identity and payload preservation
- [x] Symmetric delivery operations, request lifecycle, idempotency, deletion and indexed recovery
- [x] Effective permission at all four scopes, durable human approval, child policy initialization
- [x] Verified producing-run attribution, assignment continuation and terminal outcome ownership
- [x] Hold admission, human input batching, orderly release and device acceptance races
- [x] Agent interface, permission ceiling, instructions and inspection receipts
- [x] Human forwarding, recent/search/filter picker, model and effort, exact provenance links
- [x] Permission and Hold controls, approval cards, bounded previews and gallery states
- [x] Migration rehearsals, query plans, lifecycle/runtime tests and UI verification
- [x] Final broad regression result, final typecheck/build reconciliation and documentation review

## Implementation decisions

- The two coordination tables have one implementation and no compatibility exports. Initial delivery IDs reuse the existing source/retry identity namespace. Historical FYI IDs become delivery IDs. The opaque launch hash namespace is unchanged.
- Delivery payloads freeze accepted content, prompts, attachments and presentation context. Request rows carry owed work and its execution binding. Generated terminal outcomes use one identity regardless of outcome kind.
- Human-only typed procedures own standing policy, Hold, approval and forwarding. Generic agent updates do not expose those preferences. Direct signed message and new-chat endpoints cannot bypass coordination authorization.
- Verified local producing-run context, remote signals and ownership-checked heartbeat snapshots preserve the assignment that opened the native turn. A later human input run remains separately recorded. Human direction is annotated only after local or verified device acceptance.
- Hold preserves saved receiving events and reserved runs. A human turn may consume eligible pending context without claiming an assignment. Inputs already reserved for a native send remain with that command instead of being supplied twice. Separate acceptance and continuation pointers preserve owed work. Release wakes the device stream. A command already deferred inside the worker retries within its bounded backoff, at most thirty seconds.
- Deferred worker inputs remain journaled as received, allow control commands through, respect safe-update pause and lose their in-memory retry timers on shutdown. A successor recovers their saved command instead of creating another send. Admission failures back off rather than poll every second indefinitely.
- A manual coordination run stores its frozen input IDs in the existing structured `runs.triggerPayload`. This is dispatch reservation metadata, not another message history or new schema entity. Temporary preparation claims use `processState` and disappear when no native effect has occurred.
- Existing model and effort controls are shared with the forwarding picker. The dialog scrolls on short screens and keeps model popovers usable inside it. Switching to a harness without effort does not inherit another model's effort.
- Proposal cards are recorded when human approval is needed. Automatically authorized sends use compact outgoing receipts. Receipts and control audits never become model input.
- Long forwarded text uses the generic attachment system. Long outcomes explicitly identify paged source retrieval where needed. UI previews do not truncate the durable payload.
- Exact links include chat, message and history identity. A PK lookup shows an old linked message without scanning the transcript. Archived links remain read-only until the user explicitly continues the chat.

## Acceptance-criterion map

| # | Verified behavior and evidence |
| --- | --- |
| 1 | One-way input wakes, creates no obligation and returns no final answer. `coordination.test.ts`, durable symmetric delivery |
| 2 | Required input returns one terminal outcome. Ordinary processing of an answer does not return again. Completion and explicit-reply idempotency tests |
| 3 | Source receipts are system events, do not start a turn and do not create approval cards for automatically authorized sends. One-way and atomic-persistence tests, instruction review |
| 4 | Nested A/B clarification retains its verified parent and completes the correct obligation. Core nested-clarification test and real local runner delegation/consultation test |
| 5 | Distinct required assignments run separately, including offline queues and equal timestamps. Human steering cannot import another assignment. Real local runner, nonconcurrent runner and connected-worker-process tests |
| 6 | Five held messages remain visible, join one human-directed turn and leave Hold enabled. Core Hold tests and real local runner test |
| 7 | A human reads a held initial request without receiving its assignment. Release starts one assigned run and preserves the original accepting pointer. Core and local runner tests |
| 8 | A human reads a held child answer while the parent remains waiting. Release reserves one parent continuation without another ordinary reply. Parent-continuation test |
| 9 | Multiple child outcomes batch into one reservation. A later outcome receives the next continuation. Repeated release and recovery retain reserved identity. Batched-outcome/restart test |
| 10 | Folded human input keeps the producing assignment and annotates its outcome. Real local runner test and real laptop worker test |
| 11 | Unchanged sends, explicit answers and launches reuse delivery, event, run and destination identities. Changed intent conflicts. Core, permission and forwarding runtime tests |
| 12 | Related one-way follow-ups wake after completion without reopening or changing the earlier outcome. Late follow-up test |
| 13 | Stop returns failure instead of partial success. Cancellation fences descendants and late outcomes. A cancelled producing run cannot spawn independent replacement work. Core and startup-fence regression tests |
| 14 | Four-scope precedence includes execution siblings, explicit overrides, all-null ask and displayed provenance. Core policy tests, typed-router test and interactive gallery control |
| 15 | Pending approval is durable. Allow once retains authorization across retries. Always allow covers arbitrary destinations. Denial starts no target work and does not strand an approved parent. Core and gallery tests |
| 16 | Only the exact verified requester is covered. Delegation and replaced main chats require normal approval. Clarification, third-party and fresh-review regression tests |
| 17 | Policy changes govern new sends while approved input remains authorized. Hold continues to gate acceptance. Approval retry and Hold tests |
| 18 | Child initialization respects destination ask and runs once, including recovery between creation and initialization. Later human overrides survive retries. Core and shared-launch permission tests |
| 19 | Ask/plan authority caps omitted or broader modes, including harness changes. Unsupported caps refuse. Ordinary new-chat endpoints reject signed-agent bypasses, and generic session PATCH cannot raise or otherwise change permission modes for agents. `permissions.test.ts`, `session-permissions.test.ts` |
| 20 | Local startup admission, queued remote acceptance, retryable failures and producer-specific Stop preserve reservations. Real worker handlers, offline/reconnect device processes, native interrupt fencing and deferred-command backoff/shutdown tests |
| 21 | Full material, attachments, human authorship and directions survive forwarding. New-chat retries create one destination with selected model/effort. Router, core and real local runner tests, interactive desktop/phone picker |
| 22 | Archived pinned targets never reroute. Deleting an empty target cancels queued work. Soft-event deletion retains payloads, chat deletion clears provenance without replay and referenced runs resist deletion. Core deletion tests and deleted-chat gallery |
| 23 | Indexed query plans, migration rehearsals, typed checks, focused regressions and gallery states pass. Details below |

Main behavior evidence lives in [core coordination tests](../src/lib/coordination/coordination.test.ts), [local runner tests](../src/lib/coordination/runtime.test.ts), [permission tests](../src/lib/coordination/permissions.test.ts), [human-only router tests](../src/lib/coordination/router.test.ts), [remote execution tests](../src/lib/workers/remote-execution.test.ts), [deferred worker tests](../src/lib/worker/commands-deferred.test.ts), [query-plan tests](../src/lib/db/coordination-plans.test.ts) and [migration tests](../src/lib/db/coordination-migration.test.ts).

## Copied-data migration rehearsal

The live Home was opened read-only. Its roughly 19.4 GB database would not fit in available space. An incomplete full backup was stopped and removed. A consistent logical snapshot then copied all coordination data, exact referenced events and the full FK dependency closure. The final snapshot also selected all worker commands referenced by coordination event IDs. There were no such commands in this Home's snapshot. Synthetic tests separately cover queued device commands.

The final 11.6 MB snapshot contained 365 old requests, 78 old returned deliveries, 778 referenced events, 1,360 chats, 610 executions and 5,257 runs, plus their agent, device and preference dependencies. The safe migration runner applied the two pending forward migrations. Result: 78 owed requests and 443 symmetric deliveries.

All initial and returned IDs, retry keys, exact saved receiving text and chat/event/run rowids were preserved. Foreign-key and integrity checks passed. Synthetic migration tests additionally verify FTS rowids, nullable policy defaults, attachment conversion, old FYI parent removal, truthful queued-device acceptance, failed native sends without invented acceptance and orphaned destination failure. `pnpm db:generate` reports no schema changes, confirming that SQL, snapshot and declared schema agree.

No production database writes or server restart occurred. No manual cleanup script is needed.

## Fresh-review migration rehearsal and custom SQL

Before appending 0021, the dev Home was checked read-only: it had 20 applied migrations and had not applied 0020. Existing migration files were nevertheless preserved. The real production Home still has 19 applied migrations and no new coordination tables after verification. Neither Home was migrated by this work.

The new read-only snapshot held 437 old requests, 93 returned deliveries, 912 referenced events, 1,364 chats, 612 executions, 5,377 runs and five worker commands. The safe runner applied the pending forward migrations to the disposable snapshot. It preserved all identities, request keys, exact message content and event/chat/run rowids. Coordination FK checks, full integrity checking and exact FTS eligibility checks pass. Four historical failure events become system/error events, so FTS correctly changes from 912 user/agent rows to 908 eligible rows.

The snapshot included live unfinished work. Startup recovery truthfully failed the interrupted local assignment and produced a new failure outcome. No previously accepted input was replayed and no destination was launched. Suppressed dispatches in this rehearsal are not real model runs. The opt-in rehearsal is now in `coordination-rehearsal.test.ts` and requires an explicit `RI_COORDINATION_REHEARSAL_DB` path. The source is always opened read-only.

**Custom migration SQL is explicit:** 0020 includes the data mapping `INSERT ... SELECT` statements, which a schema generator cannot infer. 0021 was scaffolded with `drizzle-kit generate --custom` and contains corrective data SQL for historical system authorship. It adds no tables or columns. The applied-history rule is respected by appending it instead of editing 0020. This SQL should be reviewed with the migration during the owner-controlled rollout. No manual cleanup script or direct production SQL is required.

## UI and build verification

- The coordination gallery exercises Allow once, Always allow, Deny, Hold release, preference provenance, full-text expansion, recent/search/filter selection, existing/new destinations, model switching and supported effort selection.
- All coordination states, including system-authored unavailable work, render at desktop 1440 and phone 390 widths in light and dark themes. Forwarding interactions run at both widths. Screenshots were inspected, including the short-screen dialog.
- Existing inter-chat message gallery checks pass, including source/destination links, original-request disclosure, deleted sources, long titles and exact event/history URLs.
- Browser checks report no exceptions, missing fixtures or real API access.
- `pnpm ts`, `pnpm cli:build` and the gallery build pass. Compiled CLI boot resolves under plain Node. Scoped ESLint for the fresh-review changes reports zero errors and zero warnings.
- Disk space became sufficient during this review. `pnpm build` passes, including the app kit, gallery, compatible local-app catalog and Next production build. A subsequent Next build also passes after the final admission edits. Production was not started for verification.
- The new source-side forwarding failure state passes the same desktop/phone and light/dark checks. Its screenshot was inspected.
- These gallery and scripted-harness checks do not establish behavior of installed Claude, Codex, Cursor or OpenCode models on physical connected devices. That remains a rollout verification boundary.

## Regression verification

The pre-review broad result was 7,345 passing tests across 819 files. That result did not cover the defects above and is retained only as historical evidence.

Fresh-review focused checks now include the original nine repro cases, a real budget block, a real nonconcurrent runner, real worker admission under outages and malformed replies, native interrupt fencing, offline input deduplication, Stop of a held reservation, actual-acceptance direction audits, historical system authorship and the real query builders. The copied-data rehearsal passes with explicit integrity, FTS and no-replay assertions.

Broad verification found missing Chromium and five pre-existing browser fixtures pinned to a removed browser revision. The test browser was installed, and those fixtures now use Playwright’s installed executable without changing their assertions. Existing selection-route unit tests now explicitly model a human caller, while the new permission regression uses real signed credentials. Disposable-home teardown retries transient directory removal races from background writes. All 23 checks in those four affected suites pass. That review's clean run passed **7,370 tests across 825 files**, with 92 opt-in tests skipped across 15 files and no unhandled errors (`pnpm exec vitest run --maxWorkers=2`). Typecheck, production and CLI builds, scoped lint, gallery interactions and the read-only migration rehearsal also pass. Scoped lint on those review changes reports no errors or warnings. The second-review follow-up above records the current 7,373-test result.

Reproduction:

```sh
pnpm test --maxWorkers=2
pnpm exec vitest run src/lib/coordination src/lib/db/coordination-migration.test.ts src/lib/db/coordination-plans.test.ts src/lib/worker/admission.test.ts src/lib/worker/commands-deferred.test.ts src/lib/workers/coordination-admission.test.ts src/lib/workers/remote-execution.test.ts
# Optional copied-data rehearsal, source opened read-only
RI_COORDINATION_REHEARSAL_DB=/absolute/path/to/data.db pnpm exec vitest run src/lib/db/coordination-rehearsal.test.ts
pnpm ts
pnpm cli:build
pnpm exec tsx scripts/chat-ui-gallery-browser-smoke.ts --example=coordination
pnpm exec tsx scripts/chat-ui-gallery-browser-smoke.ts --example=chat-messages --skip-build
```

The original specification was re-read after the review fixes. The table above records evidence by criterion and distinguishes scripted harness/device-process tests from installed live harnesses. No production deployment or physical-device model verification is claimed.

## Rollout

After merging and deploying the source, use the normal owner-controlled Home restart to apply `0022_agent_coordination_controls.sql` and `0023_coordination_system_authorship.sql` and load the new code. Existing applied migrations were not rewritten. Refresh long-lived harness chats where needed for the new tool contract.

Update connected workers with the Home. Both peers must advertise `coordination.admission.v1`, enforced by the existing compatibility handshake. Worker protocol 4 and journal format 1 remain unchanged. An older peer is directed to update instead of accepting unguarded work.
