# One Ri experience: implementation specification and task list

Version 2, 2026-10-20. Runtime revisions: `45a46fcf`, `9f441f2f`, `b4c23bde`. Owner review decisions are tracked in [unified-home-revisions.md](unified-home-revisions.md). Previous evidence applies only to the archived implementation until reverified. Status: review implementation on `refactor/unified-home-experience`. Checked items have recorded verification. Unchecked items remain required. This document replaces the earlier design-direction-only version.

**Scope assumption:** the full transition includes team-owned agents and executable chats, using the same application components and ordinary on-server harness architecture as personal Ri. This follows the requested shared-app direction. This spec defines that full-execution variant, including the runtime work needed beyond sharing the existing UI. If the owner supplies a later personal-only execution constraint, reconcile sections 2-3 and 7-11 before implementation. Do not silently deliver that smaller scope as the full transition.

The product decisions for priority, source labels and optional Area defaults below are recommendations adopted by this spec. They are not claims that those features are already implemented.

## 1. Assignment and starting point

Implement the complete transition described here, retaining existing data, permissions, connections and personal workflows. The finished product is one Ri application whose active Home determines its data, member identity and available capabilities.

Read this whole document and the repository's AGENTS.md before editing. Use the implementing-specs skill if available. Keep the work packages and their evidence updated. A checked box requires verified behavior, not just code. Do not interpret another phase's existence as permission to leave an incomplete feature in the final result.

Start a new implementation branch and isolated worktree from `fix/team-mcp-clarity`. It includes the main-branch HUD fix and the latest spec and Area-label changes. Incorporate any newer main changes into the implementation branch before starting. Consolidation was unimplemented at that starting point. The review branch is not deployed. Relevant preceding commits:

- `4f5c187e`: MCP access wording, a Ri client preset, and the manual team test guide.
- `4cab7cd6`: initial consolidation direction and accurate task navigation instructions.
- `c0283405`: Mac desktop side sheets clear the 40px native drag bar, with browser regression coverage. This fix was independently cherry-picked to main and pushed as `acae188a`, without the consolidation or its schema work.

**Delivery for review:** commit the completed refactor on its implementation branch and provide the code diff, a map of the components and operations now shared, removed duplicate paths, migration details and verification evidence. The owner wants to review the code before it lands. Do not merge or push the refactor to main, deploy it, or restart production as part of this assignment.

Inspect the actual checkout before making assumptions about migrations or intervening changes. Preserve other agents' work and never switch a shared checkout's branch. The linked `agentex` repository is available for necessary harness/worker changes, following its own instructions.

The [current testing guide](team-testing.md) describes the implemented workflow. The [tenth review ledger](unified-home-review10.md) records corrections to the earlier acceptance claims.

## 2. Product contract

Ri has one task and note experience. A personal Home belongs to one person and gathers selected work from connected teams. A team Home has members, roles and assignees. Both are useful with AI disabled.

| Common experience | Personal addition | Team addition |
| --- | --- | --- |
| Tasks, list and board, detail, editing, lifecycle, search | Combined personal and imported team work | Members, assignees, shared audience |
| Notes, editor, attachments, decisions and history | Private notes and saved team references | Shared authorship and conflict handling |
| Agents, chats, model selection and results when enabled | Personal planning and execution | Team-owned execution and member attribution |
| Settings, appearance and navigation | Connected Homes and private organization | Membership and host capability administration |
| APIs and MCP over shared domain operations | Optional authorized access to connected teams | Member-scoped tools and separately revocable clients |

The proportion shared is not a numerical target. A common behavior must have one implementation. Differences belong in explicit capabilities, data adapters or small contextual controls. Do not build a second complete app underneath another name.

**Assignment determines automatic inclusion in personal work. It never determines permission to browse a team.** Within today's team model, active members can browse all shared tasks and notes, including unassigned work and work assigned to another person.

## 3. User journeys and acceptance contracts

### J1. Personal Ri without a team

The existing user opens their tasks, notes, Deck, agents, chats and settings normally. No team setup, member vocabulary or new required organization step appears. Existing keyboard shortcuts, routes and model preferences continue working. They can use tasks and notes without configuring AI.

### J2. A team with no AI

An owner creates the team using the existing setup flow. Members join and immediately use Tasks, Notes and search. They can create, read, edit, archive, assign and filter shared records. Owner-only destructive and administrative actions retain their restrictions. No model selection, agent naming, subscription sign-in or MCP configuration is required.

### J3. Connect a personal Home once

A person connects an existing team membership through Settings → Teams. No duplicate member is created. That connection supports browsing, personal caching and authorized native agent access. It does not require a second MCP key.

The Home selector has a consistent location and behavior in personal, embedded-team and standalone-team contexts. Standalone members without a personal Home have no fictitious My Ri destination. Switching preserves the destination's navigation and never changes the owner of a running chat.

### J4. Browse the team and organize personal work

Selecting Team Huffine opens the same Tasks surface used by personal Ri, with both List and Board. It initially shows the team's work, with an optional Assigned to me filter and Area filters.

A task assigned to the connected member is imported automatically. An unassigned task can be added to personal work without changing its assignee. These controls remain adjacent and easy to find, including in desktop windows.

Personal Tasks → Source → Team Huffine displays imported personal work from that team and explicitly labels that scope. It offers Browse all team tasks. It must not imply that assigned/imported records are the entire team's data. Current Work, Todo and All filtering remains visible. Delayed or failed sync has an intelligible state with Retry rather than an empty list that looks authoritative.

### J5. Work on a shared task with a personal agent

From a team task viewed inside personal Ri, Work with agent opens the ordinary personal launcher directly. If the task needs a personal reference, create or reuse it idempotently as part of the launch. Cancellation must not launch anything. A failed launch may retain the reference, with clear retry behavior, but must not create duplicate records or chats.

The user chooses a configured personal agent, harness and model. Work runs under personal authority. Starting work does not silently change the shared task's lifecycle. Personal conversation, planning and artifacts stay personal. Publish result explicitly selects a summary, links or files and shows the receiving audience. Shared task field edits continue to be shared immediately.

### J6. Native personal agent accesses all permitted team work

A fresh personal chat can discover connected teams, list their tasks and notes, create unassigned records, edit them, assign tasks, and complete or archive tasks using the existing membership. The records need not first be imported into personal work. Reads do not create references, change assignment or sync an entire team into the personal task list.

A request to edit a record in Team Huffine must target that Home, even if personal Ri contains another record with the same title. Unknown or ambiguous Home names require disambiguation. Do not fall back to writing a personal record when a remote operation fails.

### J7. Team-owned agents and chats

When the owner enables AI and configures a team agent, the team uses the normal Agents, Chats, model picker, results and permitted workbench components. Members can run owner-enabled team agents. Records and output from those runs belong to the team, and the initiating member and subsequent message authors remain visible.

A member with no personal Home can use this feature. A personal user viewing the team can choose an available personal or team execution environment. The launcher must identify where work runs and who can see the chat. Only offer a choice when both are available. Existing chats retain their execution owner when the viewer switches Homes.

### J8. MCP without adopting the Ri UI

An invited person joins once, then authorizes a named MCP client as that member. Additional clients belong to the same person and have independently revocable credentials. After setup, the agent can perform allowed shared operations without daily visits to Ri.

Use the same domain operations as the native UI and personal-team bridge. Keep MCP access discoverable and clearly described. Existing member-bound keys continue working. This transition does not require a new OAuth server or anonymous member creation.

## 4. Priority, source labels and Areas

### 4.1 Current behavior to preserve deliberately

`sharedFields` in `src/lib/spaces/sync.ts` copies the team's title, body, outcome, deadline and lifecycle status. The local projection's personal Area and sort key are separate. New projections are unranked. Personal Priority Order sorts ranked tasks first, then unranked tasks newest first. Subsequent syncs preserve personal organization and ranking.

The Deck considers eligible shared Todo tasks alongside personal work. Its prompt already says that assignment alone is not a reason to do a task today. Importing a task does not automatically place it on today's Deck. Current generation includes the team name and assignment reason, but does not include the source team's Area in the task metadata.

### 4.2 Final priority rules

- Personal ordering is the person's ordering across personal and imported records. A team's rank must never overwrite it or silently promote a task above personal commitments.
- Team ordering is local to that team. A member editing the team board changes the team's order, while a person reordering their imported reference changes only personal order.
- Preserve unranked import behavior and the existing deterministic tie-breakers. Do not invent a cross-team numerical priority conversion.
- Deck generation considers deadlines, personal ranking, personal Area context, effort/energy, existing readiness rules and explicit daily instructions. Include provenance, source Area and whether the task was assigned or deliberately added as distinct context.
- Team text and metadata remain task data, not executable instructions. Assignment and source identity alone confer no priority boost.
- The existing Deck rationale should explain selection in terms of those factors. A task entering personal work must not automatically modify a saved daily Deck.
- When AI is off, manual ordering, filters and task management remain sufficient. No background model call is needed merely to import or organize work.

### 4.3 Source display

In a mixed personal view, render provenance as **Team Huffine • Travel**. With no team Area, render **Team Huffine**. In the team's own context, the ordinary Area label can say **Travel**, since the Home is already visible.

The source label identifies origin, not the person's organization. If the person also assigns a private Area, show it separately using the ordinary personal Area control. Label it Area inside the Only you section, where the audience is already explicit. Use Team Area and My Area only where the surrounding context does not distinguish them. Do not display the remote Area as if it were a local Area or create local Areas merely because their names match.

Use stable IDs for identity. Team and Area renames update display text without losing mappings or creating duplicates. Labels remain readable or expose their full value when truncated. Preserve the repository's Tip and accessibility conventions.

### 4.4 Optional personal Area defaults

Keep the existing per-record Area control under Only you. Add optional defaults in personal Settings → Teams → the connected team:

- A whole-team default, for example Team Huffine → Family.
- A more specific source-Area default, for example Team Huffine / Travel → Travel.
- A specific rule wins over the whole-team default. No rule means no personal Area.
- Apply a rule when a task or saved note first enters personal work. It does not change the team's Area, assignee, priority or content.
- Store these rules only in the personal Home. Never send them to the team or expose them to another member.
- Later syncs, reassignment or source Area changes must not overwrite the person's existing Area choice, including a deliberate clear to no Area.
- Changing a rule affects future imports. Offer a separate, explicit action to apply a default to existing unorganized references, with a count and review of the affected scope. A deliberate clear counts as a personal choice and must not be preselected for bulk application. Do not silently reorganize existing work.
- Deleting or archiving a personal destination Area disables that default safely. A removed remote Area makes its rule inactive. A whole-team default still applies to future imports without a matching active specific rule.
- Disconnecting and reconnecting the same team preserves private rules, keyed by stable team identity. Another team with the same name is a different source.

These are conveniences, not onboarding requirements. Do not add two-way Area synchronization, required mapping wizards or per-team priority weights.

## 5. Shared application architecture

### 5.1 Home context

Resolve an explicit active Home, viewer identity, membership/role, available operations and execution choices at the route boundary. Screens consume that context. Persisted filters, navigation, query caches, subscriptions and editor drafts must identify the Home they belong to.

The execution environment and data Home are different concepts. A personal agent may work on team data. A team-hosted run belongs to the team even when a personal browser initiated it. Neither is inferred from the last selected navigation item.

Capabilities answer concrete questions: edit content, delete permanently, administer members, configure an agent, run with a personal agent, run with a team agent, open a terminal. Derive them from authenticated server authority and actual runtime availability. UI visibility is never the authorization boundary.

Retain separate page/document boundaries initially if needed. Sharing components does not require a risky simultaneous rewrite of transport and cache isolation. Any later same-document switching must first prove scoped caches, persisted state and draft ownership. The finished experience must remain consistent across those internal boundaries.

### 5.2 Existing implementation map

| Concern | Starting points | Required treatment |
| --- | --- | --- |
| Home identity and authority | `src/lib/home/authority.ts`, `src/lib/team/page-authority.ts`, `src/lib/trpc/init.ts` | Replace blanket team exclusions only for deliberately shared capabilities. Keep personal-only operations protected. |
| Team connection and transport | `src/lib/spaces/connect.ts`, `router.ts`, `remote.ts`, `document.ts`, `src/lib/trpc/client.ts` | Reuse member-authenticated proxy and typed operations. Never deliver stored member tokens to the model/browser. |
| Navigation | `src/components/spaces/space-selector.tsx`, `src/components/team/team-shell.tsx`, `src/components/dashboard/` | One shared shell/navigation contract, with context-specific destinations. |
| Tasks | `src/components/tasks/task-surface.tsx`, `task-list.tsx`, `task-kanban.tsx`, `task-slideout.tsx`, `src/components/team/team-detail.tsx` | Extract personal dashboard assumptions and reuse one list/board/detail implementation. |
| Notes | `src/components/notes/`, `src/components/team/team-notes.tsx`, `team-detail.tsx` | One list/detail/editor family with revision-aware shared editing. |
| Personal references | `src/lib/spaces/sync.ts`, `commands.ts`, `src/components/spaces/` | Preserve one reference per source record, private fields and explicit publication. |
| Priority and Deck | `src/lib/db/queries.ts`, `src/lib/ai/generate-deck.ts`, `deck-generation.ts` | Preserve separate ranks, add source context and mapping-aware personal Areas. |
| Agents and execution | `src/lib/executor/`, `src/lib/worker/`, `src/lib/server/operations/workspaces/`, `executions/` | Reuse the normal engine on the Team server with member authority. |
| Models | `src/lib/harness/registry.ts`, `src/components/settings/model-list.tsx`, `provider-model-selector.tsx`, `src/components/executions/composer-provider-menu.tsx` | One registry, availability model and picker family. |
| Chat UI | `src/components/chat-ui/`, `src/components/team/team-chat.tsx` | Reuse transcript/composer/result interfaces while retaining member authors and team audience. |
| Existing team AI | `src/lib/team/ai/`, team AI settings and chat tables | Migrate or adapt existing conversations and settings, then remove replaced duplicate runtime/presentation paths. |
| External access | `src/lib/team/mcp/`, `src/lib/external-ai/`, `src/lib/orchestrator/` | Shared operations, explicit targeting and unchanged existing public contracts. |
| Desktop | `src/components/desktop/`, `src/app/globals.css`, `desktop/team-window.ts`, `desktop/viewer-trust*` | Consistent chrome and navigation without granting team content personal native privileges. |

Verify filenames in the actual checkout. Extract reusable pieces in their existing component families rather than creating a giant Home component with conditionals for every feature.

### 5.3 Editing and cache invariants

Keep optimistic mutations at the hook layer, with partial cache merges and correct list/detail shapes. Preserve revision checks, conflict resolution, durable unsaved drafts, attachment addressing and explicit history attribution. Never overwrite focused editor content with a server echo.

A personal projection's local ID and its team's canonical record ID are distinct. The shared surface must carry both where necessary and send each operation to the owning Home. No write may guess identity from a title or a coincidentally matching ID.

Keep remote shared edits online and revision-checked. On failure retain the draft and show retry/recovery. Do not invent an offline write queue as part of this transition. Personal planning can continue locally under the existing rules.

## 6. Native agent access contract

Add connected-Home discovery to the orchestrator registry if no equivalent action exists. It should expose stable Home IDs, display names, connection state and allowed operations, not credentials. A new `list_homes` action is suitable. Use the existing action generation for CLI and signed MCP.

Preserve existing action names and personal behavior. Add an optional `target_home_id` to appropriate content actions, with omitted meaning the calling session's bound Home. Never change that default because a browser switched spaces.

- Local calls retain existing IDs and result shapes. Explicit team targeting uses the team's canonical IDs and returns enough provenance to prevent confusing them with cached local IDs.
- Resolve connected-team credentials on the server. A session must be authorized to use that connection through its existing agent/tool access policy.
- Initial coverage: list/get/search/create/update tasks and notes, list members and Areas, assign tasks, lifecycle transitions, history and published results. Permanent deletion retains owner checks and existing external-tool scope restrictions.
- Route operations through shared domain operations and the existing member-authenticated team transport. Preserve body revision checks, idempotency keys and AI actor attribution.
- Read-only calls do not import records. Writes to the whole team do not require a personal reference. Creating a team record leaves it unassigned unless requested.
- Search and pagination are bounded and explicitly scoped. Do not silently search every connected team by default or write after a partial/disconnected lookup.
- Revocation and membership removal take effect on the next operation, including existing sessions. Unknown outcomes reconcile without duplicate creates, transitions or publication.
- Personal external MCP content keys must not silently gain access to every connected team as a side effect. Preserve their existing allowlist unless a person explicitly authorizes a separate expanded scope. Native signed sessions and external content keys remain distinct principals.

## 7. Roles, optional AI and settings

Use the existing owner/member roles. Do not introduce a new custom-role builder as part of consolidation.

| Operation | Owner | Active member |
| --- | --- | --- |
| Read/create/edit shared tasks and notes, assign, archive | Yes | Yes, as today |
| Permanent delete and membership administration | Yes | No, preserving current policy |
| Create/configure team agents, allowed folders, harness credentials and limits | Yes | No |
| Read shared agents and team chats | Yes | Yes |
| Start a chat on an owner-enabled team agent | Yes | Yes |
| Send a message to an enabled shared chat | Yes | Yes, with per-message identity and serialized execution |
| Stop/cancel any team turn, archive or close a shared chat | Yes | Yes |
| Answer a question or approve/deny a permission prompt | Signed-in person only | Signed-in person only |
| Edit shared agent folders and open their terminals | Yes | Yes |
| Manage personal planning, personal Area defaults or personal execution | In their own personal Home only | In their own personal Home only |
| Create/revoke their MCP client credentials | Yes | Yes, as that same member |

Every active member may control team work. Agents and machine credentials never answer or approve prompts. Members leaving or being removed lose future reads, sends, terminal access and tool authorization. Revalidate live authority rather than trusting a cached role from connection time. Existing committed shared work remains attributed to the original actor.

Settings use the existing navigation and shared sections. Membership, invitations and team host configuration are contextual sections. Personal Teams connections and private mapping defaults appear only in personal settings. Keep local device/service controls outside a remote team's authority.

AI availability is an optional capability for both Home kinds. Disabling AI leaves CRUD, search, manual order and membership working and keeps prior chat history readable. It blocks new runs and stops/cancels team AI work under the existing stop semantics. Changing provider authentication or removing a member cannot leave unauthorized queued work running.

## 8. Team agents, harnesses and executable chats

### 8.1 Reuse the normal agent/execution model

Use the existing workspace/agent, execution/chat, run, event and result architecture. Add the required team actor/ownership fields and checks rather than building another team-specific execution database or hardcoded provider loop.

Team agents are owner-configured scopes: purpose, standing instructions, permitted folders, connector/MCP access and available execution environment. A task/note-only team has no mandatory agent configuration. Enabling simple shared AI can use an ordinary team agent with a default display name based on the Home, without asking the owner to name another AI persona.

A team chat is visible to the team. Every send has an authenticated member author. Preserve creator identity and per-turn requester identity separately. Concurrent sends are serialized with idempotent receipt handling. Resume, retry, cancellation and server restart preserve task links, author attribution and execution ownership.

Use the ordinary transcript, composer, model picker, results and permitted workbench. Show shared audience prominently. Team-hosted logs/artifacts intended for members are shared outputs, so host secrets and unrelated filesystem details must never be captured into them.

### 8.2 Harness parity and authentication

Use `HarnessId` and the shared registry exhaustively. The currently configured registry includes Claude, Codex, Cursor, OpenCode and Antigravity. Use the ordinary registry capability, installed-binary and signed-in-account checks for every enabled harness. Do not retain a Claude-only switch or silently substitute Claude when a user chooses something else.

The full-parity task remains incomplete if a registered supported harness has been omitted solely to reduce effort. A genuine runtime incompatibility must be documented with reproduction and an explicit unavailable reason, not represented by a broken selectable model. Keep ordinary-runner fixture evidence per harness and report real-provider qualification separately.

Use configured subscription sign-in by default. Offer explicit API-key authentication only where the selected provider supports it. No implicit fallback from subscription to paid API billing. The owner signs in through the ordinary harness flow, understands everyone on the team uses that sign-in, and can revoke it. Reuse secret storage and authentication resolution. Application responses do not expose secret values. The shared OS account risk in section 8.3 still applies.

### 8.3 Team server authority and deferred isolation

Team agents run as ordinary workspaces on the Team server, using this Home placement and the normal local runner and harness integrations. The owner chooses the folders and signs in through the existing harness flow. Everyone on the team uses this sign-in.

The owner accepts that active members can use team agents and terminals to reach files and accounts available to that OS user. Cloud or dedicated servers are expected. Hosting beside a personal Ri remains supported, with a clear, non-blocking warning when enabling AI or creating a team agent. Record desktop co-hosting at creation and detect a personal Home under the same OS user.

Permissions are enforced at the Home before dispatch, not by the agent. Session tools belong only to this Team Home and run under the requesting member's authority. Personal-only capabilities remain unavailable. Files, Git, terminals and previews use the existing operations and worker seam. The personal desktop bridge remains unavailable to remote Team documents.

Isolation is deferred, not dropped. [team-isolation.md](team-isolation.md) records the archived implementation, accepted risk, evidence limits, review defects and future worker-placement integration.

## 9. Persistence and migration plan

No production wipe or history squash is part of this transition. On 22 October the sole owner confirmed that none of the refactor migrations had been applied and explicitly authorized deleting and regenerating conflicting branch migration numbers. Main's 0000–0023 SQL, snapshots and journal entries remain byte for byte unchanged at `9528aabd`. The CLI generated one new migration, `0024_breezy_rawhide_kid`, from those snapshots. It adds the shared author, private member view/preferences, private Area organization and activity fields. There is no `lineages` directory or model-speed runner exception. SQL was not edited by hand. An independent CLI generation from main's snapshots produced byte-identical SQL. This instruction supersedes the disposable branch immutability assumptions in review9. Apply through the existing safe runner. Keep IDs, relationships and FTS rowids. Populated personal and Team upgrades from main 0018 through 0023, repeated boot and old-client refusal are tested using isolated synthetic Homes. No real Home was opened or migrated in this pass.

Required persistence outcomes:

1. **Personal Area defaults:** private storage keyed by stable team identity and optional source Area identity, pointing to a valid personal Area. Enforce at most one team default and one default per source Area. SQLite nullable uniqueness needs an explicit strategy, such as partial unique indexes. Preserve enough private provenance to distinguish an unchosen Area from a manually selected or deliberately cleared Area. Legacy records whose choice history is unknown need explicit review before bulk application, not an inferred permission to reorganize them. Rules and choice provenance must not appear in team APIs or shared history.
2. **Personal references:** preserve existing `sourceTeamId`, canonical source IDs, private `areaId`, local `sortKey`, source snapshots and private planning. No migration may copy the team's order into personal rank or confuse remote Area IDs with local foreign keys.
3. **Team execution ownership:** add the member/actor information needed by existing agents, executions, chats, runs and events. Personal rows remain valid and need no fictional member. Team authority must be derivable consistently at every entry point.
4. **Existing team chat:** preserve chat IDs, message order, author IDs, event cursors, task links, queued/finished outcomes, model preference and configured authentication. Drain or explicitly cancel in-flight old-runtime work before cutover. Do not replay completed turns or copy personal history.
5. **Connection compatibility:** retain native team connections, member identity, invitations, sign-ins, MCP keys and revocation. Existing URLs and `external-ai` settings anchors continue to resolve even though the visible label is MCP access.

Before writing migrations, inventory the schema in the implementation checkout and map every old record to its target representation. Prefer adapting existing tables to copying records. Rehearse on disposable populated personal and team databases, including non-empty histories and private projections. A successful fresh database migration alone is not acceptance.

Keep any transitional adapters narrow and removable. Record the cutover and remove replaced writers so there is one source of truth. Rollback must not attempt to run old code against an unsupported new schema. Use the application's existing compatibility/recovery behavior and documented backup restoration procedure.

## 10. Verifiable work packages

The [review map and captures](unified-home-review.md), implementation evidence and old-to-new persistence inventory are tracked in [unified-home-verification.md](unified-home-verification.md). Requirements remain unchecked until their behavior is verified.

Mark a package complete only when its listed behavior and tests pass. Record implementation commits and test evidence beneath it. All packages are required for the full scope assumed in this document.

### W00. Baseline and regression inventory

Dependencies: none.

- [x] Read this spec, AGENTS.md, current Home specification, chat/harness, desktop, optimistic-update, migration and background-AI documentation.
- [x] Inventory existing shared components, team boundary checks, schema and public actions. Record the baseline branch/commit and pre-existing failures separately.
- [x] Create disposable personal and team fixtures with owner plus member, duplicate record names, tasks in every lifecycle state, notes, saved references, chat history and an existing MCP key.
- [x] Capture current desktop/web/phone entry points and verify the Mac toolbar fix is included.

Done: reproducible fixtures and a scope-to-code inventory exist. No production Home has been restarted or changed.

### W01. Shared Home and capability boundary

Dependencies: W00.

- [x] Define the route-level Home context and server-derived capabilities, reusing existing identity types.
- [x] Scope navigation, filters, queries, subscriptions and drafts correctly. Preserve legacy routes and independent running work.
- [x] Keep data Home, execution Home, ordinary placement and member authority explicit.
- [x] Test personal, embedded team, standalone team, disconnected team and removed-member contexts, including crafted requests denied server-side.

Done: shared screens can consume one context without gaining broader authority. Both old entry points continue working during extraction.

### W02. Shared shell, Tasks and Notes

Dependencies: W01.

- [x] Reuse one navigation structure and common list/board/detail/editor components, extracting personal dashboard assumptions.
- [x] Add member/assignee/audience controls through contextual sections. Preserve lifecycle, history, attachments, editor conflicts and unsaved-input guards.
- [x] Make all permitted team work browsable by default. Preserve optional Assigned to me and Area filters.
- [x] Clearly distinguish personal imported-team filters from the full team browser, with a direct link between them.
- [x] Remove replaced TeamShell/TeamDetail/TeamNotes presentation implementations after their callers use the shared components.

Done: J1, J2 and the browsing portion of J4 pass through the same component families on desktop and phone. Personal behavior has not been reduced to the former team's subset.

### W03. Personal sync and direct task actions

Dependencies: W01-W02.

- [x] Preserve automatic assigned-task imports, explicit inclusion/removal and saved-note references. Keep refresh bounded, incremental and deduplicated.
- [x] Show sync freshness/failure and a retry action. Make Todo/Current Work filtering understandable for newly imported tasks.
- [x] Expose Work with agent directly on shared tasks inside personal Ri, with idempotent reference creation and the normal launcher.
- [x] Preserve private planning and explicit Publish result without automatic shared status changes.
- [x] Test assignment changes, removal, reconnect, unknown outcomes, launch cancellation/retry and duplicate requests.

Done: J4-J5 pass without manually navigating through a second task detail to start work.

### W04. Priority and source presentation

Dependencies: W02-W03.

- [x] Render source Team • Area consistently on mixed task/note lists, board cards, details and relevant Deck surfaces.
- [x] Preserve separate local and remote ranks and distinguish Team Area from My Area.
- [x] Add source Area to Deck context without replacing personal Area context or changing the assignment-neutral ranking instruction.
- [x] Test ranked versus unranked order, reorder in each Home, later sync, Area rename, missing Area and unchanged saved Deck on import.

Done: a user's local ordering survives team changes, provenance is clear and Deck context names the correct two kinds of Area.

### W05. Optional personal Area defaults

Dependencies: W03-W04.

- [x] Add private rule persistence and query-layer operations with valid unique constraints and destination checks.
- [x] Add optional team-level and source-Area defaults in personal Teams settings.
- [x] Apply defaults only on first import/save, preserving later private choices and deliberate clears.
- [x] Add explicit preview/apply to existing unorganized references, never automatic reorganization.
- [x] Test precedence, no rule, task/note imports, rename, deletion/archive, reconnect and same-name teams. Prove no rule data leaves the personal Home.

Done: section 4.4 passes without requiring mapping to connect or use a team.

### W06. Native agent team access

Dependencies: W01, W03.

- [x] Implement connected-Home discovery and additive explicit Home targeting in existing content actions.
- [x] Reuse member-authenticated operations with revisions, idempotency and actor attribution.
- [x] Expose authorized connections through the normal agent tool policy without new client keys or duplicate members.
- [x] Test whole-team CRUD/assignment/lifecycle, pagination, ambiguous names, identical IDs in separate Homes, permission refusal and live revocation.
- [x] Verify reads do not import records and personal external content keys do not acquire broader authority.

Done: J6 succeeds from a normal signed personal chat without MCP configuration and without assigning the target task first.

### W07. Team execution authority on the Team server

Dependencies: W01, W06. Implement the schema prerequisites from section 9 before introducing new writers. W10 completes the migration rehearsal and final cutover after the runtime work.

Owner decision: execute on this Team Home with the ordinary local runner, installed harnesses and owner-configured agent folders. Members are trusted with this server. Isolation is deferred to the design in [team-isolation.md](team-isolation.md). The former Docker gate is retired by this decision, not passed.

- [x] Route team runs through ordinary Home placement and the shared runner.
- [x] Centralize role capabilities and require a signed-in person for prompt answers and approvals.
- [x] Permit team-wide turn control, agent folder editing and terminals with member attribution.
- [x] Record shared-computer hosting and show the non-blocking owner warning.
- [x] Verify member removal, revocation, raw requests, serialized turns and restart recovery.

Done: team execution authority is enforced below the UI and does not depend on which client launched it. Review9 covers Team settings persistence after failed shutdown, interruption of member work, chat-specific leftover quarantine and explicit recovery through actual tRPC operations and real process stand-ins.

### W08. Team agents, models and chat parity

Dependencies: W02, W07.

Owner review requires renewed evidence on the ordinary server runner. Archived container runs do not qualify this revision.

- [x] Use the shared agent/chat/model/result/workbench components with creator and requester attribution.
- [x] Use installed, signed-in harnesses and the ordinary sign-in flow with the shared-account notice.
- [x] Bind legacy chats on next send or offer the ordinary launcher without losing history or inventing creators.
- [x] Test collaborative lifecycle, human approvals, failures, retries and recovery.

Done: J7 works through the ordinary application machinery. A Claude-only special-case team executor is not the final implementation. Review9 adds shared content-chat Restart, successful Retry/error feedback, visible saved connection decisions, and Team main-chat/execution speed propagation after merging main's model menu.

### W09. Shared settings and AI-off behavior

Dependencies: W02, W05, W08.

- [x] Consolidate shared settings sections and capability-dependent controls. Keep local desktop/service settings outside team authority.
- [x] Make AI optional without blocking tasks/notes or requiring an agent name. Preserve readable history when disabled.
- [x] Keep MCP onboarding and member attribution clear, with the existing independently revocable keys.
- [x] Test ordinary personal setup, standalone team without AI, personal connection, owner/member settings and desktop team-only windows.

Done: J1-J3 and J8 pass without duplicate configuration or mandatory AI setup.

### W10. Migration and cutover

Dependencies: final cutover after W07-W09. Begin the persistence map during W00 and deliver prerequisite migrations alongside their owning packages, so W05 and W07 do not wait on final cutover.

- [x] Regenerate pure Drizzle migrations from 0018 for the retained schema, with no environment or legacy profile columns.
- [x] Rehearse populated personal and team upgrades, including existing AI settings, history, private references, Area rules, credentials and active-work drain behavior.
- [x] Keep old links and protocol contracts functional through adapters, and verify no duplicates or FTS/foreign-key damage.
- [x] Remove obsolete writers/runtime paths and update the prior Home spec so conflicting separate-app rules are retired.
- [x] Document upgrade, compatibility limitations and recovery using the repository's supported mechanisms.

Upgrade fixtures reconstruct the genuine main predecessor DDL at 0018, 0019, 0020, 0021 and 0023, populate synthetic records through the current query layer, then use the server boot path, including sealed credentials and the first boot. They establish schema/data preservation for these fixtures, not historical owner-data or old-query-layer qualification. The earlier manual worker cutover is removed.

Done: populated personal and Team fixture Homes upgrade without a wipe, account recreation or lost history. Fresh fixture installation is verified. No real owner Home was migrated.

### W11. Acceptance, documentation and final reconciliation

The owner review revisions supersede the archived runtime and its checks. The [revision checklist](unified-home-revisions.md) and [verification ledger](unified-home-verification.md#final-source-and-results) record the implementation and immutable-HEAD check procedure. Docker is not part of this work.

Dependencies: all prior packages.

- [x] Map every acceptance row in section 11 to automated evidence or an explicit accepted qualification limit. Require the final-source manifest for the delivered HEAD.
- [x] Update team testing, desktop, agent/harness, settings and API documentation for the final implementation.
- [x] Run typecheck, relevant lint, focused integration/browser tests, migration tests and required build/package checks. Report baseline failures separately.
- [x] Verify replaced team-only UI is removed and both Home types import the shared components. Update the chat-interface gallery when interface composition changes.
- [x] Re-read sections 1-11 and every journey against the result. Mark remaining failures explicitly, never declare full completion with unchecked required packages.

Done: the updated guide covers both personal and Team use, and every accepted requirement maps to implementation and automated evidence or an explicit qualification limit.

The testing guide is exercised through automated fixtures and component journeys. No independent new-human walkthrough or owner-data migration is claimed.

Implementation evidence for W00–W11: [the current regression map and immutable-source procedure](unified-home-verification.md). The [tenth review ledger](unified-home-review10.md) supersedes prior completion claims and maps every new finding to its correction. The verifier now includes main’s markdown-link browser suite and coordination gallery journeys. The final external manifest names the exact committed source and checks staged, unstaged and untracked files. Browser runs use Brave through Playwright's Chromium transport, with synthetic data adapters. Source Electron checks use the real Team window, production history menu helper and navigation preload. No real-provider or signed-release qualification is claimed.


## 11. Acceptance matrix and test execution

The final delivery qualifies these rows only with a fresh clean committed-source manifest reporting `allPassed: true` and `sourceUnchanged: true`. [Tenth review corrections](unified-home-review10.md) supersede earlier parity statements and name the exact regressions. The verifier stores commands, source commit, counts, logs and captures outside the checkout, and the final response links them.

| Scenario | Automated evidence and accepted limits |
| --- | --- |
| Existing personal Home, no teams | Populated `spaces/unified-acceptance.test.ts`, ordinary task/note/session tests and production-build personal desktop journey. |
| Personal Home with AI off | Ordinary CRUD, manual ranks and Area tests. No AI is required for these operations. |
| Standalone Team with AI off | Team CRUD/settings/catalog tests, degraded-startup API test and production-build standalone desktop journey. |
| Full-team browsing | Common TaskSurface/NoteList browser fixtures, real TeamBoard four-column defaults and Home/viewer preference isolation with agent activity intact, Team search and actual TeamWorkBoundary/tRPC integration. |
| Personal task inclusion | Native-access, shared-work and review regressions cover assignment, add/remove/reassign/reconnect, retained active chats and private planning. |
| Priority | Unified acceptance, reorder/sync and Deck source tests preserve independent ranks. New imports remain unranked. |
| Area defaults | Private defaults/settings browser tests and populated upgrade fixtures cover precedence, overrides, deliberate clears and no rule. |
| Source labels | Team label browser, Deck source components and same-name Team tests. |
| Native agent access | Real MCP route and separate HTTP Team process in native-access tests, without an extra key/import. |
| Explicit destination | Real tools/call through all five registry MCP routes, actual CLI alias/conflict tests and separate Team-process native access. Foreign or unsupported destinations refuse before personal writes. Canonical target_home_id and equal targetHomeId normalize, undeclared Home/Team/Space scope spellings refuse. |
| Personal execution of Team work | Mounted launcher/reference tests, explicit publish with binary SHA-256 proxy proof. Personal conversation stays private. |
| Team-owned execution | Ordinary runner with fake providers, real HTTP send/approval/restart journey, shared Files/terminal/preview/review authority tests. Server OS account remains an accepted limit. |
| Every enabled supported harness | Registry reasons and all-harness ordinary fake-provider lifecycle checks. Real account entitlement and subscriptions are unqualified. |
| Turn lifecycle | Actual archive procedure initial/late/teardown dirty refusal and queue wakeup, SDK escalation for Cursor/Antigravity, one-close retries, teardown-send/startup/Resume races, personal remote queued stops and retrospective labels, real process-tree timeout and unrecorded-root cleanup, background stop/restart, AI-off/removal/revocation and failed-recovery tests. Successful matching receipts recover without replay. Member-private current pointers never adopt shared activity on GET. Mounted real AgentView preserves the chosen URL across Files/Terminal/Preview and reload. New/model changes inherit the viewed chat. Unavailable links retain navigation with inline Retry. Pending/offline reads never create a replacement chat, cached refresh failures keep the view mounted, and contextual Restart chat provides recovery. Failed agent/session reads offer Retry, with deletion copy reserved for a confirmed 404 and one refresh notice per view. Sends wait through invisible idle shutdown, recycle/archive share confirmed close, and Cursor exec-launcher descendants remain identifiable. Settings and shared-skill saves retain successful persistence after a failed idle recycle. Restart state belongs to the displayed chat, including failed pinned New and History Resume. Linux kernel birth identity supports subreaper adoption and takes precedence over wall-clock start time. Ambiguous identities preserve records and worktrees, with process-specific recovery confined to their chats. Corrupt recovery records still disable all AI safely. Process shutdown waits release the shared record queue. Team settings persist before interrupting member work and failed shutdown never fails the save. Content chats share Restart recovery and successful Retry removes stale recovery controls. Linux kernel probes are present but skipped on the macOS qualification host. Native launch aliases are strict, failed-first-send intent stays fixed, and slow lifecycle relay calls cover teardown. Disclosed sender attribution is retained. Credential impersonation when identity is omitted remains an accepted OS-account limit. |
| MCP and permissions | Original client allowlist, independent revocation, raw destination checks and member/agent refusal. Real HTTP relay and Team WebSocket tests enforce disclosed identity. Plan approval returns to inherited Ask, including legacy live sessions. New/model changes retain viewed-chat permissions. Replayed launches cannot widen the sender’s permission bounds. Connected personal Home approvals count as that person, disclosed agents are refused on both relays. |
| Desktop | Shipped navigation preload and real window preferences, actual production main menu, both production-build Team journeys. No signed release or physical-input claim. HUD ancestor remains preserved. |
| Phone and accessibility | Brave fixtures at 390px/desktop, task/note/detail/settings/search/draft controls, keyboard/focus and Mac sheet clearance. |
| Disconnection and drafts | Shared body conflict/autosave, scoped draft saves, offline/reconnect and unknown-outcome tests. Unacknowledged launcher cancellation can retain a safe reference. |
| Migration | Safe server boot from predecessor 0018/0019/branch-0020/0021 and main-speed-0020 DDL with synthetic current-query-layer rows for both Homes, first/second boot, sealed credentials, rowids, FTS/FKs and private links. All 0000–0021 artifacts stay immutable. No migration is added in reviews4–8. Review9 adds CLI-generated 0022 for main's speed columns and exact-history convergence, preserving main's original receipt and artifacts. |
| Component reuse | Shared header/menu/editor/status/history/document, task/note surfaces, common agent/chat/workbench and operations. Typed execution/title/backlink/agent/runtime caches refresh across both Homes. Shared Git/preview controls, including Open PR, enforce named authority and attribution using the accepted server account, disclosed on dedicated servers as well as shared computers. Contextual Team audience/assignment/conflict controls remain. No parallel Team engine/model picker/transcript/composer. |

Run `scripts/verify-unified-home.py` as documented in [the verification ledger](unified-home-verification.md). Each gate uses a disposable Home. Version-skew testing requires a detached pinned main checkout. The testing guide includes browser/Electron opt-ins after the isolation boundary. Do not infer skipped live-provider or unrelated browser-engine qualification from passing fake-provider/component tests.
