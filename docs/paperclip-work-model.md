# How Paperclip keeps work moving, and what Ri might borrow

> A study of the vendored Paperclip source (`examples/paperclip`), focused on one question: how does work continue without a human prompting each step, and who decides what gets worked on?
>
> Status: Notes, 2026-09-22. These are reference findings and candidate ideas, not commitments. The heartbeat work in Ri is tracked separately.

## 1. The short version

- In Paperclip, a **heartbeat is a short work session**, not a supervisor. Each wake the agent checks its assigned issues, takes one, does the work in the same run, updates the status, leaves a comment, and exits. The default prompt starts with "Continue your Paperclip work."
- **Work is pushed to agents, never pulled.** A human or a manager agent assigns it. The rule every agent follows is "Never look for unassigned work. No assignments = exit." Managers do assign work to others, by breaking their own work into subtasks. Nobody claims work that isn't theirs.
- **Keeping things moving is mostly the runtime's job, not an agent's.** Events wake the right agent (assigned, mentioned, approval resolved, subtasks finished). The runtime classifies each run's outcome and re-wakes agents that stopped with only a plan. Review and approval stages are enforced by the runtime, not remembered by the agent.
- **It is agents first.** Each issue has exactly one owner, an agent or a human. Human-owned issues are tracked but never run. Agents creating tasks for humans is discouraged.

Note the naming clash: Paperclip's "heartbeat" is roughly Ri's execution run. Ri's planned heartbeat (a check-in that tidies the system and offers work) is closer to what Paperclip's manager agent does on its own heartbeat.

## 2. What wakes an agent

Four wake sources (`packages/shared/src/constants.ts:896-901`), queued in `agent_wakeup_requests`:

| Source | When |
|---|---|
| `timer` | The agent's heartbeat interval elapsed. Off by default. 300s when turned on. A 30s server tick checks due agents (`server/src/services/heartbeat.ts:29470-29546`, `server/src/config.ts:366`). |
| `assignment` | An issue was assigned to the agent. No wake if the issue is in `backlog` or has no agent assignee (`server/src/services/issue-assignment-wakeup.ts:43-49`). |
| `on_demand` | A manual "Invoke", or a comment or mention on the agent's issue (`server/src/routes/issues.ts:14728`). |
| `automation` | An approval resolved (`server/src/routes/approvals.ts:322-325`), child issues completed (`server/src/routes/issues.ts:14870`), a blocker cleared, an issue monitor came due, or a liveness retry fired. |

In practice most wakes are events. The timer is a backstop.

**Routines** are their cron. Each firing (cron, webhook, or API) creates a new `todo` issue assigned to the routine's agent, then wakes it (`server/src/services/routines.ts:1905-1927`, `:1972-1975`). A schedule produces a visible task, not a free-floating prompt.

## 3. What an agent does on each wake

The heartbeat protocol (`docs/guides/agent-developer/heartbeat-protocol.md`):

1. Identify itself (role, budget, chain of command).
2. Handle an approval follow-up first, if that's why it woke.
3. Fetch its inbox: issues assigned to it in `todo`, `in_progress`, `in_review`, `blocked`.
4. Pick: `in_progress` first, then `in_review` if woken by a comment on it, then `todo`. Within that, by priority. Skip `blocked` unless it can unblock.
5. Check out the issue. This is one atomic update, so two agents can never hold the same issue. The loser gets a 409 and must not retry (`server/src/services/issues.ts:11330-11347`).
6. Read the issue, its comments, and its ancestors.
7. Do the work in this same run. "Do not stop at a plan unless the issue asked for planning."
8. Set a final status: `done`, `blocked` (naming who unblocks it), `in_review` (only with a real reviewer), or delegate.
9. Delegate by creating child issues assigned to other agents, and let the runtime wake the parent when they finish, instead of polling.
10. Always leave a comment with progress and the next action before exiting.

The manager ("CEO") agent adds planning and upkeep to that loop (`server/src/onboarding-assets/ceo/HEARTBEAT.md`): review today's plan, resolve or escalate blockers, break work down and assign it, extract durable facts to memory, then exit. Even the CEO's instructions say "Never look for unassigned work."

## 4. How things keep moving without a supervisor

- **Run liveness.** Each run is classified as `completed`, `advanced`, `plan_only`, `empty_response`, `blocked`, `failed`, or `needs_followup`. Only `plan_only` and `empty_response` trigger an automatic re-wake, at most 2 times (`server/src/services/recovery/run-liveness-continuations.ts:9`). After that the runtime leaves an audit comment for a human or manager.
- **Event wakes.** A finished subtask wakes the parent's owner. A resolved approval wakes the requester. A comment wakes the assignee.
- **Execution policy.** An issue can carry review and approval stages whose participants are agents or humans. When the executor finishes, the runtime moves the issue to the next stage and picks the reviewer, excluding the original executor (`docs/guides/execution-policy.md`). Every run must post a comment, enforced by the runtime.
- **Structured asks.** Agents ask humans through cards in the issue thread (`request_confirmation`, `ask_user_questions`, `suggest_tasks`) with a policy to wake the agent when answered.

## 5. Guardrails

- Budgets per company, agent, or project. Warning at 80%. At 100% the scope pauses, new runs are refused, and an override approval is created (`server/src/services/budgets.ts:214-250`, `:380-390`, `:770-811`).
- Per-agent daily run and cost caps in the heartbeat policy (`heartbeat.ts:16552-16581`).
- A small approval queue: hiring agents, CEO strategy, budget overrides, board requests (`packages/shared/src/constants.ts:689-694`).
- Humans (the "board") can pause, terminate, or reassign any agent's work. Changes are logged.

## 6. Configuration

Per agent, in the agent settings form (`ui/src/components/AgentConfigForm.tsx:1962-2046`): "Heartbeat on interval" toggle and seconds, "Wake on demand", timeouts, max concurrent runs. Stored in the database (`agents.runtimeConfig.heartbeat`). Instructions are files on disk (`AGENTS.md`, plus `HEARTBEAT.md` for the CEO), editable through an API. Imported companies always start with timer heartbeats off.

## 7. Candidate ideas for Ri

Ranked roughly by how well they fit Ri's human-plus-agents model. None of these are scheduled.

1. **Assign or tag a task to an agent.** One owner per task, a human or an agent. Assigning to an agent starts it. This gives the heartbeat a clean rule: it offers to take work, but only works on what you've handed over.
2. **Structured asks instead of free text.** When an agent needs a decision, it posts a card (confirm, answer these questions, pick from these suggested tasks) that wakes it when you answer. A good fit for the heartbeat's "ask me the one question that makes this task clear."
3. **Run outcome classification with bounded nudges.** Label each run advanced, plan only, empty, blocked, or failed. Automatically nudge plan-only and empty runs once or twice, then flag them. This keeps executions moving without a supervisor agent.
4. **"Every run leaves a note with the next action."** A cheap rule that makes any run resumable by a human or another agent.
5. **A claim so two workers never take the same task.** Ri already has the execution-to-task association and a live-work guard. A claim would also cover a human working a task by hand.
6. **Scheduled work that produces a task.** A routine could create a task in the list (visible, reviewable, part of the deck) rather than only a chat.
7. **Review stages enforced by the runtime.** Ri already says a finished agent run never completes a task. Paperclip goes further by routing finished work to a named reviewer automatically.
8. **Budgets per agent or project with a pause at the limit.** Ri has a monthly budget. A per-scope cap would matter once several things run unattended.

## 8. What not to borrow

- **The company-of-agents model.** Paperclip treats humans as the board and agents as employees. Ri is a human doing real work alongside agents, and human tasks are central (the deck).
- **Instructions as files on disk.** Ri's heartbeat instructions live in the database and are edited in the app.
- **A timer that makes the agent do its main work.** Ri's executions run as live sessions. Ri's heartbeat is a check-in, not the execution engine.
