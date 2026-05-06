# Workspaces & Execution Sessions: Implementation Spec

Self-contained spec for building the workspace primitive, the execution-session schema additions, and the left-nav UI that surfaces them. A fresh Claude Code session can implement this without reading the conversation that produced it.

**Foundation docs (read first):**

- `docs/chat-sessions.md` — chat data model. `chat_sessions`, `chat_events`, `chat_attachments`, the three chat types (orchestration / content / execution), the agentex adapter pattern. This spec assumes that doc as baseline and extends it.
- `CLAUDE.md` — project conventions (queries layer, no raw SQL in routes, types derived from Drizzle, paths via `src/lib/config/paths.ts`).

## Library dependencies

Three published packages do the heavy lifting. Install and use directly — no local shims.

- **`@agentex/workspace`** — git worktree creation, structured diff, checkpoints, `fromSource` config application, run-script lifecycle. Replaces any temptation to shell out to `git` from our code. Use `workspace.create({ kind: 'git', ... })` and the returned handle (`ws.git.shortstat`, `ws.git.commit`, `ws.git.push`, etc.) for every git operation in this feature.
- **`@agentex/github`** — typed `gh` CLI wrapper. Top-level `checkInstalled` / `checkAuthenticated` for the workspace settings sheet; `github.repo(path).createPR(...)` etc. for PR operations when those land.
- **`@agentex/agent`** — already a dep at `^0.0.7`. This is what the chat-sessions / execution layer uses to spawn Claude Code (and other harnesses) and stream stdio into `chat_events`. The "agentic" pattern in the tool-vs-agentic section dispatches into the per-session agent via this package.

Keep the imports at call sites; don't wrap them. Wrappers added "for testability" or "for swap-out" are net-negative — both libraries already expose the seams we'd want.

---

## Goal

Ship a left-nav workspace tree, persistent workspace entities, and execution-session schema additions so the user can:

1. Create a workspace tied to a folder on disk (optionally associated with an Area).
2. See a "Needs review" surface at the top of the nav listing sessions where the agent has produced output the user hasn't read.
3. See sessions grouped by workspace, sorted by last activity, with diff stats and a "needs review" indicator inline.
4. Drag-and-drop to reorder workspaces.
5. Collapse a workspace; the header still surfaces aggregated child statuses (e.g. a "1 review" badge).
6. Archive a workspace or a session. Optionally re-open archived later.
7. For git workspaces: each session runs in its own git worktree off a configurable base branch, so unlimited concurrent sessions within one workspace don't step on each other.

This spec is **infrastructure + UI for the list**. Wiring agentex to spawn real Claude Code sessions and stream stdio into `chat_events` is covered by `docs/chat-sessions.md` and is a follow-on task — it can begin in parallel once the schema lands.

## Non-goals (v1)

Skip these. They have their own tickets after v1 dogfooding:

- **UI for editing run scripts and `fromSource` config.** The library reads `agentex.workspace.json` from the source repo and applies it; in v1 we just surface the loaded config read-only (see "Code workspaces" section). Editing happens in the user's editor, file gets committed.
- **A "Run dev server" button in the session view.** The library exposes `ws.runScript("run")` and allocates ports (`AGENTEX_PORT`); in v1 the user starts dev servers from a terminal in the worktree. Add the button when we feel the pain.
- Custom prompt preferences per workspace action button
- Multi-device worktree replication (worktrees stay local to the machine that created them)
- Externally-spawned session import (the file-sync path from `chat-sessions.md`); follow-on
- Cron / scheduled / queued execution sessions
- Conflict UI when two sessions touch the same files (worktrees prevent the immediate stomp; merge conflicts on land are user-handled)

---

## Mental model

**Workspace = the place.** A folder on disk, optionally associated with an Area. The unit the user organizes around in the left nav. Many workspaces per area is fine (e.g. "bounce-app" and "bounce-marketing" under area "Bounce").

**Agent = the persona.** Reusable definition: name, role, harness, model, system prompt. One agent definition can be invoked across many workspaces. (Existing per `chat-sessions.md`; this spec drops `cwd` from `agents.config` for executors — cwd lives on the workspace now.)

**Chat session = the work.** A row in `chat_sessions` per `chat-sessions.md`. For executions, the session points at a workspace and (for git workspaces) at its own worktree.

**Worktree = the safety net.** For each execution session in a git workspace, we create a `git worktree` off the workspace's `base_branch`. This is what makes "unlimited concurrent sessions in one workspace" actually safe. Non-git workspaces share the cwd; user accepts the lack of isolation.

---

## Code workspaces: dependencies and run scripts

Code worktrees are isolated by design — `node_modules`, `.env.local`, `storage/`, build caches, etc. don't come along automatically. Every fresh worktree is essentially a `git clone` minus the untracked files. Without a story for this, the user has to babysit `pnpm install`, copy env files, and hope dev-server ports don't collide.

**The library handles this.** `@agentex/workspace` reads `agentex.workspace.json` from the source repo and applies a declarative `fromSource` block — `link` (symlink files/dirs from source into the worktree) and `copy` (one-shot copy) — *before* the `setup` script runs. Then `setup` (e.g. `pnpm install`) runs once per worktree, and any number of named scripts are exposed via `ws.runScript(name)` for when we want to surface them.

Example single-service `agentex.workspace.json` checked into a code repo:

```json
{
  "fromSource": {
    "link": [
      "apps/web/.env.local",
      "apps/imagen/.env.local",
      "storage"
    ],
    "copy": [".vercel/project.json"]
  },
  "scripts": {
    "setup": "pnpm install",
    "run": "pnpm run dev --port $AGENTEX_PORT"
  }
}
```

**Script names are arbitrary.** `setup`, `run`, and `archive` are conventional (recognized by `workspace.create` and `workspace.archive` for default lifecycle hooks) but consumers can declare `web`, `api`, `worker`, `test:watch`, anything. For multi-service repos (turborepo, nx, pnpm workspaces) this is the right shape — each service is its own script with its own process group. Example monorepo config:

```json
{
  "scripts": {
    "setup": "pnpm install",
    "web":   "pnpm dev:web --port 3000",
    "api":   "pnpm dev:api --port 3001",
    "worker": "pnpm dev:worker"
  }
}
```

Our v1 doesn't surface these in UI (see below), but the library supports them when v1.5 lands.

### What our app does in v1

**Editing the file.** We don't ship a UI for editing `agentex.workspace.json`. Users open it in their editor and check it in. Conductor builds a UI for this; we don't yet — the file is short, infrequently changed, and committing it gets the team-shared behavior for free.

**Surfacing the config.** The workspace settings sheet has a "Workspace config" section that:
- Shows whether `agentex.workspace.json` was found in the source repo, and renders its parsed contents read-only.
- If missing, shows a "Generate template" button that writes a minimal version into the source repo (`fromSource: {}`, `scripts: { setup: "", run: "" }`) for the user to fill in.

**Applying on session create.** When an execution session spawns in a git workspace, the library reads the config and applies `fromSource` before running `setup`. This is automatic via `workspace.create`; we don't reimplement it.

**Running dev servers.** v1: user runs the dev server in a terminal of their choice (`cd <worktree>` then their command). The session row shows the worktree path so they can copy it. The library's `AGENTEX_PORT` env var is set when we call `ws.runScript`; if the user wants the auto-port behavior, they can call `ws.runScript("run")` directly via the orchestrator (we expose the action — see API + queries below) or wait for the v1.5 Run button.

**Running dev servers (v1.5).** Add a "Run scripts" panel in the session view that lists every script declared in `agentex.workspace.json` (excluding `setup`/`archive` lifecycle hooks). Each script gets its own start/stop control, output stream, and allocated port — backed by separate `ws.runScript(name)` calls and independent RunHandles. Single-service repos see one row; monorepos see one per service. Natural follow-on after the diff viewer; not blocking v1.

### What our app does NOT do

- Per-machine overrides of run scripts. The library supports a workspace-side `agentex.workspace.json` override but we don't expose it in UI; users edit the source-repo file directly.
- Edit-config dialog. v2 maybe; not a v1 differentiator.
- **Monorepo subset selection (`sparseInclude`).** v1 always uses the full source dir. If we add subset selection later, the library's `ws.fromSourceWarnings.skippedOutsideSparse` tells us which `fromSource` entries were skipped because their destination falls outside the sparse checkout — surface as an info banner. Out of scope until users feel the pain.

---

## Tool actions vs. agentic actions

When the user clicks a button on a session (Commit, Push, Run dev server, Ship it, Review, etc.), there are two questions stacked:

1. **Where does the input come from?** User-typed, code-generated, or agent-generated.
2. **Where does the execution happen?** A deterministic library call directly, or a prompt dispatched into the per-session agent that calls the library indirectly.

The library (`@agentex/workspace`) doesn't change either way — every operation is a deterministic primitive. The choice happens at the button layer. Three patterns, picked per action.

**Initial guidance, not a strict surface.** Anything the library can do, the agent can also do via its own bash/git tools. We're not policing the boundary — we're just picking sensible defaults so v1 doesn't accidentally route every action through the agent (slow, token-burning) or through deterministic tools only (loses the intelligence that's the whole point of having an agent in there). Move actions between patterns freely as we learn what feels good.

### Pattern 1: Tool (button → library)

Direct, synchronous, deterministic. For actions where the user already provided the intent and there's no judgment to make.

### Pattern 2: Pre-generate + tool (button → agent generates input → user confirms → library)

For actions where the *primitive* is mechanical but the *input* benefits from intelligence — and the user wants to review before commit. One short generation call, no tool-loop, then deterministic execution.

### Pattern 3: Agentic (button → dispatch prompt to per-session agent → agent calls library)

For actions where the work involves judgment over multiple valid paths, or where failure recovery needs intelligence. The dispatch goes to the **per-session agent** (the executor with the worktree and recent context), not the orchestrator — same chat thread the user is already in. They see "User: [Ship it] → Agent: I'll commit and push…" continue naturally.

### Escalation pattern (the safety net)

Every Pattern 1 / Pattern 2 action can fail. When it does, surface the error inline plus an **"Ask agent to resolve"** affordance that dispatches the failure into the per-session agent. This is the recovery seam: tools are tried first because they're instant when they work; the agent catches the messy cases.

The library's typed errors (`MergeConflictError`, `DirtyWorktreeError`, `BranchNotFoundError`, etc.) drive which escalation copy to show.

### Initial bucketing

| Action | Pattern | Notes |
|---|---|---|
| Snapshot / restore checkpoint | Tool | Mechanical, fast, frequent |
| Archive workspace / session | Tool | User confirmed |
| Run dev server (v1.5) | Tool | `ws.runScript` |
| Mark reviewed | Tool | Pure DB update |
| Diff stats / status indicator | Tool | UI rendering |
| List PRs / issues | Tool | Read-only |
| Merge PR | Tool | User picked method |
| Commit | Pre-generate + tool | Agent drafts message; user edits in modal; library commits |
| Create PR | Pre-generate + tool | Title and body suggested; user edits; library creates |
| Push | Tool, escalate on failure | Fast when it works; agent on rejected push |
| Pull base | Tool, escalate on conflict | Library throws `MergeConflictError` → escalate |
| Branch rename | Tool, escalate on protection-rejection | Mechanical first; agent if blocked |
| Comment on PR | Either | User types → tool; "Ask agent to comment" → agentic |
| Review the diff | Agentic | The intelligence *is* the value |
| "Ship it" / "Land this" | Agentic | One-click delegation: commit + push + PR |
| Fix lint / failing tests | Agentic | Multi-step recovery work |
| Resolve conflicts | Agentic | Per-file judgment |

This is the v1 starting point. As we dogfood, expect a few cells to migrate (e.g. "Commit" might collapse to plain Tool if users always type their own messages, or expand to Agentic if "Ship it" eats it).

---

## Schema changes

All Drizzle. Add to `src/lib/db/schema.ts`. After any change, regenerate types in `src/db/types.ts` per project convention (no hand-duplicated types).

### New table: `workspaces`

```ts
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),                          // uuidv7
  name: text('name').notNull(),                         // user-facing label
  slug: text('slug').notNull().unique(),                // for branch names, file paths
  emoji: text('emoji'),                                 // optional row icon
  cwd: text('cwd').notNull(),                           // absolute path on disk
  is_git: integer('is_git', { mode: 'boolean' }).notNull().default(false),
  base_branch: text('base_branch'),                     // e.g. "main"; null for non-git
  remote_name: text('remote_name').default('origin'),   // null for non-git
  worktree_root: text('worktree_root'),                 // where worktrees live; null for non-git
  area_id: text('area_id').references(() => areas.id, { onDelete: 'set null' }),
  position: integer('position').notNull().default(0),   // drag-and-drop order
  collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  archived_at: text('archived_at'),
}, (table) => [
  index('workspaces_status_position_idx').on(table.status, table.position),
  index('workspaces_area_id_idx').on(table.area_id),
]);
```

**`is_git`**: detected at creation time (`stat <cwd>/.git`). Stored so we don't re-stat on every read. If the user later inits git in a non-git workspace, they re-detect via a "Refresh" action.

**`worktree_root`**: defaults to `<app-root>/worktrees/<slug>/` (use `getAppRoot()` from `src/lib/config/paths.ts`). User can override at workspace creation. Null for non-git.

**`base_branch`**: detected at creation by resolving `git symbolic-ref refs/remotes/<remote>/HEAD` (falls back to `main` then `master`). User-editable.

### Chat schema (from `docs/chat-sessions.md`)

The chat-sessions schema doesn't exist in this branch yet. Land it as part of this slice — but **only wire the execution write path** for now. Orchestration and content chat use the same tables and adapter; their write paths are deferred.

Concretely: `agents`, `chat_sessions`, `chat_events`, `chat_attachments` all get created. The agentex executor pipe writes to `chat_events`; nothing else writes to chat_events in this slice. Notifications table is deferred (separate surface).

#### `agents`

```ts
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),                          // uuidv7
  user_id: text('user_id').notNull(),
  kind: text('kind', { enum: ['orchestrator', 'executor'] }).notNull(),
  name: text('name').notNull(),
  role: text('role'),
  harness: text('harness').notNull(),                   // 'in_app' | 'claude_code' | 'codex' | ...
  config: text('config', { mode: 'json' }).notNull().default(sql`'{}'`),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  archived_at: text('archived_at'),
});
```

**Deviation from the chat-sessions doc:** for executors, `cwd` is *not* on `agents.config`. cwd lives on the workspace; sessions point at a workspace and inherit the cwd from there. The chat-sessions doc predates the workspace primitive — this spec supersedes it on that one field.

#### `chat_sessions`

```ts
export const chat_sessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),                          // uuidv7
  user_id: text('user_id').notNull(),
  agent_id: text('agent_id').notNull().references(() => agents.id),
  type: text('type', { enum: ['orchestration', 'content', 'execution'] }).notNull(),
  surface_kind: text('surface_kind'),                   // 'main' | 'task' | 'note' | null
  surface_ref: text('surface_ref'),                     // task_id / note_id / null
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  label: text('label'),
  refs: text('refs', { mode: 'json' }).notNull().default(sql`'{}'`),

  // Execution-specific fields (this spec):
  workspace_id: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  worktree_path: text('worktree_path'),                 // absolute path; null for non-git workspaces
  branch_name: text('branch_name'),                     // null for non-git
  base_sha: text('base_sha'),                           // null for non-git

  // Review-state derivation:
  last_outcome_event_at: text('last_outcome_event_at'),
  last_viewed_at: text('last_viewed_at'),

  // CLI-backed session tracking (executors only; null for in-app types):
  external_session_id: text('external_session_id'),
  external_transcript_path: text('external_transcript_path'),
  external_sync_offset: integer('external_sync_offset'),
  external_sync_last_event_id: text('external_sync_last_event_id'),

  started_at: text('started_at').notNull().default(sql`(datetime('now'))`),
  archived_at: text('archived_at'),
}, (table) => [
  uniqueIndex('chat_sessions_external_session_id_uq')
    .on(table.external_session_id)
    .where(sql`${table.external_session_id} IS NOT NULL`),
  index('chat_sessions_workspace_status_idx')
    .on(table.workspace_id, table.status, table.last_outcome_event_at),
  index('chat_sessions_agent_status_idx').on(table.agent_id, table.status),
]);
```

#### `chat_events`

```ts
export const chat_events = sqliteTable('chat_events', {
  id: text('id').primaryKey(),                          // uuidv7
  session_id: text('session_id').notNull().references(() => chat_sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),                         // 'user' | 'assistant' | 'system' | 'tool'
  source: text('source').notNull(),                     // 'user' | 'agent' | 'thinking' | 'tool_call' | 'tool_result' | 'system' | 'result' | 'rate_limit' | 'error' | 'recap' | 'cron' | 'unknown'
  content: text('content'),
  tool_name: text('tool_name'),
  tool_input: text('tool_input', { mode: 'json' }),
  tool_is_error: integer('tool_is_error', { mode: 'boolean' }),
  tool_exit_code: integer('tool_exit_code'),
  raw: text('raw', { mode: 'json' }),
  external_event_id: text('external_event_id'),
  external_message_id: text('external_message_id'),
  external_turn_id: text('external_turn_id'),
  external_tool_call_id: text('external_tool_call_id'),
  external_parent_tool_call_id: text('external_parent_tool_call_id'),
  source_part_index: integer('source_part_index').notNull().default(0),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('chat_events_external_uq')
    .on(table.session_id, sql`COALESCE(${table.external_turn_id}, '')`, table.external_event_id, table.source_part_index)
    .where(sql`${table.external_event_id} IS NOT NULL`),
  index('chat_events_session_created_idx').on(table.session_id, table.created_at),
]);
```

#### `chat_attachments`

```ts
export const chat_attachments = sqliteTable('chat_attachments', {
  id: text('id').primaryKey(),
  event_id: text('event_id').notNull().references(() => chat_events.id, { onDelete: 'cascade' }),
  session_id: text('session_id').notNull().references(() => chat_sessions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                         // 'image' | 'audio' | 'video' | 'file'
  mime_type: text('mime_type'),
  size_bytes: integer('size_bytes'),
  storage_kind: text('storage_kind').notNull(),         // 'local_file' | 'blob' | 'external_url'
  file_path: text('file_path'),
  blob: blob('blob'),
  url: text('url'),
  content_hash: text('content_hash'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('chat_attachments_session_idx').on(table.session_id),
  index('chat_attachments_hash_idx').on(table.content_hash),
]);
```

The full semantics (source enum exhaustiveness, ID model, write paths, adapter layer) are in `docs/chat-sessions.md` — don't re-derive them here. The four tables above are the schema we need to land in this slice; the adapter that writes to `chat_events` from agentex stdio is the only writer wired up now.

### Why no `review_state` column

We considered an explicit state machine (`needs_review` / `reviewed` / etc.). Rejected for v1. Two timestamps suffice and don't lie:

- `last_outcome_event_at`: timestamp of the most recent **agent outcome** event written to `chat_events` for this session. "Outcome" = `source IN ('agent', 'result')` — i.e. user-visible assistant text or run completion. Set on every write of those rows. Tool calls / tool results / thinking / system events do NOT bump it.
- `last_viewed_at`: set whenever the user opens the session in the UI. PATCH to `/api/chat-sessions/:id/view`.

**Derivation:**

- `needs_review` = `last_outcome_event_at > COALESCE(last_viewed_at, '1970-01-01')` AND session is not currently streaming (no live agentex pipe).
- "Time since agent finished" badge = `now() - last_outcome_event_at`, displayed when needs_review.
- Open the session → `last_viewed_at = now()` → row leaves the Needs Review surface.
- New agent output later → `last_outcome_event_at` advances → row re-enters Needs Review.
- Explicit Archive → `archived_at = now()` and `status = 'archived'`. Removed from active list regardless.

This is the entire review model. No "mark reviewed" button needed in v1 — opening the session is the read receipt. (Add a "mark all reviewed" bulk action only if the inbox actually gets noisy in real use.)

---

## Worktree lifecycle

### Creation

When an execution session is dispatched in a **git** workspace:

1. Generate the session-label slug: `slugify(session.label, { lower: true, strict: true })`; if label is empty, use `session-<short-id>` (first 8 chars of the session uuid).
2. Generate a branch name: `<workspace.slug>/<session-label-slug>`. On `BranchExistsError` from the library, append `-2`, `-3`, etc.
3. Compute worktree path: `<workspace.worktree_root>/<session-id-short>/` (first 8 chars of session id, e.g. `019ddfab`). Path uses the id (not the slug) so two sessions with the same label don't collide on disk.
4. Call `workspace.create({ kind: "git", source: workspace.cwd, baseBranch: workspace.base_branch, path: worktreePath, branch: branchName })`. Library does `git worktree add`, captures `baseSha` atomically, applies `fromSource` from `agentex.workspace.json`, runs `setup` script.
5. Persist `chat_sessions.worktree_path = ws.path`, `branch_name = ws.git.branch`, `base_sha = ws.git.baseSha`.
6. Spawn agentex with `cwd = ws.path`.

For **non-git** workspaces, no worktree. Sessions share `workspace.cwd` directly:

- `worktree_path = null`, `branch_name = null`, `base_sha = null` on the chat_sessions row.
- Spawn agentex with `cwd = workspace.cwd`.
- Concurrency is unprotected — two sessions in the same non-git workspace can clobber each other's edits. Acceptable v1 trade for non-code workspaces (notes folder, marketing dir, etc.); user gets isolation by switching to git or by not running parallel sessions.
- Session row UI hides diff stats for these (no `worktree_path`).

Skipping the bare-workspace wrap means we don't run `fromSource` or `setup` for non-git workspaces — there's nothing to set up. If a future feature needs a per-session scratch dir for non-git workspaces (agent drafts, generated artifacts), it can carve out a subdir under `worktree_root` without making it a workspace primitive.

### Diff stats

Compute on demand for the row indicator. Don't store. Open the workspace via `workspace.open({ path: worktree_path, source: workspace.cwd })` and call `ws.git.shortstat({ vs: "base" })` — returns `{ files, additions, deletions }` directly. The library uses the stored `baseSha` (passed back via the handle) so diffs stay anchored to the worktree's creation point even if `main` advances.

Cache in the React Query layer for ~5 seconds to avoid spamming on every render. If the worktree is missing on disk (multi-device or user deleted), `workspace.open` throws `WorkspaceNotFoundError`; show a small "missing" indicator and disable execution actions for that row.

Non-git workspaces have no diff stats — render nothing.

### Archive

When a session is archived:

1. For git workspaces: open the workspace handle (`workspace.open(...)`) and check `ws.git.status()` for dirty/unpushed state. If anything is uncommitted or unpushed, refuse archive and show a confirm dialog ("This worktree has uncommitted changes. Archive anyway? Changes will be lost.").
2. If user confirms (or no dirty state): call `ws.archive()` (runs the `archive` script if declared, then `git worktree remove --force`).
3. Set `chat_sessions.archived_at = now()`, `status = 'archived'`.

For non-git workspaces, archive is just the DB update; nothing on disk to clean.

### Workspace deletion / archive

Archiving a workspace doesn't archive its sessions automatically. Sessions stay queryable by id; the workspace row sets `status='archived'`, `archived_at`. Active worktrees are not pruned (user might still want to look at them).

Hard delete is not exposed in v1. If we need it later, add a confirm flow that walks every session and runs the worktree-archive flow above.

---

## Left-nav UI

Lives in `src/components/dashboard/power-rail.tsx`. The rail's only content is the workspace tree below — no separate "Command" / orchestrator entry at the top. The orchestrator is the always-on main chat surface, not a tab you switch to from a list, so giving it a row here would be the wrong mental model. The orchestrator UI lands in a later phase.

### Layout

```
┌─────────────────────────────┐
│ NEEDS REVIEW         (3)    │  ← thin section, shown only if count > 0
│ ▸ Refactor auth · bounce · 2h│
│ ▸ Fix infinite loop · atm · 5h│
│ ▸ Seo geo plan · bounce · 1d│
├─────────────────────────────┤
│ WORKSPACES        [filter +]│  ← header with new-workspace button
│ 📦 ai-task-manager  ● 1 rev │  ← workspace row, collapsible
│   ⎇ Cleaner tabbing  +28 -12│
│   ⎇ Markdown editor cleanup │
│   ⎇ Notes vs knowledge    4d│
│ 📦 bounce            working│  ← workspace with active session
│   ⎇ Seo geo plan  +795 -22 │
│   ⎇ Stack questions      1w│
│ 📦 1648 marketing  ▸ ● 2 rev│  ← collapsed; aggregate badge in header
└─────────────────────────────┘
```

### Components

Suggested decomposition under `src/components/workspaces/`:

- `workspace-nav.tsx` — top-level container; renders Needs Review + workspace list. Replaces or wraps `power-rail.tsx`'s lower section.
- `needs-review-section.tsx` — flat list of sessions across workspaces where `needs_review` derives true.
- `workspace-row.tsx` — one workspace; handles collapse, drag, header badges.
- `session-row.tsx` — one session within a workspace; shows label, diff stats, "needs review" dot, last activity timestamp.
- `workspace-create-modal.tsx` — folder picker + name + area dropdown + base branch (auto-detected, editable for git workspaces).
- `workspace-settings-sheet.tsx` — edit name, area, base branch, worktree_root; archive action. Also a "Git" section showing detected `gh` version, authenticated user, base branch, remote — with non-blocking install/auth banners when missing. And a "Workspace config" section that renders the loaded `agentex.workspace.json` read-only, with a "Generate template" button when missing.

### Drag-and-drop

Use `@dnd-kit/sortable` (already a dep — `^10.0.0`, with `@dnd-kit/core` and `@dnd-kit/utilities`). On drop, PATCH `/api/workspaces/reorder` with the new ordered list of ids; backend assigns new `position` values (simple integer reassignment is fine for tens of workspaces).

Drag is on workspaces only. Sessions within a workspace sort by `last_outcome_event_at DESC` always; user doesn't reorder them.

### Status indicators per row

**Session row right-side:**

- If session is currently streaming (live agentex pipe): show animated pulse dot + "working".
- Else if `needs_review`: small unfilled dot + relative time since `last_outcome_event_at` (e.g. "2h").
- Else: relative time since `last_outcome_event_at` (or `created_at` if no outcome yet), no dot.

**Diff stats** (git workspaces only): `+N -M` next to label when `worktree_path` exists. Pull from React Query cache; refresh on session view open.

**Workspace header (collapsed):**

Aggregate child statuses into a single badge:
- Any child streaming → "● working"
- Else any child needs_review → "● N rev" (count of needs_review children)
- Else nothing

**Workspace header (expanded):**

Same badge, smaller / less prominent (the children are visible).

### Empty states

- No workspaces: "No workspaces yet. Add one to get started." with `+ New workspace` CTA.
- Workspace with no sessions: "No sessions yet" subtle italic under the header, no children rendered.
- Needs Review with 0 items: hide the entire section (don't render an empty header).

---

## API + queries

Per `CLAUDE.md`, API routes call into `src/lib/db/queries.ts`. No raw SQL in routes. Types derived from Drizzle.

Queries to add in `src/lib/db/queries.ts`:

- `getWorkspaces({ status })` — returns workspaces + child session counts and aggregated status flags (streaming?, needs_review_count). Single SQL query joining `workspaces` + `chat_sessions` is preferable to N+1.
- `getWorkspace(id)` — single workspace.
- `createWorkspace(input)` — folder validation, git detection, base-branch detection, slug uniqueness, position = max(position) + 1.
- `updateWorkspace(id, input)` — name, area_id, emoji, base_branch, worktree_root, collapsed.
- `archiveWorkspace(id)` — sets archived_at, status='archived'. Does not touch sessions or worktrees.
- `reorderWorkspaces(orderedIds)` — bulk position update in a transaction.
- `getSessionsForWorkspace(workspaceId)` — sessions where `workspace_id = ? AND status = 'active'`, sorted by `last_outcome_event_at DESC`.
- `getNeedsReviewSessions()` — sessions where `last_outcome_event_at > COALESCE(last_viewed_at, '1970-01-01') AND status = 'active'`. The streaming check is runtime-only; the query returns candidates and the client filters out any session id present in the streaming map. The streaming map lives in `src/contexts/dashboard-context.tsx` as `Set<sessionId>`, populated/cleaned by the agentex stdio pipe (added when a `startSession`/`sendMessage` call returns, removed on the `result` event or stream close). Same map drives the workspace-header "● working" badge.
- `markSessionViewed(sessionId)` — sets `last_viewed_at = now()`.
- `bumpSessionOutcome(sessionId, at)` — sets `last_outcome_event_at`. Called by the chat-events writer whenever an `agent` or `result` event is inserted.

API routes to add under `src/app/api/`:

- `GET /api/workspaces` → `getWorkspaces({ status: 'active' })`
- `POST /api/workspaces` → `createWorkspace`
- `PATCH /api/workspaces/[id]` → `updateWorkspace`
- `POST /api/workspaces/[id]/archive` → `archiveWorkspace`
- `POST /api/workspaces/reorder` → `reorderWorkspaces`
- `GET /api/workspaces/[id]/sessions` → `getSessionsForWorkspace`
- `GET /api/sessions/needs-review` → `getNeedsReviewSessions`
- `POST /api/sessions/[id]/view` → `markSessionViewed`
- `GET /api/sessions/[id]/diff-stats` → runs `git diff --shortstat`; returns `{ files, additions, deletions }` or null if non-git / worktree missing.

Use `authFetch` on the client side for these (per `feedback_authfetch.md` memory).

### Orchestrator action surface

The orchestrator already exposes actions via `src/lib/orchestrator/registry.ts`. Add:

- `list_workspaces` (read)
- `create_workspace({ name, cwd, area_id?, emoji? })` — let the orchestrator agent create one when the user asks
- `archive_workspace({ id })`
- `list_workspace_sessions({ workspace_id })`

Keep these thin; they dispatch to the same `queries.ts` functions. Throw `ActionError` with stable codes per `CLAUDE.md`.

---

## Files to create / touch

**New:**

- `src/lib/db/migrations/<next>_workspaces.sql` (or via drizzle-kit `db:generate`)
- `src/components/workspaces/workspace-nav.tsx`
- `src/components/workspaces/needs-review-section.tsx`
- `src/components/workspaces/workspace-row.tsx`
- `src/components/workspaces/session-row.tsx`
- `src/components/workspaces/workspace-create-modal.tsx`
- `src/components/workspaces/workspace-settings-sheet.tsx`
- `src/lib/workspaces/index.ts` — small module that imports from `@agentex/workspace` and exposes the project-specific helpers we need: `createWorktreeForSession(workspace, session)`, `openWorktreeHandle(session)`, `archiveSessionWorktree(session)`, `detectGit(path)`, `detectBaseBranch(path, remote)`. These are call-site composition helpers, not API wrappers — they encode our naming rules (slug, path layout) and our DB persistence around library calls. Library types pass through (`Workspace`, `GitWorkspace`, `BareWorkspace`, errors).
- `src/lib/workspaces/gh.ts` — small composition module over `@agentex/github`. Top-level: `checkGhStatus()` returning `{ installed, authenticated, user }` for the settings sheet's Git section (single call, both checks). PR-creation helpers added when the Land/PR flow lands — defer in v1.
- `src/app/api/fs/browse/route.ts` — directory autocomplete endpoint for the folder picker fallback. Takes `?path=` (must be inside `os.homedir()` after realpath; reject otherwise — no path traversal). Returns directory entries only.
- `src/app/api/fs/pick-folder/route.ts` — native OS folder dialog endpoint. POST opens the dialog on the server's machine (which is the user's machine in local-first), returns `{ path }` on pick, `204` on cancel, `503` if the OS dialog tool isn't available.
- `src/lib/fs/native-picker.ts` — platform shims for the native dialog: `osascript` (macOS), `zenity` (Linux), `powershell` + WinForms (Windows). Used by the pick-folder route.
- `src/app/api/workspaces/route.ts` (and `[id]`, `reorder`, etc.)

**Modified:**

- `src/lib/db/schema.ts` — add `workspaces`, `agents`, `chat_sessions`, `chat_events`, `chat_attachments` (the chat tables don't exist in this branch yet; this slice creates them).
- `src/lib/db/queries.ts` — add the queries listed above; the agentex stdio adapter (added separately) calls `bumpSessionOutcome` on `agent`/`result` rows when it inserts them into `chat_events`.
- `src/components/dashboard/power-rail.tsx` — embed `<WorkspaceNav />` as the rail's only content. No standalone "Command" row.
- `src/contexts/dashboard-context.tsx` — add workspace selection state, active session, drag state.
- `src/lib/orchestrator/registry.ts` — register the new actions.
- `src/db/types.ts` — re-derive types after schema changes.

---

## Implementation order

Pick this up in passes; each pass is independently shippable.

1. **Schema + queries + minimal API** (no UI yet). Migration creates all five new tables (`workspaces`, `agents`, `chat_sessions`, `chat_events`, `chat_attachments`); `getWorkspaces`, `createWorkspace`, `archiveWorkspace`, `reorderWorkspaces` work via `curl`. Verify by manually inserting a workspace and a fake `chat_session` and querying. (The chat-event write path comes online with the executor wiring in step 6.)
2. **Workspace CRUD UI.** Create modal (folder picker, area dropdown, git auto-detect), settings sheet, archive flow. No session rows yet — workspaces just list as empty. Dogfood by registering the current project as the first workspace.
3. **Session rows + diff stats.** Render existing `chat_sessions` rows under their workspace. Wire the diff-stats endpoint and indicator. Sessions don't actually do anything yet (no execution wired) — but the list UI is fully rendered.
4. **Needs Review surface.** Implement the derivation, render the top section, wire `markSessionViewed` on session open.
5. **Drag-and-drop reorder + collapse persistence.** UX polish.
6. **Worktree lifecycle.** Implement `createWorktree`, `removeWorktree`, archive confirmation flow. At this point the system is ready for execution to actually run; agentex wiring (separate spec) plugs into `worktree_path`.

The first three passes ship a usable nav. Passes 4–6 add the differentiating features. Each step preserves the previous step's behavior.

---

## Edge cases & decisions

**Workspace cwd doesn't exist on disk.** Show a "missing" indicator on the workspace row. Disable session creation. Allow user to relink the path via settings sheet (point at a new directory; keep the row). Multi-device handles itself this way too.

**`gh` not installed.** Don't block workspace creation. The settings sheet's Git section calls a runtime check (eventually `github.checkInstalled()` from `@agentex/github`; pre-library, shell `which gh`) and surfaces a non-blocking banner: "`gh` not found — install via `brew install gh` to enable PR creation and PR-status badges in this workspace." Workspace still works for everything else. Re-check on settings-sheet open and after any user-triggered refresh; don't poll.

**`gh` installed but not authenticated.** Same affordance, different copy: "`gh` is installed but not signed in — run `gh auth login`." Same non-blocking pattern.

**Two workspaces with the same `cwd`.** Allowed but warned in the create modal. They'd share file changes, which the user might want (e.g. one workspace for code, one for marketing folder under the same parent dir).

**`base_branch` no longer exists on a remote.** Worktree creation fails. Surface error inline ("Base branch `origin/develop` not found. Pick another in workspace settings."). Don't silently fall back.

**Worktree creation fails (disk full, permission, etc.).** `workspace.create` throws — session creation is rolled back, no `chat_sessions` row inserted. Surface the typed error to the user (`BranchExistsError` → "branch exists, retrying with -2", `NoDefaultBranchError` → settings, etc.). Don't write a session row that points at a path that doesn't exist.

**User deletes the worktree directory manually.** On next render, `getSessionsForWorkspace` still returns the row; the diff-stats call fails (path missing). Show "missing" indicator. Allow archive (which will skip `git worktree remove` and just clean DB state).

**Concurrency on the same `chat_sessions` row.** Per `chat-sessions.md`, a per-session lock on send. No new requirement here.

**Slug collisions.** Workspace `slug` is unique. On create, derive from name; on collision, append `-2`, etc. Not user-editable in v1 (changing a slug renames branches and confuses git history).

**Deleting an Area.** `area_id` is FK with `ON DELETE SET NULL`. Workspace stays; loses its area association. Not lost.

---

## Decisions, locked

These were open questions in earlier drafts; locked now so the implementer doesn't re-litigate.

1. **Power rail width: 240–280px.** The current 200px will feel cramped once diff stats and per-session indicators land. Widen `power-rail.tsx` to 256px and ship; tune within the range during dogfood if rows still squeeze.

2. **Drag-and-drop: `@dnd-kit/sortable`** (already a dep). Use `verticalListSortingStrategy` for the workspace list with explicit drag handles on workspace rows.

3. **Folder picker: native OS dialog + typing fallback.** Primary action is a "Browse" button that triggers the OS folder dialog via the local server (`osascript` on macOS, `zenity` on Linux, `powershell` + WinForms on Windows). The server is on the user's machine, so the dialog opens in front of them — same trick Tauri/Electron use, just routed through HTTP. Returns the absolute path. The text input + `/api/fs/browse?path=` autocomplete (home-scoped) stays as the fallback for when the native picker isn't available (Linux without `zenity`, exotic platforms).

4. **Session row branch name: hidden in list, shown in detail.** Adding the branch string to every list row eats horizontal space without paying for itself for the common case (one session per branch, branch derivable from session label).

5. **Orchestrator's `last_outcome_event_at`.** Set it (cheap, future-useful for cross-context "where did we last leave off"); never read for review state. Orchestrator chat doesn't surface in Needs Review.

If anything feels under-specified during implementation, leave a TODO in code with a one-line question and post it back.

---

## Deferred: cross-machine execution

This section captures thinking, not implementation. Nothing here ships in v1. It exists so a future contributor (and future me) doesn't have to re-derive the model.

### Mental model we're building toward

One canonical place where data lives — server (Mac mini, cloud VM, doesn't matter). It runs the API + DB + a default executor. Most agent runs happen on this canonical server. Fine.

Sometimes you want to run an agent on the machine you're physically sitting at — a laptop with the app installed locally — for a faster feedback loop (see browser changes immediately, hot-reload, run tests against local services, etc.). That machine has the app installed too, but configured as a *client + local executor*: UI talks to the canonical API for everything, and a local agent runtime takes execution work that's been opted into "run here."

Phones and other peripheral devices stay pure UI clients — never executors. The asymmetry is real and deliberate: we're not building a fleet, we're building "server + maybe one helper machine I'm sitting at right now." We will never round-about route from phone → laptop → server or anything like it.

GitHub does the code-sync work for free. Server creates a worktree, pushes the branch. Laptop pulls the branch into its own local worktree, runs the agent against that. Push back when done. Same git, no special protocol.

If you can't reach the canonical server, you also can't run agents locally in any useful way (Claude API, package registries, GitHub all need internet anyway). So the offline-first arguments don't really apply — we're network-dependent regardless. That keeps the architecture simpler: server-canonical, no DB sync, no conflict resolution.

### Why we punt

Agent execution isn't wired yet. Designing for cross-machine before single-machine works is premature. Real usage will tell us:

- Is the local-feedback case important enough to justify the protocol work?
- Is "server only" enough if you can SSH into the server when you need to?
- Do users ever want fully offline mode (no canonical server reachable)?

Until those answers exist, building runtime registration / awareness / cross-device routing produces a lot of unused machinery.

### What we deliberately did NOT add today

- A `devices` table.
- `device_id` columns on `workspaces` or `chat_sessions`.
- Awareness UI ("running on Beacon", "this workspace is on the laptop").
- A runner protocol or service mode.

All of these are appropriate for a fleet-style architecture; we don't need them for "server + occasional laptop."

### What we kept open

The pieces that *would* be expensive to retrofit, we either already have or wrote to keep flexible:

- **API base URL is configurable.** `ApiClient` already accepts a `baseUrl`, and the existing pairing flow issues tokens. A laptop install can already point at a server install today — the missing pieces are UI ceremony (a "pair to remote server" flow that takes a URL), not architecture.
- **Schema fields are runtime-relative-but-currently-server-implicit.** `workspaces.cwd` and `chat_sessions.worktree_path` are absolute paths interpreted on whichever machine owns them. v1 has only one machine, so there's no ambiguity. When local execution comes, the laptop tracks its own paths separately (its own config or a small `workspace_runtime_paths` side table) — no canonical-DB schema change needed.
- **Event-write seam** — see below. The one architectural muscle memory worth doing in advance.

### The event-write seam: `EventWriter`

When we wire the agentex executor to push stream events into `chat_events` (next slice after this one), structure it around an `EventWriter` interface rather than calling `insertChatEvent` inline:

```ts
export interface EventWriter {
  write(event: CreateChatEventInput): Promise<void>;
}

// v1, server-only — the default and only implementation.
export const localEventWriter: EventWriter = {
  async write(event) { insertChatEvent(event); },
};

async function runExecutionSession(args: {
  sessionId: string;
  agent: AgentRecord;
  writer: EventWriter;       // ← parameter, not a global lookup
}) {
  const stream = await spawnAgentex(/* ... */);
  for await (const event of stream) {
    await args.writer.write({
      session_id: args.sessionId,
      ...parseStreamEvent(event),
    });
  }
}
```

Cost is one parameter and a five-line interface. Behavior is identical to writing `insertChatEvent` inline.

The day local execution becomes real, the laptop runs the same `runExecutionSession` with a different writer:

```ts
export class HttpEventWriter implements EventWriter {
  async write(event) { await api.post('/chat-events', event); }
}
```

Plus a new `/api/chat-events` ingest route on the canonical server. That's it. The executor's logic — agentex stream consumption, event parsing, error handling, rollover — doesn't move.

This is the only architectural decision worth making in advance. Everything else is purely additive when the time comes.

### Future additions to expect (sketch, not commitment)

When we actually build local execution, expect roughly:

- `chat_sessions.runtime` (text, nullable) — which machine ran this session. `null`/`'server'` for the default, some identifier for remote runtimes.
- `chat_sessions.cached_diff_files`, `cached_diff_additions`, `cached_diff_deletions` — denormalized so the canonical UI can show diff stats for sessions that ran on a different machine without being able to read those files itself. The runtime that owns the worktree updates these periodically while the session is live.
- `apiBaseUrl` and `mode` flags in `config.json` — `mode: 'server' | 'client'` decides whether this install serves data or is a thin client of another install.
- `POST /api/chat-events` — ingest route for `HttpEventWriter`.
- A `runtime` registration handshake on first connect — probably reusing the existing pairing flow with a "this device can execute" capability flag.
- A small `workspace_runtime_paths(workspace_id, runtime, cwd, worktree_root)` side table if we want path overlays queryable from the canonical DB; otherwise the client tracks its own paths in local config.

None of these change today's data model or code. They're all additive.

---

## TL;DR for the implementer

Land four chat tables (`agents`, `chat_sessions`, `chat_events`, `chat_attachments`) per `docs/chat-sessions.md`, plus a new `workspaces` table. Wire only the **execution** write path (agentex stdio → `chat_events`); orchestration and content chat are deferred. For git workspaces, every execution session creates its own `git worktree` off the workspace's base branch via `@agentex/workspace`. For non-git workspaces, sessions share `workspace.cwd` directly — no worktree, no `fromSource`, no isolation. Build a left-nav tree with a Needs Review surface, drag-and-drop reorder (`@dnd-kit/sortable`), and collapsible workspace sections. "Needs review" is derived from `last_outcome_event_at` vs `last_viewed_at` — no state column. Diff stats are computed on demand via `ws.git.shortstat`. Skip in-app config editing, preview URLs, multi-device replication, and the v1.5 Run-scripts panel.
