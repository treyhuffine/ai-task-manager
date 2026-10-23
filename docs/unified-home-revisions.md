# Unified Home review revisions

The original decisions below remain the contract. The [second review corrections](unified-home-review2.md) and [current verification ledger](unified-home-verification.md) supersede this historical completion/evidence section. The final verified source of the prior run was `37716e77`, not its earlier documentation commit.

Owner decisions received 2026-10-20. Reviewed source: `a5697a25cbb2025a2b2fa4301f770bf022c6f527`. This revision supersedes the isolated-worker execution contract. No Docker operations, production restart, deployment, merge or push are authorized.

## Progress

- [x] Archive the reviewed implementation
- [x] Remove the container-only code and restricted Claude engine
- [x] Ordinary server placement, sign-ins and shared-computer warning
- [x] Central capability table and team-wide human control
- [x] Regenerate disposable-only migrations and rehearse predecessor-0018 DDL with synthetic current-query-layer rows through boot
- [x] H1 Shared lifecycle operations
- [x] H2 Keep editors mounted on refetch failure
- [x] H3 Home and author scoped drafts with personal migration
- [x] H4 Isolate sync failures and show Retry
- [x] M1
- [x] M2
- [x] M3
- [x] M4
- [x] M5
- [x] M6
- [x] M7
- [x] M8
- [x] M9
- [x] LOW fixes
- [x] UNVERIFIED investigations
- [x] Final fake-harness two-member restart journey
- [x] Final full Vitest, types, changed lint, desktop and touched browser suites
- [x] Reconcile all evidence and deliver committed review diff

Archive: local branch `archive/team-isolated-worker` at `a5697a25cbb2025a2b2fa4301f770bf022c6f527`. The supplied review-probe worktree is absent. Reproductions will be rebuilt as regression tests.

Implementation commits: `45a46fcf` (ordinary execution, permissions, shared UI and regressions), `9f441f2f` (remove container packaging), `b4c23bde` (phone creation/navigation checks and display-name hook correction), `85a1917c` (actual HTTP Home process restart journey), `31eccc6f` (typed reference invalidation and regression). Detailed item-to-test mapping: [verification ledger](unified-home-verification.md#per-requirement-regression-map).

Final immutable-HEAD results: [verification ledger](unified-home-verification.md#final-source-and-results), exported manifest `/private/tmp/ri-unified-verification-final/manifest.json`. It records the exact final source, commands, results and limits after the documentation commit.

Updated read-only migration check on 20 October: `~/ri-dev/data.db` has 20 journal entries, latest matching main’s `0019_groovy_may_parker`. The refactor appends `0020_unified_home_members` and preserves 0000–0019. No production database was opened.

## Accepted revision contract

Review fixes for refactor/unified-home-experience (reviewed at a5697a25)

An independent review of a5697a25 found the defects below, and the owner made the decisions listed first. Work on the same branch in the same worktree. Add tests for each fix and keep the spec and evidence honest. No merge, push, deploy or production restart. Use isolated disposable Homes via pnpm iso. Docker is no longer part of this work: don't use it, start or stop it, or touch its containers.

The review's reproductions are in /private/tmp/uh-review-probe/src/__review_probes__/ (detached a5697a25). Port the useful ones into real tests, inverting the ones that assert a defect.

Suggested order:
1. archive ref
2. remove the container work and the old engine
3. capability table and team-wide control
4. regenerate migrations
5. HIGH
6. MEDIUM
7. LOW
8. docs and evidence

OWNER DECISIONS (update spec §7, §8 and §9, the acceptance matrix, W07, W08, W10, W11 and the docs to match)

1. Team agents run on the team's server, like personal Ri runs on a computer. No container, no isolated worker and no credential proxy for now.
   - The owner accepts the risk: team servers are expected to be cloud or dedicated machines, and members are trusted with that server. Isolation is deferred, not dropped (see CONTAINER CODE).
   - Team agents are ordinary workspaces in the team Home, with owner-chosen folders on that server.
   - Runs use the ordinary placement ("this Home"), the ordinary local runner and the ordinary harness integration, with every harness that is installed and signed in on that server, as in personal Ri.
   - No team-only runner or execution path.
   - Team chat sessions get the team Home's session tools under the requesting member's authority ("X's agent"), never a personal Home's.
   - The owner signs harnesses in on the server through the existing sign-in flow. The Team AI sign-in step says "Everyone on the team uses this sign-in."
   - Personal-only capabilities stay off in team Homes as before.
   - Keep the seam that makes isolation cheap later: authorization happens at the Home before dispatch, and agents never enforce permissions themselves or write the Home database directly. File, Git, terminal and preview go through the same operations personal remote workers already use (src/lib/workers).

2. Warning on a shared computer, no blocking. When a team Home runs on a computer that also holds a personal Ri (the desktop "Hosted on this computer" flow), show the owner a clear, non-blocking warning when turning on Team AI or creating a team agent. Example: "Team agents run on this computer as you. Anyone on the team can use them to reach your files, your personal Ri and the accounts signed in here." Detect it reliably: record it at team creation from the desktop flow, and also check for a personal Home under the same OS user. Note it in docs/team-testing.md. Follow the UI copy rules (no em dashes, no semicolons).

3. Delete the old engine. Remove the legacy Claude-only restricted runtime that runs Claude Code on the team Home's host: team/ai/runtime.ts runTeamTurn, runner-profile, the legacy profile, and the manual "Move existing chats to a worker" cutover with its ordering bug.
   - Existing legacy chats keep their IDs, authors, cursors and history and become ordinary chats on a team agent. With exactly one enabled team agent, bind on the next send. Otherwise use the ordinary launcher choice. With none, the history stays readable and sending explains what is needed.
   - At upgrade, queued and running legacy turns become cancelled or interrupted with a visible reason. They never run, and completed turns never replay.
   - Keep the old encrypted credential until the owner removes it, shown as unused.
   - Keep public URLs resolving.

4. Team-wide control. Work running on the team belongs to the team. Any active member may stop any turn, cancel any queued message, answer a pending question, approve or deny a permission prompt, and archive or close any team chat. Anyone who wants sole control runs the work in their personal Ri.
   - Only a signed-in person may answer or approve. An agent, a team AI client key, a session token or the orchestrator never approves its own or another chat's prompt.
   - Replace §7's "Own requested turn" and "Approve operations" rows.
   - Relax the ordinary paths that enforce the old rule: interrupt, retireChatForHome, execution-lifecycle-authority, and the stop/answer branch at home/execution-authority.ts:48-53.

5. Roles later, without tech debt. Roles stay owner and member, with no role builder and no new role values.
   - Put every team permission in ONE server-side capability table (role -> named actions) behind one function.
   - Name the actions: read, edit shared content, delete permanently, administer members, configure agent, run team agent, stop turn, cancel queued, answer question, approve permission, archive chat, edit agent folder, open agent terminal, manage sign-ins.
   - Every entry point asks that function: tRPC, HTTP routes, WebSocket and terminal admission, team MCP tools, orchestrator actions and CLI. No role or 'owner' comparisons anywhere else.
   - Add a guard test, like process-state.test.ts, that fails on new direct role checks.
   - The UI reads server-derived capabilities from HomeContext, never member.role. Today team-record-controls.tsx:77,148 branch on role, while deletePermanently and administerMembers are computed and unused.
   - Adding a role later should mean editing the table and its tests.

6. Reviewer chats are collaborative, so there is no sender restriction. But never accept a message and then fail it. Behave as personal Ri does for reviewer follow-ups (refuse up front with the same message, for everyone), at sessions/[id]/messages.ts:92-94 and the action-message routes.

7. Shared agent folders. Members may edit files in a team agent's folder (AGENTS.md included) and open a terminal there without a chat. Attribute every edit and terminal session to the member. The agent record (purpose, instructions, folders, sign-ins, limits, models) stays owner-configured.

8. Privacy invariants. Nothing from a personal Ri leaves it except an explicit write by the person or their agent, attributed to them. Team chats are accessible only to that team's members. Keep native team access for personal chats (J6) with no per-agent gate. Add tests for both invariants.

9. Migrations. 0019-0025 have reached only disposable Homes (~/ri-dev is at 0018; re-check read-only, never touch prod). Regenerate them as pure drizzle-kit output for the schema this work actually needs:
   - No execution_environments table and no environment link columns.
   - No legacy_profile.
   - No onDelete 'set null' on columns added to existing tables (the convention in schema-conformance.test.ts, already followed by main's 0011; member and api_key rows are never hard-deleted).
   - Keep the creator, requester, sign-in, member-view, attribution and private Area columns and tables.
   - Any hand-written SQL that remains must be raised with the owner before commit and disclosed in the review doc.

CONTAINER CODE: REMOVE NOW, KEEP FOR LATER

1. Preserve. Before removing anything, create a local branch archive/team-isolated-worker at a5697a25. Do not push it. Report it so the owner can decide whether to push it to GitHub. Squash-merging and deleting this branch would otherwise eventually lose those commits.

2. Record. Replace docs/team-worker.md and docs/team-harness-qualification.md with one design record, docs/team-isolation.md. It covers:
   - why isolation was deferred (owner decision 2026-10-20, accepted risk);
   - what the archive branch contains (file list);
   - what it proved, by evidence category;
   - the review findings to fix when it returns:
     - bind the approved account revision into each turn;
     - the operator path must use the mount allowlist (isolatedWorkerDockerArgs was test-only, and its argv didn't match the image);
     - the Cursor model policy must cover every forwarded route and model/billing field;
     - the Google identity CONNECT tunnel needs the nonce and a destination allowlist;
     - ACP fs callbacks run outside the sandbox;
     - native evidence gaps: a stub Home, hardcoded attribution, unasserted revocation, no native stop, and runs that predate their commit;
     - no fixed 15-minute cap;
   - how it plugs back in: as a worker placement through src/lib/workers, with the capability table gaining "run on isolated worker".
   Link it from spec §8.

3. Remove. Grep for callers before deleting each file. Anything the ordinary personal path uses stays. A generally useful improvement moves into the ordinary code with its own test (for example the preview same-origin refusal in resolve-iframe-src.ts) and is reported separately.
   a. Files that exist only for the container:
      - src/lib/worker/: team-controller, team-runtime, team-native-config, team-auth, team-enrollment, team-start, model-credential-proxy, model-request-policy, google-identity-proxy, harness-wrapper, isolated-files, file-helper, file-operations, private-storage, redact-event, execution-lease, authority-fingerprint, previews and isolation, with their tests including isolation.docker.test.ts;
      - src/worker-runtime/;
      - worker-runtime/ entirely (Dockerfiles, package.mjs, qualify-*.mjs, fixtures, seccomp);
      - the pnpm worker:package script;
      - src/lib/runner/isolation.ts and runtime-context.ts, src/lib/terminal/isolation.test.ts;
      - src/lib/skills/runtime-bundle.ts;
      - src/lib/preview/worker.ts and worker-protocol.ts;
      - Home side: execution-worker-authority, execution-worker-lease, execution-enrollment, execution-environment-router, db/execution-environments, and components/team/execution-environment-settings with its approval flow;
      - patches/@agentex__agent@0.0.45.patch, if only the controller needs it;
      - the container evidence under docs/verification/unified-home/ and docs/images.
   b. The branch's container-only edits to existing shared files go back to main's behavior. Those files are runner/local-runner, live-state and types; worker/client, config, handlers, run and terminals; workers/hub, protocol and route-auth; terminal/place and pty-manager; preview/service, supervisor, pid-store and route-helpers.
   c. Keep and adapt the Home-side team pieces to the server placement: execution-authority (minus environment/worker checks), execution-lifecycle-authority, execution-request, sessions and executor home-policy, skills/home-policy, team terminal authority, document binding and scope, HomeContext capabilities, the turn queue and receipts, and attribution.

HIGH

H1. One chat lifecycle implementation.
   - team.ai.chats.archive (team/ai/router.ts:148-154) sets 'archived' directly. The Home keeps the turn 'running' and the execution 'active', queued turns end 'failed', and it closes an execution's only open chat (close-chat.ts refuses that).
   - team.ai.chats.create (:132-141) calls startNewMainChat, which archives the agent's current main chat.
   - events, chatStatus and rename (:83,142,173) skip the agent-folder check.
   - Fix: route these through the ordinary retire, close and stop operations, or remove them if no external contract needs them. Create must add a chat, not replace one.
   - Test: archive by a non-requesting member with running plus queued turns settles the turns as cancelled with a reason, settles runs and executions, and keeps the last-chat rule.

H2. Home boundary refetch.
   - HomeBoundary (components/home/home-context.tsx:15,39-40) replaces the dashboard (dashboard.tsx:204), the Team shell (team-home.tsx:78) and /results on any failed refetch.
   - Fix: keep children mounted when data exists, show a non-blocking retry, block only on a failed first load, and keep the DOCUMENT_AUTHOR_CHANGED handling.
   - Test: a refetch failure keeps a mounted editor and its text.

H3. Draft scoping.
   - Chat and launcher drafts are keyed exec:<sessionId> and launcher:<workspaceId> (execution-composer.tsx:733, launch-modal.tsx:748, execution-view.tsx:163-166) and restored unchecked (chat-input-editor.tsx:609-640, 881).
   - Fix: key them with homeDocumentKey (Home + viewer) for both Home kinds, as the legacy team-chat.tsx:335 did. Refuse another author's draft on restore. Carry existing personal drafts over so nobody loses unsent text.
   - Tests: a member switch on one browser profile neither restores nor sends the other member's text. Personal drafts survive the upgrade.

H4. Sync failure isolation.
   - spaces/sync.ts:231-235 rethrows unrecognized errors (remote.ts:101-105). syncAllTeams (:269-276) has no per-team catch. requestTeamSync (:405-410) returns [].
   - Fix: catch per team, record lastError and lastErrorAt for any failure (5xx, non-JSON, BAD_REQUEST), continue with the other teams, and show failure plus Retry (imported-work-notice.tsx:22).
   - Tests: a 502 HTML page and a tRPC 500 from team A still sync team B, and A shows failure with Retry.

MEDIUM

M1. Turn outcomes in the ordinary transcript.
   - Failed, cancelled, interrupted and refused team turns show their reason and a way to send again, like personal recordSendRefused (messages.ts:345-347).
   - Places: native-turn.ts:30,45-48; team/ai/chat.ts:106,139-162; team/chat-event-view.ts; runtime-status.ts:24-29.
   - Queued messages are cancellable from the ordinary UI (decision 4).
   - A timeout is not labeled "Stopped." (chat.ts:160).

M2. Native access contracts (spaces/native-access.ts).
   - Don't add assigneeMemberId or idempotency_key to local schemas, or pass them to local handlers (:66-68, 73-80). Today local create and update fail on a foreign key, list_tasks returns [], and update_task on a reference writes the team title and then fails locally.
   - list_homes advertises only operations that work (:128). list_links has no action, and get_session_messages fails on sessionId/session_id (:18-22).
   - publish_result returns permanent refusals as non-retryable with the real reason, matches the team's link limit (10 vs 5, trpc/schemas.ts:61) and supports files (:102, 113-116).
   - list_areas 'inactive' filters correctly (:34-37, 50-52).
   - External content clients don't see parameters they can never use.
   - Add the missing same-name-Homes test claimed in W06.

M3. Work with agent provenance.
   - work-with-personal-agent.tsx:21 always calls addToMyWork, which stamps addedAt on an assigned reference (sync.ts:307). That reference then never releases on reassignment (:184), and the Deck says "deliberately added".
   - Fix: reuse a reference without changing it. A cancelled launch must not leave a newly added reference.
   - Use the same existing-chat lookup as start-with-agent-button.tsx:68-77 instead of always opening a fresh launcher (task-launch-intent.tsx:18-26).
   - Add tests. Neither file has any.

M4. Deck prompt. Quote all team-supplied text, titles and descriptions included (ai/deck-generation.ts:244, 262). Test with injected section headers.

M5. Source labels.
   - Disambiguate same-name teams everywhere (team-label.tsx:14-15, task-list.tsx:399-401, teams-section.tsx:70). Fix team-label.browser.test.ts, which asserts the ambiguity.
   - Add source labels to deck-more-options.tsx:60-116, deck-task-browser.tsx:218-235 and deadline-band.tsx:117-121, and carry sourceArea in AlternativeItem (deck-container.tsx).

M6. Navigation inside Team documents.
   - Use WorkContext or HomeLink in EntityChip (ai-elements/entity-reference.tsx:384-393), editor entity links (editor/entity-link-node.tsx:124-142), result-ai-review.tsx:50,90 and result-renderer.tsx:132.
   - Team navigation handles session links (team-context.tsx:33-46).
   - Execution status pips work in Team (entity-reference.tsx:313-329).

M7. Finish the reuse.
   - Fold SharedTaskBody (spaces/shared-task-body.tsx) into TaskDocument, with one snooze implementation using dateInputToStored (the :138 bug resurfaces a day early east of UTC) and one empty-title rule.
   - One search implementation for both Homes (team/team-search.tsx vs search-overlay.tsx), with the hand-written query keys gone.
   - One rail and phone bar implementation (team-home.tsx:167-309 vs PowerRail, MobileTopBar and MobileTabBar), and one phone Home selector behavior (mobile-top-bar.tsx:16 vs team-home.tsx:252).
   - Update the review map to what is actually shared.

M8. No team-specific turn cap. Team turns follow personal behavior. Remove the Home's 20-minute abort (native-turn.ts:31, runtime.ts:213) along with the container's 15-minute cap.

M9. Mac chrome.
   - area-slideout.tsx:194 and areas-sheet.tsx:227 must clear the 40px drag strip (shared sheet primitive or data-slot).
   - Team windows get Back and Forward via keys, mouse buttons and menu, without gaining the personal bridge (desktop-chrome.tsx:65, desktop/main.ts).

LOW (fix all)
- task-document.tsx:68 deadline: commit on blur or Enter, not every keystroke. Restore data-cancel-on-escape (baseline d4d33358 task-slideout.tsx:578) and the overdue highlight.
- No invented chat creator on conversion (db/team-chat-cutover.ts:34). NULL stays NULL.
- History given to the first turn after conversion marks or excludes cancelled and interrupted legacy requests (team/ai/runtime.ts:128-153, or wherever history assembly lands).
- Sandbox the shared-result preview iframe like preview-view.tsx:124 (chat-ui/handoffs/result-artifacts.tsx:82).
- RailRows flyouts don't depend on useDashboard (home-navigation.tsx:75-83, rail-flyout.tsx:6,59).
- Any query key you keep or add uses the tRPC key factories (for example the hand-written key at agent-placement-controls.tsx:36, if that control survives).
- Team Decisions: ?kind=decision filters, and phone "+" respects Decisions and Assigned to me (note-list.tsx:54-60, team-home.tsx:128,269,272,297, team-context.tsx:87).
- Team List and Board show agent activity (task-surface.tsx:46, task-list.tsx:140, task-kanban.tsx:316-333).
- Disconnected and revoked teams show their real state and the right action (task-list.tsx:98, imported-work-notice.tsx, connect.ts:251).
- spaces/commands.ts:95 keeps the last known Area name instead of writing 'Area'.
- A harness capability that team chats can't use shows a registry-level reason, as in personal Ri, not a generic fallback (harness/registry.ts, home-runtime.ts:53-58).
- Show the chat creator and per-turn requester in the ordinary UI.
- J7 launcher: one entry that names where work runs ("this team's server" vs personal) and who sees the chat. It offers a choice only when both are available and reflects real personal availability (team-record-controls.tsx:73-74, work-with-personal-agent.tsx:15, home/context.ts:37).
- The per-turn json_extract over runs (work-result-runtime-queries.ts:119-123) is bounded per the Query cost rules and pinned with EXPLAIN QUERY PLAN.
- Connecting during a running sync pass includes the new team or triggers an immediate follow-up (spaces/router.ts:93, sync.ts:399).

UNVERIFIED (investigate, fix if real, report evidence either way)
- Serialized team turns on the ordinary runner don't collide with a live session's binding after a stop or restart (runner/local-runner.ts:502-506).
- Converted chat history order: the ordinary transcript sorts by created_at,id, the legacy view by rowid (runner/parse.ts:104 timestamps).
- Shared-field drafts on a personal reference after reconnecting as a different member (use-document-autosave.ts:13-15).
- Voice auto-send and transcription in team chats (execution-composer.tsx:256-258,856; operation-router.ts:618,676).
- Sync request volume per 2-minute pass.

EVIDENCE AND DOCS
- Rewrite §8 for team-on-server and link docs/team-isolation.md. Update the acceptance rows "Team-owned execution", "Every enabled supported harness" and "Turn lifecycle", W07 and W08, and remove the W11 Docker gate.
- Uncheck or reword boxes the tree contradicts until fixed: W01 bullet 2, W02 reuse and removal, W03 failure and retry, W04 Deck surfaces, W06, W10 removal of obsolete paths.
- Record the source commit in every durable result.
- Migration evidence reconstructs genuine predecessor-0018 DDL with synthetic rows mostly written by the current query layer, then uses the server boot path, including the sealed credential and first boot. This establishes fixture preservation, not owner-data or historical-query-layer seeding.
- Electron evidence says CDP input, not native. Assert execution ownership if you claim it, and record platform, commit, build mode and geometry.

DONE WHEN
Every item is fixed or explicitly reported with its reason, each has a test, and focused suites pass. Also required, all at the final HEAD:
- an end-to-end check on a disposable team Home using a fake harness or provider, no real account: two members, one starts a chat on a team agent, the other continues it, someone stops a turn, a permission prompt is approved by a person and refused for an agent, and attribution survives a restart;
- full vitest in an iso Home;
- typecheck;
- changed-source lint;
- the desktop suite and the browser checks touched;
- updated spec, review and verification docs.
Report:
- per-item status, commits and test evidence, separating fixture, browser and Electron proof;
- the archive branch name and SHA;
- the files removed and anything kept from the container work, with why.
