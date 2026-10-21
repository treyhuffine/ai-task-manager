# Agent coordination

Status: implemented. The agent-facing interface is consolidated around existing-chat messages and new-chat assignments.

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

Messages from other chats have a distinct incoming container. Its header names
the source chat with an underlined title and an open arrow, alongside the agent
name when available. Requests, assignments and replies identify their purpose. A required response is labeled "Request from", without guessing whether the prose is a question.
Generated routing headers and return instructions stay in the saved and copied
message, while the visible body shows the actual message. Returned answers keep
their original request in a disclosure.

Every newly accepted message from another chat also saves a compact `Sent to`
receipt in its sender's transcript. It links to the receiving chat and shows a
bounded message preview. Both events commit together, retries produce one
receipt, and the receipt remains visible outside collapsed tool activity. This
runs at the shared query-layer insert boundary, covering MCP, signed CLI,
delegation and automatic returns. The receipt is a system event, so it neither
starts a turn nor creates a second message exchange. It does not mark a chat
unread. Earlier sends are not backfilled through a history scan.

This change applies to personal orchestrator, agent main, and execution chats. It does not expand team AI's capabilities or let an agent approve a human-only permission. Retrieval excludes internal reviewer contexts and team conversations from the personal surface.

## Addresses and tools

| Tool | Purpose |
| --- | --- |
| `get_session_context` | Current chat identity, agent and orchestrator addresses, requesting chats, and effective harness capabilities |
| `message_agent` | Message an existing chat, with explicit `response: "required"` or `"none"` |
| `delegate_work` | A new execution with a durable assignment and automatic returned outcome |
| `get_agent_request` | Request state, responding chat and run, answer, and delivery state |
| `list_agent_requests` | This chat's incoming or outgoing requests |
| `reply_agent_request` | An explicit answer from the assigned responding chat |
| `cancel_agent_request` | Cancel an outgoing assignment and its descendants, stopping delegated executions |
| `get_session_events` | Indexed backward paging through complete personal conversation events |
| `get_chat_event` | One exact message or tool input, in bounded text slices |

Targets are `orchestrator`, `agent` for this chat's own agent, `agent:<workspace id>` for another agent, and `session:<chat id>` for an exact conversation. `requester` resolves the source of the current incoming assignment. Discover agent IDs through `list_workspaces` or `get_workspace`.

`message_agent` takes `target`, `request_id`, `content`, and a required `response`:

- `required`: final answer, failure, cancellation, and blocked-state updates return automatically and resume the requesting chat.
- `none`: deliver the message and wake the recipient, without automatically returning its answer. The recipient can send a separate message when useful.

`delegate_work` takes `workspace_id`, `request_id`, and `prompt`. It always creates a tracked assignment in a new chat. Optional `provider`, `model`, `effort`, `permission_mode`, `task_id`, `device_id`, and `label` retain the launcher controls. An unavailable device is refused, never replaced silently.

Both return the same compact acceptance receipt: `id`, lifecycle `status`, logical `target`, resolved `targetSessionId` when known, `response_required`, `return_delivery` (`automatic` or `none`), and a next-step note. Acceptance does not mean delivered or completed. Use `get_agent_request` for the exact work and delivery state. Continue independent work, or end the current turn if waiting. The runtime resumes the requester when the tracked outcome arrives, without transcript polling.

Only two general communication tools are exposed. They correspond to the recipient's lifecycle: contact an existing chat, or assign work to a new one. An argument carries the return policy, where the delivery mechanics are otherwise identical. An explicit reply and request inspection/cancellation remain separate operations because they act on an existing request.

### Removed tools and their replacements

| Previous use | Current interface | Behavior |
| --- | --- | --- |
| `ask_agent` | `message_agent`, `response: "required"` | Consult any stable agent address or exact chat, with automatic return |
| `send_agent_message` | `message_agent`, `response: "none"` | Information or steering without automatic return |
| `send_session_message` | `message_agent`, `target: "session:<chat id>"` | Choose the return policy explicitly, with mandatory retry identity |
| `start_execution` | `delegate_work` | New chat with all launch controls and a tracked returned outcome |
| `submit_memory_finding` | `message_agent`, `target: "orchestrator"`, `response: "none"` | Ask the main chat to consider saving the finding in MEMORY.md, with retry safety |
| `delegate_work` | `delegate_work` | Retained as the single way to initiate a new assignment |
| Manual progress polling after a send or start | No replacement workflow needed | Request completion and failure return automatically when tracked |

The removed actions are absent from both MCP and CLI, with no aliases. `delegate_work` names the intent and its ownership/return contract. "Start execution" describes only the launch primitive, which is now an internal server operation.

Examples:

```json
{ "target": "agent:frontend-id", "request_id": "expiry-context-1", "content": "Confirm the agreed behavior after session expiry.", "response": "required" }
```

```json
{ "target": "session:work-chat-id", "request_id": "expiry-steering-1", "content": "Preserve the destination after login.", "response": "none" }
```

```json
{ "workspace_id": "frontend-id", "request_id": "expiry-fix-1", "prompt": "Fix session expiry, preserve the destination after login, and verify the redirect.", "permission_mode": "plan" }
```

All new request creation requires a signed personal Ri chat. The source identity comes from its verified credential. Changing intent while reusing a request ID is a conflict. Replies can be submitted only by the assigned responding chat. Request nesting is bounded to eight ancestors to stop unbounded agent loops.

## Execution and return delivery

The `agent_requests` table retains each request's source, logical addresses, exact target chat, input event, optional parent assignment, run, response event, and outcome. `agent_deliveries` is its durable outbox for replies, failures, cancellation, and blocked-state updates. The query layer owns every write.

The server resolves addresses and delivers through the existing message operation. Delegation calls `startDelegatedExecution`, an internal server operation preserving worktree, device, model, permission, and task-link behavior. An unchanged retry never overwrites a permission choice made in the chat since launch. A stable input event prevents a repeated delivery from becoming a second message. CLI calls forward runtime work to the owning server.

The dispatcher binds a request to its run before the runner can emit output. Event ingestion records the exact root assistant event for that run. Completion saves its answer and queues the return in the same transaction. Streamed text is read from its saved event at completion, avoiding repeated copies on every text update. Returned answers retain up to 80,000 characters and the response event ID for retrieving longer output.

An execution that has outstanding consultations or delegated work becomes `waiting` when its current turn ends. It does not report the whole assignment complete. The returned child answer resumes that execution and binds the original assignment to the continuation run. Its eventual result returns to the original requesting chat.

Blocked updates identify the responding chat and its pending input. Supervisors can answer questions within the user's intent through the existing pending-input tools. Human-only permission approvals remain enforced by the existing runtime.

Tracked requests and returned outcomes wait until the recipient is available, so unrelated in-flight output cannot be mistaken for the answer. Informational steering enters a busy chat immediately when its actual harness/device capabilities support concurrent send, preserving mid-turn steering. Otherwise it remains queued. Retry scheduling prevents one busy agent from starving other destinations. Completion resumes the requesting chat without requiring a browser viewer. A return to a main-chat address can reach a replacement main conversation. Once delivery has been attempted, its destination is pinned so an uncertain acknowledgment cannot duplicate the same event into a different chat.

If work cannot start and has no responding chat, the server records a system-authored failure and resumes the requester with that failure. It does not fabricate a human or agent author. Cancelling an assignment also cancels its descendants, and late child replies do not restart the cancelled execution.

## Restart and failure behavior

Queued work and unsent replies survive restarts. Replies retry delivery without repeating the completed assignment. A person stopping the responding turn ends its run normally, as Stop always has, and the request fails with a notice that the work was stopped, so the requester never reads partial output as finished work. Other unfinished turn statuses (failed, timeout, max turns or budget) fail the run and the request. A local run interrupted by a home restart is reported as interrupted and is not automatically repeated. Work running on a connected device remains owned by that device and can report its outcome through the worker journal.

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

The final consolidation run passed 1,428 tests across 153 files, with six existing opt-in tests skipped. Typecheck and targeted ESLint passed, with two existing unused-variable warnings in queries.ts. Verification includes native MCP discovery and argument validation, generated CLI help, durable recovery, concurrent steering and presentation checks. It covered coordination, harnesses, orchestrator actions, execution, runs, database queries and migrations, work results, team AI and MCP boundaries, HTTP orchestrator routes, and process state. Typecheck and targeted ESLint passed. CLI help successfully discovered the new actions.

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

## Database and rollout

The tool consolidation needs no SQL migration or cleanup script. Both message policies and new assignments use the existing request/outbox schema. The optional permission setting is stored in the existing options JSON. The persisted `question` kind means a response-tracked message, not a linguistic classification. The UI calls it a request.

Existing requests, deliveries, chat IDs, event IDs, retry keys and execution-ID derivation remain valid. Retries also reuse accepted message bytes, so an instruction-text update cannot turn the same event ID into conflicting content. Keep the opaque hash namespace in `start-id.ts` stable: changing those bytes would risk launching an existing queued assignment twice. It is persisted identity, not an exposed action alias. Historical transcript text and tool-call evidence stay intact. The presentation parser recognizes the stable control-footer preamble, so old saved instructions can be hidden without rewriting messages.

Already-launched work from the removed untracked tools has no requesting lifecycle record. It continues as an ordinary chat and is not retroactively turned into an assignment. A new `message_agent` request with `response: "required"` can ask that exact chat for a status or result when needed.

Use the normal owner-controlled server restart to load the new registry. Start new chats to give agents a fresh tool inventory and brief. A long-lived harness can remember a removed tool name until refreshed. No installed external-client configuration or running production process is changed by this source update.

## Adversarial review

The pre-merge independent review found two regressions and two existing lifecycle gaps. Each has a regression test:

- Budget and other terminal HTTP refusals produce a failed outcome, while transport uncertainty, rate limits and server errors remain retryable. A transport error has its own error type, retaining the existing action envelope for callers.
- Delegation checks its durable request before launch and after creation. Its exact chat is bound before the first prompt. Cancelled inputs are refused again at message acceptance, local dispatch after preparation and provider startup, and device-queue delivery. Stop also fences asynchronous local runner startup without a home-only admission callback. A command already accepted by a connected device is stopped through its durable interrupt command, so cancellation there remains asynchronous.
- Input and return retries retain accepted bytes and identities after lost acknowledgments.
- All relationship links preserve the exact chat ID. Archived main chats open their transcript without resuming or replacing the current main chat. Active exact chats keep their own composer.

The main-branch integration preview preserves both the file-preview gallery and the chat-message gallery when resolving their shared rendering section. Production is not restarted by these checks.

Final pre-merge integration verification against main at `41dfe4dc`: 1,456 tests passed across 155 files, with six existing opt-in tests skipped. Typecheck, gallery build, CLI build and the focused chat-message browser smoke passed. The browser check covers all example states on desktop and phone in both themes. Independent re-review found no remaining blockers in the four fixes or the startup Stop fence.
