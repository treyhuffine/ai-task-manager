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
- ~~**Preview already has a workspace route:** `/api/workspaces/:id/preview`.~~ Wrong, found in Phase 5: previews are per execution (`/api/executions/:id/preview/*`, `preview_targets.execution_id`). The only workspace route is `preview/restore-set`. See the Phase 5 note.
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
- [x] Caps (proposed): purpose 500 characters, instructions 20,000 characters. Enforced in the query layer, surfaced as `invalid_params` / HTTP 400.
  - `WORKSPACE_PURPOSE_MAX` / `WORKSPACE_INSTRUCTIONS_MAX` and `WorkspaceFieldError` (code `invalid_params`) in `queries.ts`. Values are trimmed, blank means none (null), the cap is measured after trimming, non-text is rejected. Messages read "Purpose is 501 characters. The limit is 500." The create and update routes return them as a plain 400.
- [x] `createWorkspace` / `updateWorkspace` accept both. Types follow from the schema. `POST /api/workspaces` passes them through too.
- [x] Execution chats receive `instructions` through the session `instructionsFile`, merged with the reference-folder block in `adapter.ts`. Harnesses that ignore session instructions log the same warning the reference-folder path logs.
  - The per-session file is now generic: `src/lib/executor/session-instructions.ts` (`planSessionInstructions`, `writeSessionInstructions`, `clearSessionInstructions`, and the provider check moved here from the reference-folder module). The block comes from `src/lib/executor/prompts/agent-instructions.ts`, ahead of the reference-folder block. Editing instructions recycles the agent's live execution sessions (the next message resumes the same chat), the same as connector-scope and reference-folder edits.
- [x] The agent main chat's brief includes purpose and instructions (Phase 6).
  - Landed with Phase 6: `renderAgentMainChatBrief` in `harness-surface.ts`. Name and purpose edits recycle only the agent's main chat, since executions never receive them.
- [x] Tests: caps, round-trip, delivery into an execution's instructions file.
  - `queries.workspace-scope.test.ts` (round-trip, trim, blank, partial update, caps at and over the limit, rejected writes leave the row alone, non-text), `session-instructions.test.ts` (block content, order, claude and codex deliver, cursor and opencode report the loss, the file's path, mode, rewrite and removal), `app/api/workspaces/[id]/route.test.ts` (400 mapping, recycle on instructions only). The live end-to-end check is part of Phase 10's run.

**Done when:** purpose and instructions can be set, and every new execution in that agent receives the instructions (or logs why it can't).

**Status 2026-09-22:** done except the agent main chat line, which lands with Phase 6.

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

- [x] Give every harness session a way to identify itself to the orchestrator:
  - MCP mode: the executor adds a per-session credential to the orchestrator MCP server config it attaches to the session. The `/api/orchestrator/[transport]` route resolves it to `ctx.actor`.
  - Skills mode: the executor exports the session id and a per-session token into the harness environment, and the CLI forwards them.
  - One value carries both: `<chatSessionId>.<HMAC-SHA256(localToken, "ri-session:<id>")>` (`src/lib/orchestrator/session-credential.ts`). Nothing is stored, since any process holding the local token can re-verify it. MCP sends it as the `x-ri-session` header (`orchestratorMcpServer(port, { sessionId })`). Every session's env gets `RI_SESSION_CREDENTIAL`, which `ri agent` reads (`actorFromSessionCredential`).
- [x] A bare header or env var without a valid token is ignored, so an untrusted caller cannot claim to be a session. Human CLI calls keep today's behavior (actor unset).
  - A forged signature, a bare id, or a credential for a deleted chat all resolve to no actor. This is identity only. `ctx.remote` still decides what the transport may do.
- [x] Test: an action called from a session sees that session in `ctx.actor.sessionId`, and a forged id does not.
  - `session-credential.test.ts` (sign, verify, forge, header parsing, actor lookup) and `app/api/orchestrator/[transport]/route.test.ts`, which drives the real MCP handler with signed, forged, bare and missing headers.

**New actions**

- [x] `start_execution`: `workspaceId`, `prompt`, optional `provider`, `model`, `effort`, `permissionMode`, `taskId`, `label`, and a required `requestId` for retry safety. Goes through the server, like `send_session_message`: create via `POST /api/workspaces/:id/sessions`, then send the prompt through the messages route. A retry with the same `requestId` returns the same execution. Returns `sessionId` and `executionId`.
  - Retry safety without a new table: the chat id and the prompt's event id are UUIDv8s derived from `sha256("ri:start_execution:<kind>:<workspaceId>:<requestId>")`. A retry finds the chat already there and skips the create. It resends the prompt under the same event id, which the messages route already dedupes. `requestId` is scoped per agent, so two agents reusing one id never collide. `permissionMode` is PATCHed before the prompt, and only when it differs from the session default. Server refusals map to `not_found`, `conflict` (with the route's reason, e.g. a task that cannot start) or `invalid_params`.
- [x] `archive_execution`: `sessionId`, optional `force`. Goes through the server's archive route. A dirty worktree without `force` fails with `conflict` and says what would be lost. Archiving an archived execution succeeds as a no-op.
  - Refuses non-execution chats with `invalid_params`. The conflict carries the route's detail and a `force: true` suggestion.
- [x] `update_workspace`: `name`, `emoji`, `areaId`, `purpose`, `instructions`, `connectorScopes`, `browserEnabled`. **The folder, scripts (setup, teardown, start) and files-to-copy are not in this action.** Those execute commands or move files on the machine, so they stay in the app UI.
  - `connectorScopes` and `browserEnabled` widen what the agent can reach, so they need the trusted local CLI (`ctx.remote === false`). Over MCP, or with the transport unset, they fail with `invalid_params`. Plain fields go through `PATCH /api/workspaces/:id` (so an instructions change recycles live sessions). Scopes go through `PUT /api/workspaces/:id/connector-scopes`, which validates toolkits. Validation messages come back as `invalid_params`.
- [x] `get_workspace` and `list_workspaces` return `purpose` and `instructions`.
  - They return the full row, so the new columns came along. `create_workspace` also takes both. `list_workspace_sessions` now lists executions only, so an agent's main chat never shows up as work.

**Provenance**

- [x] Add `chat_events.sender_session_id`: text, nullable, foreign key to `chat_sessions`, `ON DELETE SET NULL`. Plain `ADD COLUMN`. (In `0001_late_magus.sql`.)
  - **Changed to a soft reference (no FK).** A scratch generate showed drizzle-kit emits `ADD sender_session_id text REFERENCES chat_sessions(id)` and silently drops the `ON DELETE SET NULL`, so existing databases would get a stricter constraint than fresh installs, and deleting a chat that had sent a message would fail. Fixing that needs hand-edited SQL, so the column is a plain nullable text id and readers treat an unresolvable id as "a deleted chat".
- [x] `send_session_message` passes `ctx.actor.sessionId` to the messages route, which stores it on the event.
  - Passed as a signed `x-ri-session` header, not a body field, so the route verifies it and a request cannot claim a sender. The result carries `sentFrom`.
- [x] The receiving harness gets the message with a one-line header naming the sender, for example `[Message from the ri agent's main chat]` or `[Message from the orchestrator]`. Messages you type are unchanged.
  - `src/lib/sessions/sender.ts`: `[Message from the "ri" agent's main chat, sent on the user's behalf]`, then a blank line. The stored event keeps the text as sent, so the label is only in what the harness receives. Orphan redispatch (`health.ts`) applies the same label.
- [x] Enforce "never send to your own session" using the actor.
  - Both layers: the action refuses before calling the server, and the messages route refuses a credential naming the target (400).

**Briefs and skills**

- [x] Update the orchestrator brief (`harness-surface.ts`, `claude-md-template.ts`) and `skills/orchestrator/SKILL.md`: the new actions, provenance, and "a workspace is what the user calls an agent".
  - SKILL.md also had stale `schedule` action names from before triggers. Fixed.
- [x] Registry tests for every change above (`registry.triggers.test.ts`, `registry.oversight.test.ts`, new tests for the new actions).
  - `registry.agents.test.ts` covers the new actions, provenance, the capability gate and the executions-only list. Trigger changes were tested with Phase 1. `server-client.test.ts` covers the structured `ServerResponseError`.

**Done when:** an orchestrator session can start, message and archive an execution. The execution's transcript shows who sent each message, and retries do not duplicate work.

**Status 2026-09-22:** landed. Every action is tested through `runAction` with the app server mocked and the database and credentials real, and caller identity through the real MCP handler. `get_session_messages` marks steered rows with `sentBy`, so an overseeing agent can tell them from typed ones. The transcript chip in the UI is Phase 7. A live run against a real harness is part of the Phase 10 end-to-end pass.

### Phase 5: REST routes

- [x] Workspace-level files and terminal on the agent's own folder:
  - `GET /api/workspaces/:id/tree`
  - `GET /api/workspaces/:id/file`
  - `GET` and `POST /api/workspaces/:id/terminals`

  Reuse the internals behind the session routes (`list-tree.ts`, the file reader, the terminal manager). For git agents these read the source checkout. The file viewer is read-only in this spec.
  - Paths and response shapes mirror the session routes exactly, so the Phase 7 viewer and terminal panel only swap a base URL. A working terminal panel also needs `terminals/:terminalId` (GET, DELETE), `/input`, `/resize` and `/stream`, so those landed too. The session terminal routes and the new ones are thin wrappers over `src/lib/terminal/http.ts`, and the file read over `src/lib/workspaces/file-http.ts`.
  - Agent terminals are owned by the workspace (`workspace:<id>`, `workspaceTerminalOwnerId`), separate from every execution's shells. An archived agent or a missing folder gets no new shell (409). Archiving an agent reaps its terminals.
  - **Surprise, upstream bug:** agentex 0.0.4 cannot open a main checkout correctly. For a main checkout (not a linked worktree), `git rev-parse --git-path info/agentex.json` answers with a relative path, and agentex reads it relative to the *server process's* cwd. So opening any user's checkout read Ri's own `.git/info/agentex.json` (base `origin/main`, an unrelated sha), and where the server cwd has no such file it throws. The agent folder routes use a new `openFolderHandle` that passes the base explicitly: current branch at HEAD, so status flags mean uncommitted changes (empty tree for an unborn repo). agentex cannot open a detached HEAD at all, so that case falls back to a plain listing and direct reads. **Live-mode executions still open the source checkout the old way** and only work because the server's cwd happens to carry that metadata. Fixing them changes execution diff behavior, so it is left for the execution view work (§7) and the agentex fix.
- [x] The agent's main chat, sharing one query helper with the app's main chat (`workspaceId` or null):
  - `GET /api/workspaces/:id/chat` (current chat, created if missing)
  - `POST /api/workspaces/:id/chat/new`
  - `GET /api/workspaces/:id/chat/history`
  - `POST /api/workspaces/:id/chat/resume`
  - Query: `listMainChats(workspaceId | null)`. Behavior: `src/lib/sessions/main-chat.ts` (ensure, new, history, resume), which both route families wrap. Concurrent opens of one scope share a single create. Resume refuses a chat from another scope (another agent, the app, an execution). An archived agent still returns its current chat and history, but never starts or resumes one (409).
- [x] `/api/orchestrator-chat`, `/history` and `/resume` filter on `workspace_id IS NULL` so agent main chats never appear in the app's main chat.
  - Also verified the other places an orchestration chat could leak: the rail (`listRailSessions`) inner-joins executions, session search is executions only, and `list_workspace_sessions` lists executions (Phase 4).
- [x] `PATCH /api/workspaces/:id` accepts `purpose` and `instructions`. (Landed with Phase 3: the route already forwards fields, the query layer validates, and validation errors map to 400.)
- [x] Session, trigger and run responses carry `harness` (Phase 1).
  - Confirmed no route emits `agentHarness` or `agentId`. `GET /api/runs` now forwards the `harness` filter too (it only forwarded the rejected `agentId`).
- [x] Route tests for each new route, including the main-chat filter.
  - `app/api/workspaces/[id]/chat/route.test.ts` (both scopes, isolation both ways, scheduled fires, concurrency, archived agents), `app/api/workspaces/[id]/folder.test.ts` (real git and plain folders, detached HEAD, terminal cwd and ownership, archive reaping), `lib/workspaces/open-folder.test.ts`.

**Done when:** the agent view can load an agent's chat, tree, files, terminal and preview without an execution.

**Status 2026-09-22:** landed.

- **Preview, corrected premise.** §5.5 said a workspace preview route existed. It does not: a preview belongs to an execution, and `preview_targets` is keyed by execution. That is also the right model here. A git agent's main chat never edits the checkout, so the code worth previewing lives in executions, and a preview of the checkout itself is a live-mode execution. So instead of a folder preview (which would need a `preview_targets` rebuild), `GET /api/workspaces/:id/previews` lists the previews on the agent's active executions with live state and labels. Start, stop and pin stay on the execution routes, and `preview/restore-set` brings up the pinned ones. Listing passes `touch: false` so a polling Overview never defeats idle eviction. Phase 7's Preview tab and Overview line read this.

### Phase 6: The agent's main chat (backend)

- [x] Row shape per §4: `type = 'orchestration'`, `workspace_id` set, no execution. `harness` is the user's default provider.
  - Created by `src/lib/sessions/main-chat.ts` (Phase 5).
- [x] Test that `resolveCwd` returns the agent's folder for it.
  - **Surprise:** §5.5 said this needed no change. It did. `resolveCwd` refuses a git workspace without a worktree (it returns null so an execution never runs in the source checkout), which would have refused every git agent's main chat. It now takes the chat's `type` and `executionId` and lets exactly one case through: an orchestration chat with a workspace and no execution runs in the folder, git or not, and a folder that is gone is refused. Executions keep the old rule, and a test pins that. All callers already passed full rows, so making the fields required cost nothing.
- [x] **Never write into the agent's folder.** No surface install there, whatever `user_state.orchestratorMode` says. The brief goes through session instructions. Orchestrator actions go through the session MCP config (the `harness_mcp` path).
  - `src/lib/executor/agent-main-chat.ts` (`prepareAgentMainChatSpawn`) builds the whole spawn: brief and reference folders in the instructions file under the work dir, MCP servers, write guard. The adapter's orchestration branch skips `installOrchestratorSurface` for it.
  - Two more writers found and handled. **Codex symlinks `skillDirs` into `<cwd>/.agents/skills`** (agentex `injectWorkspaceSkills`), so an agent main chat on Codex gets no `skillDirs` and logs that. Claude builds a temp dir, and the rest use the home dir. **Cursor and OpenCode drop session instructions**, so the brief rides the first message of a fresh chat instead (`withFirstTurnPreamble`), framed as app instructions the user did not type. A resumed chat keeps the brief it started with.
- [x] The brief covers:
  - the scope: name, folder, purpose, instructions
  - the role: manage this agent's executions (see, answer, steer, start, close out)
  - how to read them: `list_workspace_sessions`, `get_session_messages`, `search_sessions`
  - the git rule: changes go through `start_execution`
  - permission prompts: answer questions when the user's intent is clear, pass permission prompts to the user
  - provenance: its messages are labeled as coming from it
  - `renderAgentMainChatBrief`. It also reuses the orchestrator brief's shared sections (the domain brief was split into named sections, and the app main chat's brief was verified byte-identical before and after). Home-relative paths (`@USER.md`, `attachments/`) are absolute here, since the working directory is the agent's folder.
- [x] Write guard for git agents: the same `disallowedTools` as the orchestrator. On Codex it is prompt-only, and the adapter logs it.
  - Only Claude enforces argv tool filtering, so every other harness gets the prompt-only warning. A non-git agent has no guard, and its brief says it may act directly.
- [x] Connectors: the agent's connector scopes, the same set its executions get.
  - Same gate as executions: attached only when the agent has scopes and the harness isolates MCP. **Decision:** "the same set its executions get" applied to the rest of the scope too, so the main chat also gets the agent browser (the isolated `ws-<id>` profile, when the app and the agent allow it) and the agent's reference folders (read-only). Scope and reference-folder edits recycle the main chat along with the executions.
- [x] It can use the full orchestrator surface (tasks, notes, deck). The brief keeps it focused on its agent.
- [x] Labels: none while live, retrospective summary at archive (the existing orchestration rule).
  - Unchanged code: the messages route never titles orchestration chats, and `retireMainChat` derives the retrospective label.
- [x] Verify it stays out of Needs Review and the rail.
  - `src/lib/db/main-chats.test.ts`: not a Needs Review candidate even with an unread reply, not in `listRailSessions`, not in `listWorkspaceExecutions`. Session search is executions only.
- [x] Tests: brief contents, write guard on git versus non-git, no files created in the agent folder, connector scoping.
  - `src/lib/executor/agent-main-chat.test.ts` (brief, credentialed MCP, guard on git vs plain and Claude vs Codex, connectors, browser, reference folders, folder byte-for-byte unchanged, first-message fallback), `adapter.resolve-cwd.test.ts`, `adapter.recycle.test.ts`, `app/api/workspaces/[id]/route.test.ts`.
- [x] Recycles wait for the turn to end. (Added.) A settings change recycles live sessions so the next message respawns with the new config, but recycling closes the handle, and a main chat that edits its own agent through `update_workspace` would have cut off the turn making the edit. The same was true of an execution mid-turn when the app's main chat edited its agent's instructions (a Phase 3 regression). `recycleWhenIdle` recycles idle sessions now and running ones when the turn ends, once, however many changes land. Name and purpose recycle only the main chat, and instructions, browser and folder recycle everything.

**Done when:** an agent's main chat runs in its folder, can see and steer that agent's executions, and has left no files behind in the folder.

**Status 2026-09-22:** landed. Verified through the spawn preparation with a real folder and database. A live harness run is part of Phase 10's end-to-end pass, which also checks `git status` in the folder afterwards.

### Phase 7: Agent view UI

**Navigation state**

- [x] Replace `ActiveView = 'command' | string` (`src/types/dashboard.ts`, whose comment wrongly says "or an agent id") with a union: home, agent (`id`, optional tab), execution (`id`).
  - Helpers in `src/lib/client/active-view.ts` (build, compare, URL encode). The context adds `openExecution`, `openAgent`, `goHome` and a derived `activeSessionId`. About 40 call sites moved, found by the compiler.
- [x] URL: `?agent=<workspaceId>` with an optional `&tab=`, next to today's `?session=<id>`. Reload and browser back/forward restore the view.
  - Switching tabs within one agent replaces the history entry instead of pushing one, so Back leaves the agent rather than stepping through tabs. `session` wins if a URL carries both. Verified in the browser: agent, then execution, then Back and Forward.
- [x] `dashboard.tsx` renders the agent view for the agent state.

**Layout**

- [x] Two resizable panels with the same primitives as `PanelLayout` (react-resizable-panels): chat on the left (min 360px), tools on the right. The tools panel can collapse so the chat goes full width. Sizes persist.
- [x] In-panel responsive rules use Tailwind `@container`, not viewport breakpoints.
- [x] Header:
  - agent icon and name
  - folder path, muted
  - working and needs-you counts
  - a "Start work" button that opens the launcher seeded with this agent
  - Plus a button that collapses the tools panel. The Start work label drops to its icon in a narrow header (`@container`).

**Chat panel**

- [x] Renders the agent's main chat with the existing harness chat components (`src/components/chat/harness-chat.tsx`), loaded from `/api/workspaces/:id/chat`. A menu offers history and "New chat".
  - `HarnessChat` takes a scope (null for the app's chat). The history menu moved out of `content-panel.tsx` into `main-chat-history-menu.tsx`, and the hooks into `use-main-chat.ts` (`use-orchestrator-chat.ts` binds them to null).
- [x] Composer placeholder: "Ask ri about its work, or what to start next". UI copy uses no em dashes and no semicolons.

**Tools panel**

- [x] A tab strip with Overview, Files, Terminal, Preview and Setup. The last-used tab persists per agent.
  - A tab stays mounted once visited, so a terminal keeps its scrollback. Inactive tabs are transparent and `inert`, not `visibility: hidden`: the terminal panel sets `visibility: visible` on its active terminal, which painted through the Overview (caught in the light screenshots).
- [x] **Overview**
  - Executions grouped with the rail's classification (`StatusView`): **Needs you** (approval and unread), **Working**, **Recent**. Rows show label, diff stats, harness and last activity. Clicking opens the execution view.
  - **Pinned:** this agent's pinned executions.
  - **Tasks:** tasks linked to this agent's executions.
  - **Preview:** running or stopped, port, open link.
  - Empty state: "No work yet" plus Start work.
  - Grouping reuses `classifySession` on the rail feed (`use-agent.ts`), so the view and the rail never disagree. Tasks come from a new `GET /api/workspaces/:id/tasks` (open tasks of active executions, `listWorkspaceExecutionTasks`).
- [x] **Files:** tree and read-only viewer on the agent's folder (Phase 5 routes). Reuse the file tree and viewer components by giving them a target (a session or a workspace).
  - The target is `FolderSource` (`src/lib/folders/source.ts`) with hooks in `use-folder.ts`. `FileTree`, `FileViewer`, `FileView`, `DiffView`, `MarkdownView`, the terminal panel and instance, and the terminal hooks and API all take it now. A session source keeps its old cache keys. A workspace source is read-only: no create, rename, delete or edit, and the empty viewer's copy says so. Status flags and Diff compare against HEAD.
- [x] **Terminal:** the terminal panel on the agent's folder (Phase 5 routes).
  - **Surprise:** it showed a blank screen, reproduced on a real GPU (Apple M4 through Metal), not just headless. xterm's WebGL renderer only measures its canvas when the terminal resizes. The execution view's bottom panel settles its size after mount, which triggered that by accident. The agent view's tab is full size from the start. Fix in `execution-terminal-instance.tsx`: attach the WebGL renderer on first activation and nudge a resize so it measures itself. Verified at 1x on the GPU in both views. (2x device-scale emulation leaves both blank with the old code too, so that is a test artifact.)
- [x] **Preview:** the existing preview pane pointed at the workspace preview.
  - Revised by the Phase 5 finding: the agent's execution previews (`GET /api/workspaces/:id/previews`). Pick one to show it in the existing preview pane, with "Restore pinned" calling `preview/restore-set`.
- [x] **Setup** replaces `WorkspaceSettingsSheet`. Sections:
  - `src/components/agents/agent-setup.tsx`. Adds Purpose and Instructions with live counters against the caps. Saving sends only the fields that changed, because instructions, the browser and the folder recycle live sessions (verified: editing purpose sends `{"purpose": ...}` alone). An untouched form follows edits made elsewhere, such as the main chat's `update_workspace`, and unsaved edits are never overwritten. The Start script is the preview command, so it lives in "Scripts and preview". The sheet is deleted, and every opener (rail gear, status and history views, Needs Review, row menus, the execution preview pane) opens this tab.
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

- [x] Messages with a `sender_session_id` show who sent them ("From ri", "From orchestrator"), linking to the sending chat.
  - `src/components/chat/sender-chip.tsx`. The agent chip opens the agent view, the orchestrator chip goes Home, and an execution chip opens that execution. A deleted sender reads "From a chat that was deleted". Verified with seeded events.

**Trial preference**

- [x] `src/lib/client/agent-view-mode.ts`, mirroring `entity-view-mode.ts`. Settings > General gets "Clicking an agent" with two options: "Opens the agent view (trial)" and "Folds its list". The default is the agent view.
  - Under a new "Agents" heading. Verified that fold mode folds and leaves the view closed.

**Done when:** every tab works on a git agent and on a non-git agent. Screenshots in light and dark are attached to the commit or recorded here.

**Status 2026-09-22:** landed. Every tab exercised on dev (port 42241) against a git agent (`demo-app`, with three executions, a pinned one, an unread one, a linked task and a running preview) and a plain folder (`field-notes`). Screenshots in light and dark for every tab are in `personal/agents-view-screenshots/` (gitignored, not in the repo). Found and fixed along the way:
- The PR routes (`/api/sessions/:id/pr`, `/prs`) returned 500 for a repo with no GitHub remote. They now answer "no PR", as their contracts promise for missing gh.
- The Connectors section said scopes only reach executions. Its copy now says the main chat too.
- An intermittent React hydration warning naming a Radix popover id showed up twice in scripted runs and never in nine direct loads. Left for a follow-up with that evidence.

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
- [x] `docs/orchestrator-harness.md`: new actions, caller identity, provenance, the agent main chat.
  - Also fixed two stale names there (`ensureAgentSession`, `create_schedule`).
- [x] CLAUDE.md: the glossary line (Phase 2), the migration note (Phase 0), and a line in the Orchestrator section about agent main chats.
  - The "agent in the UI" half of the glossary lands with Phase 8's copy sweep.
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
