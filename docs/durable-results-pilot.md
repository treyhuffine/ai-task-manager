# Historical durable result handoffs and review pilot

This records the original reversible pilot and its actual verification and trial findings. The subsequently authorized personal expansion is documented in [Durable results: personal integration](durable-results-personal.md). The original claims below apply to the pilot boundary and do not claim to verify that expansion.

Current naming note: internal storage now uses `work_results`, `work_result_tasks`, `work_result_decisions`, and `work_result_ai_reviews`, with matching `workResults`, `workResultTasks`, `workResultDecisions`, and `workResultAiReviews` Drizzle exports and schema-derived `WorkResult*` types. The old `result_reviews` name now reads `work_result_decisions` because it records human, agent, or system dispositions rather than independent AI reviews. The forward `drizzle/0006_work_result_names.sql` migration preserves data, rowids, and foreign keys, and leaves applied migrations `0002` through `0005` unchanged. The integration map below uses current module paths. Public result actions and `/results` and `/api/results` paths are unchanged. The original trial evidence and counts below remain historical, and do not verify this naming migration.

The implemented boundary follows [the Ri task specification](durable-results-spec.md). Results are immutable saved handoffs with exact task associations, durable attachment ownership, attributed human dispositions, and optional manual independent review. The pilot is opt-in. It adds no task lifecycle dependency, automatic review, primary navigation, team publication, or persisted reviewer preference.

Enable **Durable handoffs** in Settings, General. Enable **Manual AI review** separately if wanted. Both machine-local configuration fields default off, and effective review availability is `handoffsEnabled && aiReviewEnabled`. A handoff is useful without AI review.

In an existing conversation, **Save as handoff** preserves the selected answer and its gallery without synthesis. **Prepare handoff** continues the producing session through an explicitly recorded durable request. **Update handoff** asks that session for a meaningful successor to the exact snapshot. The prior snapshot, files, task membership, decisions, and reviews stay readable at `/results/:id`.

**Accept** and **Dismiss** record attributed dispositions. **Request changes** and **Address findings** save contextual feedback for the exact result, including selected inspection context and normal composer uploads. Delivery uses the recorded producing conversation. A missing or unavailable destination keeps the feedback and explains the limitation. Proven not-started delivery can be retried explicitly. An interrupted admitted send stays uncertain and is never blindly resent.

**Review with AI** accepts optional focus and per-request harness, model, and effort. The picker uses ordinary available defaults without changing global settings or the authoring session. A dedicated fresh session receives the original request, linked task criteria, exact handoff, retained files, relevant project instructions, and a shared review method. It inspects read-only, records requested versus observed scope and settings, and can legitimately find no actionable issues. Reports never accept, fix, merge, publish, or complete work. Review details expose available activity, permissions, limits, cancellation, and terminal outcomes.

## Integration map

| Boundary | Files and purpose |
| --- | --- |
| Storage | Four tables in `src/lib/db/schema.ts`, derived types in `src/db/types.ts`. Historical migrations `0002` through `0004` established the pilot storage, and forward migration `0006_work_result_names.sql` supplies the current names. Feature queries in `src/lib/work-results/queries.ts`, exported through the ordinary `queries.ts` facade. Feedback owns its uploaded files and selected inspection context even with no destination. See [storage and admission evidence](durable-results-storage.md). |
| Gates | `src/lib/work-results/capabilities.ts`, existing machine config, `/api/results/capabilities`, and settings switches. Disabled queued operations become terminal immediately. |
| Agent surface | `src/lib/orchestrator/result-actions.ts`, registry registration, dynamic general/narrow MCP discovery, and `src/lib/work-results/instructions.ts`. Stable names are `report_result`, `get_result`, `list_results`, `request_result_review`, and `report_result_review`. Stale calls retain guarded replay/error semantics. |
| Server writes | `/api/results` and reporting, decision, preparation, review, activity, cancellation and preview routes use queries and runtime services. CLI report actions forward signed intent to the running server for persistence and realtime events. They do not open the local DB or acquire a writer lease from a read-only reviewer. |
| Files | Existing multipart attachment upload and authenticated serving. `ri attachment upload <path>` uploads selected local bytes and returns the ordinary record. Screenshot-mode `browser_read` returns a durable uploaded record only when handoffs are enabled. The public browser's private-network restriction remains in force. |
| Runtime | `src/lib/work-results/runtime.ts` and `src/lib/db/work-result-runtime-queries.ts` use existing sessions, chat events, and runs with tagged operation metadata. The executor owns final admission, sends, and provider completion. Boot recovery runs before ordinary session recovery. Scheduler and health hooks preserve terminal feature outcomes without blind redispatch. |
| Reviewer isolation | Dedicated `result_review` sessions are filtered from normal chat/execution/primary-output queries. The existing rail and mobile attention surfaces expose unresolved reviewer operations. Dedicated sessions cannot perform ordinary orchestrator mutations, change permissions/settings, receive ordinary messages, or escape plan mode. |
| UI | `src/components/results`, `src/hooks/use-results.ts`, exact result page, and existing conversation event renderer. Model-list `selectionOnly` mode performs no preference writes. The session stream refreshes app-owned operation status instead of dropping updated deterministic IDs. |
| Retention | Existing attachment GC calls `getAllWorkResultAttachmentFileNames`, including snapshot galleries, feedback uploads, review scope evidence, and prepared runtime payloads. It remains active with both gates off. |
| Review method | `skills/result-review/SKILL.md` and explicit runtime method delivery. Project concerns come from existing instructions, rather than a second project policy system. |

No native independent-review API is advertised by the installed adapter. Ri uses the supported fresh-session fallback and retains that limitation. A requested effort is not claimed as applied unless provider evidence proves it. Dirty or untracked working-copy evidence has no exact checkpoint, so a completed inspection does not become proof of current exact-revision freshness. Live previews and URLs also remain qualified separately from captured files.

For adapters with MCP support, the assigned reviewer calls `report_result_review`. The installed Codex adapter has no MCP attachment and its read-only sandbox blocks local CLI networking. For those adapters, the original brief explicitly assigns one strict `ri_result_review_report: "v1"` JSON completion envelope with the exact request and review identities and the report body. The existing server-owned executor submits that exact envelope through the same query creator and trusted observations. Extra text, mismatched identities, missing content, and late cancelled reports cannot complete an assignment. This transport applies only to a dedicated reviewer turn, and never classifies ordinary answers into results.

## Operational rollback and deliberate removal

Turn off both switches in the current application version. New handoffs, preparation, updates, decisions, and reviews stop. A queued feature operation is cancelled and cannot resume when the switches return. Ordinary authoring work and previously sent human feedback continue. An already admitted preparation or reviewer can finish only its exact server-recorded assignment, and permission handling and Cancel remain accessible. Saved exact URLs, inline cards, reports, dispositions, and files remain readable after restart.

Actual removal requires a separate bounded cleanup. First stop new dispatch and finish or cancel dedicated contexts. Keep read/render/retention support while preserving saved work. Use the existing consistent SQLite backup facility for the database and preserve the referenced attachment files separately. The normal markdown mirror and `ri snapshot` do not by themselves export result files. For a human-readable export, read authorized result pages or `list_results` and `get_result`, including reports and decisions, and copy each referenced file through the authenticated attachment API. Verify record and file counts before removing ownership roots.

Then remove the named instruction/tool/runtime/settings/UI integrations together, retire dedicated contexts, and handle old `work_result` references by preserving their reader or migrating them into supported ordinary content. Keep an authorized usable export or migrated content before removing remaining readers and attachment ownership. Do not drop the feature tables, undo migrations, or delete referenced files as a consequence of disabling the experiment. Destructive cleanup requires a separate explicit decision.

## Verification and isolated trial

Automated storage, transport, runtime, capability, presentation, migration, and attachment tests covered retries, changed intent, exact supersession, assigned completion, source pruning, gallery-only retention, scope drift, missing reports, feedback delivery, queued/running disable, cancellation, recovery, and isolation from task lifecycle. The recorded full repository suite, typecheck, production build, lint, and real-browser checks below apply to the original pilot before the internal naming migration.

Historical pilot verification on October 7, 2026:

- `pnpm test`: 302 passing files and 2 skipped files, 2,842 passing tests and 26 skipped tests.
- `pnpm ts`, `pnpm cli:build`, and `pnpm build`: passed. The production build used the isolated pilot home. It retained one nonblocking Turbopack tracing warning in the unchanged `src/lib/service/environment.ts` dynamic Node-version path discovery.
- `pnpm test:browser`: 21 passing real-browser tests. Desktop/mobile feature inspection is recorded separately below.
- Focused feature ESLint and `git diff --check`: passed. Repository-wide lint still reports 121 errors and 112 warnings. Comparison against the original commit finds no added or removed semantic diagnostics, normalizing absolute paths and rendered line positions.

The trial's preview and isolated app server were stopped after verification. The isolated database, retained uploads, and generated code were preserved in the temporary trial home, with both feature switches off. The real Ri data home was not migrated for the trial.

The trial uses a temporary Ri home, temporary Git repository, and private local preview. It does not migrate or change the real Ri data home or deploy this work. Claude builds an accessible single-file cost calculator. Codex writes a taskless offline budget-log memo. Both receive the actual enabled guidance and callable reporting path. The memo is saved verbatim through the human Save path after a natural omission. The code handoff includes two uploaded screenshots and qualifies the local-only preview.

### Real-harness findings

The isolated trial used the installed Claude and Codex harnesses, rather than mocked completions. Claude naturally reported its calculator after the substantive implementation. Its first screenshot attempt exposed an upload gap, so the pilot gained the generic attachment upload command. Two captured screenshots then became ordinary retained attachment records. Removing the original temporary screenshot folder did not remove the gallery. The private preview worked through the existing preview service. The review correctly qualified its sandbox's inability to reach that live preview.

Codex naturally wrote a useful budget-log memo but omitted the requested handoff action. Save as handoff preserved its exact answer without synthesis, and repeating Save returned the same snapshot. Explicit Update then exercised the same `report_result` path without an execution or task. An ordinary arithmetic question produced only an answer and no result. These observations demonstrate a real omission and successful recovery. They do not establish an omission rate or sustained human adoption.

A fresh Claude review of the memo took approximately 4 minutes 18 seconds, including two permission waits. It found no actionable defects and offered four optional improvements. The human feedback path sent two selected clarifications and a normal composer file to the original memo conversation. Replaying the disposition preserved one message and run. The author revised the memo, and disabled gates honestly prevented an unrelated new report.

The first fresh Codex code review inspected the calculator and retained screenshots and identified a modifier-key defect, but could not submit its CLI report from the read-only sandbox. The operation retained a visible `missing_report` failure. After implementing the strict assigned host completion envelope, a deliberate new Codex review saved its report in approximately 1 minute 26 seconds. It identified one actionable issue: intercepting `-` and `e` also swallowed modified shortcuts. The report distinguished requested settings from unknown observed settings, a dirty untracked file from an exact revision, and captured screenshots from unverified live preview behavior.

Address findings delivered one contextual message to the original code author despite concurrent request retries. The author fixed the handler and checked modified-key cancellation and negative-value validation in a real headless browser page using synthetic events. This does not prove actual browser zoom or screen-reader behavior. The author reported that limitation and saved an exact successor. Desktop and mobile inspection confirmed that the old snapshot retained its report and feedback, the successor linked its predecessor, and the successor inherited neither acceptance nor an AI review. The visible interface was unchanged, so the author reused the original screenshots with their original-capture qualification rather than claiming fresh captures.

Desktop at 1280 pixels and mobile at 390 pixels exercised exact snapshots, files, preview links, the reviewer picker, optional focus, feedback uploads, review activity, permissions, Cancel and existing attention links. Producing-conversation return links had the correct destination and remained visible. Mobile return navigation was not directly clicked in the trial. Both switches were turned off and the isolated app restarted. Saved content, gallery files, reports, decisions, old cards, and failed-review attention remained available. Reviewer contexts stayed out of ordinary conversation lists. There were no observed page errors or document overflow. Picker selections left ordinary settings and the authoring session unchanged.

The actionable code finding justified its focused repair. The memo review's suggestions were useful clarifications, although they required an extra authoring turn. Report packaging required one screenshot-upload recovery and one explicit memo Update. Subscription harnesses exposed no attributable dollar cost in this trial, so cost is unknown. The timings above include different permission and setup conditions and are not a comparative performance benchmark. This is an agent-driven functional trial, with no claim of long-term human usefulness or natural adoption. Automatic review, persistent reviewer defaults, broader navigation, task completion, and team publication remain separate decisions.

### Pilot acceptance reconciliation

Every row corresponds, in order, to one of the 42 pilot acceptance criteria in the original task. “Tests” means executable verification in the named feature suite, rather than an assertion that the real trial exercised every failure mode.

| # | Requirement | Evidence and qualifications |
| --- | --- | --- |
| 1 | Real code handoff with screenshot and preview | Claude calculator, two durable screenshots, existing private local preview, explicit reviewer reachability limitation. |
| 2 | Non-code reporting without task or execution | Codex memo, exact human Save recovery, then explicit Update through the same reporting action. |
| 3 | Ordinary messages do not create results | Real arithmetic answer and observed progress/confirmations, plus capability and presentation tests. No automatic answer classifier. |
| 4 | Actual guidance and second-harness portability | Enabled instructions and actual reporting paths exercised with Claude and Codex. Natural Codex omission and read-only completion failure recorded above. |
| 5 | Concurrent idempotent reporting and conflicts | Real concurrent feedback retry plus storage/action tests for one snapshot, event, gallery, task links, and changed intent. |
| 6 | Exact multi-task membership | Storage tests change execution associations after save, preserving explicit stored membership. |
| 7 | Independent snapshots and one successor | Storage transaction/index tests and real code successor with unchanged historical content and reviews. |
| 8 | Readable after source/file removal | Real original screenshot-folder deletion, and SQLite tests for chat pruning, restart, retained content and files. |
| 9 | Gallery-only ownership | Real screenshot galleries plus storage access, restart, source-pruning and GC tests. |
| 10 | One contextual feedback delivery and honest recovery | Both real author conversations, concurrent code retry, persisted files/context, runtime tests for offline, interruption, Stop and safe deliberate retry. |
| 11 | No inherited acceptance or task lifecycle effects | Real unreviewed successor plus storage/runtime tests for unchanged tasks and no inherited dispositions. |
| 12 | Actor, link and file authority | Signed reporting and assigned-completion tests reject identity claims, cross-owner links, paths, symlinks and nonuploaded manifests. |
| 13 | Private authority stays private | Current branch has one local personal owner. The pilot adds no team publication, shared runtime or new membership authority. |
| 14 | Legacy review compatibility | Legacy tables, action and endpoints remain. Dedicated reviewers are excluded from legacy output obligations, with regression tests. |
| 15 | Desktop/mobile inspection and return | Real 1280/390 inspection, retained artifacts, preview, reply and producing-conversation links, with zero observed page errors/overflow. |
| 16 | Task-linked and taskless manual review | Runtime/storage fixtures include linked criteria and taskless work. Real memo and code review used existing defaults, optional focus and the ordinary picker. |
| 17 | Real fresh fallback and supported native boundary | Real Claude and Codex fresh inspections and saved reports. Installed adapter advertises no native review API, so no unsupported native command was attempted. |
| 18 | Original brief, actual work and honest no-findings | Brief/task/project-instruction fixtures, actual code/file inspection, and real memo report with no actionable issues. Brief selection is bounded to the producing request. |
| 19 | Review retries, intent conflicts and focus | Runtime/storage tests cover concurrent identical requests, changed focus/settings conflicts and deliberate reruns. |
| 20 | Compatible evidence and provenance | Compatibility tests include actual scope and explicit reviewer choice. Imported native claims stay reported. Actual native reuse is unavailable on the installed adapter. |
| 21 | No recursive review | Assigned reviewer/action tests reject primary reporting and further review. Report snapshots are excluded from primary lists and review obligations. |
| 22 | Visible terminal failure and recovery | Real missing-report attempt, permissions and later successful deliberate rerun. Runtime tests cover cancel, startup races, budget/lease admission, noncompleted turns, interruption and retained outcomes. |
| 23 | Exact scope and no resurrection | Real dirty-unbound code qualified honestly. Tests reject changed clean checkout, stale evidence, cancelled completion and successor inheritance. |
| 24 | Assigned immutable report | Signed-session and strict host-envelope tests reject mismatched identities and changed retries. Report/attachment retention is independent of runtime rows. |
| 25 | Findings feedback within authority | Real manual code repair after one contextual message. No automatic repair, acceptance or completion. Destination and lifecycle tests cover unavailable sessions. |
| 26 | Read-only navigation, faithful Save, no automatic critique | Render/activity APIs start no run. Exact Markdown and galleries tested through HTTP Save. Preparation requests packaging, without launching independent review. |
| 27 | Explicit durable preparation | Real memo Update and runtime tests for busy queues, source context, offline/crash/replay, exact session, and no substitute execution. |
| 28 | Exact Update supersession | Real code and memo successors plus immutable-snapshot tests. No inherited review, human decision or independent critique. |
| 29 | Visible settings limitations | Model catalog/effort validation, final capability checks, real requested/observed details. Unsupported native review uses only the supported fresh fallback. |
| 30 | Resolved settings retained on replay | Runtime/storage tests change defaults/gates, replay the original tuple and reject changed explicit settings. |
| 31 | Dedicated contexts and reachable attention | Real desktop/mobile attention and exact Review details. Sessions excluded from ordinary lists, execution output and task activity. |
| 32 | Optional activity and source-independent evidence | Real activity/permissions and storage tests pruning session/run while retaining report, files, requested selection, provenance and terminal status. |
| 33 | Complete narrow pilot flow | Actual producing conversation, exact handoff, manual review, contextual feedback, focused repair and successor. No broader navigation/team/automation dependency. |
| 34 | Picker does not change preferences | Real before/after settings and author-session comparison, selection-only picker, and runtime explicit/default selection tests. |
| 35 | Disabled baseline isolation | Gates default null/off, no instruction/tool/job injection when off. Full repository regression suite and dedicated lifecycle/isolation tests. |
| 36 | Independent gates | Capability tests and real retained handoff inspection with review unavailable. Effective review requires both switches. |
| 37 | Queued disable and cancellation | Runtime tests cancel queued review/preparation, prevent resume after reenable, and leave ordinary authoring intact. |
| 38 | Admitted finish after disable | Runtime tests restrict completion to exact admitted assignments. Real permission/Cancel remained visible, and memo preparation was finished after both gates were disabled. |
| 39 | Stale tools and committed retries | Action/HTTP/MCP tests give guarded disabled errors, preserve exact replay after pruning, and reject fabricated completion exceptions. |
| 40 | Disable/restart preservation | Real off/restart exact pages, old cards, files, reports, feedback and failed-review attention. Source-pruning/restart tests extend retention coverage. |
| 41 | Non-destructive rollback and removal | Integration map and preservation/export/removal steps above, plus additive migration and gate-independent GC tests. |
| 42 | Practical trial notes | Timings, one actionable finding, memo suggestions, packaging follow-up, unknown cost, natural omission, and human-adoption limitations recorded above. |
