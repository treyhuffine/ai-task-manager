# Agent coordination

Status: implemented and verified on 2026-10-15. Scope approved in the conversation on that date.

The orchestrator, agent main chats, and execution chats should form a complete work loop. An agent can discover its environment, address another agent, ask for context or delegate work, and receive a durable reply that resumes its conversation. Existing task, result, approval, Connector, and team boundaries continue to apply.

## Implementation checklist

- [x] Enable qualified Codex MCP capabilities and verify tool delivery to agent main chats and executions.
- [x] Add stable addresses for the orchestrator and agent main chats, current session context, and reliable inter-chat sends.
- [x] Persist requests, delegation, replies, blocked-state updates, retries, and recovery. Completion resumes the requesting chat.
- [x] Search personal main and content chats and retrieve complete messages through bounded, indexed history pages.
- [x] Attach native coordination tools to executions and teach all three roles how to use them.
- [x] Verify the complete delegation and consultation loop, failure recovery, access boundaries, and migration. Run typecheck and relevant regression checks.

## Design decisions

An address identifies an agent, while a session identifies one conversation with it. The orchestrator address resolves its current main chat. An agent address resolves that agent's current main chat. Existing session IDs continue to identify exact chats. Starting a new main chat does not invalidate the agent address.

Requests and their outgoing replies are durable. Stable request IDs prevent retries from repeating the same operation. A request records its source, target, accepted message, associated work, and outcome. Replies retain provenance and wake the requester through the existing message pipeline. Delivery failures retry delivery rather than repeating completed work. Uncertain execution remains explicit after a restart.

Consultation is ordinary visible work between chats. Agents can consult another agent's main chat for its project context, while code changes remain in execution chats. Executor tools expose coordination directly alongside the existing signed CLI.

This change applies to personal orchestrator, agent main, and execution chats. It does not expand team AI's capabilities or let an agent approve a human-only permission. Retrieval excludes internal reviewer contexts and team conversations from the personal surface.

## Addresses and tools

| Tool | Purpose |
| --- | --- |
| `get_session_context` | Current chat identity, agent and orchestrator addresses, requesting chats, and effective harness capabilities |
| `ask_agent` | A consultation with an automatic returned answer |
| `send_agent_message` | An informational message with no automatic returned answer |
| `delegate_work` | A new execution with a durable assignment and automatic returned outcome |
| `get_agent_request` | Request state, responding chat and run, answer, and delivery state |
| `list_agent_requests` | This chat's incoming or outgoing requests |
| `reply_agent_request` | An explicit answer from the assigned responding chat |
| `cancel_agent_request` | Cancel an outgoing assignment and its descendants, stopping delegated executions |
| `get_session_events` | Indexed backward paging through complete personal conversation events |
| `get_chat_event` | One exact message or tool input, in bounded text slices |

Targets are `orchestrator`, `agent` for this chat's own agent, `agent:<workspace id>` for another agent, and `session:<chat id>` for an exact conversation. `requester` resolves the source of the current incoming assignment. Discover agent IDs through `list_workspaces` or `get_workspace`.

`ask_agent` and `send_agent_message` take `target`, `request_id`, and `content`. `delegate_work` takes `workspace_id`, `request_id`, and `prompt`, with optional provider, model, effort, task, device, and label. Existing `start_execution` stays available for lower-level dispatch, and `send_session_message` now accepts an optional `requestId` for retry safety. Existing action names and their parameter conventions remain compatible.

All new request creation requires a signed personal Ri chat. The source identity comes from its verified credential. Changing intent while reusing a request ID is a conflict. Replies can be submitted only by the assigned responding chat. Request nesting is bounded to eight ancestors to stop unbounded agent loops.

## Execution and return delivery

The new `agent_requests` table retains each request's source, logical addresses, exact target chat, input event, optional parent assignment, run, response event, and outcome. `agent_deliveries` is its durable outbox for replies, failures, cancellation, and blocked-state updates. The query layer owns every write.

The server resolves addresses and delivers through the existing message operation. Delegation reuses `start_execution`, preserving worktree, device, model, permission, and task-link behavior. A stable input event prevents a repeated delivery from becoming a second message. CLI calls forward runtime work to the owning server.

The dispatcher binds a request to its run before the runner can emit output. Event ingestion records the exact root assistant event for that run. Completion saves its answer and queues the return in the same transaction. Streamed text is read from its saved event at completion, avoiding repeated copies on every text update. Returned answers retain up to 80,000 characters and the response event ID for retrieving longer output.

An execution that has outstanding consultations or delegated work becomes `waiting` when its current turn ends. It does not report the whole assignment complete. The returned child answer resumes that execution and binds the original assignment to the continuation run. Its eventual result returns to the original requesting chat.

Blocked updates identify the responding chat and its pending input. Supervisors can answer questions within the user's intent through the existing pending-input tools. Human-only permission approvals remain enforced by the existing runtime.

Busy chats leave delivery queued. Retry scheduling prevents one busy agent from starving other destinations. Completion resumes the requesting chat without requiring a browser viewer. A return to a main-chat address can reach a replacement main conversation. Once delivery has been attempted, its destination is pinned so an uncertain acknowledgment cannot duplicate the same event into a different chat.

If work cannot start and has no responding chat, the server records a system-authored failure and resumes the requester with that failure. It does not fabricate a human or agent author. Cancelling an assignment also cancels its descendants, and late child replies do not restart the cancelled execution.

## Restart and failure behavior

Queued work and unsent replies survive restarts. Replies retry delivery without repeating the completed assignment. A local run interrupted by a home restart is reported as interrupted and is not automatically repeated. Work running on a connected device remains owned by that device and can report its outcome through the worker journal.

Closing an exact requesting chat cancels work that has not started. Closing an exact receiving execution prevents a new continuation there. Closed or removed responding chats produce a visible failure, including when an exact target closes before dispatch. Stable agent addresses can resolve new main chats for requests that have not started yet. Request and delivery inspection remain available when a recipient is unavailable.

The delivery loop runs at startup and every two seconds, with immediate wakes after relevant state changes. Its in-flight state uses `processState`, and its background work uses a named performance scope. The loop queries bounded indexed request and outbox rows, without scanning chat history.

## Native tools and harness capabilities

Qualified execution chats receive a focused `coordination` MCP server alongside their existing scoped Connectors, browser, and optional result tools. The coordination endpoint requires a signed personal chat and exposes the coordination and inspection tools rather than every administrative action. Internal result reviewers retain their restricted surface.

The same instructions describe the signed CLI fallback when native MCP is unavailable. Agent main chats and the orchestrator receive the coordination instructions through their existing managed briefs. Consultation with another agent is allowed within the user's requested work, and code changes continue to belong to executions.

Codex MCP and strict configured-MCP isolation are enabled with Agent Ex support and a verified Codex CLI version of at least 0.160.0. Older or unverifiable versions give an upgrade or verification reason. Configured MCP isolation and native file-tool filtering are separate capabilities. Codex's native ChatGPT Apps remain subject to Codex's own settings and approvals.

## Conversation retrieval

The `search_sessions` action searches personal execution, orchestration, and content conversations by default, including archived history. Its optional `type` narrows the search. Existing execution-only UI searches retain their existing query default. Team chats and internal result reviewers are excluded from personal search.

`get_session_events` returns a bounded page with `next_before` for older history. A cursor must belong to that chat. `get_chat_event` retrieves the remainder of long text through `next_offset`, and long tool inputs through `next_tool_input_offset`. Provider raw records are never returned. User ownership is checked before returning conversation content.

The history queries use the session index and bounded limits. They preserve `(created_at, id)` ordering when several events have the same timestamp. No whole-session ranking or grouping is added.

## Verification

The coordination integration tests use disposable homes and real SQLite migrations. They cover retry identity, changed-intent conflicts, provenance, new main chats, blocked updates, cancellation, launch failure, restart interruption, complete text retrieval, audience separation, and the indexed history query plan.

The runtime test uses the real message operations, execution creation, dispatcher, runner, event ingestion, and run completion, with a scripted stand-in model. It proves the complete orchestrator to executor to agent main chat consultation and return loop, including automatic continuation.

The backend regression run passed 1,321 tests across 139 files, with six existing opt-in tests skipped. It covered coordination, harnesses, orchestrator actions, execution, runs, database queries and migrations, work results, team AI and MCP boundaries, HTTP orchestrator routes, and process state. Typecheck and targeted ESLint passed. CLI help successfully discovered the new actions.

The native Agent Ex Codex smoke check verifies new and resumed threads against local HTTP and stdio MCP servers, credentials, configured-server isolation, and cleanup. It uses no inference prompt or connected-account tool and verifies that the user's configuration is unchanged.

Reproduce the main checks from this repository:

```sh
pnpm exec vitest run src/lib/coordination src/lib/harness src/lib/orchestrator src/lib/executor src/lib/runs src/lib/db src/lib/work-results src/lib/team/ai src/lib/team/mcp src/app/api/orchestrator src/lib/process-state.test.ts
pnpm ts
```

The native qualification runs in the linked Agent Ex checkout:

```sh
pnpm --filter @agentex/agent exec tsx scripts/smoke-codex-mcp.ts
```

Migration `0017_agent_coordination` adds the two coordination tables. Existing tables are not rebuilt. A running home applies it through the normal migration runner on its next server start.
