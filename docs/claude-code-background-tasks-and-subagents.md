# Claude Code Background Tasks & Subagents — How They Work, How They Surface, and What Flow Does With Them

> **Purpose.** A standalone reference for how Claude Code represents background tasks and
> subagents across three surfaces — the persisted JSONL transcript, the headless
> `--output-format stream-json` stdio stream, and the interactive terminal TUI — plus how
> the open-source CLI constructs/injects them, and exactly where Flow captures vs. drops
> them today. Written so we never have to re-derive this.

## Provenance (where this was found, for re-review)

- **Triggering observation / source transcript analyzed:**
  Claude Code chat **`9fc77f94-2cf3-4053-a7b0-914d38583148`**
  → `~/.claude/projects/-Users-treyhuffine-startups-insiderfinance-tradedata/9fc77f94-2cf3-4053-a7b0-914d38583148.jsonl`
  (7,511 lines. This is the session where a turn showed `end_turn` while two background research
  agents were still running, then "resumed" on its own — the behavior that kicked off this investigation.)
- **Research chat where these findings were produced:**
  Claude Code chat **`372e402c-56f2-42e5-a1fa-a78562f5be66`**
  → `~/.claude/projects/-Users-treyhuffine-dynamism-ai-task-manager/372e402c-56f2-42e5-a1fa-a78562f5be66.jsonl`
- **Open-source Claude Code source read:** `/Users/treyhuffine/code/claude-code-open-source`
  (a beautified/reverse-engineered checkout, ~March 2026 vintage).
- **Live CLI used for empirical stdio/disk capture:** `claude` **v2.1.186** (`/Users/treyhuffine/.local/bin/claude`).
- **Date of investigation:** 2026-06-22 / 2026-06-23.

> ⚠️ **Version drift.** The OSS checkout (~March) and the installed CLI (v2.1.186, June) differ in
> spots. Where they disagree, the **live capture from v2.1.186 is authoritative for wire shape**;
> the OSS source is authoritative for *how/why* it's constructed. The clearest known drift: the
> live build emits `system/task_updated` (a `{status,end_time}` patch) where the OSS source
> describes `system/session_state_changed`. Re-verify line numbers before relying on them.

---

## 0. TL;DR

When a background subagent finishes, Claude Code surfaces it through **two parallel channels for
two different audiences**:

| Channel | Audience | Form | Why |
|---|---|---|---|
| **Synthetic `<task-notification>` user turn** | the **model** | a `user`-role message whose content is the XML block (with the agent's `<result>` inlined) | re-injects the finished work into context so the model wakes up and continues |
| **`system` / `task_*` stream events + on-disk files** | the **UI / SDK consumer** | structured NDJSON events + a live `agent-<id>.jsonl` transcript on disk | live status, progress, nesting, cancel |

**Both fire from the same run.** The "turn ended, then Claude restarted itself" effect is *not* a
special transcript artifact — it's the CLI's **message queue** injecting the synthetic user turn
when the session goes idle. The interactive CLI layers visibility on top (status counter, `/tasks`
modal, 1s output polling, OS notifications); the headless SDK path exposes the same lifecycle as
`task_started/progress/updated/notification` events.

**Flow today:** captures the events into `chat_events.raw` but renders none of them (the render
allowlist is an empty set), recognizes the `Task`/`Agent` tool enough to show a "subagent" pill +
count, and does **not** populate parent linkage on the live path. Surfacing background agents in
Flow is ~90% a presentation change, not a capture change. See §7–§8.

---

## 1. The persisted transcript: the synthetic `<task-notification>` user turn

This is what you actually see in a `.jsonl` transcript, and what started this thread.

### 1.1 The sequence

```
A  stop=tool_use   tool_use[Agent]   ← launch background subagent (research agent #1)
A  stop=tool_use   tool_use[Agent]   ← launch background subagent (research agent #2)
A  stop=tool_use   tool_use[Bash]
U  (tool_result)
A  stop=end_turn   "I've mapped both pipelines and kicked off two research agents…"   ← TURN ENDS
U  "<task-notification> … </task-notification>"   ← SYNTHETIC user message, injected when agent #1 finished
A  stop=tool_use   "The schema-mapping agent returned a thorough report…"             ← model resumes
…
A  stop=end_turn   "I'll hold here for the Databento/Rust research agent…"            ← ends again, waiting on agent #2
```

The prior assistant turn genuinely ends with `stop_reason: "end_turn"`. The notification arrives
as a **new `user`-role entry** that re-invokes the model. That's the "it restarted on its own."

### 1.2 The entry metadata (it's disguised as a normal user message)

```jsonc
{
  "type": "user",
  "userType": "external",
  "isSidechain": false,
  "isMeta": null,                    // NOT flagged as meta
  "isVisibleInTranscriptOnly": null,
  "isCompactSummary": null,
  "parentUuid": "c6b59162-…",
  "uuid": "e494f5bd-…",
  "message": { "content": "<task-notification>…</task-notification>" }
}
```

**The tell when scanning raw JSONL:** a `type:"user"` entry whose `message.content` is a *string*
beginning with `<task-notification>` rather than something the human typed. In the source session
this occurred **25 times** (plus 43 `queue-operation` echoes and 4 `attachment` refs of the same blocks).

### 1.3 The XML payload

```xml
<task-notification>
<task-id>a49f86553b1b9c841</task-id>
<tool-use-id>toolu_01WEyY9BsEky2uLQ7oAbkUV2</tool-use-id>   <!-- links back to the launching Agent tool_use -->
<output-file>/private/tmp/claude-501/<project>/<session>/tasks/a49f86553b1b9c841.output</output-file>
<status>completed</status>                                  <!-- completed | failed | stopped -->
<summary>Agent "Map DB schema and greeks/equity code" came to rest</summary>
<note>A task-notification fires each time this agent comes to rest with no live background
children of its own. The user can send it another message and resume it, so the same task-id
may notify more than once.</note>
<result> …the agent's full final output… </result>
</task-notification>
```

Notes:
- `<tool-use-id>` ties the notification back to the exact `Agent`/`Task` tool_use that spawned it.
- The `<note>` is literal and important: **the same `task-id` can notify more than once** — an
  agent "comes to rest" each time it stops; messaging it again (resume) produces another notification.
- The agent's real output also lives on disk at `<output-file>`; the `<result>` is a copy.

---

## 2. The headless stdio stream (`--output-format stream-json`) — empirically captured

These shapes were captured **live from CLI v2.1.186**, not inferred. Reproduction commands in §10.

### 2.1 Event vocabulary on stdout

`system/init`, `system/thinking_tokens`, `system/task_started`, `system/task_progress`,
`system/task_updated`, `system/task_notification`, `assistant`, `user`, `rate_limit_event`,
`result/success`. Each line is one JSON object (NDJSON).

`assistant` / `user` envelopes carry: `message`, **`parent_tool_use_id`**, `request_id`,
`session_id`, `type`, `uuid`.

`system/init` keys: `agents, analytics_disabled, apiKeySource, claude_code_version, cwd,
fast_mode_state, mcp_servers, memory_paths, model, output_style, permissionMode, plugins,
product_feedback_disabled, session_id, skills, slash_commands, subtype, tools, type, uuid`.

`result/success` keys: `api_error_status, duration_api_ms, duration_ms, fast_mode_state, is_error,
modelUsage, num_turns, permission_denials, result, session_id, stop_reason, subtype,
terminal_reason, time_to_request_ms, total_cost_usd, ttft_ms, ttft_stream_ms, type, usage, uuid`.

### 2.2 The subagent lifecycle = four `system` subtypes

```jsonc
// fired when the subagent launches
{"type":"system","subtype":"task_started",
 "task_id":"a649e217ab4715f94","tool_use_id":"toolu_01LGd7…",
 "description":"Run bash command and report output","subagent_type":"general-purpose",
 "task_type":"local_agent","prompt":"Run the bash command 'echo hello-from-subagent'…"}

// fired repeatedly as it works — this is the live progress feed
{"type":"system","subtype":"task_progress",
 "task_id":"a649e217ab4715f94","tool_use_id":"toolu_01LGd7…",
 "description":"Running Echo hello-from-subagent message","subagent_type":"general-purpose",
 "usage":{"total_tokens":11821,"tool_uses":1,"duration_ms":1475},"last_tool_name":"Bash"}

// status patch (v2.1.186 wire form)
{"type":"system","subtype":"task_updated",
 "task_id":"a649e217ab4715f94","patch":{"status":"completed","end_time":1782163121494}}

// the "came to rest" ping (telemetry counterpart of the synthetic user turn)
{"type":"system","subtype":"task_notification",
 "task_id":"a649e217ab4715f94","tool_use_id":"toolu_01LGd7…",
 "status":"completed","output_file":"","summary":"Run bash command and report output",
 "usage":{"total_tokens":13036,"tool_uses":1,"duration_ms":5406}}
```

> In a one-shot `-p` run the subagent is awaited inline, so `task_notification.output_file` was `""`
> and there was no inlined `<result>`. In **interactive/async** mode the notification is the
> *synthetic user message* (§1) with a populated `<output-file>` and `<result>`. Same event, two dressings.

### 2.3 How child output threads to the parent (the nesting key)

Every interior message the subagent emits streams inline with **`parent_tool_use_id`** set to the
parent `Agent` tool's id. The final rolled-up `tool_result` returns on the main thread (`parent=null`):

```
A | parent=null                 tool_use[Agent] id=toolu_01LGd7…
SYS/task_started
U | parent=toolu_01LGd7…        (subagent's first turn)
SYS/task_progress
A | parent=toolu_01LGd7…        tool_use[Bash]      ← child's tool, tagged to parent
U | parent=toolu_01LGd7…        tool_result
SYS/task_updated  →  SYS/task_notification
U | parent=null                 tool_result for the Agent   ← rolls up to main thread
A | parent=null                 text:"DONE"
RESULT/success turns=3
```

The rolled-up `tool_result` content also carries a resume hint and usage footer:

```
The command executed successfully. The output is: **hello-from-subagent**
agentId: a649e217ab4715f94 (use SendMessage with to: 'a649e217ab4715f94', summary: '…' to continue this agent)
<usage>subagent_tokens: 13055 / tool_uses: 1 / duration_ms: 5406</usage>
```

### 2.4 The launch "receipt" (immediate tool_result when launching async)

In async mode the `Agent` tool returns immediately with a receipt rather than the result:

```
Async agent launched successfully.
agentId: a5f0d332890c3f201 (internal ID - do not mention to user. Use SendMessage with
  to: '<id>', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes.
Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: /private/tmp/claude-501/<project>/<session>/tasks/a5f0d332890c3f201.output
Do NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript…
```

---

## 3. On-disk artifacts (the file-based visibility surface)

Captured live from the research session. Three layers, increasing fidelity:

```
~/.claude/projects/<project>/<session>/subagents/
   agent-<agentId>.jsonl       ← live, append-only FULL child transcript (tail this for progress)
   agent-<agentId>.meta.json   ← { agentType, description, toolUseId }   (tiny; cheap to poll)

/private/tmp/claude-501/<project>/<session>/tasks/
   <taskId>.output             ← SYMLINK → the agent-<agentId>.jsonl above

~/.claude/tasks/<session>/
   .highwatermark              ← registry cursor
   .lock                       ← registry lock
```

- A subagent transcript's first line has keys:
  `agentId, cwd, entrypoint, gitBranch, isSidechain, message, parentUuid, promptId, sessionId,
  slug, timestamp, type, userType, uuid, version`.
- OSS disk layer: `src/utils/task/diskOutput.ts`
  - `getTaskOutputDir() = join(getProjectTempDir(), getSessionId(), 'tasks')`;
    `getTaskOutputPath(taskId) = <dir>/<taskId>.output`.
  - `DiskTaskOutput` — async buffered single-threaded writer, **5 GB** cap, `O_NOFOLLOW` (anti-symlink-attack).
  - **`getTaskOutputDelta(taskId, fromOffset, maxBytes)`** → `{content, newOffset}` — the incremental
    tail API an external app would poll for live output.
  - `getTaskOutput(taskId, maxBytes)` → tail read, 8 MB default cap, prepends "[X KB omitted]".

---

## 4. How the OSS CLI builds and injects the notification

### 4.1 Construction + injection

- `src/tasks/LocalMainSessionTask.ts:224-263` — assembles the `<task-notification>` XML
  (`task-id`, `tool-use-id?`, `output-file`, `status`, `summary`), then
  `enqueuePendingNotification({ value: message, mode: 'task-notification' })` (line ~262).
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx:246-262` — same for subagents; XML also carries
  `result?`, `usage?`, `worktree?`.
- `src/utils/task/framework.ts:274-290` — generic completion handler; enqueues for all task types.
- **Trigger:** `completeMainSessionTask()` (`LocalMainSessionTask.ts:168-219`) only emits the XML
  when the task is still backgrounded (`isBackgrounded`); otherwise emits the SDK event directly.
  `pollTasks()` (`framework.ts:255-269`) periodically checks status, collects output deltas, and
  enqueues a notification once (idempotency `notified` flag).
- **Addressing / resume:** `src/query.ts:1575-1577` — a subagent only consumes notifications
  addressed to it: `cmd.mode === 'task-notification' && cmd.agentId === currentAgentId`.
  `query.ts:1631-1633` — prompt and task-notification commands are converted to *attachments*.
- **Design intent:** `src/tools/AgentTool/forkSubagent.ts:18-39` —
  *"All agent spawns run in the background (async) for a unified `<task-notification>` interaction model."*

### 4.2 The SDK event schema (`src/entrypoints/sdk/coreSchemas.ts`)

`SDKMessage` union (≈ lines 1854-1881) variants: `assistant`, `user`, `user replay`, `result`,
`system`, partial assistant (streaming), and these `system`-subtype messages — `compact_boundary`,
`status`, `api_retry`, `local_command_output`, `hook_started/progress/response`, `tool_progress`,
`files_persisted`, `elicitation_complete` — plus top-level `auth_status`, `tool_use_summary`,
`rate_limit_event`, `prompt_suggestion`.

Task-related schemas:
- `SDKTaskNotificationMessageSchema` (1694-1712): `task_id, tool_use_id?, status
  (completed|failed|stopped), output_file, summary, usage?`.
- `SDKTaskStartedMessageSchema` (1715-1732): `task_id, tool_use_id?, description, task_type
  (local_agent|local_bash|remote_agent|local_workflow…), workflow_name?, prompt?`.
- `SDKTaskProgressMessageSchema` (1750-1767): `task_id, tool_use_id?, description, usage, last_tool_name?, summary?`.
- `SDKSessionStateChangedMessageSchema` (1735-1746): `state: idle|running|requires_action`
  — described as the authoritative "turn really over" signal (fires after held-back results flush
  and the background-agent loop exits). *(Drift: not observed by that name in v2.1.186; see §0.)*

Serialization: `src/cli/structuredIO.ts:466` — `writeToStdout(ndjsonSafeStringify(message) + '\n')`.
Headless queue: `src/utils/sdkEventQueue.ts:74-101` (1000-event cap; `drainSdkEvents()` stamps
`uuid` + `session_id`). Drained to stdout at `src/cli/print.ts:2218-2241, 2374`.

### 4.3 Control protocol + IDE / VS Code integration

- `src/entrypoints/sdk/controlSchemas.ts` — `SDKControlRequest`/`Response` pairs:
  `can_use_tool` (106-122, carries **`agent_id`** so a host knows *which* background agent wants a
  tool), `stop_task` (455-462, cancel a running task by `task_id`), `hook_callback`, `mcp_message`,
  `initialize`, `set_permission_mode`, plus `keep_alive` / `update_environment_variables`.
  `StdoutMessage` union at 642-653.
- **IDE bridge:** `src/utils/ide.ts:73-100` — `DetectedIDEInfo { name, port, workspaceFolders, url,
  isValid, authToken, ideRunningInWindows }`. IDEs (VS Code, Cursor, Windsurf, JetBrains…) write a
  lockfile with port + auth token; Claude Code connects over a websocket/SSE bridge.
  `src/cli/structuredIO.ts:533-659` — `createCanUseTool()` races hook decisions vs. SDK permission
  prompts; the `agent_id` field routes the prompt to the right background agent in the IDE.
- **There is no dedicated "subagent panel" protocol.** IDEs get visibility via (1) the `task_*`
  stream events, (2) `stop_task` control requests, and (3) tailing the on-disk `.output` files.

---

## 5. How the **interactive terminal CLI** handles it (the TUI)

The key insight: **a finished background agent is modeled as a queued message**, and the synthetic
user turn (§1) is the queue firing. Everything else is visibility layered on top.

### 5.1 The engine — queue + idle gate

- **Enqueue with low priority:** `src/utils/messageQueueManager.ts:142-149` —
  `enqueuePendingNotification(command)` defaults `priority:'later'` (`now > next > later`), so a
  completion never preempts something you typed.
- **The idle gate (this is the whole "auto-resume"):** `src/hooks/useQueueProcessor.ts:28-68` —
  subscribes to the queue via `useSyncExternalStore`; a `useEffect` fires only when
  `!isQueryActive && !hasActiveLocalJsxUI && queueSnapshot.length > 0`, then calls
  `processQueueIfReady({ executeInput: executeQueuedInput })`. When idle, it dequeues the
  notification, converts it to a `user`-role message, and **auto-starts a new turn.** It will *not*
  interrupt an in-flight query or an open dialog.

### 5.2 Live display while agents run

- **Status-line counter:** `src/components/Spinner.tsx:451-500` — `BriefIdleStatus` renders
  `"N in background"` (`count(AppState.tasks, isBackgroundTask) + remoteBackgroundTaskCount`),
  refreshing live via `useAppState(s => s.tasks)` even as you type.
- **1-second output polling:** `src/utils/task/TaskOutput.ts:81-164` — a shared
  `setInterval(#tick, 1000).unref()`; each tick `tailFile(path, 4096)`, counts lines/bytes,
  slices the last 5/100 lines, and fires `onProgress(...)`. Polling is visibility-driven (starts on
  component mount, stops on unmount). This is the TUI's equivalent of `getTaskOutputDelta` (§3).
- **`/tasks` modal:** `src/commands/tasks/index.ts` (a `local-jsx` command) →
  `src/components/tasks/BackgroundTasksDialog.tsx:127-200` — lists running/pending tasks, grouped
  (bash, local_agent, remote_agent, workflow, mcp monitor), running-first. Per-row renderer
  `src/components/tasks/BackgroundTask.tsx:17-160`; completed-but-unread agents show a `", unread"` suffix.

### 5.3 Keyboard controls

- **Ctrl+B = background the foreground task:** `src/keybindings/defaultBindings.ts:185`
  (`'ctrl+b' → 'task:background'`), wired by `src/tools/BashTool/UI.tsx:31-84` (`BackgroundHint` +
  `useKeybinding("task:background", …)`) → `backgroundAll()` in
  `src/tasks/LocalShellTask/LocalShellTask.tsx:390-411`: aborts the foreground query
  (`abort('background')`), flips `isBackgrounded=true`, wires completion→enqueue handlers, returns
  you to the prompt. Subtlety: `src/screens/REPL.tsx:2525-2583` — backgrounding mid-query *removes*
  pending `task-notification` commands from the queue and forwards them as attachments into the
  backgrounded session (so they don't immediately re-trigger a turn).
- **`/tasks`** opens the modal above; **Esc / kill** stops a selected task via its `kill()` (shell
  → SIGTERM; local agent → abort its `AbortController`; remote → stop signal). Status → `killed`,
  notification still enqueued.

### 5.4 Out-of-terminal notifications

- `src/ink/useTerminalNotification.ts:25-126` — primitives: `notifyBell()` (raw `BEL`),
  `notifyITerm2()` / `notifyKitty()` / `notifyGhostty()` (OSC escape sequences).
- `src/services/notifier.ts:18-104` — `sendNotification(notif, terminal)`; reads
  `preferredNotifChannel`; `'auto'` detects the terminal (Apple Terminal checks via `osascript`
  whether the bell is muted; iTerm/Kitty/Ghostty use their protocols). `executeNotificationHooks`
  lets a user hook customize/suppress. So a finished background agent can ping you even in another window.

### 5.5 Soft spot (least-confirmed)

The inline subagent **tool-tree** rendering (`src/components/Messages.tsx`, a `pillLabel` helper)
was only loosely located. The CLI mostly renders subagent activity as ordered messages linked by
`parentUuid` rather than a hard visual tree; collapsed/nested views live in the `/tasks` detail
dialogs. Treat as directionally-right, exact component unconfirmed.

---

## 6. The three surfaces side by side

| | A finished background agent surfaces as… |
|---|---|
| **Persisted JSONL** | a synthetic `type:"user"` entry, content `<task-notification>…</task-notification>` (§1) |
| **Headless `--stream-json`** | `system/task_started\|progress\|updated\|notification` events + the synthetic user turn (§2) |
| **Interactive CLI** | queued `task-notification` → idle-gated auto-resume; live `/tasks` modal + "N in background" status + OS bell (§5) |
| **Flow today** | events land in `chat_events.raw`; **nothing renders them**; no status surface, no idle-resume UI (§7) |

---

## 7. How **Flow** handles this today

Flow does **not** spawn `claude` directly. It uses the **`@agentex/agent` SDK** (v0.0.21), which
wraps the CLI subprocess, parses the JSONL internally, and hands Flow structured `StreamEvent`s.

### 7.1 Invocation

- `src/lib/executor/adapter.ts:694-717` — `provider.createSession({ cwd, config, onEvent,
  onUserInputRequest })`. Each event → `persistStreamEvent` → a `chat_events` row.
- Flags (`adapter.ts:626-677`): `--permission-mode` (default|acceptEdits|plan), model override;
  surface modes — `harness_mcp` (`--mcp-config` + `--strict-mcp-config`, blocks Write/Edit) and
  `harness_skills` (`--add-dir` skill dirs); `extraArgs` (e.g. `--append-system-prompt`).
  MCP config at `src/lib/orchestrator/harness-surface.ts:364-387`.
- Flow does **not** pass `--output-format stream-json` itself — agentex owns the wire format.

### 7.2 Event parsing → `chat_events`

`src/lib/executor/adapter.ts:984-1217` (`parseStreamEvent`, `mapUnknownEvent`). agentex's
`StreamEvent` union → `chat_events.source`:

| agentex `StreamEvent` | Flow `source` | Notes |
|---|---|---|
| `system` | `system` | content = subtype; `task_started`/`task_notification`/`init`/… land in `raw` |
| `assistant` | `agent` | rendered |
| `thinking` | `thinking` | (prose often withheld by CLS ≥2.1.155) |
| `tool_call` | `tool_call` | stores `toolName`, `toolInput`, `externalToolCallId` |
| `tool_result` | `tool_result` | `toolIsError`; paired via `externalToolCallId` |
| `result` | `result` | cost/usage in `raw`; not rendered |
| `rate_limit` | `rate_limit` | only when exceeded/blocked/limited/throttled |
| `auth_required` | `auth_required` | renders a "Log in" button |
| `unknown` | fallback | forward-compat (`compact_boundary`, `api_error`, `away_summary`, …) |

Realtime fan-out: `src/app/api/sessions/[id]/stream/route.ts:75-84` (SSE kinds: `chat_event`,
`runtime`, `pending_input`, `reconcile`); client `src/hooks/use-session-stream.ts:34-173`.

Two ingestion paths exist (`docs/chat-sessions.md`): **live agentex StreamEvents** (app-spawned)
and **on-disk reconciliation** (`parseFileEntry`, for imported/drift). They dedup at the DB level.

### 7.3 What Flow does with subagents today

- ✅ Recognizes the tool: `src/lib/executions/tool-display.ts:219-220`
  (`case 'Task' → {glyph:'task', verb:'Subagent', kind:'subagent'}`); `isSubagentTool` at 255-258;
  counted in turn summaries by `src/components/executions/transcript-grouping.ts`
  ("6 tool calls · 2 subagents").
- ❌ **Renders no task events.** `src/components/executions/execution-transcript.tsx:362-371` —
  `RENDERABLE_SYSTEM_SUBTYPES = new Set<string>([])` (empty), filtered at line ~401. The comment
  *names* `task_started`/`task_notification` as examples it deliberately drops from render but keeps in `raw`.
- ❌ **No parent linkage on the live path.** The column **exists** —
  `src/lib/db/schema.ts:673` `externalParentToolCallId: text()` — and the on-disk path sets it from
  `parent_tool_use_id` (`docs/chat-sessions.md:509`), but the live `parseStreamEvent` never sets it
  (no reference in `adapter.ts`). So live subagent interior events float at the top level instead of
  nesting under their parent `Task` pill.
- ❌ **No `<task-notification>` handling**, no idle-resume queue UI, no "N agents running" status,
  no subagent drill-down.

---

## 8. Recommended changes for Flow (grounded in the CLI blueprint)

Scoped to the high-leverage, low-risk slice (the data is already captured — this is mostly presentation):

1. **Render the `task_*` subtypes already in `chat_events.raw`.** Add `task_started`,
   `task_progress`, `task_notification` to a render path (allowlist + a small renderer):
   `task_started` → a subagent card; `task_progress` → live tokens / `last_tool_name`;
   `task_notification` → completion summary. File: `execution-transcript.tsx:362-401`.
2. **Populate `externalParentToolCallId` on the live path** — one addition in
   `parseStreamEvent` (`adapter.ts:984-1217`) mirroring the on-disk path — so child tool calls
   nest under the parent subagent pill instead of floating. (Confirm agentex v0.0.21 exposes the
   parent id on live `StreamEvent`s; if not, it needs an agentex bump or a `raw` parse.)
3. **Optional drill-down:** a "view subagent" affordance that tails
   `subagents/agent-<id>.jsonl` (or polls `getTaskOutputDelta`-style) for the full child transcript.
4. **Status surface modeled on the CLI:** a persistent "N agents running ▸ <desc> (tokens, last
   tool)" pill on the execution — the analog of `BriefIdleStatus` + `/tasks`.
5. **Idle-resume parity (only if Flow lets background agents inject):** mirror the CLI's
   `useQueueProcessor` idle gate (`!isQueryActive && queue.length > 0`) with `priority:'later'`,
   so a background completion auto-continues a session without preempting user input.

Net effect: from "a session silently ended while agents ran" to a live
"2 agents working ▸ Map DB schema (11.8k tokens, running Bash)" surface with auto-resume — the
exact thing missing from the transcript that started this investigation.

---

## 9. Key file reference index

**Open-source Claude Code** (`/Users/treyhuffine/code/claude-code-open-source`):

| Concern | File | Lines |
|---|---|---|
| Build/inject `<task-notification>` (main session) | `src/tasks/LocalMainSessionTask.ts` | 168-263 |
| Build/inject (subagent) | `src/tasks/LocalAgentTask/LocalAgentTask.tsx` | 246-262 |
| Generic task completion | `src/utils/task/framework.ts` | 255-290 |
| Subagent addressing / resume | `src/query.ts` | 1575-1577, 1631-1633 |
| Async-by-default rationale | `src/tools/AgentTool/forkSubagent.ts` | 18-39 |
| Disk output (delta/tail/paths) | `src/utils/task/diskOutput.ts` | 49-357 |
| SDK event schemas | `src/entrypoints/sdk/coreSchemas.ts` | 1694-1881 |
| Control protocol / `can_use_tool` / `stop_task` | `src/entrypoints/sdk/controlSchemas.ts` | 106-122, 455-462, 642-653 |
| stdout serializer | `src/cli/structuredIO.ts` | 466 |
| Headless SDK event queue / drain | `src/utils/sdkEventQueue.ts` · `src/cli/print.ts` | 74-101 · 2218-2241, 2374 |
| IDE bridge detection | `src/utils/ide.ts` | 73-100 |
| Queue idle gate (auto-resume) | `src/hooks/useQueueProcessor.ts` | 28-68 |
| Enqueue priority | `src/utils/messageQueueManager.ts` | 142-149 |
| Status counter ("N in background") | `src/components/Spinner.tsx` | 451-500 |
| 1s output polling | `src/utils/task/TaskOutput.ts` | 81-164 |
| `/tasks` modal | `src/components/tasks/BackgroundTasksDialog.tsx` | 127-200 |
| Per-task row | `src/components/tasks/BackgroundTask.tsx` | 17-160 |
| Ctrl+B backgrounding | `defaultBindings.ts` · `BashTool/UI.tsx` · `LocalShellTask.tsx` | 185 · 31-84 · 390-411 |
| Ctrl+B mid-query handling | `src/screens/REPL.tsx` | 2525-2583 |
| Terminal/OS notifications | `src/ink/useTerminalNotification.ts` · `src/services/notifier.ts` | 25-126 · 18-104 |

**Flow** (`/Users/treyhuffine/dynamism/ai-task-manager`):

| Concern | File | Lines |
|---|---|---|
| agentex session invocation | `src/lib/executor/adapter.ts` | 694-717 |
| CLI flags / surface modes | `src/lib/executor/adapter.ts` | 626-677 |
| `StreamEvent → chat_events` parse | `src/lib/executor/adapter.ts` | 984-1217 |
| MCP harness config | `src/lib/orchestrator/harness-surface.ts` | 364-387 |
| SSE fan-out | `src/app/api/sessions/[id]/stream/route.ts` | 75-84 |
| Client stream hook | `src/hooks/use-session-stream.ts` | 34-173 |
| Task tool → subagent pill | `src/lib/executions/tool-display.ts` | 219-220, 255-258 |
| Subagent counting | `src/components/executions/transcript-grouping.ts` | — |
| **Empty render allowlist (the gap)** | `src/components/executions/execution-transcript.tsx` | 362-401 |
| `externalParentToolCallId` column | `src/lib/db/schema.ts` | 673 |
| Adapter wiring + ingestion-path docs | `docs/chat-sessions.md` | 247, 389-536 |
| StreamEvent→row mapping doc | `docs/executor-wiring-spec.md` | 78-94 |

---

## 10. How to reproduce the empirical captures

All run from a scratch dir; `< /dev/null` avoids the stdin-wait warning.

```bash
# (a) Baseline stdio envelope shapes
claude -p "Reply with exactly the word: pong" \
  --output-format stream-json --verbose --model haiku < /dev/null > baseline.jsonl
jq -rc '{type, subtype:(.subtype//"-")}' baseline.jsonl | sort | uniq -c

# (b) Subagent lifecycle over stdio (task_started/progress/updated/notification + parent_tool_use_id)
claude -p "Use the Task tool to launch ONE general-purpose subagent whose entire job is to run \
the bash command 'echo hello-from-subagent' and report its output. Then reply with the word DONE." \
  --output-format stream-json --verbose --model haiku \
  --allowedTools "Task" "Bash(echo:*)" < /dev/null > subagent.jsonl
jq -rc 'select(.type=="system" and (.subtype|startswith("task_")))' subagent.jsonl

# (c) Inspect a real interactive transcript's synthetic user turns
F=~/.claude/projects/<project-dir>/<session-id>.jsonl
grep -n "task-notification" "$F"          # find injected turns
# each match: a type:"user" entry whose message.content starts with <task-notification>

# (d) On-disk artifacts of a running session
ls ~/.claude/projects/<project-dir>/<session-id>/subagents/   # agent-<id>.jsonl + .meta.json
ls /private/tmp/claude-501/<project-dir>/<session-id>/tasks/   # <task-id>.output symlinks
```

> Env note: `--model haiku` keeps cost low. The `subagent_type` strings available depend on the
> session's agent registry; `general-purpose` and `Explore` are always present.
