# Durable result handoffs for agent work

Specification from the October 6, 2026 product discussion, updated October 7, 2026 to include independent AI review, explicit handoff preparation, reviewer preferences, background execution without chat-list clutter, and a reversible pilot boundary. This is the concrete first implementation slice of the existing verification and trust exploration. Preserve pluggable harnesses and keep normal conversation effortless. This task records the design, it does not imply that the implementation has shipped.

## Outcome and product boundary

An agent can explicitly hand over useful work as ordinary Markdown, durable files, and labeled links. Ri saves one result, shows it in the conversation and relevant task views, opens existing viewers or previews, and routes contextual feedback to the producing agent.

The agent chooses its implementation and verification methods. Ri supplies durable identity, context, honest evidence presentation, and review actions, including an optional independent AI review coordinated through the selected harness. Existing repository instructions and CI/CD remain responsible for their checks and delivery rules.

A result is not a successful harness turn, a task completion, a certification, or permission to merge/publish. Ordinary questions, progress updates, small confirmations, and turn-end events do not automatically create results. Code changes, documents, research findings, designs, and other substantive deliverables use the same model.

### Product language and intent

Use AI review for independent scrutiny of the work, Handoff for the saved explanation and evidence a person can inspect, and explicit decision verbs for the human response. Do not use a generic Review or Human review button for all three. A completed AI review does not mean a person accepted the work. A prepared handoff does not mean an independent AI review happened.

| Intent | User-visible action | Behavior |
| --- | --- | --- |
| Independently challenge the work | Review with AI | Requests a background AI reviewer or reuses compatible recorded evidence. |
| Inspect an existing handoff | View handoff | Opens the exact saved result. Never starts AI. |
| Preserve already usable output | Save as handoff | Saves existing content, files, and links without AI synthesis. |
| Make work ready to inspect | Prepare handoff | Explicitly requests needed preparation from the authoring agent. |
| Refresh a handoff after work changes | Update handoff | Requests preparation of a successor when needed, preserving prior snapshots. |
| Respond to the outcome | Accept, Request changes, Dismiss | Records the disposition, with contextual delivery when feedback is sent. |

Keep results, result_reviews, report_result, existing URLs, and other established code/wire names. Handoff is product language for the saved primary result, not a new database entity. Saved results and the task Results section remain the existing collection names. AI reports are labeled AI review and nested under their target.

## Pilot scope, isolation, and removability

The current build target is a contained, reversible pilot. The full design remains below as the intended expansion path, but expanded surfaces and automation are not requirements for completing the pilot. Where earlier broad wording conflicts with this section, the pilot boundary governs. Test whether the experience is useful before making it foundational to Ri.

### One complete path

Start in an isolated development data home, using one agent and existing conversations:

Existing conversation -> saved handoff and exact-result page -> optional manual AI review -> findings -> contextual feedback to the author.

Include real durable results and task associations, files, exact scope/provenance, source-independent retention, retry protection, authorization, runtime permissions, cancellation, recovery, and inspectable available activity. Keep the four feature tables described below. Include report_result guidance, View/Save/Prepare/Update handoff, Accept/Request changes, manual Review with AI, and per-request harness/model/effort selection. Use the existing chat and exact-result presentation without adding a new primary navigation destination.

The pilot does not change task lifecycle or require a result/review to complete ordinary work. Accept records a result disposition only. Ordinary task completion remains available through its existing path. Handoffs can prove useful even if independent AI review does not.

Later integration includes automatic AI review, persisted workspace review defaults, task Results sections, execution Results shortcuts, Saved results menus/search, Accept and complete, and team publication/reviewer routing. Their intended behavior and checks remain documented below. Do not build or enable those merely to satisfy the pilot checklist. Keep authority checks and prevention of implicit sharing in the pilot even though team publication is not enabled. Task links and read/query APIs remain useful without building every linked-task UI surface.

### Small integration boundary

Group feature-specific queries/services and UI components together, with a small set of named integration points: orchestrator actions and instruction delivery, result rendering, runtime dispatch/completion, attachment retention, and capability configuration. Continue routing mutations through queries.ts and existing server-owned runtime primitives. Use ordinary module boundaries and shared components, not a new plugin framework, event bus, or workflow engine.

Use additive migrations for feature tables and optional later settings. Do not repurpose existing task, execution, or chat state to mean handoff readiness or acceptance. No mandatory hooks on every assistant answer, no task-body rewriting, and no dependency from ordinary completion/shipping onto these records. Feature-owned rows may refer to existing work, but ordinary work must still function without creating them.

Document the integration points and the steps to disable/remove them in the implementation docs. Keep the implementation changes separable from unrelated refactors. The goal is a feature that can be removed with a bounded cleanup change, not a promise that a flag erases its code or data.

### Independent feature gates

Use the existing simple capability/configuration pattern, with handoffsEnabled and aiReviewEnabled both explicitly opt-in for the pilot. Do not create a feature-management service or settings table. Resolve effective new-review availability as handoffsEnabled AND aiReviewEnabled. Keeping handoffs on and AI review off must be a supported, useful configuration. The later workspace review_before_handoff preference is not the master feature gate and can never bypass either capability gate.

The AI review gate controls additional reviews coordinated by Ri. It does not constrain the harness's ordinary internal verification or subagents. With handoffs enabled, already completed native review evidence may still be included in report_result as part of the handoff, without launching another run or enabling review automation. The separate disabled review tools cannot use this evidence-recording allowance to start work.

Gate server-side admission and dispatch, new/resumed-session instructions and tool discovery, new UI entry points, and later automatic scheduling. Checking only whether a button is visible is insufficient. Recheck at dispatch so a queued operation cannot start after its capability is disabled. Preserve stable public action names. Calls from existing sessions with stale guidance return a clear unsupported/feature-disabled response and leave ordinary chat useful.

The gates govern starting new feature work, not reading previously saved work or cleaning up an already running operation. Result/review reads and their read-only API/CLI access, attachment reachability, old event rendering, authorization, and necessary runtime recovery remain active. Disabling must not turn saved messages into unrenderable event references or make retained files eligible for garbage collection.

### Disable behavior

| State/action | Required behavior when its capability is disabled |
| --- | --- |
| New handoff creation/preparation/update | When handoffs are off, stop admitting and dispatching new work. Remove creation guidance and entry points. Existing ordinary authoring work continues. |
| New AI review, retry, or automatic scheduling | When either gate is off, stop admission/dispatch. Hide launch controls. With only AI review off, normal handoffs still work. |
| Queued preparation or review | Do not launch. Record a visible disabled/cancelled outcome using existing delivery/runtime status and require a deliberate new request after re-enabling. Do not silently replay a queue later. |
| Already running preparation or review | Let the admitted operation finish and persist its report, or allow explicit cancellation through existing controls. Keep questions, normal permission decisions, errors, and Cancel reachable within the admitted operation's authority. Disabling does not broaden that authority or allow new feature follow-on work. |
| Saved handoffs and AI reports | Keep exact URLs and existing inline links/cards readable, with files, provenance, prior decisions, and available details. Retain a small read-only presentation even if optional creation/navigation UI is hidden. |
| Ordinary chats, tasks, executions, and delivery | Continue their established behavior. Do not cancel an implementation session because a feature-origin preparation message was cancelled. |

Tag preparation/review operations in the existing durable message/command/run metadata with their purpose and stable request identity. The finish-after-disable exception must be checked against a server-recorded running operation and its authorized caller, not granted to every report from the same session or to a caller-supplied claim. An already committed request replay returns its original result. A new review spawned from an in-flight completion is still new work and remains blocked. Review cancellation/completion keeps the existing conditional-transition protections.

When handoffs are off, the retained handoff UI is read-only except for controls needed to resolve/cancel already running feature operations. Normal conversation remains available for further feedback. Previously sent user feedback keeps its ordinary durable delivery and is not cancelled with feature-origin preparation/review jobs. When only AI review is off, handoff creation and human decision/feedback actions can continue. Do not hide existing decisions or evidence. Keep dedicated reviewer sessions filtered out of ordinary lists after disable, while leaving their operational attention accessible.

### Turning off versus removing

The switches provide operational rollback without a database rollback. Do not drop tables, remove referenced attachments, undo migrations, or delete saved work on disable. An old application binary is not automatically a safe rollback target just because migrations are additive. Use the current version with the feature disabled for the trial's rollback test.

Actual code removal is a separate cleanup: stop feature dispatch, finish/cancel and retire dedicated reviewer contexts, remove instruction/tool/runtime/UI integrations, and deliberately preserve or export saved results, reports, decisions, provenance, and referenced files. Before removing the remaining read/retention support, either migrate preserved work into existing supported content or provide a usable export and handle old transcript references. No dangling work_result events or orphaned attachment ownership. Destructive data cleanup requires a separate explicit decision, not an automatic consequence of rejecting the feature.

### Evaluate usefulness and isolation

Try real code work and a non-code deliverable. Record whether the human can understand and inspect the result with fewer follow-up messages, whether AI findings are actionable enough to justify their time/cost, and whether handoffs get used naturally or add maintenance. A short trial note is sufficient. Do not build another scoring/analytics system for the experiment.

Test disabling after real data exists and while work is queued/running, then re-enable. Verify ordinary Ri behavior, retained work, no surprise job restart, and no stale tool invocation bypass. Passing the complete pilot path and these isolation checks is the first milestone. Broad rollout is a later product decision based on the trial, not an unfinished pilot requirement.

## Database changes

Add four feature tables: results, result_tasks, result_reviews, and result_ai_reviews. The first three store handoffs, task associations, and acceptance/feedback dispositions. The fourth links an independent AI review request to its runtime and report, as specified below. Review reports reuse results and the existing attachment store. Do not add separate revision, artifact, pipeline, or test-runner tables. Each results row is an immutable handoff snapshot. A meaningful replacement is another row linked by supersedes_id.

Use the shared timestamps spread immediately after id on every table. Both created_at and updated_at are TEXT NOT NULL with the existing datetime('now') default, and updated_at uses the existing on-update behavior. Result content and disposition rows are otherwise append-only. Independent review request rows can progress through execution, while their completed report snapshots remain immutable. Foreign-key provenance nulling is not a content edit.

### results

Links have two variants. Ordinary URLs use {kind: "url", label, url}. Ri previews use {kind: "preview", label, preview_target_id}. A preview reference is resolved through the existing preview service for the viewing device. PRs, sources, and arbitrary sites all work as ordinary labeled URLs, with richer rendering only where Ri already understands the destination. No arbitrary executable UI, commands, or server filesystem paths are part of a link.

The optional code_revision shape is {commit_sha, working_tree_state, captured_at, checkpoint_ref?}. working_tree_state is clean, dirty, or unknown. Populate it from the execution computer through existing Git/checkpoint facilities, not agent assertions. A commit SHA does not identify dirty or untracked contents. If no exact working-copy checkpoint exists, label that evidence as captured from a working copy and do not claim exact freshness. Do not build a general repository snapshot engine as part of this task.

Indexes and constraints:

- Index (source_chat_session_id, created_at, id).
- Index (source_execution_id, created_at, id).
- Index (user_id, created_at, id) for the authorized result list.
- Partial unique index on supersedes_id WHERE supersedes_id IS NOT NULL.
- CHECK that supersedes_id is null or differs from id.
- The primary key enforces request deduplication. Compute IDs from the operation namespace, authority identity, a stable tagged caller identity, and request_id. The caller is the authenticated human principal or signed agent chat ID, never an access token, browser connection, or transient transport session. Never let a raw caller-supplied ID claim another actor's record.

### result_tasks

Add UNIQUE(result_id, task_id) and an index on (task_id, result_id). These links capture what a particular result concerns. Do not dynamically derive historical result membership from the execution's current task associations.

Defaults:

- If task_ids is omitted and the execution has exactly one accessible same-authority task association, save that association.
- If several tasks are associated, the agent may identify the relevant tasks. Omitting them is allowed and does not guess that the result completes every task.
- Explicit task_ids: [] means intentionally taskless.
- For a replacement result, omitted task_ids copies the prior result's explicit links. Explicit values replace the membership for the new snapshot only.
- All task IDs must be accessible in the same authority. Source executions may have wider context without granting wider result access.

### result_reviews

Add index (result_id, created_at, id) and a partial unique index on (feedback_session_id, feedback_message_id) when both are non-null. Use existing message/command delivery state for pending, queued, delivered, uncertain, or failed status. Do not add a second delivery state machine to this table.

The latest review for a result is its current disposition, with its actor attribution always visible. AI acceptance is displayed as agent acceptance and never satisfies a requirement for human acceptance. A successor starts unreviewed. The previous acceptance remains historical and never transfers to the new result. No stored results.status, verified flag, current-result pointer, or revision counter is required.

## Authority, privacy, and retention

Reuse the ownership, principal identity, and authority boundaries established by the homes branch. Do not invent a parallel home_id/space_id permissions model. user_id and actor_user_id values come from that authority's trusted context. Source chat/execution IDs are provenance, not sufficient authorization.

Private results live at the personal home and survive source chat deletion, execution archiving, or worktree cleanup. Continue checking owner/membership on every result, attachment, preview, task-link, and review operation. No public result-delete action is needed in v1.

Team publication is later integration, outside the pilot. When enabled, it is explicit and uses the homes branch's Publish result boundary. Copy only the selected summary, links, and files into a team-authority result, with local task links there. Never create cross-database FKs. Published copies have null private chat/execution/event references, and must not expose personal preview access, local paths, or transcript links implicitly. Linking personal work to a shared task does not publish the result. Team review feedback without an authorized personal execution destination stays recorded as team feedback, it must not silently start or command someone's personal agent.

## Agent API and discovery

Add report_result to the existing orchestrator registry, using a raw Zod parameter shape and a creator in queries.ts. The same action supplies CLI help and MCP behavior. Preserve existing public wire action names.

Inputs:

- request_id: required stable retry key for this submission.
- body: required nonempty Markdown.
- title: optional display title.
- attachments: optional existing uploaded attachment records/references, validated by Ri.
- links: optional typed destinations.
- attention: optional Markdown.
- task_ids: optional list, with omitted versus empty semantics above.
- supersedes_id: optional ID of the specific current result this replaces.
- independent_review: optional existing independent-review content/evidence fields as described below, with target and identities derived from this request. Saves evidence atomically with the handoff so automatic review does not duplicate it.

Infer creator, source session/execution, and code context. An agent-origin report requires the signed caller context already used by Ri sessions. Reject contradictory supplied origin metadata. An unsigned local caller cannot impersonate another agent or claim human acceptance. A human Save as handoff action uses the authenticated human UI path.

The action returns result_id, its local result URL, and whether it was an idempotent replay. The result body is stored once. Conversation, execution, and task views read that same record.

When the handoff capability is enabled, provide the exact invocation path and this short instruction at session creation:

> Use report_result when you produce or materially update something the user will use, inspect, or share: working changes, a finished artifact, or findings from an assigned investigation. Include useful outputs and important limitations. Use ordinary chat for questions, progress, discussion, and small confirmations. Do not create extra artifacts or repeat checks merely to populate a report.

Use the existing session-instruction delivery and extend the first-message fallback to execution sessions whose harness ignores instructionsFile. Ensure resumed sessions receive the currently enabled guidance through a supported adapter path. Do not inject disabled capabilities, and handle stale calls under the disable behavior above. Do not depend solely on skill auto-discovery. A separate skill is optional, not a user setup requirement.

The CLI is the common structured path today. Execution sessions currently attach connector/browser MCP servers rather than the complete orchestrator surface. If using MCP, explicitly attach a narrow report-result capability where supported. Exposing the action in the registry alone is not sufficient.

A report call activates the result presentation. Never create results from every normal final message or use an extra model call to classify every turn. If an agent omits a report, ordinary output remains useful. The user can Save as handoff when the output is already usable, or explicitly Prepare handoff when assembling a useful handoff needs more work.

## Persistence, retry safety, and supersession

Validate authorization and the request key before materializing files. Create the result and explicit task links in one database transaction. When a source chat exists, create its app-owned conversation event in that same transaction. The event uses a distinct work_result source and references the saved result, so the UI can render it in context without copying the body into task descriptions. A task-only or published team result needs no transcript event.

Use the existing request-scoped UUID pattern for result, disposition, independent-review request, and feedback-message IDs. A duplicate request with the same canonical input returns the existing object. Reusing the same scoped key with materially different body, files, links, tasks, review action, nested independent-review evidence, or supersession target returns conflict. Store request_hash so replay is stable even if source records or task links are later removed. Hash submitted intent rather than volatile observations such as the current Git HEAD. Check replay before re-evaluating task defaults or importing files.

Supersession must name an accessible current snapshot. Validate in the transaction that it has no successor. The unique index resolves concurrent replacements safely. Independent results in the same execution coexist and never implicitly supersede each other.

Only substantive new content creates a successor. Tool delivery retries do not. GET /results/:id identifies that exact snapshot and can show a Newer result available link.

## Files, links, and evidence

Use the existing attachment store and StoredAttachment/application-type conventions. Validate MIME, size, identity, and access with the same rules as the upload route. A screenshot/report must be copied into the attachment store before Ri acknowledges a durable result. A file path in a worktree or temporary directory is insufficient.

Remote reporting accepts previously uploaded attachments, not arbitrary server paths. A permitted local or worker import reads regular files within existing authorization and uploads through the normal path. Do not broaden filesystem access.

Result-gallery attachments can exist without inline Markdown markers. The current deriveAttachments helper drops unreferenced files, so preserve validated gallery attachments explicitly and include all result references in attachment reachability/cleanup. Retrying must not duplicate attachment uploads or remove files shared by older results. Validate attachment references retained in review briefs/scope, and include them in attachment reachability/cleanup so pruning source or reviewer messages cannot delete the retained review inputs.

Reuse protected attachment URLs and existing viewers. Render unfamiliar formats as downloads and unfamiliar HTTP(S) URLs as links. Preview targets resolve through existing device-aware preview services, with honest running, starting, unavailable, and stale states.

Keep agent statements separate from observed system status. For example, Agent reports tests passed and GitHub checks passed are distinct. Reuse existing GitHub checks and attach them to the relevant commit. Screenshots describe captured state, while a live preview may have changed. Missing or unbound evidence stays unknown. Do not introduce a universal Verified badge.

## UI and feedback

Start work in the existing chat or task flow. There is no new factory mode, required form, or review dashboard.

Render the handoff as a useful agent answer with a compact artifact/link row and optional attention text. Open Preview, Changes, Files, or existing document/image viewers directly. Provide an exact-result deep link. Broader associated-task entry points are later integration.

### Result surfaces for the pilot

- Conversation: render the saved result inline at its work_result event in the existing conversation used for the pilot. Use existing artifact viewers and the workbench.
- Exact-result page: /results/:id opens the same handoff, artifacts, provenance, AI review, and available human decision actions. It names that exact snapshot and can show Newer result available. The URL remains usable if the source is pruned or the feature is disabled.
- Reuse one result renderer and authorized query layer. Taskless results remain first-class. Existing notes can hold ordinary saved-result links. No new navigation destination is needed for the pilot.
- Capability-off presentation keeps old inline cards/links and exact pages readable. It hides new feature actions, apart from necessary controls for already running work.

### Later result surfaces, outside pilot completion

- Extend inline results across execution and task/note content-chat surfaces as part of broader rollout.
- Task detail: add a compact Results section immediately below the editable body, outside that body. Hide it when empty. Show current snapshots linked through result_tasks and expose older versions without copying summaries into the task.
- Execution: add a small Results shortcut to jump to or list saved results. Do not add another permanent workbench tab.
- Personal rediscovery: add Saved results to the command palette and touch-accessible app menu, opening a recent-results list with title/body filtering. Include taskless and source-deleted results, default to current snapshots, and expose replacement history. Reuse command/hotkey definitions without a new search service.
- Notes retain their existing AI chat and ordinary links. Do not add result_notes or a dedicated Results collection on notes.

### Handoff preparation and human inspection

While the handoff capability is enabled, the normal path remains packaging by the working agent through report_result. The human should not need to press a button to get a handoff for substantive completed work. These actions recover omissions or refresh existing work without introducing another required process.

View handoff opens the saved result, summary, artifacts, preview links, AI findings if present, and human decision actions. Opening or revisiting it never starts a harness run, reruns checks, or prepares another packet. Explicitly opening a stopped preview can use the existing preview-start flow and authorization, without requiring an AI run.

Save as handoff preserves a selected useful answer and its already available outputs through the authenticated result creator. Validate and materialize files as required for durability, but do not call a model to rewrite or classify the answer. Keep the human's saving action distinct from the original author's provenance. If preparation is needed, offer Prepare handoff as a separately labeled action rather than silently upgrading a save into an AI request.

Prepare handoff is an explicit request to the authoring agent to explain what changed or was produced, gather useful existing evidence, identify important limitations and decisions, and make the relevant files or preview accessible. Useful screenshots or starting a server may be part of preparation when needed and authorized. It should reuse existing checks and artifacts, avoid redoing implementation work merely to fill a packet, and finish with report_result. It does not commission an independent reviewer merely because a person wants to inspect the result.

Use the current authoring session and its normal harness/model for this continuation, not the separate AI-review model defaults. If the source session is busy, queue the contextual request through existing delivery. Persist a stable request/message ID, selected source output, exact result ID when updating, and complete preparation prompt before dispatch. Repeated clicks/retries reuse the same pending request. If the same requested handoff already exists, open/reuse it instead of starting a redundant preparation turn. Use existing server-owned messages/runs and query functions, with no handoff-preparation table, scheduler, or extra public action that merely duplicates message delivery. Show Preparing handoff and any delivery/runtime limitation in the existing work surface. A successful turn without a saved result is not a completed handoff.

When several authoring destinations could apply, retain the selected result's provenance or let the human choose. An unavailable, deleted, archived, read-only, or unauthorized destination must not cause Ri to silently open another implementation execution or invoke a person's private agent. Existing output can still be saved. Preparation stays limited by the normal permission, budget, and device boundaries.

Update handoff uses the same preparation path and names the exact current result to replace with supersedes_id. It must inspect the current work and preserve the original on any supersession conflict. Only meaningful changed content produces a successor. If the saved handoff is already sufficient, View handoff is the normal action, not an automatic refresh run.

Place View handoff on saved primary results. Offer Prepare handoff in the existing work/output actions when a handoff is missing or needs preparation, and Save as handoff on usable selected output. Keep Update handoff secondary. Do not show a mandatory form, add a permanent workbench tab, classify every message with AI, or introduce a Request human review action implying assignment/notifications that this feature does not implement.

Saving and preparation do not require AI critique. In later integration, if both capability gates and the agent's automatic-review preference are enabled, the resulting primary handoff can enqueue AI review with visible status. The pilot has no automatic review scheduling. The save operation itself does no AI synthesis, and viewing a saved handoff never triggers that policy. Humans can inspect and respond while an optional AI review is pending.

### Human decision controls and discussion boundary

Opening or saving a result does not create a mandatory human decision obligation. An authorized person can access Accept and Dismiss as secondary actions on the exact result. Accept and complete is later integration, absent from the pilot. When added, show it only for an eligible linked task, with an explicit choice when several tasks qualify. Offer Request changes through the contextual composer when an authorized destination exists, and explain unavailable destinations without silently starting another chat. AI-authored reviews remain labeled as AI.

Shared task/note comments and reply threads are a separate product slice, not part of this implementation. Preserve the existing private AI content chats. Do not turn ordinary discussion into an agent command or publish private chat content through this result feature.

Request changes focuses the normal composer with the exact result and any selected screenshot/preview context attached. On send, record an append-only review with nonempty feedback and its intended destination/message ID. Route delivery through the server-owned message/worker path, not an executor started from a CLI handler.

Persist the review and the fully composed feedback message, including the exact result and selected screenshot/preview context, before dispatch. Prefer one home-database transaction through shared query functions, followed by server-owned dispatch. If transport boundaries require separate steps, persist the exact prepared payload in the existing durable message/command facility and release it only after the review is saved. The review note alone is not the complete message. Reuse existing delivery and retry primitives. Recovery retries the same message ID and payload. Show Feedback saved separately from delivery or agent execution. Offline, unavailable, archived, takeover, imported read-only, or budget-blocked destinations remain understandable and recoverable. Never silently choose a different execution or bypass a stop/permission boundary.

Accept records acceptance only. In later integration, Accept and complete additionally names one eligible linked task and atomically records acceptance plus the existing task lifecycle operation. Reject stale result acceptance for task completion without partial writes. A successor or a known content-revision mismatch makes the result stale for completion. Ordinary conversation alone does not. Unknown code identity stays visibly unknown rather than being claimed fresh. Multiple linked tasks require an explicit task choice. Reporting, viewing, dismissing, and acceptance alone do not complete tasks.

Merge PR, Publish, and other external actions retain their existing explicit meanings and authorization. Optional independent AI review is defined below. It does not add a CI engine, workflow builder, automatic repair loop, or shipping approval.

## Independent AI review

This section incorporates the October 7, 2026 discussion. Independent review is a small capability attached to useful results, not a mandatory workflow for all work. The harness performs the review. A shared review skill supplies the method. Ri requests it, preserves its scope and evidence, and presents the outcome. Treat a Ri-requested reviewer as background work attached to the result. Prefer native review capabilities when the adapter supports them. Otherwise use a fresh internal harness session through the existing runtime. Fresh context does not require another visible conversation or implementation execution. Do not require a different model or provider, and do not promise that fresh context eliminates correlated mistakes.

### Discovery, defaults, and project guidance

- While both capabilities are enabled, add Review with AI to the pilot's inline handoff and exact-result actions. Extend the same action to later result surfaces as they are added. One click uses the effective reviewer settings described below. An optional focus field lets the user add a concern without having to compose a review prompt. Show a compact harness/model/effort summary with Change using the existing picker, without a separate setup wizard.
- While AI review is enabled, describe its callable actions alongside report_result. For the pilot, request a new review only when the human explicitly invokes it or asks for it in conversation. The working agent may suggest review and can record an appropriate review its harness already performed. Later opt-in automation can request review when useful. Do not review ordinary conversation or recursively review review reports. Name the callable actions. The skill teaches the method, while the explicit session instruction makes it discoverable. Do not depend on skill auto-loading.
- Start with human-initiated manual review in the pilot, including an agent carrying out the human's explicit request. Later integration adds a single opt-in Request independent review before handoff preference to the associated agent's settings. When implementing that stage, add workspaces.review_before_handoff as a nullable INTEGER boolean with no database default and resolve null as off. Do not create a new project entity or global policy dashboard. Taskless results without an associated agent still support manual review.
- The shared skill handles general method. Read existing repository and agent instructions for project concerns, such as migration safety or keyboard accessibility. The optional one-off focus adds context. Reuse the existing instructions field rather than adding a second free-text review-policy editor. Natural-language guidance can influence judgment. Reliable automatic scheduling belongs to the later explicit preference and remains subordinate to both capability gates.
- In later integration, with both capability gates and the preference enabled, saving a substantive result durably records one automatic review request unless matching evidence already exists. The result is immediately readable with Review queued or Reviewing, rather than presented as independently reviewed. Dispatch after the producing turn is quiescent, unless a stable captured target can be reviewed concurrently in isolation. Failure or missing access remains visible. This preference requests review, it does not create a mandatory acceptance, task-completion, merge, or shipping gate.
- Review reports never trigger review-before-handoff themselves. Do not add model calls to classify every conversation turn, risk-score every change, or decide whether ordinary chat needs review.

### Reviewer settings and resolution

Allow a harness, model, and reasoning-effort selection for an individual AI review. Reuse existing selection controls, model catalogs, variants where relevant, and supported-effort types rather than adding a quality score or parallel model registry. The review skill specifies the method and reads project concerns. It does not silently choose or override the human's reviewer settings.

The pilot uses the one-off review selection followed by the user's normal defaults. Later integration inserts saved review defaults for the associated agent/workspace between those levels. At that stage, add workspaces.review_defaults as a nullable typed JSON/TEXT preference with no database default. Its shape is {harness?, model?, variant?, effort?}, referencing the existing harness/selection types. Null or omitted fields inherit. This is separate from the already specified nullable review_before_handoff switch: users can save review preferences without enabling automatic review. No new settings table or project entity is needed.

Resolve the harness first and validate a coherent model/variant/effort combination using existing capability discovery. Inherited settings for another harness must not produce an invalid mixed combination. Show only supported controls and the effective selection. Do not silently ignore an explicitly requested effort, change to another model, or downgrade a saved unavailable selection. Explain unavailable choices and let the user adjust them. When native review cannot honor the selected settings, use a compatible fresh-context background reviewer or show that the selection is unavailable.

Changing the picker applies only to this request. The pilot does not persist workspace review defaults. In later integration, persist them only through an explicit Use for this agent action or its existing settings form, with authority checks. Resetting that preference restores inheritance. Neither launching a review nor changing its picker updates global defaults, the implementation session, or defaults for unrelated agents. Existing new-chat/session-update paths that also write global preferences must not be reused unchanged.

For later workspace defaults and any runtime context needed now, resolve the associated workspace from the producing context, not an arbitrary linked task, and validate access. Taskless results use their producing agent when present. Results with no associated agent use normal defaults plus the one-off override, and do not offer Use for this agent until an authorized agent has been explicitly selected. No implicit cross-authority preference lookup.

Snapshot the resolved selection on the review request before dispatch. A retry with the same request key uses the stored selection even if defaults later change. Include explicit overrides in the request-intent hash. Record actual observed harness/model/effort separately in provenance when available, with unknown values labeled unknown. Ri's requested effort is not proof that a provider applied it.

Reuse evidence only when compatible with the requested reviewer settings as well as work scope and focus. An explicit request for another model or effort must not silently return the previous model's report. Review again creates a deliberate new attempt. Changing settings is not retroactive to already running or completed reviews.

### Review method and execution

Give the reviewer the original request and relevant acceptance criteria, project guidance, optional focus, the exact saved result, and the actual changes or artifacts. Preserve that brief on the review record and use the same content for its initial durable message, so it survives pruning of the source or reviewer conversation. Do not give only the implementer's summary or seed the fresh conversation with the full implementation transcript. Review source material and implementation explanations as evidence, not as proof of correctness.

The shared instruction is:

> Independently inspect the work against the original request. Look for concrete defects, missing requirements, regressions, and unsupported claims. Use relevant checks to investigate. Report actionable findings with evidence, their practical impact, and what you could not verify. Finding no actionable issues is a valid outcome. Do not invent objections, demand speculative abstractions, or repeat checks merely to fill a report.

Adapt the checks to the deliverable. Code review may inspect diffs and exercise behavior. Research review may inspect sources and challenge unsupported conclusions. Reuse existing tests, CI, screenshots, previews, and native reviewer tools when relevant. Ri does not create another test or CI engine.

Reuse the existing server-owned session/run dispatcher, permissions, device routing, budget/concurrency limits, cancellation, and message delivery. Keep review context separate from the implementation conversation. Prefer a supported native review mode that supplies fresh context and honors the selected settings. Otherwise launch a fresh internal review session. A native command must go through the harness capability adapter, not be sent as an assumed slash command to every harness. Supported native capabilities may improve without changing the saved-result contract.

A harness may implement review using its own subagent. An appropriate review it already performed can be recorded and reused without creating another session just to satisfy a database shape. If Ri starts the work, track it as a background child of the result. Attach to the existing execution when appropriate, without creating another primary task/execution or changing task lifecycle merely to review it. Reuse existing isolation facilities when checks need their own scratch space.

Persist the internal run/session records needed for authorization, cancellation, recovery, and inspection. Do not present dedicated background reviewer sessions as ordinary user chats in the main chat or execution lists. Use the review relation and existing session surface metadata to distinguish these internal reviewer contexts, and apply that distinction consistently to list queries, navigation, unread summaries, and selection of an execution's primary conversation. Do not rely on a hidden CSS row or the label to identify a background reviewer. An implementation conversation that contains or reports native review evidence remains a normal implementation conversation. Never hide or restrict the producing chat merely because it reported a subagent review, and never use that parent chat as reviewer_session_id when it is only the reporter.

Expose progress, pending questions/permissions, errors, and Cancel beside the target result and through existing activity/attention surfaces. Background work still counts toward normal budgets and concurrency. Hiding a chat from the rail must never make a blocked reviewer invisible. The normal action opens the saved report, while Review details can show its original brief, requested and observed settings, scope, evidence, and authorized ordinary messages/tool activity. Full provider internals are not required to understand or trust the report.

The original review brief, report, reviewed target, relevant evidence, setting/provenance snapshots, and terminal outcome remain durable independently of the internal session. Retain available execution activity under existing retention rules. If it is pruned or was never exposed by the harness, show that honestly in Review details. Pruning the activity must not delete the report or turn a completed review into an unknown outcome. Publishing the report does not publish the private runtime trace or brief.

The existing subscription-harness background helper is a starting point for bounded execution, not an already complete reviewer engine. Reuse/extend the common harness infrastructure and existing runtime lifecycle rather than adding a direct model API path. Review must honor its resolved selection, required tools, normal permissions, and cancellation. Do not inherit the helper's fast-tier, one-turn, or short-timeout defaults as an implicit review-quality policy.

The reviewer must examine the named target. A fresh Git worktree created from the default branch is not automatically the implementation under review. Resolve the actual commit, base revision/diff, existing checkpoint, or retained artifacts through the execution computer. Do not let the reviewer edit the implementer's active checkout. Use isolated existing facilities for tests that write temporary/build files. If the target or execution device is unavailable, preserve the request with an honest limitation instead of silently reviewing a different revision or granting broader access. Do not build a new repository snapshot service for this feature.

Review authorization permits inspection and relevant checks, not implementation edits, publication, merging, or arbitrary access. Reviewers can return findings and evidence. Address findings is a separate action that composes contextual feedback to the authorized implementation destination using the existing Request changes delivery path. An implementer can fix findings under already granted task authority, but this feature does not start an automatic repair/review loop. A deliberate Review again action can request another review. A new result alone does not schedule one in the pilot, and later automatic requests remain subject to the explicit preference and capability gates.

### Review evidence and version identity

An AI assessment is distinct from the human dispositions in result_reviews. It neither accepts the result nor completes a task. Keep the full review body as Markdown and use the existing durable attachments and links. Require an intelligible account of what was inspected, actionable findings or no actionable findings, supporting evidence, and limits. Do not require a fixed findings quota, numerical trust score, or rigid code-only checklist.

Record both the requested scope and the scope actually inspected. Bind the assessment to results.id and, for code, the repository identity, observed revision/checkpoint, and comparison base. Capture the requested scope when creating the request and keep it immutable. Record actual observations separately, including any drift during review, rather than overwriting the original target. Saved files identify their immutable attachment records. Live URLs and previews can change, so record capture time and scope limits. A result ID alone does not prove that the live code still matches it. Unknown or dirty code without an exact checkpoint stays visibly unbound and cannot satisfy a claim of exact freshness.

Reuse an existing independent review when it covers the same result, exact work version, and requested focus. Do not launch another reviewer just because the UI offers a button. Native review evidence may be recorded by the producing harness, with method and reviewer provenance. Distinguish Ri-observed independent execution from Agent reports independent review. A signed implementer message authenticates the reporter, not the existence of a separate reviewer. Only adapter-observed or otherwise verifiable independent execution with matching scope can satisfy the later review-before-handoff preference. Other evidence remains useful and visible without being upgraded into verified independence.

A successor does not inherit the previous assessment. Known code changes make the old assessment historical, and uncertain identity is shown as uncertain. Fixing a reported issue is not proven by an implementer's assertion or by the previous review. Present a later fix report or rereview with its own provenance. No universal Verified badge.

### Durable review request and agent actions

Add one focused fourth feature table, result_ai_reviews. It stores the link between a request, the exact target, its runtime, and an immutable report. The report itself remains an ordinary results row, so files, viewers, retention, and access do not acquire a second implementation. Keep result_reviews exclusively for accepted, changes_requested, and dismissed dispositions.

Columns, in addition to the shared id and timestamps:

| Column | Purpose |
| --- | --- |
| user_id | Owning principal under the existing authority model. |
| result_id | Required FK to the exact target results row, ON DELETE RESTRICT. |
| actor_source, actor_user_id, actor_session_id | Trusted request/report attribution using existing actor conventions. Session FK is nullable, ON DELETE SET NULL. Never supplied as trusted identity by the caller. |
| request_hash | Canonical request intent for idempotent retries. |
| focus | Optional plain-English concern for this review. |
| brief | Nullable TEXT holding the complete original review brief. Required by the query layer for Ri-requested reviews, nullable when an imported review did not provide it. Retained independently of runtime messages and protected by the same authority. |
| selection | Required typed JSON snapshot of the resolved harness, model, variant if applicable, and reasoning effort, plus any explicit selection requirements. For imported native evidence, store known settings and explicit unknowns rather than inventing a requested selection. Reuse existing selection types. |
| scope | Required typed JSON with requested scope and, when available, observed scope. Includes code revision/base or attachment references, capture time, and explicit unknowns. |
| provenance | Required typed JSON with method (native_review, fresh_session, or reported_review), observed versus reported independence, and observed reviewer harness/model/effort/native identifiers. Keep requested settings distinct from observed settings. Preserve the known facts when source sessions are pruned. Never infer missing reviewer identity. |
| reviewer_session_id | Nullable FK to the internal reviewer context when Ri creates one, ON DELETE SET NULL. It need not be a visible user conversation or exist for an imported native review. |
| run_id | Nullable FK to the associated existing run, ON DELETE SET NULL. |
| report_result_id | Nullable unique FK to the immutable review report in results, ON DELETE RESTRICT. Filled once by successful reporting, never overwritten by a later review. |
| status | queued, running, completed, failed, or cancelled. Required with a query-layer write default, no SQL policy default. This is a durable projection of review progress, not a new scheduler. |
| status_reason | Optional stable reason such as missing_report, interrupted, target_unavailable, or dispatch_failed. |

Index (result_id, created_at, id), reviewer_session_id, and run_id. Reject a target pointing to its own report. Allow at most one queued/running request per target using a partial unique index. Concurrent equivalent requests return the same active request. A different focus or reviewer selection must not silently reuse an incompatible request. Return a conflict with the active review reference instead. Completed historical reviews can coexist, and an explicit new attempt gets a new identity.

Use the existing request-scoped ID and canonical-intent rules. Persist the request and exact prepared initial message before dispatch, with deterministic session/message identities. A replay never creates another reviewer. Reconcile lifecycle callbacks with idempotent conditional updates. completed requires a committed report, not merely a successfully ended harness turn. A terminal turn with no report becomes failed with missing_report. Late reports or callbacks cannot resurrect failed/cancelled requests or overwrite/downgrade a completed report. Replay of an already committed completion still returns the original. Interrupted dispatch/run recovery becomes visible and offers Retry through existing runtime facilities, rather than blindly relaunching work. A retry is a new linked-to-the-same-target attempt with a new request key. Prior outcomes and reports remain readable after session/run pruning. No additional worker, scheduler, or general pipeline engine is introduced.

Add two orchestrator actions, exposed through the same narrow CLI/MCP surface and shared query layer:

- request_result_review: request_id, result_id, optional focus, and optional harness/model/variant/effort overrides using existing selection types and wire conventions. Validate actor, target access, runtime access, and budget/permission boundaries. Resolve compatible existing evidence or an active request first, otherwise persist and enqueue one request. Return its review ID, exact-result URL, whether evidence/request was reused, and current status. Explicit Review again uses a fresh request key and an explicit rerun option, without changing historical evidence. It cannot bypass an active incompatible review.
- report_result_review: request_id, either an assigned review_id or an accessible result_id for recording an existing review, body, optional title/attachments/links, and evidence scope/provenance. The service validates observed fields against trusted runtime facts. For an assigned review, only its authenticated reviewer or a trusted native adapter can finish it. An implementer can report existing native evidence but cannot impersonate a separate reviewer. Transactionally create the immutable report through the same result creator and link it to the review record. The report's request_hash protects completion retries. Replaying with changed evidence conflicts. Return review ID, report result ID, and exact-target URL.

Allow report_result to carry an optional independent_review when the harness already reviewed the work. This nested payload contains only report content and evidence fields, not request_id, result_id, or review_id. Derive its target from the enclosing result and its identities from namespaced versions of the enclosing request key. Include the nested content in the parent retry hash. Persist the result and review evidence atomically before deciding whether automatic review is needed. This avoids a duplicate reviewer racing with a separately reported native review.

Before dispatch, recheck for compatible completed evidence. If a canonical completed review has appeared, atomically close the still-queued request as cancelled with reused_existing_review, record its canonical review ID in validated provenance, and show/link the reused review. Do not leave an active request occupying the uniqueness constraint or attach one report_result_id to two rows. Once a request is running, do not silently replace its reviewer or target.

The reviewer completion action and nested report creation do not invoke automatic handoff review. Enforce this through the review relation and assigned reviewer session, not only a prompt: agent-origin review requests from a linked reviewer session cannot start another reviewer. A generic report_result call from that session must direct the caller to report_result_review for its assigned target, rather than create an automatically reviewed primary deliverable. Review reports have no inherited task links and appear nested under their target, rather than as duplicate top-level deliverables or acceptance obligations in Saved results and task Results lists.

### Human presentation and team boundaries

Show a compact AI review line on the result. Before a review is recorded, use No AI review recorded. During a request, show queued/running, Cancel, and any existing runtime question, permission, or unavailable-device state. Afterward, show the concise outcome with an expandable report, scope, reviewer attribution, and limitations. Review with AI, Change, Retry, Review again, Review details, and Address findings reuse the result actions, existing picker, and composer. Review details is secondary and does not start another run. The normal human entry point is View handoff, with Accept and Request changes as decisions. Do not require opening the internal reviewer conversation to understand the outcome.

Keep failed, cancelled, missing, reported-only, outdated, and scope-unknown states distinct from a completed independent review. Significant unresolved findings remain visible without turning every comment into a gate. Show claims such as Two issues fixed only when linked follow-up evidence supports them, with attribution. Keep product judgments and unresolved decisions clear for the human.

Apply the same authority boundary to requests, runtime access, review reports, and attachments in the pilot. The following publication/reviewer-routing behavior is later integration. Publishing a result does not automatically publish its private review or transcript. A user may explicitly include selected review evidence in the team copy, with provenance and limitations preserved and private runtime references removed. Copied evidence cannot gain stronger independence/freshness claims through publication. A team reviewer operates only through an authorized team-accessible runtime and artifacts, never by implicitly commanding a member's personal agent. If no authorized runtime exists, retain feedback and explain review availability.

Reference capabilities, not hard dependencies: [Claude independent review guidance](https://code.claude.com/docs/en/best-practices) and [Codex dedicated review](https://learn.chatgpt.com/docs/codex/cli). Resolve actual capabilities through the installed harness adapter when implementing.

## Compatibility and migration

Keep existing execution_reviews as readable legacy review history. Do not manufacture a new result for every historical agent message or create a mass backlog of unreviewed results.

New result reviews target results.id and do not require an execution. Preserve the existing review_execution action and old endpoints for their documented legacy behavior, with clear separate presentation. Do not reinterpret a legacy review as acceptance of a saved result. New result attention derives from explicit saved handoffs and actual feedback state, not the broad OUTCOME_SOURCES predicate.

Add result query/read/review routes using queries.ts. Add get_result and list_results to the agent surface so results remain discoverable from later sessions, with authorized filters by task, execution, and source chat. Reuse existing pagination and query-cache patterns. No standalone full-text/vector index is required for the first slice. The pilot requires authorized result queries, inline conversation access, and exact-result links. Broader result-list menus and linked-task navigation belong to the later surfaces described above.

Derive types from the Drizzle schema, including the existing camel/snake attachment conversion. Use current query-layer write defaults for policy fields. Migrate only through the safe runner. Preserve task/note bodies and existing data invariants. Do not edit live database files or the Markdown mirror directly.

## Pilot acceptance criteria

- [ ] A real harness produces a code result with a durable screenshot and working preview or an honest preview limitation, without the user requesting packaging.
- [ ] A research/document result uses the same action with no execution and no task required.
- [ ] Questions, progress, ordinary answers, and trivial confirmations create no result automatically.
- [ ] The reporting instruction and callable action reach the selected pilot harness. Exercise a second configured harness where available to check portability, and record real omission/over-reporting examples rather than only mocked calls.
- [ ] Concurrent retries produce one result, one transcript event, one attachment set, and one set of task links. Reused keys with changed intent conflict.
- [ ] Multi-task results retain exact task membership after execution-task associations change.
- [ ] Independent results coexist. Explicit replacements preserve earlier content/reviews and create at most one successor.
- [ ] Deleting the original file/worktree or pruning the source chat leaves the saved result and its attachments inspectable.
- [ ] Gallery-only attachments survive save, reload, access checks, and cleanup.
- [ ] Request changes sends one contextual message to the correct destination. Crash/retry/offline cases retain feedback and show actual delivery state.
- [ ] A new result is not accepted because its predecessor was accepted. Reporting, acceptance, and AI review do not change task lifecycle in the pilot.
- [ ] Agent-created records cannot claim human acceptance or another session's identity. Cross-authority task links and remote server-path imports fail.
- [ ] Private results remain private when linked work concerns a team task. The pilot offers no publication or implicit shared runtime access.
- [ ] Legacy reviews remain readable and do not generate new review obligations.
- [ ] Desktop and mobile can read the result, open the relevant artifact/preview, reply, and return to the same work without losing context.
- [ ] Review with AI works from a task-linked and taskless result, with useful defaults and optional focus, without a new setup flow.
- [ ] A real fresh-context fallback inspects the intended work and saves a report. Exercise native review when the selected adapter supports it, otherwise record the limitation without requiring new native capabilities for the pilot. Never send unsupported native commands blindly.
- [ ] Reviewers receive the original brief and actual work, can report no actionable findings, and keep project-specific concerns in existing instructions.
- [ ] Retrying or concurrently requesting the same review produces one request/dispatch. Changed request intent conflicts, and a different focus is not silently dropped.
- [ ] A matching native review can be reused with its actual provenance. Unsupported independence claims stay labeled as reported. Explicit reviewer choices remain part of compatibility.
- [ ] Review-report rows and reviewer sessions never recursively trigger another review, even through a generic report_result call.
- [ ] Interrupted, cancelled, offline, permission/budget-blocked, and completed-without-report cases are visible and recoverable without duplicate dispatch. Review evidence and terminal outcomes survive source-session/run pruning.
- [ ] Review scope includes the actual repository/base/revision or retained artifacts. A changed, dirty-unbound, missing, or superseded target cannot inherit fresh-review status. Late reports never apply to a successor or resurrect a terminal request.
- [ ] A different session cannot finish or replace another reviewer's assigned report. Report retries preserve the same immutable report and files.
- [ ] Address findings sends contextual feedback only to an authorized destination and does not silently edit code, start an automatic repair loop, accept work, or complete a task.
- [ ] View handoff and Review details never start an AI run. Save as handoff preserves usable content without AI synthesis. Preparation does not automatically launch AI critique in the pilot.
- [ ] Prepare handoff explicitly continues the authorized authoring session with the selected context and creates one saved handoff. Busy/offline/crash/retry cases use existing durable delivery without duplicate preparation or a silently chosen new execution.
- [ ] Update handoff preserves the prior snapshot and uses exact supersession. Preparation does not silently request independent critique or mark a human decision complete.
- [ ] Unsupported or unavailable model/effort choices are visible. Native review honors explicit settings or uses a compatible fallback, with requested versus observed settings retained. An explicit different reviewer is not replaced by incompatible historical evidence.
- [ ] Review-request replay keeps its original resolved selection after defaults change. A changed explicit selection with the same request key conflicts.
- [ ] Background reviewers do not clutter normal chat/execution lists, affect task lifecycle, or displace the implementation conversation. Their progress, permissions, cancellation, and failures remain reachable from the result and existing attention surfaces.
- [ ] Review details can show authorized available activity without requiring it for ordinary inspection. Pruned/unavailable activity is labeled honestly and leaves the report, evidence, selected settings, and terminal outcome intact.
- [ ] The complete pilot works through an existing conversation, exact handoff, manual AI findings, and contextual feedback, without broader navigation/team/automation features.
- [ ] Per-request harness/model/effort selection honors normal defaults and explicit overrides without persisting workspace/global preferences or modifying the authoring session.
- [ ] With both gates off, ordinary chats, tasks, executions, and task completion behave as before, with no new feature job or prompt/tool injection.
- [ ] Handoffs remain useful with AI review disabled. AI review cannot start while handoffs are disabled, regardless of later workspace preferences.
- [ ] Disabling with queued feature work prevents dispatch. Re-enabling does not silently resume the cancelled queue. Cancelling a queued preparation message does not cancel the authoring session.
- [ ] Disabling during a running operation retains attention, permission handling, and Cancel. Only the admitted authorized request can finish/save, with no new follow-on jobs or broader permission.
- [ ] Existing sessions with stale tool guidance receive a clear disabled response. Committed retries still return the original result, and no new caller bypasses the gate via a claimed completion.
- [ ] After disable and restart, saved handoffs/reports, exact URLs, old transcript cards, and retained files remain readable. Dedicated reviewer sessions stay out of normal lists without hiding unresolved runtime problems.
- [ ] The off switch does not roll back migrations, delete tables, or remove attachment retention roots. The implementation documents its integration points and a deliberate preservation/export path for actual removal.
- [ ] Trial notes cover follow-up effort, actionable AI findings versus time/cost, and whether people naturally use the handoff. No new metrics platform is needed.

## Later integration acceptance criteria

These criteria apply when the corresponding expansion is undertaken. They do not block pilot completion.

- [ ] Before broader harness rollout, reporting, supported native review, and fallback behavior are validated for each harness being enabled.
- [ ] Accept and complete rejects stale or ambiguous task completion without partial writes.
- [ ] Deliberate team publication includes only selected content/files and preserves privacy, provenance, and authority boundaries.
- [ ] Saved results remains usable for a taskless result after its originating chat is deleted. The menu and command-palette entry reach the same filterable list.
- [ ] Task Results sections remain outside editable bodies, hide when empty, and show saved snapshots without duplicate copies. Notes use their existing AI chat and ordinary result links.
- [ ] The opt-in creates one review per primary result, not per linked task. Off/null creates none automatically. Humans can still read and act on the result while review is pending or failed.
- [ ] Reported-only or scope-mismatched evidence cannot satisfy the later automatic-review preference.
- [ ] Team publication does not expose private review evidence or runtime links, and team review cannot implicitly invoke a personal agent.
- [ ] Reviewer selection follows one-off override, agent review defaults, then normal defaults. Use for this agent is the only picker action that persists defaults. Starting or editing a reviewer does not change global or implementation-session preferences.

## Implementation and evaluation order

1. Establish the feature boundary, two gates, additive storage, and disable/retention contract. Keep a short map of integration points and removal steps.
2. Build the complete enabled handoff path in an existing conversation and exact-result page, including reporting guidance, files, View/Save/Prepare/Update, and contextual human feedback. Do not change task lifecycle.
3. Add manual AI review with per-request model/effort selection, real background execution, durable scope/provenance, findings, and accessible runtime details.
4. Run the pilot persistence/auth/retry/recovery tests and the enabled-to-disabled isolation tests, including queued/running work and saved data.
5. Try real code and non-code work in the isolated data home. Evaluate usefulness before broader integration. The implementation milestone ends with a working, reversible pilot and its trial findings.
6. If the trial supports expanding the feature, separately roll out automatic review, saved workspace preferences, broader navigation/task surfaces, explicit task-completion integration, and team publication under their documented requirements. A successful pilot does not automatically authorize or require that expansion.

The broader factory gaps remain separate: general continuation through CI/reviewer events and repairs, proving requested behavior beyond the coverage of a review, authorized delivery, and sustained operation under failures. This task makes work durable, inspectable, and independently reviewable. It does not claim to solve all of them.

---

## Preserved original exploration and sources

The following is retained verbatim for context. Earlier exploratory checklists are not additional requirements for this implementation slice.

A possibility to consider, not a commitment to build. Riff here, then choose, refine or retire it when useful.

## Outcome

Explore AI output verification and the trust needed to reduce human review

## Why this is here

A clearly named capability with a gradual autonomy trajectory. Separate from the already specified lifecycle mechanics. Preserve the possibility of less human review over time, not permanent babysitting.

## Original thinking

> Missing major piece is output verification / QA by AI and trust

Source: [[task:01a03c17-cd01-7bff-a52b-a7828ad50646]]

> The bottle neck for AI productivity will always be human review. This will likely diminish over time as it gets better. It will make less mistakes and be better about reviewing itself.

Source: [[task:019de0ce-f537-7726-a275-63cf721c0243]]

## Questions and possible checks

These are suggested starting points, not settled product requirements.

- [ ] Use a real output with meaningful correctness criteria
- [ ] Expose checks, evidence, uncertainty, and disagreement
- [ ] Specify what the reviewer may resolve autonomously and what still needs human judgment

## Working notes

Add new thinking, evidence and decisions here. Keep important source qualifications visible.

## Context

[[note:01a04a5e-b00b-7b9e-be07-edaa304d9337]]
[[note:01a04a5e-bfc9-7546-992d-80e4396801aa]]

Imported from the preserved Ri sources on 2026-09-07. The framing and checklists above are organization aids, not replacements for the original wording.

## Source reconciliation, September 9, 2026

Recovered source details, September 9, 2026. These additions preserve missing qualifiers and decision questions. They do not assert an old symptom still exists, mark work complete, select an unresolved alternative, or authorize new external access. Existing status and metadata are unchanged.

## Reconciled scope and acceptance

- [ ] Preserve the Floodg8 comparison and use [[note:01a08845-214a-7b01-a790-97ecae514568]] for research findings. Separate verification, needs-review webhook notifications and parallel/stacked work, linking the notification and workstream owners.
- [ ] Define what an independent reviewer checks, how evidence and disagreement appear, and how trust can reduce unnecessary review without silently removing authority boundaries.

## Exact recovered source details

### S072, body lines 408

[[task:019df8a0-1836-7a64-9df7-3a35548c0dff]]

> - [ ] Floodg8 anything worth doing? Chatgpt says: 1. Self verification (I think claude and llms kind of already do this), 2. Get a notification work needs to be review, make a webhook channel for this, 3.Parallel tasks. My addition - stack tasks and have AI work through it. /Users/treyhuffine/dynamism/ai-task-manager/personal/[floodg8-execution-analysis.md](http://floodg8-execution-analysis.md)

&nbsp;