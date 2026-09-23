# Agents view: spec and task list

**Status:** in progress. Written 2026-09-22.
**How to use this doc:** it is the task list. Check a box (`- [x]`) when the work lands on `main`, and append the short commit hash when useful. Keep the "Done when" lines honest: a phase is done when every line under it is true, not when the code compiles. Record surprises inline under the task they affect.

---

## 1. Summary

Ri is becoming agent-forward. In the UI, a workspace is now called an **agent**. Clicking an agent in the rail opens its **agent view**: the agent's main chat on the left and its tools on the right. The agent's main chat **manages that agent's work**. It sees every execution, answers questions about them, steers them, starts new ones, and closes them out.

Along the way we delete the vestigial `agents` table (it only ever stored which engine runs a chat) and use the word **harness** wherever the code means the engine.

The execution view redesign comes next and is out of scope here, but this work must leave room for it to feel like a different experience: the agent view is oversight, the execution view is a workbench.

---

## 2. Decisions

Locked during alignment on 2026-09-22.

1. **The UI says "agent"** for what the code calls a workspace. This is a copy change. Whether the code follows is open (§3).
2. **An agent is a scope:** where it lives (its folder), what it can use (connectors, browser, reference folders), its purpose, and its instructions. There is **one stable persona** across all agents. No reusable personas.
3. **Clicking an agent's name opens the agent view.** The chevron folds its execution list.
4. **Agent view layout:** chat on the left, tools on the right as tabs: **Overview** (default), **Files**, **Terminal**, **Preview**, **Setup**.
5. **The agent's main chat manages work:** see, answer, steer, start, close out. In a git agent it never edits the checkout. Code changes go through executions so it cannot collide with running worktrees. Agents that are not git repos may act directly.
6. **One persistent main chat per agent**, resumed when the agent view opens. History and "new chat" sit behind a menu.
7. **Both the app's main chat and an agent's main chat may message any execution directly.** No chain of command. The execution transcript is the shared record, and every message records who sent it.
8. **The old `agents` table is deleted.** The engine moves onto chats, triggers and runs as a `harness` column.
9. **Code that says "agent" but means the engine says "harness".**
10. **Pins** in the agent view are pinned executions. The **Connectors** section may later be renamed Plugins. That is a label change.
11. **Ships as a trial.** The new click behavior and the agent view sit behind a client preference with one click back to the old behavior.
12. **Each phase lands as its own commit(s) on `main`** in the live checkout.

---

## 3. Open questions

Not decided. None of these block the phases below.

- **Rename `workspaces` to `agents` in code** (table, types, API paths, orchestrator actions). Trey is not convinced it is the right move. Revisit once purpose and instructions exist and we can see whether they feel like part of the folder's settings or a separate layer. If it happens, it is a separate spec.
- **The `ri agent <action>` CLI namespace.** It means "the command group agents use to call Ri". With "agent" meaning a scope in the UI, `ri agent list_workspaces` reads oddly. Changing it breaks every skill that learned it. Decide together with the rename above.
- **The app's main chat as an agent record** (a "home agent"). Nothing in this project needs it. The main chat stays a chat with no workspace.
- **A shared persona layer** that reaches every chat (how Trey works, standing preferences). Today each chat type gets different instructions (§5.6). Follow-up work.
- **Connectors vs Plugins naming.**
- **Whether an agent main chat's replies count as unread in the rail.** Default for this spec: no, same as the app's main chat.

---

## 4. Glossary

| Term | Meaning |
|---|---|
| **Agent** (UI) | A workspace, presented as a scope: folder, what it can use, purpose, instructions. |
| **Workspace** (code) | The `workspaces` row that backs an agent. Code identifiers keep this name for now. |
| **Harness** | The engine that runs a chat: `claude`, `codex`, `cursor`, `opencode` (the `HarnessId` values). |
| **Execution** | A unit of work. Lives in its own git worktree, or in the folder itself for non-git and live executions. |
| **Main chat** | A chat with no execution and no attached note or task. The app's main chat has no workspace. An agent's main chat has its workspace. |
| **Execution chat** | A chat attached to an execution. |
| **Note or task chat** | A chat attached to one note or task. |
| **Old `agents` table** | Four rows mapping an id to an engine name. Deleted in Phase 1. |

How each chat is stored (all existing columns, only the agent main chat is new):

| Chat | `type` | `workspace_id` | `execution_id` | `surface_kind` | Runs in |
|---|---|---|---|---|---|
| App main chat | `orchestration` | null | null | null | the Ri home (`getAppRoot()`) |
| Agent main chat (new) | `orchestration` | set | null | null | the agent's folder |
| Execution chat | `execution` | set | set | null | its worktree, or the folder |
| Note or task chat | `content` | null | null | `note` / `task` | the Ri home |

---

## 5. Background: what exists today

Evidence gathered while aligning. Line numbers are as of 2026-09-22.

### 5.1 The old `agents` table is an engine lookup

- Schema: `kind` (`orchestrator` / `executor`), `name`, `role`, `harness`, `config`, `status` (`src/lib/db/schema.ts`, `agents`).
- Prod has 4 rows: `Claude Code` (executor, `claude_code`), `codex` (executor, `codex`), `Orchestrator` (`claude_code`), `Orchestrator` (`codex`). `role` is empty and `config` is `{}` on all of them.
- `chat_sessions.agent_id`, `triggers.agent_id` and `runs.agent_id` are required foreign keys to it.
- **Every read of a row reads only `.harness`.** Call sites: the session routes (`sessions/[id]`, `messages`, `new-chat`, `slash-commands`, `dev/sessions/scratch`), `derive-label.ts`, `executor/adapter.ts`, `executor/reconcile.ts`, `queries.ts`, and `orchestrator/registry.ts`.
- `kind` is only used to find the right row at creation time (`getOrCreateDefaultExecutor`, `getOrCreateDefaultOrchestrator`, `getOrCreateTriggerAgent`). It always matches the chat's own `type`: in prod all 616 chats line up (206 execution chats on executor rows, 410 orchestration and content chats on Orchestrator rows).
- The names are never shown. `/api/agents` and `useAgents` have no callers.
- The only public reach: `create_trigger` / `update_trigger` accept `agentId` as a second way to pick the engine, next to `provider`. The CLI mirrors it as `ri trigger --agent <id>` (help text already says "Prefer --provider").

### 5.2 How it got here

- 2026-04-23, `docs/chat-sessions.md`: an agent is a definition with persona, prompt, harness and cwd.
- 2026-05-06, commit `e87f723` ("Init agent execution"): the same commit created `workspaces` and `agents`. `docs/workspaces-spec.md` reframed the agent as "the persona, reusable across many workspaces" and moved cwd onto the workspace.
- The persona part (display name, role, model, system prompt) was never built. Only the engine landed. The reusable-persona idea is now covered by the harnesses themselves (skills, subagents), which Ri already surfaces (`list_skills`).
- The code anticipated this project: the comment on `getOrCreateDefaultExecutor` reads "until per-workspace agents are a real product surface we collapse all executor sessions onto a single shared agent per harness."

### 5.3 Migration hazard: table rebuilds can cascade

- `getDb` (`src/lib/db/index.ts`, around line 325) turns `foreign_keys = ON` and then calls Drizzle's `migrate()`, which runs pending migrations inside one transaction. A `PRAGMA foreign_keys=OFF` inside a migration is ignored inside a transaction.
- SQLite cannot drop a column that is part of a foreign key. Removing `agent_id` means rebuilding `chat_sessions`, `triggers` and `runs` (create new, copy, drop old, rename).
- With foreign keys on, `DROP TABLE chat_sessions` performs an implicit delete that fires `ON DELETE CASCADE` on `chat_events`, `chat_refs` and `external_session_imports`. **In prod that is 598,104 chat events.** Rebuilding `runs` and `triggers` would also null out links (`chat_sessions.created_by_run_id`, `task_status_changes.run_id`, `runs.trigger_id`, and others).
- Good news: no search index depends on these three tables' rowids. `tasks_fts`, `notes_fts` and `stream_fts` key on their own tables, and `chat_events_fts` keys on text ids. Embeddings key on `entity_id`. So the rowid warning in CLAUDE.md does not bite here, though we preserve rowids anyway.

### 5.4 Caller identity is defined but never set

`ActionContext.actor` (`src/lib/orchestrator/types.ts`) has `source`, `sessionId`, `executionId`, `runId`. No transport sets it: the MCP route calls `runAction(..., { remote: true })` and the CLI passes `{ remote: false }`. So today an action cannot know which chat called it. Provenance (Phase 4) needs this wired.

### 5.5 Pieces the agent view can reuse, and pieces it can't

- **Folder resolution already fits.** `resolveCwd` (`src/lib/executor/adapter.ts`) returns the worktree if there is one, else the workspace folder, else the Ri home. An agent main chat runs in the agent's folder with no change.
- **Session file tree and terminal are worktree-centric.** `sessions/[id]/tree` returns an empty tree without a worktree. The terminal only falls back to the folder for non-git workspaces. The agent view needs workspace-level routes.
- **Preview already has a workspace route:** `/api/workspaces/:id/preview`.
- **The app's main chat is found by type alone.** `/api/orchestrator-chat` (plus `/history` and `/resume`) uses `listChatSessions({ type: 'orchestration', status: 'active' })`. Agent main chats would leak into it unless filtered by `workspace_id IS NULL`.
- **Needs Review already excludes interactive orchestration chats** (`listNeedsReviewSessionCandidates`), and the rail lists executions, so agent main chats stay out of both without new code. Verify, don't assume.
- **The orchestrator surface installs files into the Ri home** (`installOrchestratorSurface`, `claude-md-template.ts`). An agent main chat runs inside the user's own folder, so it must never install files there.
- **The write guard** is `disallowedTools: ['Write', 'Edit', 'NotebookEdit']` (`ORCHESTRATOR_DISALLOWED_TOOLS` in `harness-surface.ts`). Codex ignores tool filtering upstream, so there it is prompt-only.

### 5.6 Instructions today, per chat type

- App main chat: the orchestrator brief, installed into the Ri home.
- Note and task chats: a document prompt via `--append-system-prompt` (Claude only).
- Execution chats: the repo's own `CLAUDE.md` / `AGENTS.md`, plus the reference-folder block via the session `instructionsFile` (adapter, around line 1095). Harnesses that ignore session instructions get a logged warning.

Nothing shared reaches all four. That is the persona follow-up in §3.

---

## 6. Phases

Order: **0 → 1 → 2**. Phase 3 can run any time. Phases 4 and 5 need 1 and 3. Phase 6 needs 4 and 5. Phase 7 needs 5 and 6. Then 8, 9, 10.

### Phase 0: Make migrations safe for table rebuilds

Removes the cascade trap in §5.3 for this and every future migration. This follows SQLite's documented procedure for schema changes.

- [x] In `getDb` (`src/lib/db/index.ts`), set `foreign_keys = OFF` before `migrate()`. After it returns, run `PRAGMA foreign_key_check`. If it returns rows, throw with the offending table, rowid and parent so boot fails loudly. Then set `foreign_keys = ON`.
  - Landed as `runMigrations` (`src/lib/db/migrate.ts`), which replaces Drizzle's `migrate()`. It runs the check *before* COMMIT, so a migration that breaks a link rolls back instead of landing, and it only fails on violations the migration introduced (pre-existing ones don't brick boot). Bookkeeping is identical to Drizzle's.
- [x] Test (temp database): a parent table with an `ON DELETE CASCADE` child. A migration that rebuilds the parent keeps every child row. A migration that leaves a dangling reference fails boot with a readable error.
  - `src/lib/db/migrate.test.ts`. Includes a premise test showing the same rebuild under Drizzle's own runner deletes the children, and a round-trip test that Drizzle's runner and ours agree on what has been applied.
- [x] Confirm `pnpm db:migrate` (drizzle-kit's own runner, its own connection) does not turn foreign keys on. SQLite's default is off per connection. Note the result here.
  - **It does turn them on.** better-sqlite3 compiles SQLite with foreign keys ON by default, so `drizzle-kit migrate` had the same cascade trap. `pnpm db:migrate` now runs `scripts/db-migrate.ts`, which goes through `getDb` and therefore `runMigrations`.
- [x] Add a line to CLAUDE.md "Column defaults": migrations run with foreign keys off and are checked after, so a rebuild never cascades. A rebuild still reassigns rowids unless the migration copies `rowid` explicitly, so the FTS warning still applies to FTS-backed tables.

**Done when:** the tests pass and CLAUDE.md says how migrations treat foreign keys.

### Phase 1: Delete the old `agents` table

**Schema**

- [x] Add `harness` to `chat_sessions`, `triggers` and `runs`: text, enum `'claude' | 'codex' | 'cursor' | 'opencode'`, NOT NULL, no default. It is a fact column: every creator passes it, no fallback.
- [x] Remove `agent_id` from those three tables and drop `idx_chat_sessions_agent_status`.
- [x] Drop the `agents` table. Remove it from `schema.ts`.
- [x] Remove `AgentRecord`, `CreateAgentInput`, `UpdateAgentInput` and `AgentKind` from `src/db/types.ts`.

**Database change** (rebuild onto a fresh baseline, not a migration)

A first pass shipped this as a hand-edited `0001` migration. Trey asked for it to be clean instead: one generated baseline, no hand-edited SQL, and existing databases rebuilt and refilled. That is what landed.

- [x] Collapse `drizzle/` into one baseline generated straight from `schema.ts` (`0000_typical_shockwave.sql`, untouched drizzle-kit output). It has no `agents` table, `harness` on the three tables, and no `tasks.heartbeat_days` (Trey's schema-only drop from `49fdd9b` rides along). `drizzle-kit check` is clean and a fresh generate reports no changes.
- [x] `scripts/db-rebuild.ts --from <snapshot> --to <new>`: builds the new file through `getDb` (exact fresh-install schema, FTS, vec, triggers), drops the triggers, copies every shared table column by column keeping rowids, fills `harness` from the old `agents` row (`claude_code` becomes `claude`, a CASE with no ELSE so a missing row or unknown engine aborts), copies the vector rows, reopens through `getDb` to reinstall triggers, rebuilds the FTS indexes, then verifies. Unexpected dropped tables or columns, or a new NOT NULL column with nothing to fill it, abort before any row is written.
- [x] Rehearsal on copies (2026-09-22). Dev: 34 tables identical. Prod (the 15:25 snapshot, 230 s): all 34 tables match row for row by digest with rowids (`chat_sessions` 617, `chat_events` 610,424, `runs` 1,612, `triggers` 10, `tasks` 611, `notes` 247, `embeddings` 406). Harness distribution exact (chats `claude` 522 / `codex` 95, runs 1,085 / 527, triggers 10 `claude`). Vector rows, `sqlite_sequence`, all four FTS indexes (integrity-check and row counts), all 18 triggers, `foreign_key_check`, `integrity_check`, one migration recorded, source file untouched. The app's query layer reads the rebuilt file correctly.
- [x] Dev cutover: `pnpm tsx scripts/db-rebuild.ts --in-place ~/ri-dev/data.db` (snapshot `~/ri-dev/snapshots/pre-rebuild-20260922T215938/`, 34 tables verified, swapped). The dev server boots on it, the triggers / rail / runs APIs return data, and the startup reconcile is clean. New code against an un-rebuilt copy refuses to boot (`table ... already exists`) and rolls back, leaving the old file intact.
- [x] Prod cutover 2026-09-22 23:09 UTC. Trey stopped the app and ran `pnpm tsx scripts/db-rebuild.ts --in-place ~/ri/data.db` from a terminal (this session runs as an execution under the prod server, so it couldn't stop the server itself). Snapshot and untouched original: `~/ri/snapshots/pre-rebuild-20260922T230927/`. Checked after restart: every row of the snapshot is in the live file (chats, events, runs, triggers, tasks, notes, stream, executions, workspaces: 0 missing), rowids unchanged for tasks, notes and chat events, harness matches the old agent row for every chat, `foreign_key_check` clean, `tasks_fts` 613 rows, one migration recorded (the new baseline). The server boots and writes: new runs on both `claude` and `codex` and new chat events since the restart.

**Code: writes**

- [x] Chat creation sets `harness` directly: `src/lib/sessions/dispatch.ts`, `createExecutionWithChat`, `createExecutionSession`, `createExecutionChat` (`queries.ts`), `/api/orchestrator-chat`, `/api/document-chat`, `sessions/[id]/new-chat`.
- [x] Triggers and runs: `create_trigger` / `update_trigger` store `harness` from `provider`. `src/lib/runs/dispatch.ts` copies `trigger.harness` onto runs and chats. `src/lib/deck/trigger.ts` and `src/lib/stream-triage/triggers.ts` pass a harness.

**Code: reads**

- [x] Switch every `getAgent(x.agentId)?.harness` to `x.harness`: session routes, `derive-label.ts`, `executor/adapter.ts`, `executor/reconcile.ts`, `queries.ts`, `registry.ts`.
- [x] `GET /api/sessions/:id` returns the row's `harness` instead of a joined `agentHarness`. Update client consumers.
  - `ChatSessionWithAgent` is gone (it only added `agentHarness`). Components that still key the model catalog by the old `claude_code` vocabulary convert with `providerHarnessKey(session.harness)` until Phase 2 unifies the spelling.
  - External-agent imports (`src/lib/import/external-agents.ts`) store the import source as the harness.

**Code: delete**

- [x] `getOrCreateDefaultExecutor`, `getOrCreateDefaultOrchestrator`, `getOrCreateTriggerAgent`, `createAgent`, `listAgents`, `getAgent`, and the `providerForAgent` / `agentProvider` helpers.
- [x] `/api/agents` and `src/hooks/use-agents.ts`.
- [x] Update tests that seed `agents` rows (scheduler, runs, notifications, triggers, oversight).

**Done when:** no code references the `agents` table or `agentId`. `pnpm ts`, `pnpm lint`, `pnpm test`, `pnpm smoke`, `pnpm smoke:agent` and `pnpm smoke:harness` pass. The dry-run numbers are recorded above.

**Status 2026-09-22:** landed. `pnpm ts` clean, `pnpm lint` 0 errors, `pnpm test` 1,937 passed. `pnpm smoke:harness` passes end to end against real Claude, including a new assertion that a scheduled fire carries the trigger's harness onto its run and chat. It had been failing on two stale paths (`config.json` moved into `.config/`, `/schedules` renamed to `/triggers`), fixed along the way. `pnpm smoke` and `pnpm smoke:agent` fail identically on unmodified `main` (they still expect the pre-`.config/` layout, a `brain/` folder, and root skill symlinks), so they are unrelated and left for a separate fix. The only remaining `agentId` is the rejected legacy param described under Phase 4.

### Phase 2: "Harness" wherever we mean the engine

Leave "agent" where it means the AI in general: "agent browser", the "Agent (trial)" entity view, the NL MCP's `runMcpAgent`, "the agent surface".

- [x] Add the rule to CLAUDE.md: "harness" is the engine, "agent" in the UI is a workspace's scope.
  - The harness half landed with Phase 1 (Rules). Add the "agent in the UI" half with Phase 8, when the UI actually says it.
- [x] Move `src/lib/agents/` (registry, runtime, credentials, opencode, redaction) into `src/lib/harness/`, next to `one-shot.ts`. Move `src/lib/agent-options.ts` to `src/lib/harness/options.ts`.
  - Also moved, same reason: `agent-model-discovery.ts` → `src/lib/harness/model-discovery.ts`, the hooks `use-agent-models` / `use-agent-harnesses` / `use-agent-connection` → `use-harness-models` / `use-harnesses` / `use-harness-connection`, the settings components `agent-settings-panel` / `agent-connection-ui` → `harness-*`, and the onboarding `step-agent` → `step-harness`.
- [x] Rename identifiers:
  - `getAgentModelCatalog` → `getHarnessModelCatalog`
  - `getAgentModels` → `getHarnessModels`
  - `useAgentModels` → `useHarnessModels`
  - `useAgentHarnesses` → `useHarnesses`
  - `explicitAgentSelection` → `explicitHarnessSelection`
  - `LaunchAgentSelection` → `LaunchHarnessSelection`
  - `AgentModelsResponse` → `HarnessModelsResponse`
  - `AgentModelSource` → `HarnessModelSource`
  - `AgentSettingsPanel` → `HarnessSettingsPanel`
  - `AgentHarnessSettingsRecord` → `HarnessSettingsRecord`
  - `getAgentHarnessSettings`, `listAgentHarnessSettings`, `ensureAgentHarnessSettings` → the `HarnessSettings` forms
  - `AgentHarnessOperationRecord` → `HarnessOperationRecord`
  - `harnessIdForAgentRecord` → deleted once Phase 1 removes its only purpose
  - Found in the sweep and renamed too: `clearAgentModelCache`, `resolveAgentSelection`, `ExplicitAgentSelection`, `upsertAgentHarnessSettings`, `UpsertAgentHarnessSettingsInput`, the `useAgentConnection` / `HarnessAuth*` / `HarnessVerify*` family, `registerAgentRuntimeSecret`, `redactAgentRuntimeValue`, `DEFAULT_AGENT_EFFORT` → `DEFAULT_EFFORT`, the executor's live-session helpers (`ensureHarnessSession`, `isHarnessSessionAlive`, `invalidateHarnessSession`, `closeHarnessSession`, `harnessSessions`; agentex's own `AgentSession` type keeps its name), and local state in the launcher and trigger form.
  - **One spelling for the engine.** The old `claude_code` vocabulary is gone everywhere: `AgentHarness`, `agentRecordHarness`, `providerHarnessKey`, `providerIdForHarness` and the executor's `mapHarnessToProvider` are deleted. `MODEL_OPTIONS` and the model-reconcile snapshot are keyed by `HarnessId`, `ExplicitHarnessSelection` drops its duplicate `harness` field, and untyped input is narrowed with `requireHarnessId` (accepts every known harness, including rollout-disabled ones, so history always reads). `isKnownHarnessId` joins the registry for the same reason.
  - Deliberately unchanged, because "agent" there means the AI or an external tool, not our engine field: agentex's `AgentSession`, the external-agent history import (`ExternalAgent*`, `/api/imports/agents`), the `ri agent` CLI namespace (§3), the agent browser, the entity "Agent (trial)" view, `runMcpAgent`, subagents, "Start with agent", and the `'agent'` values of `chat_events.source` / `actor` / `createdBy`. User-facing copy that says "agent" for the engine is handled in the Phase 8 copy sweep, so the UI never uses "agent" for two things.
- [x] Rename routes `/api/agent/*` (`auth`, `cursor`, `harnesses`, `models`, `opencode`, `skills`, `verify`) to `/api/harness/*`, with every caller in the UI, CLI and docs.
- [x] Rename tables `agent_harness_settings` → `harness_settings` and `agent_harness_operations` → `harness_operations`. `ALTER TABLE ... RENAME` keeps rowids. drizzle-kit asks interactively whether a table was renamed or recreated. Answer "renamed", or write the `ALTER TABLE` by hand and check the generated snapshot matches.
  - Generated as `drizzle/0001_late_magus.sql` (Trey ran `pnpm db:generate` and answered the rename prompts, no hand edits). The sweep also found `user_state.default_agent_harness` / `default_agent_model` / `default_agent_effort`, renamed in the same migration to `default_harness` / `default_model` / `default_effort` (TS `defaultHarness` / `defaultModel` / `defaultEffort`). The migration also carries the Phase 3 and Phase 4 columns, so the spec needs one migration in total. Every statement is an in-place `RENAME` or `ADD COLUMN`.
  - Rehearsed on copies of dev and prod with `runMigrations`: every row count and rowid unchanged, the user's saved default (`claude` / `opus` / `xhigh` on prod) carried over, new columns empty, schema equal to a fresh install, `foreign_key_check` clean, `quick_check` ok, 1.2 s on prod. Applies on the next app restart.

**Done when:** no identifier, route or table uses "agent" to mean the engine, and all checks pass.

**Status 2026-09-22:** done. `pnpm ts` clean, lint clean on every touched file (two pre-existing `set-state-in-effect` errors in `use-setup-checklist.ts` and `triggers-modal.tsx` are on lines this phase didn't touch), `pnpm test` 1,934 passed. A pre-existing intermittent vitest teardown error in `registry.stream.test.ts` (reproduced 3 of 5 runs on unmodified `main`) is reduced to about 1 in 6 by stubbing the background embedding upsert, the pattern other entity-creating suites use. The remaining late log only appears under full-suite load and is left as a known flake.

### Phase 3: Scope fields on workspaces

- [x] Add `purpose` and `instructions` to `workspaces`: text, nullable, no default. Null means none. Plain `ADD COLUMN`. (In `0001_late_magus.sql`.)
- [ ] Caps (proposed): purpose 500 characters, instructions 20,000 characters. Enforced in the query layer, surfaced as `invalid_params` / HTTP 400.
- [ ] `createWorkspace` / `updateWorkspace` accept both. Types follow from the schema.
- [ ] Execution chats receive `instructions` through the session `instructionsFile`, merged with the reference-folder block in `adapter.ts`. Harnesses that ignore session instructions log the same warning the reference-folder path logs.
- [ ] The agent main chat's brief includes purpose and instructions (Phase 6).
- [ ] Tests: caps, round-trip, delivery into an execution's instructions file.

**Done when:** purpose and instructions can be set, and every new execution in that agent receives the instructions (or logs why it can't).

### Phase 4: Orchestrator actions (MCP and `ri agent` CLI)

One registry generates both surfaces, so every item lands on both.

**Removing the table**

- [x] `create_trigger` / `update_trigger`: keep `agentId` in the param shape for now, but reject it with `invalid_params`: "agentId was removed. Use provider." Never silently ignore it, since that would change which engine runs.
  - Landed with Phase 1 (the table removal forced it). `update_trigger` never accepted `agentId`. `list_runs` got the same treatment: its `agentId` filter is rejected, and a new `harness` filter replaces it (a silently ignored filter would return the wrong runs).
- [x] Output fields: `list_executions` and `get_session_messages` change `agentHarness` to `harness`. `list_runs`, `get_run`, `list_triggers` and `get_trigger` change `agentId` to `harness`.
  - Landed with Phase 1. Values are now the `HarnessId` spelling (`claude`, not `claude_code`). Trigger reads keep `provider` as well, since `provider` is the name the create/update actions take.
- [x] CLI: remove `ri trigger --agent`. `ri trigger runs --by agent` becomes `--by harness`.
  - Landed with Phase 1. The grouping flag lives on `ri trigger spend --by harness`.

**Caller identity** (§5.4)

- [ ] Give every harness session a way to identify itself to the orchestrator:
  - MCP mode: the executor adds a per-session credential to the orchestrator MCP server config it attaches to the session. The `/api/orchestrator/[transport]` route resolves it to `ctx.actor`.
  - Skills mode: the executor exports the session id and a per-session token into the harness environment, and the CLI forwards them.
- [ ] A bare header or env var without a valid token is ignored, so an untrusted caller cannot claim to be a session. Human CLI calls keep today's behavior (actor unset).
- [ ] Test: an action called from a session sees that session in `ctx.actor.sessionId`, and a forged id does not.

**New actions**

- [ ] `start_execution`: `workspaceId`, `prompt`, optional `provider`, `model`, `effort`, `permissionMode`, `taskId`, `label`, and a required `requestId` for retry safety. Goes through the server, like `send_session_message`: create via `POST /api/workspaces/:id/sessions`, then send the prompt through the messages route. A retry with the same `requestId` returns the same execution. Returns `sessionId` and `executionId`.
- [ ] `archive_execution`: `sessionId`, optional `force`. Goes through the server's archive route. A dirty worktree without `force` fails with `conflict` and says what would be lost. Archiving an archived execution succeeds as a no-op.
- [ ] `update_workspace`: `name`, `emoji`, `areaId`, `purpose`, `instructions`, `connectorScopes`, `browserEnabled`. **The folder, scripts (setup, teardown, start) and files-to-copy are not in this action.** Those execute commands or move files on the machine, so they stay in the app UI.
- [ ] `get_workspace` and `list_workspaces` return `purpose` and `instructions`.

**Provenance**

- [x] Add `chat_events.sender_session_id`: text, nullable, foreign key to `chat_sessions`, `ON DELETE SET NULL`. Plain `ADD COLUMN`. (In `0001_late_magus.sql`.)
  - **Changed to a soft reference (no FK).** A scratch generate showed drizzle-kit emits `ADD sender_session_id text REFERENCES chat_sessions(id)` and silently drops the `ON DELETE SET NULL`, so existing databases would get a stricter constraint than fresh installs, and deleting a chat that had sent a message would fail. Fixing that needs hand-edited SQL, so the column is a plain nullable text id and readers treat an unresolvable id as "a deleted chat".
- [ ] `send_session_message` passes `ctx.actor.sessionId` to the messages route, which stores it on the event.
- [ ] The receiving harness gets the message with a one-line header naming the sender, for example `[Message from the ri agent's main chat]` or `[Message from the orchestrator]`. Messages you type are unchanged.
- [ ] Enforce "never send to your own session" using the actor.

**Briefs and skills**

- [ ] Update the orchestrator brief (`harness-surface.ts`, `claude-md-template.ts`) and `skills/orchestrator/SKILL.md`: the new actions, provenance, and "a workspace is what the user calls an agent".
- [ ] Registry tests for every change above (`registry.triggers.test.ts`, `registry.oversight.test.ts`, new tests for the new actions).

**Done when:** an orchestrator session can start, message and archive an execution. The execution's transcript shows who sent each message, and retries do not duplicate work.

### Phase 5: REST routes

- [ ] Workspace-level files and terminal on the agent's own folder:
  - `GET /api/workspaces/:id/tree`
  - `GET /api/workspaces/:id/file`
  - `GET` and `POST /api/workspaces/:id/terminals`

  Reuse the internals behind the session routes (`list-tree.ts`, the file reader, the terminal manager). For git agents these read the source checkout. The file viewer is read-only in this spec.
- [ ] The agent's main chat, sharing one query helper with the app's main chat (`workspaceId` or null):
  - `GET /api/workspaces/:id/chat` (current chat, created if missing)
  - `POST /api/workspaces/:id/chat/new`
  - `GET /api/workspaces/:id/chat/history`
  - `POST /api/workspaces/:id/chat/resume`
- [ ] `/api/orchestrator-chat`, `/history` and `/resume` filter on `workspace_id IS NULL` so agent main chats never appear in the app's main chat.
- [ ] `PATCH /api/workspaces/:id` accepts `purpose` and `instructions`.
- [ ] Session, trigger and run responses carry `harness` (Phase 1).
- [ ] Route tests for each new route, including the main-chat filter.

**Done when:** the agent view can load an agent's chat, tree, files, terminal and preview without an execution.

### Phase 6: The agent's main chat (backend)

- [ ] Row shape per §4: `type = 'orchestration'`, `workspace_id` set, no execution. `harness` is the user's default provider.
- [ ] Test that `resolveCwd` returns the agent's folder for it.
- [ ] **Never write into the agent's folder.** No surface install there, whatever `user_state.orchestratorMode` says. The brief goes through session instructions. Orchestrator actions go through the session MCP config (the `harness_mcp` path).
- [ ] The brief covers:
  - the scope: name, folder, purpose, instructions
  - the role: manage this agent's executions (see, answer, steer, start, close out)
  - how to read them: `list_workspace_sessions`, `get_session_messages`, `search_sessions`
  - the git rule: changes go through `start_execution`
  - permission prompts: answer questions when the user's intent is clear, pass permission prompts to the user
  - provenance: its messages are labeled as coming from it
- [ ] Write guard for git agents: the same `disallowedTools` as the orchestrator. On Codex it is prompt-only, and the adapter logs it.
- [ ] Connectors: the agent's connector scopes, the same set its executions get.
- [ ] It can use the full orchestrator surface (tasks, notes, deck). The brief keeps it focused on its agent.
- [ ] Labels: none while live, retrospective summary at archive (the existing orchestration rule).
- [ ] Verify it stays out of Needs Review and the rail.
- [ ] Tests: brief contents, write guard on git versus non-git, no files created in the agent folder, connector scoping.

**Done when:** an agent's main chat runs in its folder, can see and steer that agent's executions, and has left no files behind in the folder.

### Phase 7: Agent view UI

**Navigation state**

- [ ] Replace `ActiveView = 'command' | string` (`src/types/dashboard.ts`, whose comment wrongly says "or an agent id") with a union: home, agent (`id`, optional tab), execution (`id`).
- [ ] URL: `?agent=<workspaceId>` with an optional `&tab=`, next to today's `?session=<id>`. Reload and browser back/forward restore the view.
- [ ] `dashboard.tsx` renders the agent view for the agent state.

**Layout**

- [ ] Two resizable panels with the same primitives as `PanelLayout` (react-resizable-panels): chat on the left (min 360px), tools on the right. The tools panel can collapse so the chat goes full width. Sizes persist.
- [ ] In-panel responsive rules use Tailwind `@container`, not viewport breakpoints.
- [ ] Header:
  - agent icon and name
  - folder path, muted
  - working and needs-you counts
  - a "Start work" button that opens the launcher seeded with this agent

**Chat panel**

- [ ] Renders the agent's main chat with the existing harness chat components (`src/components/chat/harness-chat.tsx`), loaded from `/api/workspaces/:id/chat`. A menu offers history and "New chat".
- [ ] Composer placeholder: "Ask ri about its work, or what to start next". UI copy uses no em dashes and no semicolons.

**Tools panel**

- [ ] A tab strip with Overview, Files, Terminal, Preview and Setup. The last-used tab persists per agent.
- [ ] **Overview**
  - Executions grouped with the rail's classification (`StatusView`): **Needs you** (approval and unread), **Working**, **Recent**. Rows show label, diff stats, harness and last activity. Clicking opens the execution view.
  - **Pinned:** this agent's pinned executions.
  - **Tasks:** tasks linked to this agent's executions.
  - **Preview:** running or stopped, port, open link.
  - Empty state: "No work yet" plus Start work.
- [ ] **Files:** tree and read-only viewer on the agent's folder (Phase 5 routes). Reuse the file tree and viewer components by giving them a target (a session or a workspace).
- [ ] **Terminal:** the terminal panel on the agent's folder (Phase 5 routes).
- [ ] **Preview:** the existing preview pane pointed at the workspace preview.
- [ ] **Setup** replaces `WorkspaceSettingsSheet`. Sections:
  - Basics: name, icon, area, purpose
  - Instructions
  - Connectors
  - Browser
  - Reference folders
  - Folder and git
  - Scripts
  - Files to copy
  - Preview command
  - Archive

  Delete the sheet once Setup covers everything it does.

**Provenance in transcripts**

- [ ] Messages with a `sender_session_id` show who sent them ("From ri", "From orchestrator"), linking to the sending chat.

**Trial preference**

- [ ] `src/lib/client/agent-view-mode.ts`, mirroring `entity-view-mode.ts`. Settings > General gets "Clicking an agent" with two options: "Opens the agent view (trial)" and "Folds its list". The default is the agent view.

**Done when:** every tab works on a git agent and on a non-git agent. Screenshots in light and dark are attached to the commit or recorded here.

### Phase 8: Rail and navigation

- [ ] Agent row (`workspace-row.tsx`):

  | Action | Today | New |
  |---|---|---|
  | Click the name | folds/unfolds | opens the agent view (folds when the trial preference is off) |
  | Chevron (on hover) | folds/unfolds | folds/unfolds |
  | Gear (on hover) | settings sheet | agent view, Setup tab |
  | `+` (on hover) | start work | unchanged |
  | Click an execution | execution view | unchanged |

  The active agent gets a highlight.
- [ ] Rail state per view: Home and the agent view keep whatever the user set. The execution view still collapses the rail automatically. That contrast is part of what makes the two views feel different.
- [ ] Execution header (`execution-header.tsx`): a breadcrumb "ri › Refactor auth". Clicking the agent name opens the agent view.
- [ ] Top bar (`top-hud.tsx`): in the agent view a "Close agent" button goes Home, with the same hotkey as "Close execution". Rename the hotkey `closeExecution` to `closeView` in `src/constants/commands.ts`, since it now closes either view.
- [ ] Copy sweep: every user-visible "workspace" becomes "agent". Covers:
  - the rail tab ("Agents"), the "AGENTS" header, "New agent", and the empty state ("No agents yet. Add one to get started.")
  - the create modal, launcher and trigger form
  - toasts, aria-labels and titles
  - mobile

  Find them with `grep -rnE "['\">][^'\"<>]*\b[Ww]orkspaces?\b" src/components src/app`. Code identifiers keep "workspace".

**Done when:** you can go Home → agent → execution → agent → Home with clicks, the breadcrumb, the hotkey and the browser back button, and no user-visible "workspace" remains.

### Phase 9: Tablet and mobile

- [ ] Mobile "Agents" tab (`mobile-agents-view.tsx`): tapping an agent opens its agent view with the chat full screen and the tools behind a tab switch, Overview first.
- [ ] Tablet: the agent view collapses to one panel with a chat/tools switch when its container is narrow.

**Done when:** you can use an agent's main chat and Overview comfortably on a phone.

### Phase 10: Docs and final verification

- [x] `docs/workspaces-spec.md`: replace "Agent = the persona" in the mental model with a pointer to this spec. (Landed with Phase 1.)
- [x] `docs/chat-sessions.md`: the Agents section says the table is gone and the harness lives on the chat. (Landed with Phase 1, along with `docs/async-agents-v1.md` and the one stale line in `docs/orchestrator-harness.md`.)
- [ ] `docs/orchestrator-harness.md`: new actions, caller identity, provenance, the agent main chat.
- [ ] CLAUDE.md: the glossary line (Phase 2), the migration note (Phase 0), and a line in the Orchestrator section about agent main chats.
- [ ] `pnpm ts`, `pnpm lint`, `pnpm test`, `pnpm smoke`, `pnpm smoke:agent`, `pnpm smoke:harness`, `pnpm build`.
- [ ] End-to-end run on dev (port 42241):
  1. Create an agent.
  2. Open its agent view.
  3. Ask its main chat to start an execution.
  4. Watch the execution appear in Overview.
  5. Have the main chat steer it and check the transcript shows the sender.
  6. Have the app's main chat message the same execution.
  7. Archive the execution from the agent's main chat.

  Record the result here.
- [ ] Update this doc's status line to done.

---

## 7. Not in this spec

Recorded so they are not lost:

- **Execution view redesign.** Next. It must read as a workbench, distinct from the agent view.
- **Renaming `workspaces` to `agents` in code, and the `ri agent` namespace** (§3).
- **A home agent record** for the app's main chat (§3).
- **A shared persona layer** reaching every chat (§3).
- **Several agents sharing one folder.** If it becomes real, split scope fields (name, icon, area, purpose, instructions, connectors, browser, rail order) from folder fields (path, git, worktree root, scripts, files to copy). Reference folders are a judgment call, since they can point at another workspace.
- **Renaming Connectors to Plugins.**
- **Editing files from the agent view's Files tab.**

---

## 8. File reference

| Area | Files |
|---|---|
| Schema, types, queries | `src/lib/db/schema.ts`, `src/db/types.ts`, `src/lib/db/queries.ts`, `src/lib/db/index.ts`, `drizzle/` |
| Orchestrator | `src/lib/orchestrator/registry.ts`, `types.ts`, `harness-surface.ts`, `server-client.ts`, `src/app/api/orchestrator/[transport]/route.ts`, `skills/orchestrator/SKILL.md`, `src/lib/config/claude-md-template.ts` |
| Chats and execution | `src/lib/sessions/dispatch.ts`, `src/lib/executor/adapter.ts`, `src/lib/executor/harness.ts`, `src/lib/executor/reconcile.ts`, `src/lib/sessions/derive-label.ts`, `src/app/api/sessions/[id]/*`, `src/app/api/orchestrator-chat/*`, `src/app/api/document-chat/route.ts` |
| Triggers and runs | `src/lib/runs/dispatch.ts`, `src/lib/deck/trigger.ts`, `src/lib/stream-triage/triggers.ts`, `src/cli/commands/trigger.ts` |
| Harness naming | `src/lib/agents/*`, `src/lib/agent-options.ts`, `src/app/api/agent/*`, `src/hooks/use-agent-*` |
| Rail | `src/components/dashboard/power-rail.tsx`, `src/components/workspaces/rail-tabs.tsx`, `workspace-nav.tsx`, `workspace-row.tsx`, `workspace-settings-sheet.tsx`, `pinned-rail.tsx`, `status-view.tsx` |
| Shell and navigation | `src/components/dashboard/dashboard.tsx`, `panel-layout.tsx`, `top-hud.tsx`, `src/contexts/dashboard-context.tsx`, `src/types/dashboard.ts`, `src/constants/commands.ts` |
| Reused view parts | `src/components/chat/harness-chat.tsx`, `src/components/executions/file-tree/`, `viewer/`, `execution-terminal-panel.tsx`, `preview/`, `execution-header.tsx` |
| Trial preference | `src/lib/client/entity-view-mode.ts` (pattern), `src/components/settings/sections/general-section.tsx` |
| Mobile | `src/components/mobile/mobile-agents-view.tsx`, `tablet-layout.tsx` |
