# Agent coordination specification

Status: implemented in this checkout. Owner-controlled rollout pending.

Updated: 2026-10-27. Implementation started from commit `3c1cda1d2950`.

This is the normative specification. It supersedes the earlier proposals and review alternatives in this file. [Agent coordination](agent-coordination.md) describes the implementation and rollout. [Implementation evidence](agent-coordination-implementation.md) maps its acceptance criteria to verification. Production has not been restarted or migrated by this work.

## 1. Product contract

Sending a message wakes the receiving chat. Automatically returning an answer is optional.

- Send a message: deliver it as agent input, let the recipient decide what to do, and do not automatically return its final answer.
- Ask for an outcome: deliver the assignment or question, track its work, and automatically return its answer, failure, cancellation, or blocked-state update.
- Hold: incoming messages remain visible, but agent traffic cannot start another turn in this chat. The human can direct a turn while Hold remains enabled. Only explicit release restores automatic activation.

Both send modes are subject to applicable permission, availability, and Hold. Waking means eligible dispatch, not an immediate concurrent run regardless of those gates.

Delivery receipts come from Ri code. They are visible status, not agent input. Agents must not send acknowledgments merely to confirm delivery. A returned answer does not itself create another obligation to answer.

The orchestrator and agent main chats should consult and delegate proactively within the user's intent and permission. The user does not need to tell them to become an orchestrator.

There is no passive-context send mode in version one. In particular, `response: "none"` does not mean wait for a future unrelated turn. Legitimate one-way instructions can require action now without requiring an answer back.

This preserves useful autonomy. It does not promise that agents can never make unnecessary explicit follow-ups. Hold is the dependable human control. Existing budget and execution safeguards remain in force.

## 2. Scope and non-goals

Implement:

- One symmetric, durable mechanism for every inter-chat delivery.
- Optional requests for work whose outcome is owed.
- The agreed standing permission columns and per-action approval.
- Per-chat Hold, independent of permission and Stop.
- Human Send to chat with truthful provenance, source/destination links, search, and an agent filter.
- Normal model and effort controls when starting a destination chat.
- Correct request/run attribution, restart recovery, and retry identity.
- A permission ceiling for agent-created chats.

Version one does not add a collaboration entity, permanent chat-pair records, a grants table, work-wide permission inheritance, mandatory takeover dialogs, passive FYIs, global or execution-wide Hold, or new mandatory exchange/chat-count allowances.

Execution-wide and agent-wide permission are included. They are independent of Hold scope.

## 3. Three record responsibilities

| Record | Responsibility |
| --- | --- |
| `chat_events` | The visible transcript: received text, source references, outgoing receipts, decisions, and control events |
| `agent_coordination_deliveries` | One inter-chat send in either direction, including its exact payload, delivery state, and harness acceptance |
| `agent_coordination_requests` | One question or assignment whose outcome is owed, including its work lifecycle and execution binding |

Rename and evolve the existing `agent_requests` and `agent_deliveries` tables. Do not keep a second active implementation or compatibility aliases.

Every inter-chat send uses a delivery. A delivery's `request_id` is optional. A one-way message or ordinary human forward needs no request. Requests are obligations, not generic threads and not human permission requests.

### 3.1 Worked sequence

| Step | Message | Records |
| --- | --- | --- |
| 1 | A asks B to implement a feature | Request R1 and initial delivery D1, A to B |
| 2 | B asks A whether to preserve the old API | Child request R2 and initial delivery D2, B to A |
| 3 | A answers yes | Delivery D3 answers R2, A to B |
| 4 | B completes the feature | Delivery D4 completes R1, B to A |
| 5 | A sends B an additional instruction without asking for a report | Delivery D5, A to B, no new request |

D5 still wakes B when eligible. B's final answer remains in B's chat. B may initiate a separate useful follow-up, subject to the same permission and Hold rules.

A and B can each initiate requests and provide outcomes. A request has an initial delivery and may have several returned updates. Retry attempts reuse a delivery rather than creating more logical messages.

## 4. Agent interface

### 4.1 Send and ask

Keep the two initiation tools:

| Tool | Meaning |
| --- | --- |
| `message_agent` | Send to an existing chat, with explicit `response: "none"` or `"required"` |
| `delegate_work` | Create a new chat for an assignment with a tracked returned outcome |

For `message_agent`:

- `response: "none"` creates a message delivery, wakes the recipient when eligible, and creates no new request or automatic returned answer.
- `response: "required"` creates a request plus its initial delivery. The eventual outcome returns automatically.
- Keep `target`, `content`, and the required `request_id` retry key.
- Add optional `related_request_id` for explicitly associating a one-way message with existing work. It must name a request the sender is serving or initiated, and the destination must be a participant. It does not reopen a terminal request or create an additional outcome obligation. An existing required assignment still returns its own eventual outcome.
- `related_request_id` is valid with `response: "none"`. A new required response creates a new request whose parent is established from the verified producing run.

The existing `request_id` argument remains the caller-supplied idempotency key for this send. It is not the server request ID used in `related_request_id`. Describe this distinction in tool schemas and receipts. Do not reuse one field for both meanings.

`delegate_work` retains its launch options, including agent, device, harness/provider, model, effort, task, label, and permission mode. Approval precedes destination creation. Launch retries reuse the reserved chat and execution identities. Before the first native send, join the shared worktree readiness guard. A worktree setup failure reports the failure without starting a harness, and connected-device work remains on its worker.

### 4.2 Reply and inspection

Keep `reply_agent_request`, `get_agent_request`, `list_agent_requests`, and `cancel_agent_request`. Add delivery inspection through `get_agent_delivery` so one-way sends are inspectable without inventing requests for them.

An explicit reply must come from the assigned chat and its verified assignment run. The final output of that run can also answer automatically. Both paths settle the same obligation and produce at most one logical terminal outcome. A different answer after completion conflicts.

An unchanged retry of an already settled reply from the assigned chat returns the existing receipt without another settlement. It does not require inventing a new assignment run merely to acknowledge the prior operation.

Acceptance receipts identify the delivery, any associated request, exact destination when resolved, approval/delivery state, and whether automatic return is expected. Acceptance never means the requested work is complete. The receipt directs the agent not to send an acknowledgment merely to confirm receipt.

An agent can always finish its current turn when waiting. No transcript polling is required for a tracked returned outcome.

### 4.3 No automatic reply to a reply

Receiving a required outcome may start a continuation in the requester. That continuation's final text stays in its own chat unless it completes a separate parent assignment or the agent deliberately initiates another useful send.

A one-way receiver's final text is not automatically routed back. Generated sent/received receipts, approval audit rows, and Hold status updates never create new send obligations.

Agents may communicate useful results, decisions, questions, blockers, and changed circumstances. Tool instructions explicitly discourage ACK, received, thanks, and repeated progress narration with no new useful information. This is guidance, not a prose classifier or an absolute loop guarantee.

## 5. Standing permission and approval

### 5.1 Columns and precedence

Add nullable `agent_coordination_policy` preferences to these existing tables:

| Table | Scope |
| --- | --- |
| `user_state` | Global default |
| `workspaces` | This agent's chats |
| `executions` | All existing and future chats in this execution |
| `chat_sessions` | This exact chat |

Manager chats are unrestricted for new coordinating sends. These are personal orchestration chats with no execution, no creating run, and a main or unset surface, including Ri's main chat and each agent's main chat. The server derives this authority from the saved chat. No coordination setting can make a manager chat ask before messaging or delegating. Existing pending approvals remain pending, including unchanged retries. The panel explains the exemption and retains incoming pause, without offering Ask/Allow choices for the manager. Restricted team and reviewer surfaces remain outside this authority.

Saved preferences remain separate from this exemption. The following precedence and child-initialization rules continue to govern execution and other chats. Manager authority does not initialize a child to Allow automatically.

Values are ask, allow, or unset. Unset inherits. Resolve chat, execution, agent, then global, skipping missing levels. If all are unset, use ask as the code-level initial product default. Do not put policy defaults in SQLite.

The UI shows the effective setting and its source. Global controls say Default coordination, with Ask first and Allow automatically choices. A chat can explicitly override that default. Changing a default does not erase explicit narrower choices.

Standing policy and Hold are human-controlled settings. Generic agent-facing update actions must not expose them as writable fields. The platform's child-initialization rule below is not permission for an agent to edit its own or another chat's standing policy.

Always allow in this chat permits that chat to message existing chats and create any number of chats across the user's agents. It is not a destination-by-destination grant. Offer equivalent controls at the agreed execution and agent scopes without adding separate grant records.

### 5.2 Approval operation

Check coordination permission when a new initiating delivery is created. Under ask, save it as `awaiting_approval` and show a card in the source chat with the destination, exact intent, and whether a returned outcome is expected.

Actions are Allow once, Always allow in this chat, and Deny. The broader action updates the chat preference and approves the pending send in one operation. Allow once authorizes this send and its promised returned outcomes. It does not establish a work-wide grant.

Approval and denial are human-only operations. Record the proposal and decision in `chat_events`. Do not create or start an agent destination before approval. A retry with the same intent reuses the existing delivery and decision. An agent must stand down after denial rather than manufacture another key for unchanged intent.

Already approved sends remain approved if policy later changes. Policy changes govern new initiating actions. Hold and cancellation control activity already approved or queued. This distinction is visible in settings and the approval card. Permission is not silently re-requested on delivery retries.

Automatic outcomes of approved requests need no new approval. Direct communication back to the requester of the current verified assignment, including a clarification, is covered by that assignment's authorization. This exemption requires an active assigned request and the verified requester address. It does not apply to an arbitrary previous requester or third chat.

### 5.3 New-chat policy

Human-created chats inherit their destination scopes unless the human explicitly chooses a chat override.

For agent-created chats, initialize coordination permission from the creator's effective policy, without overriding an explicit ask policy on the destination agent or execution. A creator using ask produces a child using ask. An allow creator can produce an allow child where the destination has no explicit ask restriction. Record the starting policy and source in a system audit event and show it through the normal policy control.

This initialization is a platform rule for delegated chats, not an agent-callable permission setter. Later human changes to an explicit destination scope remain available through its controls. A more specific explicit child preference follows the normal precedence rule and is not silently rewritten by a global-default change.

### 5.4 Enabled automation

Enabling an automation authorizes its run chats to communicate and delegate within the assignment. Every trigger-fired chat starts with the existing chat-level Allow automatically preference, including later fires in a recurring execution. This covers one-time, cron, interval, webhook and manually fired triggers. Interactive execution and other non-manager chats retain the ordinary permission defaults. This requires no new permission table, recipient rules or trigger permission columns. Agents create or enable schedules only within the user's intent and never to bypass a denied send. A person may still change a run chat's preference, pause incoming messages or stop its work. Disabling the schedule prevents future automatic fires.

A scheduled turn ending with its own sends still awaiting approval is failed with an actionable reason, rather than reported as completed. Use its normal terminal notification routing, falling back to the existing needs-input notification route when no terminal notification is queued. Repeated terminal callbacks do not create another notification. A person's Stop and an existing specific failure remain authoritative. Queued authorized messages retain their delivery state, and are not classified as needing approval. A run records a harness turn, while delivery and request rows record message acceptance and owed outcomes separately.

Existing enabled schedules gain this default on their next fire. Do not replay historical work or automatically release old approval requests.

### 5.5 Harness permission ceiling

Coordination authorization does not grant broader tool authority.

For agent-created chats, select the less autonomous of the source chat's current permission mode and the requested destination mode, including the omitted-mode default. App-native order is plan, ask, auto_edits, auto_all. Validate the result against the destination harness's supported modes. Refuse an unsupported result rather than silently choosing a more autonomous one.

Apply this at the shared agent launch boundary, including retries and other agent entry points. A model/harness switch is not a new permission grant. Existing destination chats keep their user-authorized tool settings. Connector and restricted team/reviewer boundaries remain enforced.

## 6. Hold and human input

Store `coordination_held_at` on `chat_sessions`. Non-null means held. Persist it through reload and restart.

Hold prevents agent-origin messages and automatic outcomes from starting or injecting input into that chat's harness. They can still be received into the transcript. It does not interrupt work already admitted. Stop remains the separate control for interrupting work now.

Human composer sends and human forwards may start a turn in a held destination. Pending delivered messages join that human-directed turn automatically, clearly labeled with origin and request identity. Hold remains on afterward. A human turn is not permission for arbitrary automatic successor turns.

Releasing Hold schedules eligible pending messages and assignment continuations. If the chat is already working, wait or batch into the appropriate turn according to capability and request ownership. Never release every pending item as a burst of concurrent assignment turns.

A per-chat Hold is local. It does not stop other chats, cancel assignments, or prevent an already running or human-directed turn from making authorized outgoing sends. The UI calls this Pause incoming and describes its scope as this chat.

### 6.1 Human direction and ownership

Use the run that opened the producing harness turn, not the newest send row. Overlapping sends have separate run records and may fold into one producing turn.

Only a run explicitly started or continued for an assignment can automatically complete it. If human input joins an active assignment turn, preserve that producing assignment identity and annotate its outcome that human direction intervened. The agent must reconcile the user's latest direction before reporting completion. Do not infer task completion merely from any final text in the chat.

A turn opened by a human send is human-directed. Reading a held assignment or answer during that turn does not rebind it as an assignment run, and its final answer is not automatically sent to a requester.

A required request read during a human turn remains queued if its assigned work never started. A parent assignment whose child answer was read during a human turn remains waiting for its own continuation. On release, Ri starts the appropriate assignment turn, references the supplied material and human work already performed, and instructs it to inspect current state rather than blindly repeat the original assignment.

No takeover dialog is required. Opening, reading, or focusing the chat does not change work ownership. Answering an existing pending question or approval is distinguishable from opening a new human-directed turn.

## 7. Delivery and request states

### 7.1 Delivery state

| State | Meaning | Next states |
| --- | --- | --- |
| awaiting_approval | Saved intent, not authorized or sent to the target | queued, denied, cancelled |
| queued | Authorized, waiting for target resolution or transcript persistence | delivered, failed, cancelled |
| delivered | Receiving event saved, not yet supplied to a harness run | accepted, failed, cancelled |
| accepted | Supplied to the accepting run | Terminal for delivery, not necessarily for its associated work |
| denied | Human declined this initiating operation | Terminal |
| failed | Delivery cannot proceed | Terminal |
| cancelled | Withdrawn before acceptance or made inapplicable by cancellation | Terminal |

A transient transport error retains the current nonterminal state, updates attempts/error/backoff, and retries. A permanent refusal becomes failed. Hold is not a delivery state. Work failure is an outcome message kind, distinct from failure to deliver that message.

Persist the receiving event and transition to delivered atomically. Reconcile a lost acknowledgment by stable event ID. Treat remote device queuing separately from actual harness acceptance. The queued command is durable but not proof the harness received it.

Multiple delivered messages may join one human or ordinary message turn in stable delivery order. Distinct new required assignments are admitted separately so one final answer cannot complete unrelated requests. A human message or one-way steering can join a running assignment where the harness supports it. Otherwise queue it visibly.

Steering explicitly related to an open assignment may join or continue that assignment in its assigned chat. Do not inject it into an unrelated producing assignment merely because the destination chat is the same. A related update sent to the requester is ordinary incoming information unless it also belongs to a verified parent assignment. A related message never reopens terminal work.

### 7.2 Request state

| State | Meaning |
| --- | --- |
| queued | Created or continuation reserved, but its assigned turn has not accepted the work |
| working | A verified assigned run is executing it |
| waiting | The assigned turn ended with tracked child work or returned input still to handle |
| completed | A valid final outcome settled the obligation |
| failed | Assigned work failed, stopped, or became unavailable |
| cancelled | Explicitly cancelled or its initiating action was denied/withdrawn |

A new required send creates the request and initial delivery together. A denied, cancelled, or permanently failed initial delivery settles its associated request in the same domain operation. No request remains queued forever after its send is terminal.

An assignment with outstanding tracked children becomes waiting when its turn ends. It does not send a false final completion. An eligible child outcome can resume its exact parent assignment. Other children can remain outstanding, and the resumed turn can still finish waiting.

A run failure or human Stop does not turn partial output into a successful outcome. Terminal settlement and its returned outcome delivery commit together. Use one stable terminal-outcome identity regardless of whether the outcome is answer, failure, or cancellation. Cancellation covers descendants and late outcomes never restart cancelled work.

### 7.3 Delivery acceptance is not assignment continuation

A held answer may be accepted by a human-directed run without continuing the parent assignment. Preserve both facts:

- `accepted_by_run_id` identifies the first run supplied the delivery.
- `continuation_run_id` identifies the assigned parent run reserved to handle this returned update, where a parent continuation is needed.

The second pointer is justified by the held-answer case. It is not a second delivery or another collaboration entity. In the common case both pointers can identify the same run.

On Hold release, the scheduler examines queued/waiting requests as well as unaccepted deliveries. It atomically reserves one continuation and binds the relevant returned deliveries before dispatch. Use a stable resume command identity based on the request and pending update set through the existing durable dispatch mechanisms. Retries recover that reservation rather than create another continuation.

If a reserved continuation is held before acceptance, keep its reservation and queued work. Do not allocate a successor run simply because Hold was toggled. Multiple child updates can be batched into one continuation. Later updates arriving after reservation are either included safely or remain for the next eligible continuation.

Do not use an optional cleared FK or a browser read receipt as proof that work must run again.

## 8. Schema and references

All tables retain the shared id and timestamp conventions. These are semantic columns and constraints for implementation, not executable migration SQL.

### 8.1 `agent_coordination_requests`

Keep work identity and state here:

| Column | Responsibility |
| --- | --- |
| source_session_id | Requesting chat |
| source_address | Stable or exact return address chosen at initiation |
| target_address | Logical assignment destination |
| target_session_id | Exact assigned chat once resolved |
| parent_request_id | Verified parent assignment, nullable |
| kind | question or delegation |
| request_key | Initiating retry key, unique per source |
| options | Immutable delegation launch settings, nullable |
| status | Request work state |
| run_id | Current assigned or reserved run, nullable |
| response_event_id | Captured producing assistant event, nullable soft reference |

The initial text belongs to the initial delivery. The returned text belongs to its outcome delivery. Drop request-owned transport attempts, next-attempt time, message-event key, duplicated content, and duplicated response text. Preserve the hot output-capture pointer so completing a run reads the correct saved assistant event.

### 8.2 `agent_coordination_deliveries`

| Column | Responsibility |
| --- | --- |
| request_id | Optional request association |
| kind | message, request, answer, blocked, failed, or cancelled |
| sender_kind | agent, human, or system |
| source_session_id | Source chat context, nullable for system origin or retained history |
| source_run_id | Verified initiating run when applicable, nullable |
| target_address | Logical destination, including stable agent/orchestrator addresses |
| target_session_id | Exact destination pinned before the first external delivery attempt |
| event_id | Unique receiving event ID allocated at creation, also the stable event retry identity |
| source_event_id | Optional selected/forwarded original material, a soft reference |
| payload | Versioned immutable content, attachments, and required presentation/source metadata |
| status | Delivery state |
| accepted_by_run_id | First run supplied this message, nullable |
| continuation_run_id | Reserved parent assignment continuation handling this update, nullable |
| attempts, next_attempt_at, error | Delivery retry scheduling and diagnosis |

Use stable delivery identities for initial send retries and a stable dedupe key for each generated update. Preserve the existing opaque identity derivation wherever IDs have already been persisted. A repeated unchanged operation reuses its record. Different intent under that identity conflicts. Generated terminal outcomes and blocked updates also deduplicate by obligation and update identity.

The source run pointer preserves causal evidence under overlapping inputs, but it does not establish authority by being supplied by an agent. Establish it from verified runner/call context. Source chat identity alone or first-open-request lookup is insufficient. A verified producing run with no parent assignment creates independent work. If assignment context is ambiguous, resolve it or refuse tracked child creation before acceptance. Do not silently pick a parent or treat potentially dependent work as independent, which could let its real parent report completion too early.

### 8.3 Foreign keys and soft event references

| Table | Column | References |
| --- | --- | --- |
| Requests | source_session_id, target_session_id | chat_sessions.id |
| Requests | parent_request_id | agent_coordination_requests.id |
| Requests | run_id | runs.id |
| Deliveries | request_id | agent_coordination_requests.id |
| Deliveries | source_session_id, target_session_id | chat_sessions.id |
| Deliveries | source_run_id, accepted_by_run_id, continuation_run_id | runs.id |

Event references remain indexed soft IDs. A receiving event may not exist when its delivery is queued, so `event_id` must not be a required FK to a future row. Once delivered, the event is found by that same ID. There is no extra target-event column plus a separate event key.

Do not add reverse coordination FKs to `chat_events` or `runs`. Do not duplicate execution/agent references on every delivery. Stable addresses and delegation options already identify the agent before a destination chat exists, so no target-workspace column is needed.

Source context is not authorship. A human forwarding from A has sender kind human, even though A is the source chat and another agent wrote the quoted material. A missing source pointer must never imply human authorship.

Foreign keys enforce existence, not ownership. Domain operations verify destination-event ownership, accepting-run ownership, responder identity, and allowed source references. A required initial delivery has exactly one request and an answer cannot refer to an unrelated obligation.

### 8.4 Deletion and indexes

Archive preserves records and links. Hard deletion of a source or target must settle or cancel its unaccepted coordination before removing the chat. Preserve historical coordination records where possible, using nullable source/target FKs with SET NULL. A cleared destination is never permission to resolve and send somewhere else.

Keep referenced requests and continuation runs while they are needed for coordination correctness. Restrict their removal until dependents are explicitly settled or purged. Optional diagnostic run pointers can use SET NULL, but an accepted delivery stays accepted. Nothing reruns merely because historical provenance was cleared.

Deleting coordination records must never cascade into a transcript. Deleted soft event references render as unavailable and are never interpreted as authorization or a delivery that should be replayed.

Required indexes include:

- Requests: unique source/retry key, target/status, source/status, current run, and parent request.
- Deliveries: status/next-attempt time, target/status, request, source event, and unique event ID. Index run references used for acceptance and continuation recovery.
- One initial request-kind delivery per request, and one logical terminal outcome per request, enforced through stable identities and transaction guards.

Pin hot query plans with EXPLAIN QUERY PLAN tests. Do not scan full transcripts to discover pending coordination or related chats. FKs into small coordination records do not justify rebuilding the large event table.

## 9. Text ownership, routing, and ordering

`chat_events` remains the visible transcript. `payload` is the durable accepted send needed before an event or destination exists and for exact retries. It is an immutable transport snapshot, not another editable conversation history. Do not reconstruct changed bytes from edited source material or changed instruction templates on retry.

Preserve attachments and source references using the existing generic attachment system. Long content remains fully accessible using attachments or paged source retrieval where needed, with explicit size handling. A collapsed visual preview must not mean the receiving agent gets only the preview.

Resolve stable addresses and pin the exact destination before attempting transcript delivery. Retry that same target after an uncertain acknowledgment. Never duplicate one message into a replacement main chat. Before first attempt a stable main address can resolve a replacement according to existing routing rules. Historical source links always preserve exact chat/event identity.

Dispatch unaccepted inputs in stable persisted order. Batch ordinary messages when they target the same eligible turn. Human input can start a held chat's turn and includes its pending received material, while the scheduler preserves assignment ownership. Recheck Hold before local start and before a connected device accepts queued work. Admission races preserve one reserved command and expose an honest waiting or accepted state.

Late one-way messages still have their agreed wake behavior when eligible. A link to completed work does not reopen that request. Label the message as a follow-up received after completion, and let the receiving agent decide whether new action is useful. Do not edit an already created or delivered outcome to append late content.

Outcomes of cancelled or unavailable assignments remain visible as appropriate but cannot restart that work. An accepted answer read during a human turn is not replayed as another ordinary message on release. Only any still-owed assignment continuation is scheduled.

## 10. Human Send to chat UX

Add Send to chat beside the message actions. The human chooses a destination and can add directions around the quoted source.

The picker sorts by recent activity, supports search and filtering by agent, and displays chat title, agent, and last activity. It offers an existing chat or a new chat in the selected agent. User-facing copy says agent, while code retains workspace.

A new chat uses normal launcher defaults with optional model and supported effort controls before sending. Save choices on its existing chat settings. An existing destination keeps its own settings.

Human sending authorizes that specific operation without another coordination approval. If creating a new chat, reserve a stable creation identity and use the normal launcher through the same durable send workflow. Retrying must not create an empty second chat. Human launch choices remain editable normally.

The receiving card says Shared by you, separates the user's directions from the quoted material, and links to the exact source message. The sending chat gets a receipt linking to the exact destination and accepted message. Receipts are system events and never model input or reasons to start a turn.

Use the same Send to chat action to forward an answer back. Version one does not automatically return human-forwarded answers. Other messages use neutral Message from, Request from, or Answer from labels based on protocol state, never prose classification. Preserve the original request disclosure on returned outcomes.

Long cards show a bounded preview and a clear expansion action. The full selected material is available to the receiver. Related-chat shortcuts derive from recorded exchanges without another table. Links navigate to the exact archived transcript without silently resuming it or replacing a current main chat.

Ordinary idle chats show no collaboration row above the composer. An attempted send under Ask first displays an approval card stating that the message has not been sent. Approved unfinished exchanges show a compact status linking to participating chats and Pause incoming. Determine activity from open approved requests, queued deliveries and accepted inputs whose producing run is still active, never historical receipts. Once the exchange finishes, the row disappears.

An enabled pause remains visible even when idle, with Incoming agent messages paused, a waiting count and Resume. Keep standing permission preferences and a pause control in the chat menu so both remain reachable without an active exchange. Stop remains independently available. The Send to chat dialog stays centered within viewport margins, scrolls vertically on short screens and never scrolls horizontally. Its model picker remains usable inside the dialog scroll lock.

## 11. Migration and rollout

Use a forward migration. Applied migration SQL and journal entries remain immutable. This specification contains no executable migration and applies no database changes.

- Rename/evolve the two existing coordination tables.
- Turn each old initial send into a delivery using its existing message event identity.
- Convert old FYI requests into message deliveries without retaining them as active obligations.
- Preserve historical FYI IDs as their initial delivery IDs. Preserve tracked request IDs, returned delivery IDs, receiving event IDs, source references, retry keys, and unchanged persisted identity derivations.
- Move exact initial and terminal payloads into their deliveries. Do not recompute historical text.
- Map existing work and delivery statuses from evidence. Never backfill a run association by guessing, and never repeat accepted or completed work to manufacture missing metadata.
- Treat existing accepted coordination as approved. New initiating actions use the new policy default or an explicit user choice. Do not create retroactive approval cards for history.
- Add the preference and Hold columns using repository migration conventions, without policy defaults or unnecessary large-table rebuilds.

Rehearse on disposable homes and a copied database. Verify row/identity preservation, foreign-key integrity, pending work recovery, and no duplicate execution. Use the safe migration runner. A restart loads the new registry and code. Production restart remains owner-controlled. Start fresh harness chats where necessary to refresh tool descriptions. No removed tool aliases are reintroduced.

## 12. Acceptance criteria

The implementation is complete only when the following behavior is verified:

1. A one-way send wakes an idle recipient, which can act. Its final answer is not automatically returned.
2. A required send starts its assignment and returns exactly one logical terminal outcome. A returned answer's ordinary continuation does not automatically answer back.
3. Ri-generated delivery receipts produce zero agent turns. Tool instructions discourage unnecessary acknowledgments without classifying prose at runtime.
4. A asks B, B asks A a clarification, A answers, and B finishes. Each run and outcome belongs to the correct obligation.
5. One-way steering can join supported running work or queue for an eligible turn. Distinct required assignments cannot consume each other's final output.
6. Five messages arrive under Hold and remain visible without agent input. A human send includes them, runs normally, and leaves Hold enabled.
7. A held initial request is read during a human turn. Its work remains queued, and release starts one verified assignment turn.
8. A held child answer is read during a human turn. Its parent continues once on release without sending a duplicate ordinary reply or replaying the original side effects blindly.
9. Multiple child outcomes batch safely, including one arriving during reservation. Repeated release and a restart do not duplicate the reserved continuation.
10. Human input folded into an active assigned turn retains its producing-run identity and annotates the eventual outcome. A separately opened human turn cannot complete that assignment automatically.
11. Unchanged retries after lost acknowledgments preserve one delivery, accepted event, destination chat, and terminal outcome. Changed intent under the same key conflicts.
12. A one-way follow-up linked to completed work wakes normally without reopening it or mutating its prior outcome.
13. A cancelled assignment and descendants never restart from late returned updates. A stopped turn cannot return partial text as successful completion.
14. Ask/allow inheritance works across global, agent, execution, and chat scopes, including multiple sibling chats and displayed policy provenance.
15. Allow once covers the exact initiating send and its promised return. Always allow in this chat covers arbitrary destinations. Deny creates no target work. Pending approval survives restart.
16. Direct replies and clarifications to the verified current requester do not create new approval cards. Unrelated third-chat contact follows policy.
17. Policy changes affect new sends, while already authorized sends remain authorized. Hold and cancellation still stop their admission as specified.
18. New delegated policy initialization does not override an explicit destination ask restriction. Later child overrides follow visible normal precedence.
19. An ask or plan caller cannot create a more autonomous child, including by omitting the mode or switching harness. Unsupported capped modes fail clearly.
20. A race between Hold/Stop/cancellation and local preparation or device acceptance preserves honest state and never starts another unreserved run.
21. Human forwarding preserves actual sender, full source material, exact links, and destination settings. Repeated new-chat forwarding creates one destination. Model and effort options respect the selected harness/model.
22. Deleted or archived sources, targets, requests, and event references produce the defined historical display or failure, without unintentional rerouting, input replay, or transcript deletion.
23. Pending coordination queries stay bounded and indexed. Representative plans, migration rehearsals, typecheck, relevant tests, and UI states in the chat gallery pass.
24. Trigger-fired chats start with Allow automatically under Ask first defaults, including later chats in recurring executions. A scheduled message reaches its recipient without a per-send prompt, and a scheduled delegation returns its outcome. Interactive chats retain their inherited defaults.
25. A scheduled turn ending with its own pending send approval fails visibly with an actionable reason. Failure text takes precedence over a misleading success reply in notifications and run lists. Terminal callbacks do not duplicate notifications. Human Stop and a specific provider failure retain their meaning.
26. Idle and completed chats show no permanent collaboration row. Active exchanges show linked participating chats and Pause incoming. An enabled pause remains visible with Resume. Preferences remain accessible in chat menus, including embedded chats. Send to chat fits and centers on desktop, phone and short viewports without horizontal overflow, including long titles and agent names and a usable nested model picker.

No new passive-context mode, mandatory takeover ceremony, generic thread entity, or work-wide grant is required to satisfy these criteria.

<a id="14-review-response-and-a-simpler-message-flow-candidate"></a>

## 13. Evidence and source map

The owner's second review, attachment `01a16447-c4bd-7765-ad2e-4a4d59d8f6b8.md`, corrected the earlier sample: 231 message/FYI requests, 59 questions, and 10 delegations at 300 total, later 257, 63, and 10 at 330. It reports no blocked deliveries, long acknowledgment exchanges, and 63 of 608 executions with multiple chats. These are reported measurements of an older running build, not counts independently reproduced for this specification.

The review usefully motivated symmetric delivery, explicit states, and Hold. Its recommendation to make no-return messages passive was considered and rejected by the owner. The final contract preserves one-way messages that wake a recipient. Its single-active-run assumption is also invalid: source code supports overlapping sends and separate run records within one producing harness turn.

| Source | Relevant behavior |
| --- | --- |
| [Existing implementation overview](agent-coordination.md) | Current tools and rollout |
| [Schema](../src/lib/db/schema.ts) | Existing coordination, sessions, events, executions, and runs |
| [Actions](../src/lib/coordination/actions.ts) | Initiation, explicit replies, inspection, and cancellation |
| [Queries](../src/lib/db/coordination-queries.ts) | Run binding, output capture, parent/child work, and returned outcomes |
| [Service](../src/lib/coordination/service.ts) | Current dispatch, retry, activation, and parent inference |
| [Delegated launch](../src/lib/coordination/start-execution.ts) | Launch options and the shared caller ceiling in `permissions.ts` |
| [Permission mapping](../src/lib/executor/permission-map.ts) | Supported modes and provider validation |
| [Executor adapter](../src/lib/executor/adapter.ts) | Dispatch runs and admission |
| [Local runner](../src/lib/runner/local-runner.ts) | Producing run identity, overlapping inputs, and acceptance |
| [Event ingestion](../src/lib/executor/apply.ts) | Output attribution and pending input |
| [Session credentials](../src/lib/orchestrator/session-credential.ts) | Authenticated chat identity, distinct from exact producing-run context |
| [Message operation](../src/lib/server/operations/sessions/[id]/messages.ts) | Event persistence and subsequent execution |
| [Chat composer](../src/components/executions/execution-composer.tsx) | Human sends during running work |
| [Execution chat tabs](../src/components/executions/execution-chat-tabs.tsx) | Multiple chats per execution |
| [Relationship presentation](../src/components/chat-ui/messages/chat-message-link.tsx) | Source and destination navigation |
| [Coordination tests](../src/lib/coordination/coordination.test.ts) | Existing scenario coverage |
| [Runtime test](../src/lib/coordination/runtime.test.ts) | End-to-end flow with a stand-in harness |

The implementation and acceptance evidence are recorded in [the implementation checklist](agent-coordination-implementation.md). Migrations were rehearsed on disposable databases and a read-only logical snapshot of all existing coordination data and its dependencies. Applying the migration to production remains part of the owner-controlled rollout.
