# Agent coordination

Status: implemented in this checkout. Production rollout remains owner-controlled.

The [specification](agent-coordination-controls-proposal.md) defines the contract. The [implementation checklist](agent-coordination-implementation.md) records acceptance evidence and rollout requirements.

Sending to a chat wakes it when permission, availability and Hold permit. Asking for an outcome adds a durable obligation. The agent chooses useful communication and writes its answer. Ri code handles delivery, approval state, run ownership, retries and automatic return. It does not classify prose to decide whether a message is a question or an acknowledgment.

## Records and ownership

| Record | Responsibility |
| --- | --- |
| `chat_events` | Visible received text, source links, outgoing receipts, approval decisions and control history |
| `agent_coordination_deliveries` | One symmetric send, its immutable payload, exact destination, delivery state and first accepting run |
| `agent_coordination_requests` | An optional owed outcome, parent assignment, work state and assigned run |

A one-way message and a human forward have a delivery without a new request. A tracked question or delegation has an initial delivery and a request. Answers, failures, cancellations and blocked updates are deliveries in the reverse direction. This needs no chat-pair or collaboration table.

Run identity comes from the producing harness turn, including verified signals and heartbeat recovery from a connected device. A chat ID or its latest run is insufficient. Human input folded into an assigned turn keeps that assignment and records human direction. A separate human turn can read pending work without claiming or completing it.

When an assigned run finishes, Ri captures its saved root assistant output. Outstanding child work keeps the assignment waiting. Otherwise completion or failure settles the obligation and queues one terminal outcome in the same transaction. A stable outcome identity prevents an explicit reply and normal completion from returning two answers. Ordinary reply-processing turns do not create another return obligation.

## Addresses and tools

Stable addresses are `orchestrator`, `agent` for the caller's own agent, and `agent:<workspace id>`. `session:<chat id>` identifies an exact chat. `requester` means the exact originating chat of the verified current assignment. Scheduled chats also use exact return addresses. A stable address may resolve a replacement main chat before delivery is attempted. Once pinned, the destination is retained through retries and uncertain acknowledgments.

| Tool | Purpose |
| --- | --- |
| `get_session_context` | Identity, stable addresses, current producing run and assignment, effective coordination policy and actual harness capabilities |
| `message_agent` | Send to an existing chat with explicit `response: "none"` or `"required"` |
| `delegate_work` | Start a new chat for an assignment with an automatic returned outcome |
| `get_agent_delivery` | Inspect approval, pinned destination, delivery and native acceptance, including one-way sends |
| `get_agent_request` | Inspect owed work, its assigned run, outcome and deliveries |
| `list_agent_requests` | This chat's incoming or outgoing obligations |
| `reply_agent_request` | Explicitly answer from the verified assigned producing run |
| `cancel_agent_request` | Cancel an outgoing obligation and descendants, stopping delegated work |
| `get_session_events` | Bounded, indexed history pages |
| `get_chat_event` | One exact message or tool input in bounded text slices |

`message_agent` requires `target`, `content`, `response` and `request_id`. The last field is a caller retry key for unchanged intent. Receipts identify the server delivery and optional request separately. A changed operation under the same retry key conflicts.

- `response: "none"` delivers and wakes when eligible, with no automatic returned final answer.
- `response: "required"` adds an obligation whose answer, failure, cancellation or blocked update returns automatically.
- Optional `related_request_id` associates one-way steering with participating work. It is a server request ID. It creates no new obligation and cannot reopen completed work. Related steering cannot enter an unrelated producing assignment.

`delegate_work` requires `workspace_id`, `request_id` and `prompt`. It retains provider, model, effort, permission mode, task, device and label options. Approval precedes creation. Retries reuse reserved chat, execution and input identities. An unavailable device is refused instead of replaced.

Receipts expose `delivery_id`, optional `request_id`, delivery `status`, `request_status`, logical target, exact target when resolved and `return_delivery`. Acceptance is separate from completed work. Agents may finish their current turn while waiting, and tracked outcomes resume them without transcript polling.

### Consolidated interface

| Previous tool | Replacement |
| --- | --- |
| `ask_agent` | `message_agent`, `response: "required"` |
| `send_agent_message` | `message_agent`, `response: "none"` |
| `send_session_message` | `message_agent`, `target: "session:<id>"`, explicit response policy |
| `start_execution` | `delegate_work` |
| `submit_memory_finding` | `message_agent`, target orchestrator, `response: "none"` |

Removed tools have no MCP or CLI aliases. The orchestration registry generates both surfaces. Qualified personal chats receive the focused native coordination server, with a signed CLI fallback. Team chats and internal reviewers retain their restricted surfaces. The orchestrator and agent main chats are encouraged to consult and delegate proactively within the user's intent and permission.

## Permission and Hold

Nullable `agent_coordination_policy` preferences live on `chat_sessions`, `executions`, `workspaces` and `user_state`. Resolve in that order. All unset means Ask first in code, with no database policy default. UI controls display the effective setting and its source.

Under Ask first, a send is durably saved as awaiting approval in its source chat. The human can Allow once, Always allow in this chat, or Deny. The broader choice allows arbitrary destinations and new chats from that chat. Denial starts no target work. Policy changes govern future sends, while previously approved sends keep their authorization.

Automatic outcomes and direct communication to the exact verified current requester need no new approval. Creating a new delegated chat is never this exemption, even in the requester’s agent. A replacement main chat follows normal policy. Contacting an unrelated third chat follows normal policy. Agent-created chats initialize from the creator's effective policy while respecting an explicit destination ask restriction. Initialization is audited and idempotent. Only human controls can edit standing policy or Hold. Policy, Hold, approval and human-forward mutations reject signed agents even when the request also carries the Home's viewer key.

Delegation cannot increase tool authority. The shared launch boundary caps requested or omitted permission to the less autonomous of source and destination mode, in the order plan, ask, auto_edits, auto_all. Unsupported capped modes fail clearly. A retry or harness switch cannot grant broader authority. Signed agents cannot bypass this boundary through ordinary new-chat endpoints or generic permission-mode updates.

Hold is `chat_sessions.coordination_held_at`. It persists through reload and restart. Incoming traffic stays visible but cannot start or inject an automatic turn. Hold does not interrupt already admitted work. Stop remains independent.

Human composer sends and forwards can run a held chat with eligible pending material. Inputs already reserved for a native command stay with that command instead of being supplied twice. Human input into an active assignment includes only its related steering and child updates. Hold stays on. Reading a required assignment this way leaves its owed work queued. Reading a child answer leaves the parent waiting. Release reserves the appropriate assignment continuation once, with instructions to inspect current state and prior human work instead of repeating side effects blindly. Release wakes the connected device stream. Commands already deferred inside the worker retry within their bounded backoff, at most thirty seconds.

`accepted_by_run_id` records the first run supplied a delivery. `continuation_run_id` separately records a reserved parent continuation. This preserves a child answer read during a human turn without losing its still-owed parent continuation or replaying it as another ordinary reply.

## Delivery and recovery

Delivery states are awaiting_approval, queued, delivered, accepted, denied, failed and cancelled. Delivered means the receiving event is saved. Accepted means the native harness received the input. A queued device command alone is not acceptance. Request states are queued, working, waiting, completed, failed and cancelled.

Receiving text, an outgoing receipt and delivered state commit together, with realtime publication after commit. Delivery payloads retain exact accepted text and attachments. Retries do not reconstruct text from updated templates or edited source messages. Long material stays fully available through attachments or explicitly paged source retrieval.

Distinct required assignments receive separate producing turns. An offline device’s pending command and an existing reservation count as occupied work even when its live mirror says idle. Ordinary messages batch in persisted order. Related steering may join a supported active assignment. Late one-way follow-ups wake normally without reopening terminal work or editing an earlier outcome.

Hold and cancellation are checked during local preparation and immediately before native acceptance on a connected device. A held reserved command remains reserved and can be retried without another run. Deferred device sends do not block interrupt/control commands. A human Stop produces a failed outcome for the interrupted assignment rather than returning partial work as success. Unaccepted reservations for other work remain queued. Busy, budget and known transport failures preserve reservations and retry with backoff. Ordinary human device sends do not depend on coordination admission. Admission network failures defer rather than permanently fail the send.

Queued work, approvals and unsent outcomes survive restart. Unaccepted coordination reservations use the `coordination_wait` run reason, including Hold and retry waits. Boot preserves those queued reservations for their own scheduler. They do not take the scheduled execution concurrency gate until started. Move-held scheduled fires retain their separate `held_by_move` behavior. Local work interrupted after acceptance is reported as interrupted rather than repeated. Connected-device work remains owned by its journal. Generic orphan-message recovery hands coordination back to its own scheduler instead of dispatching unbound work.

Archive preserves exact history. Hard deletion settles unaccepted coordination before clearing nullable provenance. Referenced assignment requests and continuation runs are protected by restrictive foreign keys. Soft event references can become unavailable without replaying delivery or deleting another chat's transcript. The scheduler and active-exchange queries use coordination indexes, never whole-transcript scans.

## Scheduled jobs

Enabling an automation authorizes communication and delegation needed for its assignment. The dispatcher initializes each trigger-fired chat with the existing chat-level Allow automatically preference. This includes first-time execution creation, later recurring execution chats, orchestrator jobs, one-time jobs, interval jobs, webhooks and Run now. Ordinary interactive chat defaults remain unchanged. There are no new permission tables, recipient grants or trigger preference columns. Future fires of existing schedules use the new default without a migration or historical replay.

A person may change that run chat's preference, pause incoming messages or stop the run. If the turn ends with its own send still awaiting approval, the run fails with `coordination_approval_required` and an actionable message. Its normal terminal notification route is used, with the existing needs-input route as fallback. There is one notification route per failure and no duplicate on repeated result callbacks. Already authorized queued messages remain delivery state. A run's completed turn is distinct from an accepted delivery or a finished delegated assignment.

Schedule creation and enabling retain their existing authorizing operations. Agent instructions require user intent and prohibit using a schedule to bypass a denial. No new setup approval workflow is introduced.

## Human sharing and navigation

Send to chat appears beside message actions. The picker orders chats by recent activity, searches their metadata and filters by agent. It shows title, agent and activity time. Existing destinations keep their settings. A new chat uses normal defaults with optional model and supported effort controls, and retrying creates one destination.

The receiving card says Shared by you, separates directions from quoted material and links to the exact source message. Agent traffic uses protocol labels such as Request from, Message from and Answer from. System failures retain truthful Ri authorship. Long cards have a bounded preview and explicit expansion.

The sending chat receives a compact linked receipt. A human forward that fails before acceptance creates a durable failure card there with its destination and reason. Receipts, approval history and Hold audits are system events that start zero agent turns. Instructions discourage acknowledgment-only chatter without a runtime prose classifier. Hold remains the dependable way to get the human back in control.

Links preserve exact chat and event IDs. A direct message lookup works outside the currently loaded transcript page. Archived links open history without resuming the chat or replacing its current main chat. The composer shows linked participating chats and Pause incoming only while approved work or delivery is active. Completed history does not keep controls visible. An enabled pause stays visible with a waiting count and Resume. Standing preferences and pause controls live in the chat menu. The Send to chat dialog centers within viewport margins without horizontal scrolling, including when choosing a new chat model.

## Mentioning an agent

Typing `@` in a personal chat's composer, or in the new-chat launcher, offers the home's active agents (`agent:` narrows to them). A mention is saved in the message as `[[agent:<workspace id>]]` and reaches the chat's agent as that agent's name, purpose and stable address: `<agent id="…" name="…" address="agent:…">purpose</agent>`, with `status="archived"` when it can no longer be reached. The folder is left out. Another agent is reached through its address, where its own scope applies.

A mention says who to involve. It authorizes nothing by itself. The chat's agent decides whether to consult (`message_agent`) or delegate (`delegate_work`), and those sends follow the chat's effective policy, so Ask first shows the usual approval card. Mentions add no `chat_refs` rows, since Notes & tasks and backlinks hold what a chat carries, not who it should involve. Team chats have no coordination and offer no agent mentions.

## Migration and rollout

Forward migration `0022_agent_coordination_controls.sql` evolves the two old coordination tables and adds nullable preferences and Hold. It does not rebuild `chat_events`, chats or runs. Existing FYIs become deliveries without retained obligations. Request, delivery, event and retry identities and exact saved message bytes are preserved. Historical accepted work is not re-run to fill missing metadata. No manual database cleanup script is needed.

Appended migration `0023_coordination_system_authorship.sql` corrects historical failure provenance without changing saved text or rowids. The migrations include explicit custom data-conversion SQL. Review that SQL as part of rollout.

Apply through the normal safe migration runner on the owner-controlled server start. This work did not restart or migrate production. Start fresh harness chats where necessary to refresh learned tool descriptions.

Home and connected workers must advertise `coordination.admission.v1`. The existing compatibility system requires an update for peers without that guard, preventing an older worker from bypassing Hold. Worker protocol 4 and journal format 1 remain unchanged. Update both peers as part of rollout.

Verification includes disposable-home lifecycle tests, real local and remote runner flows with scripted harnesses, indexed query plans, a copied-data migration rehearsal, typechecking, CLI and gallery builds, and interactive gallery checks on desktop and phone in both themes. See the [acceptance evidence](agent-coordination-implementation.md) for results and reproduction commands.
