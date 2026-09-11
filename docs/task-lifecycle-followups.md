# Task lifecycle followups after merge

Date: 2026-09-07

Status: open followups. The final check found no issue that should block the Ri task reorganization.

Reviewed [PR #2, Ship Ri's Consider-to-Done task lifecycle](https://github.com/treyhuffine/ai-task-manager/pull/2), merged at `c68cb31`, and the current checkout at `7797f61`. The task lifecycle paths covered here are unchanged between those commits. Recheck the implementation before starting each item.

This document records the remaining findings from the final check, with proposed fixes and acceptance checks. The check included independent data, runtime, and UI reviews, 185 passing targeted tests, and a passing typecheck. Those checks establish the reorganization's foundation. They do not establish that the issues below are fixed.

## Work order

| Order | Work | Priority | Status |
|---|---|---|---|
| 1 | Prevent cancelled preparation from launching an agent afterward | Next runtime fix | Open |
| 2 | Route CLI run cancellation through the server that owns the agent | Next runtime fix | Open |
| 3 | Show newly unblocked Todo tasks consistently in Deck | Next attention fix | Open |
| 4 | Make Deck child completion and deferral reflect durable results | Followup | Open |
| 5 | Honor the destination position on a cross-column Kanban drop | Followup | Open |
| 6 | Remove the ineffective Complete control from Consider rows in Area | Followup | Open |

Items 1 and 2 share runtime control code and can ship together. Item 3 can proceed independently. Items 4 through 6 are smaller issues found during the same final check.

## Product decisions to preserve

- Keep `consider | todo | in_progress | done | archived`.
- Keep many-to-many task and execution associations as durable context and history.
- One execution can continue working across several tasks.
- Stopping runtime activity preserves execution records, chats, worktrees, and associations. Other associated task statuses remain unchanged.
- Agent output or runtime completion alone never completes a task.
- Use the existing query layer, lifecycle commands, runtime control, and optimistic mutation hooks. No additional database migration or new lifecycle state is expected for these fixes.

The implementation reference remains [Task lifecycle](task-lifecycle.md). These followups do not reopen the settled model.

## 1. Prevent a stopped preparation from dispatching afterward

### Observed behavior

A message begins asynchronous worktree or provider preparation before the runtime handle exists. If the user stops the agent during that interval, `close()` can find no handle, clear the running state, and return success. Preparation can then finish and call `dispatch()` or `agentSession.send()` anyway.

The result is an agent starting after the user was told it stopped. During a coordinated task change, the task may already have changed lifecycle while that old instruction begins running.

Evidence at the reviewed commit:

- [Message dispatch route](../src/app/api/sessions/[id]/messages/route.ts), around lines 250 to 260, dispatches after `ensureWorktreeReady()` without checking whether preparation was cancelled.
- [Executor adapter](../src/lib/executor/adapter.ts), around lines 730 to 745, awaits provider preparation and then sends. Around lines 814 to 838, close advances the existing dispatch generation.
- [Workstream runtime](../src/lib/sessions/workstream-runtime.ts), around lines 36 to 62, coordinates stopping the execution's current activity.

### Proposed fix

Carry the existing dispatch generation or cancellation token across asynchronous preparation. Check it before starting dispatch and again before sending to a prepared provider session. Stopping must invalidate pending preparation as well as control any existing handle. Clean up a handle produced by cancelled preparation without discarding a newer handle created by a later explicit send.

Keep run accounting truthful. Cancelled preparation must not later report successful execution. A failed stop must retain enough runtime state for a retry and report the failure. An explicit later Continue or send must still work.

### Acceptance

- [ ] Stop while worktree preparation is waiting, then let it finish. No provider send occurs.
- [ ] Stop while provider creation is waiting, then let it finish. No old instruction is sent and any abandoned handle is cleaned up.
- [ ] A later explicit Continue or send succeeds with a fresh generation.
- [ ] A failed handle close reports failure and keeps the handle tracked. A coordinated task transition remains unapplied.
- [ ] Stopped work cannot later become a successful run through a late finalizer.
- [ ] Execution, chat, worktree, task bodies, associations, and other task statuses remain intact.

Use controllable promises in runtime and route tests to exercise the preparation races deterministically.

## 2. Make CLI cancellation reach the owning server

### Observed behavior

The `cancel_run` orchestrator action imports the executor adapter in the calling process. A standalone CLI process has its own empty handle map, so `abort()` can do nothing while the server's agent keeps running. The action then marks the run cancelled.

Evidence: [Orchestrator registry](../src/lib/orchestrator/registry.ts), around lines 2060 to 2082. The existing [server client](../src/lib/orchestrator/server-client.ts) provides the transport needed to reach server-owned runtime state.

### Proposed fix

Keep the public `cancel_run` action name and route runtime control through the app server. Use one service for UI, CLI, and MCP cancellation. The response must distinguish acknowledged cancellation from an unavailable server or failed control request.

Preserve the action's actual scope. If the runtime can only interrupt a whole chat turn and other work is affected, report that scope explicitly. Do not promise cancellation of one isolated piece of a shared turn. Reuse the existing run and runtime records.

### Acceptance

- [ ] Start a server-owned agent, invoke `cancel_run` from a separate CLI process, and verify the intended runtime activity is interrupted.
- [ ] An unreachable server or failed cancellation produces an honest conflict or unsupported result. It does not report successful cancellation merely because a DB row changed.
- [ ] Already-terminal runs return their current result without interrupting newer work.
- [ ] Retrying cancellation cannot stop a later unrelated turn on the same persistent chat.
- [ ] Late completion callbacks cannot overwrite confirmed cancellation.
- [ ] Task lifecycles, execution records, worktrees, and associations stay unchanged.

Test the server transport and runtime boundary. A test that only asserts the run's database status is insufficient.

## 3. Let completed blockers release work into Deck

### Observed behavior

The server resolves a task dependency when its blocker is Done. The client rejects any nonempty `blockedOn` reference, even when it points to that completed task. Newly unblocked work can therefore be omitted from the visible Deck while remaining available in Todo and Kanban.

Evidence: [Client Ready predicate](../src/lib/deck/client-ready.ts), line 20, and `isBlockerUnresolved` in [queries.ts](../src/lib/db/queries.ts).

### Proposed fix

Give client Deck paths the same resolved-blocker fact used by the server. Prefer a shared query projection or complete dependency lookup rather than inferring resolution from whichever tasks happen to be in the client cache. Keep the dependency link as history. Apply the same Ready rule to existing Deck hydration, alternatives, Browse, and fallback.

### Acceptance

- [ ] Todo task A blocked by unfinished task B is excluded from Ready Deck work.
- [ ] Completing B makes A eligible across all Deck paths without deleting A's dependency link or regenerating the entire Deck.
- [ ] Archiving B does not falsely satisfy the dependency.
- [ ] A missing dependency or unresolved free-text blocker remains unresolved.
- [ ] Consider, In-progress, Done, Archived, future-resurfacing, and not-yet-due recurring tasks remain ineligible.
- [ ] Resolution works when B is outside the current Area, page, or client task list.

## 4. Make Deck child actions reflect durable results

### Observed behavior

Child completion now calls the real task mutation, but immediately marks the child complete in Deck's separate local plan. A rejected mutation or cancelled confirmation can leave that local checkmark visible. Child deferral only removes the child from local plan state and is lost on reload.

Evidence: [Deck container](../src/components/deck/deck-container.tsx), around lines 574 to 604.

### Proposed fix and acceptance

Use the shared lifecycle result and confirmation flow, with rollback or reconciliation of the Deck projection. Preserve the existing optimistic mutation pattern.

- [ ] Successful child completion updates the real child exactly once and survives reload.
- [ ] Failure or cancelled child/runtime confirmation restores the unchecked child in Deck.
- [ ] Parent and sibling task states remain unchanged.
- [ ] Define Defer's visible promise and persist it: a dismissal from today's Deck belongs in the saved Deck, while a dated deferral belongs in the task's existing resurface field. Do not invent a date for an undated action.
- [ ] A successful deferral survives reload. A failed deferral restores the child with feedback.

## 5. Preserve position when moving between Kanban columns

### Observed behavior

Same-column ordering now uses the atomic server reorder path. A cross-column drop only applies the lifecycle command, so the destination card or insertion position is ignored.

Evidence: [Kanban board](../src/components/tasks/task-kanban.tsx), around lines 258 to 274.

### Proposed fix and acceptance

Carry the destination neighbor intent through the lifecycle confirmation and reorder flow. Resolve order against the complete destination sibling set using the existing server operation. Keep the final position stable through optimistic updates and refetch.

- [ ] Cross-column drops at the top, middle, bottom, or into an empty column survive reload in the intended position.
- [ ] Area filtering and hidden siblings do not create duplicate or invalid order keys.
- [ ] Cancelling a required confirmation leaves the task's status and order unchanged.
- [ ] Lifecycle or ordering failure is reported and reconciled to the actual server state.
- [ ] Illegal lifecycle moves remain rejected through the shared commands.

## 6. Give Consider rows an honest Area control

### Observed behavior

The Area task list renders a button labeled Complete for Consider items. Its lifecycle toggle intentionally does nothing for that status. The adjacent status selector works, but the completion control is misleading.

Evidence: [Area slideout](../src/components/dashboard/area-slideout.tsx), around lines 360 to 380.

### Proposed fix and acceptance

Match the status-aware controls already used in the task list and detail views.

- [ ] Consider has no actionable Complete control that silently does nothing.
- [ ] Its status selector still supports the legal commit, start, and archive actions.
- [ ] Todo and In-progress completion retains the shared lifecycle and confirmation behavior.
- [ ] Accessible labels describe the action that will actually occur.

## Closeout

For each item, mark its acceptance checks complete and record the fixing commit plus relevant test results here. Verify the changed user path as well as its underlying helper. The data reorganization may proceed while these followups remain open, using task inventory and lifecycle records as its verification source.
