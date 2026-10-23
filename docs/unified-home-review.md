# Unified Home review

Review branch: `refactor/unified-home-experience`, in the separate `ai-task-manager-unified-home` worktree. It starts at `fix/team-mcp-clarity` (`d40987bd`) and incorporates main through `17a58dbb`. The independent Mac HUD fix `acae188a` remains an ancestor. No merge to main, push, deployment, production restart or real Home migration is part of this work. [Ninth review corrections](unified-home-review9.md) is the current finding ledger.

The owner's [20 October decisions](unified-home-revisions.md) supersede the container implementation. Local branch `archive/team-isolated-worker` preserves that implementation at `a5697a25cbb2025a2b2fa4301f770bf022c6f527`. It has not been pushed. [The isolation design record](team-isolation.md) lists its files, evidence limits and defects to resolve before reuse.

## Shared implementation

| Concern | Common implementation | Small contextual controls |
| --- | --- | --- |
| Home shell | `HomeShell`, `RailContainer`, `RailLayout`, `RailRows`, `useRailCollapse`, `HomePhoneBar`, `MobileTopBar`, `SpaceSelector`, WorkContext | Team identity, membership, assignment, Decisions and AI availability |
| Tasks | `TaskSurface`, `TaskList`, `TaskRow`, `TaskKanban`, `TaskDocument`, `PersonalTaskDocument`, `TaskPlanningProperties`, `TaskDateField`, `EntitySheet`, `EntityDetailHeader`, `EntityActionsMenu` | Shared audience/assignment versus private planning, My Area and publication |
| Notes and editor | `NoteList`, `NoteRow`, `NoteEditor`, RichEditor, history/diff and autosave | Shared revision and author checks |
| Search | `SearchPalette`, `parseSearchQuery`, `CommandSearchItems`, `RecentSearchItems` and common keyboard/focus behavior | Personal versus Team query adapters |
| Work entry | `StartWithAgentButton`, continue-target lookup, task launcher seed and ordinary launcher | One destination entry, with a choice only when personal and Team execution are both available |
| Agents | `AgentView`, `AgentSetup`, `WorkspaceCreateModal`, Files and terminal | Owner-only configuration, member file edits and terminal opens, member activity log |
| Chats | `ExecutionView`, `ExecutionTranscript`, `ChatTranscript`, `ChatComposer`, `ChatInputEditor` | Audience, creator, per-message requester and turn outcome controls |
| Models and sign-ins | Harness registry/runtime, ordinary model discovery, `ComposerProviderMenu`, `ModelMenuContent`, `ModelMenuProvider`, `ModelList`, harness settings | Shared sign-in notice and server-derived capabilities |
| Runtime | Ordinary Home placement, local runner, native bindings, queue and session-spec planning | Team turn admission and live member-scoped session tools |
| Workbench | Existing file/Git operations, merge/auto-merge, launcher Git queries, worker protocol seam, PTY manager, preview supervisor, Run and Preview | Home authorization, shared-resource filtering, manual operation attribution and viewer-safe preview URL |
| Results and skills | Common saved results, reviews, decisions, result preparation, skill manager and library | Shared author and requester, owner-managed Team skills |
| Data operations | Shared query functions, lifecycle/revision operations, typed operations and compatibility adapters | Explicit Home/member authority and independent private projections |
| Native Team access | Existing orchestrator registry, one raw-input MCP registration helper, shared alias validation and member transport | `list_homes` and explicit stable Home target, with no new member, client key or per-agent grant |

Review4 shares background-task stop/restart and archive preflight/confirmed-close operations across both Home types. Team Chat uses the ordinary member main-chat hook and common AgentView, with a small URL-selection adapter. Typed execution/title/backlink invalidation serves both Homes. Main's personal message_agent/delegate_work changes remain integrated, including receipt rendering in the common ChatTranscript. The existing Team start_execution action is a contextual registry entry calling the common launch operation, not a second execution engine. Personal-only delivery, Resync and desktop opener controls use contextual capabilities.

Review5 unifies personal and Team chat retirement, restores personal remote queued stops and retrospective labels, and applies closing admission to every ordinary dispatch. Concurrent closes share one confirmation. Idle cleanup rechecks after asynchronous process capture. Team tool tabs preserve the viewed chat, and New/model changes pass its ID through the shared main-chat operation after resource checks. Missing links render inline with Retry. Launch replay rechecks the sender’s permission bounds. GitHub controls, including Open PR, consistently use the accepted Team server account with named capabilities and attribution. Workspace and runtime cache refreshes now cover both existing manual keys and typed consumers.

Review6 adds shared pending/offline and refresh-error presentation, preserving cached chats and showing a composer only after an explicit empty response. Main chats expose the shared Restart control. The runner joins the original SDK close across retries, waits beyond the SDK escalation budget and confirms recorded process trees for every harness. Team CLI, HTTP and MCP use the same signed-session operations and alias/destination admission. Launches validate availability before creation, serialize identical request IDs and return accepted receipts after archive. Resume errors remain visible. All launch/import paths use shared typed workspace invalidation. Disclosed Team senders reach both stored messages and the ordinary prompt label.

Permissions are centralized in `team/capabilities.ts`, exposed through HomeContext and enforced at server entry points. The guard test rejects new direct role checks. Any active member can control shared work. Answering questions and approving or denying permissions requires a signed-in person. Disclosed session/agent and external AI credentials cannot approve work. A connected personal Home represents its signed-in person, an accepted relay limit.

Team agents run on the Team server as its OS user, using ordinary installed and signed-in harnesses. The owner configures folders and sign-ins. Members can use those agents and terminals to reach that OS account's files and accounts. Desktop creation records co-hosting, including a custom personal root. The owner sees a non-blocking warning when enabling AI or creating an agent. This is an accepted owner decision, not an OS isolation claim.

## Removed implementations

The original consolidation removed TeamShell, TeamDetail and TeamNotes presentation, the independent Team model picker and the duplicate chat writer. This revision removes the remaining independent Team chat feed/composer and restricted Claude engine, runner profile, probe, legacy profile and manual migration UI. Retained public endpoints adapt to ordinary chat lifecycle operations.

Container-only controllers, proxies, enrollment/leases, environment storage and approval UI, isolation wrappers, runtime skill bundles, worker preview paths, sandbox file helpers, runtime packaging, Dockerfiles, seccomp and qualification scripts are removed. The complete inventory and archive recovery ref are in [team-isolation.md](team-isolation.md). Shared runner/worker/terminal/preview files retain ordinary behavior.

Three useful ordinary fixes remain: preview URL scheme/credential/same-origin refusal, bounded preview log bytes and partial lines, and an explicit free port per OpenCode SDK server. The dependency patch keeps generated control authentication and removes the controller-specific password override. Its process test uses a synthetic native server, not an account.

## Database upgrade

Main’s `0019_groovy_may_parker` is preserved. The 20 October read-only dev journal check found 20 entries through that migration. The refactor appends pure drizzle-kit output `0020_unified_home_members.sql` and `0021_small_echo.sql`, their snapshots and journal entries. 0021 adds the per-member current-main-chat map. SQL/snapshots 0000–0021 and existing journal entries remain identical to reviewed source b2495707. Reviews4–8 add no migration. Review9 appends CLI-generated `0022_ordinary_the_professor` for four nullable model-speed columns. Main's independently released speed 0020 artifacts and applied receipt remain intact through the exact-history convergence described in the ninth ledger. No hand-written migration SQL remains. Migrations 0000–0019 are byte-identical to main. No production database was opened.

| New storage | Purpose |
| --- | --- |
| `personal_area_defaults`, `reference_area_choices` | Private Team/source-Area defaults and explicit choice/clear provenance |
| `member_chat_views`, `member_execution_views` | Independent read/unread and pin state |
| `member_preferences` | Per-member browser voice preferences and current-main-chat pointers |
| `team_activity` | Member-attributed manual agent file/Git/preview edits and terminal control |
| Nullable member/sign-in columns | Chat/execution/agent creators, run requester and result/review/decision authors |
| Virtual `runs.result_operation_message_id` and index | Bounded lookup of a result operation without scanning/parsing all runs |

No existing table is rebuilt. Existing rowids and FTS keys stay intact. There is no execution environment table, environment link or legacy profile. Added foreign keys on existing tables use NO ACTION. Existing nullable creators remain NULL. The old sealed credential remains saved and unused until explicit owner removal.

At boot, queued legacy requests are cancelled and running requests interrupted with a visible reason. Completed turns never replay. Existing chat IDs, authors, task links, insertion order and public cursors survive. With one active configured agent the next send binds the same chat. Otherwise the ordinary picker chooses an agent. Without an agent the history remains readable.

The populated rehearsal reconstructs genuine predecessor DDL at 0018, main-0019 and branch-0020 for personal and Team Homes. It populates synthetic records mostly through today's query layer, including personal references, Area choices, ranks and links. It uses the safe server-boot path, compares old fields and rowids, verifies FTS/FK integrity and the sealed credential, and checks pending-migration refusal outside boot and a stable second boot. This is fixture-preservation evidence, not historical owner-data seeding. Regeneration against the current snapshot must report no changes. Use the normal safe migration runner and supported backed-up-Home recovery, never drizzle-kit migrate or an ad hoc downgrade.

## Verification and limits

[The evidence ledger](unified-home-verification.md) records source, commands, result categories and final checks. The spec's W00–W11 and the revision checklist are the completion record.

- `team/ai/http-restart.test.ts` uses a separate real HTTP Home process, exits and starts it twice, and checks two members, human approval, AI refusal, stop, restart interruption, saved native identity and authorship. The provider is fake and no native account is used.
- Server tests use disposable Homes and the actual ordinary runner with fake providers. The two-member journey checks continuation, human approval, agent refusal, stop and restart attribution. Every registered harness is exercised through that runner fixture.
- Browser tests render real common components and CSS with synthetic transports. They cover drafts, member switching, shared editing, settings, destination choices, dates in Tokyo and Denver, source labels, Run/Preview and 40px Mac sheet clearance.
- Electron history evidence bundles the actual Team window, production history-menu helper and sandboxed Team preload and uses CDP key/mouse dispatch plus a menu callback. It records platform, architecture, build mode and geometry, and verifies no personal bridge or Node authority.
- These checks do not claim real provider account entitlement, physical input or signed packaged-release qualification. No Docker operation was run for this revision.
- Voice server tests use a fake transcription provider. Actual microphone quality, browser permission prompts and live provider speech recognition remain hardware/account qualification.
- File activity records successful app-mediated edits, Git/preview controls and terminal control changes without keystrokes. It does not claim surveillance of every command or external filesystem edit.
- Cancelling a launcher discards only a newly prepared pristine reference. Any intervening edit, private planning or associated execution protects it from deletion. A browser/process crash before cancellation is acknowledged can leave that safe reference for explicit removal.

## Review commits and diff

- `45a46fcf`: ordinary Team execution, shared components and operations, capability enforcement, migration and regression fixes.
- `9f441f2f`: remove archived container packaging and qualification tools.
- `b4c23bde`: phone Decisions/mine creation, Team session navigation and display-name context.
- `85a1917c`: real HTTP, two members and actual Home process restart proof.
- `31eccc6f`: typed reference catalog invalidation after agent folder changes, with a QueryClient regression.

Compare the complete refactor with `git diff 17a58dbb..refactor/unified-home-experience`. Compare review9 fixes and main merge with `git diff 57595477..refactor/unified-home-experience`. Compare this owner's revision with `git diff archive/team-isolated-worker..refactor/unified-home-experience`. The final verification manifest is generated after the corrections/docs commit and names the exact immutable HEAD.


## Second review corrections

[The finding ledger](unified-home-review2.md) maps the review of `37716e77` to fixes and tests. Main was incorporated at `a0a3fdd3`. Compare `git diff 37716e77..refactor/unified-home-experience` for the corrections plus main merge.

Both Home kinds now share boot recovery for orphan processes, stale runs, results, setup scripts, previews and idle sweeps. Team New/model changes add and select a chat for that member, while Resume selects an existing chat, including with AI off. Cancellation waits for its handle to close and owns its pending prompt rejection. Failed close blocks dispatch until an explicit retry closes it safely. Lifecycle Keep sends current associated task states on every native resume.

Private reference sync uses bounded batches and opaque metadata cursors including same-second revision counters. A steady pass with 21 unchanged assignments, 30 added tasks and 15 saved notes takes five requests with no individual body reads. JSON cursors need no schema column.

Removed after review: obsolete auth/turn-token modules, old test seams and transition/admission helpers, sole-control predicate, uncalled send-receipt helper, obsolete native fixture, duplicate personal task-page document/planning UI and duplicate personal rail-strip rows. Team rail supplies contextual places to common layout/width/rows and persistence. Team search shares commands, prefixes and recents. Public team.ai compatibility procedures remain thin, capability-checked adapters to preserve existing contracts and URLs. They contain no independent engine.

The root registry stores canonical root/kind metadata only. It discovers custom personal roots after successful startup, including after Team creation, and combines those with defaults and desktop co-hosting records. An arbitrary historical custom root never registered or recorded cannot be found without searching unrelated disk locations. Discovery grants no authority.

Claude and Codex support strict MCP configuration. Cursor, OpenCode and Antigravity may load ambient MCP tools from their OS-account configuration. Registry capabilities disclose that limit. The accepted shared OS account can access local files and keys. No strict OS isolation or real-account validation is claimed.


## Third review corrections

[The current ledger](unified-home-review3.md) maps each high, medium, low and unverified finding. Files create/rename/directories/conflicts now pass shared editAgentFolder admission. ExecutionView task chips, reviews, backlinks and shared resource reads use the ordinary operations with Team authority, and personal device/app hooks are capability-gated. Results includes the lifecycle provider. Actual Team boundary/tRPC completion and production-build desktop smoke provide evidence beyond component mocks.

TeamTaskPanel/TeamNotePanel remain contextual wrappers around shared chrome, editor, status, history and references. Their independent header/action-menu implementations were removed. Board/phone/search creation now shares one mine/Area/Decisions-aware hook. Public team.ai adapters delegate creation/retirement/stop to common lifecycle operations, and transcript queued cancellation calls the ordinary session operation.

Protocol 2 clients receive an update message from old protocol 1 Team servers. Updated Homes retain protocol 1 adapters. Update the Team server before using new native operations. Discovery probes support and advertises no unsupported operations. The real-main version-skew test uses the pinned main checkout in the final manifest.


## Seventh review corrections

[The current ledger](unified-home-review8.md) maps all findings to common runner,
shared UI, native input and attribution fixes. It adds no duplicate Team runtime
or migration. Launch intent is saved atomically in an existing system-event JSON
record, hidden by the common transcript's subtype allowlist. Native actions keep
strict aliases, including Plan/provider/task choices. Recycle, Archive and idle
shutdown share the same confirmed-close path. Recorded harness identity tolerates
exec argv changes using PID/birth/parent, with strict owner checks and unrelated
process controls. No unobserved process is killed by name. The final external
manifest separately qualifies the exact committed code and docs.
