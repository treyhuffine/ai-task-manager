# Workspaces & Execution Sessions: Implementation Spec

Self-contained spec for building the workspace primitive, the execution-session schema additions, and the left-nav UI that surfaces them. A fresh Claude Code session can implement this without reading the conversation that produced it.

**Foundation docs (read first):**

- `docs/chat-sessions.md` — chat data model. `chat_sessions`, `chat_events`, `chat_attachments`, the three chat types (orchestration / content / execution), the agentex adapter pattern. This spec assumes that doc as baseline and extends it.
- `CLAUDE.md` — project conventions (queries layer, no raw SQL in routes, types derived from Drizzle, paths via `src/lib/config/paths.ts`).

## Library dependency strategy

Worktree mechanics, structured diff, and run-script lifecycle eventually move to the `@agentex/workspace` library (separate repo, draft PRD). Until that ships, write a thin local module at `src/lib/workspaces/git.ts` whose API matches the agex shape. Migration is then a one-line import swap. Keeping our wrapper aligned to agex is also useful integration feedback for that PRD.

The same applies to GitHub operations — see `gh` integration below.

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

### New table: `agents` (if not already created by chat-sessions work)

Per `docs/chat-sessions.md` §Agents. **Important deviation from that doc:** drop `cwd` from `config` for executors. cwd now lives on the workspace; sessions point at workspaces.

If the chat-sessions schema already shipped with `cwd` in `agents.config`, treat that as a no-op JSON field for now and migrate it out when convenient.

### New table: `chat_sessions`

Per `docs/chat-sessions.md` §Sessions, **plus** these execution fields:

```ts
// Add to the existing chat_sessions definition:
workspace_id: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
worktree_path: text('worktree_path'),    // absolute path; null when not using a worktree
branch_name: text('branch_name'),        // git branch the session is on; null for non-git
base_sha: text('base_sha'),              // SHA the worktree was created from; null for non-git
last_outcome_event_at: text('last_outcome_event_at'),  // for "needs review" derivation
last_viewed_at: text('last_viewed_at'),  // last time user opened this session
```

Index needed for the "Needs review" query and per-workspace listing:

```ts
index('chat_sessions_workspace_status_idx').on(table.workspace_id, table.status, table.last_outcome_event_at)
```

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

When an execution session is dispatched in a git workspace:

1. Generate a branch name. Use the session's slugified label, prefixed with workspace slug for namespacing: `<workspace.slug>/<session-label-slug>`. On `BranchExistsError` from the library, append `-2`, `-3`, etc.
2. Compute worktree path: `<workspace.worktree_root>/<session-id-short>/` (first 8 chars of session id, e.g. `019ddfab`).
3. Call `workspace.create({ kind: "git", source: workspace.cwd, baseBranch: workspace.base_branch, path: worktreePath, branch: branchName })`. Library does `git worktree add`, captures `baseSha` atomically, applies `fromSource` from `agentex.workspace.json`, runs `setup` script.
4. Persist `chat_sessions.worktree_path`, `branch_name`, `base_sha = ws.git.baseSha`.
5. Spawn agentex with `cwd = ws.path`.

For non-git workspaces, call `workspace.create({ kind: "bare", path: worktreePath, source: workspace.cwd })`. The library wraps cleanly, gives us `.context/` and `fromSource` support for free (becomes useful as soon as we have any "agent writes draft → user reviews" flow per `docs/chat-sessions.md`), and keeps the session-creation code path identical between git and bare. The marginal cost is one extra directory per session under `worktree_root` — negligible.

### Diff stats

Compute on demand for the row indicator. Don't store. Pre-library: shell `git -C <worktree_path> diff --shortstat <base_sha>..HEAD` and parse. Post-library: `ws.git.shortstat({ vs: "base" })` returns `{ files, additions, deletions }` directly — same shape, no parsing.

Cache in the React Query layer for ~5 seconds to avoid spamming on every render. If the worktree is missing on disk (multi-device or user deleted), show a small "missing" indicator and disable execution actions for that row.

### Archive

When a session is archived:

1. Check for uncommitted/unpushed work in the worktree:
   - `git -C <worktree_path> status --porcelain` — if non-empty, refuse archive and show a confirm dialog ("This worktree has uncommitted changes. Archive anyway? Changes will be lost.").
   - `git -C <worktree_path> log @{u}.. --oneline` — if non-empty (unpushed commits), surface in the same dialog.
2. If user confirms (or no dirty state): `git -C <workspace.cwd> worktree remove --force <worktree_path>`.
3. Set `chat_sessions.archived_at = now()`, `status = 'archived'`.

For non-git workspaces, archive is just the DB update; nothing on disk to clean.

### Workspace deletion / archive

Archiving a workspace doesn't archive its sessions automatically. Sessions stay queryable by id; the workspace row sets `status='archived'`, `archived_at`. Active worktrees are not pruned (user might still want to look at them).

Hard delete is not exposed in v1. If we need it later, add a confirm flow that walks every session and runs the worktree-archive flow above.

---

## Left-nav UI

Lives in `src/components/dashboard/power-rail.tsx`. The current rail shows "Command" (orchestrator) and "Active Agents." Replace the "Active Agents" section with the workspace tree below. Keep "Command" at the top — clicking it opens the orchestrator chat as today.

### Layout

```
┌─────────────────────────────┐
│ ⚡ Command                   │  ← existing orchestrator entry
├─────────────────────────────┤
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

Use existing dnd library if one's already in the codebase (check `package.json`); otherwise `@dnd-kit/sortable`. On drop, PATCH `/api/workspaces/reorder` with the new ordered list of ids; backend assigns new `position` values (simple integer reassignment is fine for tens of workspaces).

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
- `getNeedsReviewSessions()` — sessions where `last_outcome_event_at > COALESCE(last_viewed_at, '1970-01-01') AND status = 'active' AND NOT (currently streaming)`. The streaming check is runtime-only; the query returns candidates and the client filters by the runtime streaming map.
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
- `src/lib/workspaces/git.ts` — thin wrappers around `git worktree add/remove`, `git rev-parse`, `git status --porcelain`, `git diff --shortstat`. Shape the API to match `@agentex/workspace` so the future migration is a one-line import swap. Use `node:child_process` with `execFile` (never shell strings — pass paths and refs as args).
- `src/lib/workspaces/detect.ts` — `isGitRepo(path)`, `detectBaseBranch(path, remote)`. Same migration story: shape matches agex helpers.
- `src/lib/workspaces/gh.ts` — minimal `gh` CLI wrappers shaped to match `@agentex/github`'s split: top-level stateless checks (`checkInstalled`, `checkAuthenticated`) and a `repo(path)` factory returning an instance with `createPR`, `getPR`, etc. (only the methods we use in v1). Used by the workspace settings sheet's Git section and (eventually) PR-creation flow.
- `src/app/api/workspaces/route.ts` (and `[id]`, `reorder`, etc.)

**Modified:**

- `src/lib/db/schema.ts` — add `workspaces`, extend `chat_sessions` (or add it if chat-sessions work hasn't shipped yet — coordinate with that branch).
- `src/lib/db/queries.ts` — add the queries listed above; modify chat-event write path to call `bumpSessionOutcome` on `agent`/`result` rows.
- `src/components/dashboard/power-rail.tsx` — embed `<WorkspaceNav />`. Keep "Command" at the top.
- `src/contexts/dashboard-context.tsx` — add workspace selection state, active session, drag state.
- `src/lib/orchestrator/registry.ts` — register the new actions.
- `src/db/types.ts` — re-derive types after schema changes.

---

## Implementation order

Pick this up in passes; each pass is independently shippable.

1. **Schema + queries + minimal API** (no UI yet). Migration lands; `getWorkspaces`, `createWorkspace`, `archiveWorkspace`, `reorderWorkspaces` work via `curl`. Verify by manually inserting a workspace and a fake `chat_session` and querying.
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

**Worktree creation fails (disk full, permission, etc.).** Session creation is rolled back — no `chat_sessions` row inserted. Surface the git error verbatim to the user. Don't write a session row that points at a path that doesn't exist.

**User deletes the worktree directory manually.** On next render, `getSessionsForWorkspace` still returns the row; the diff-stats call fails (path missing). Show "missing" indicator. Allow archive (which will skip `git worktree remove` and just clean DB state).

**Concurrency on the same `chat_sessions` row.** Per `chat-sessions.md`, a per-session lock on send. No new requirement here.

**Slug collisions.** Workspace `slug` is unique. On create, derive from name; on collision, append `-2`, etc. Not user-editable in v1 (changing a slug renames branches and confuses git history).

**Deleting an Area.** `area_id` is FK with `ON DELETE SET NULL`. Workspace stays; loses its area association. Not lost.

---

## Open questions for the implementer

These are real decisions the spec doesn't pin down — pick whichever feels right and document the choice:

1. **Where to render the workspace nav.** Embed inside `power-rail.tsx` (200px rail) vs. expand to a wider 240–280px panel. The 200px rail will feel cramped once diff stats and per-session indicators land — prototype both widths and pick the one that doesn't squeeze the indicators.

2. **Drag-and-drop library.** If `@dnd-kit/sortable` is not already a dep, evaluate against `react-beautiful-dnd` and whatever shadcn-recommends. Pick the smallest one that handles vertical sortable lists with drag handles.

3. **Folder picker on web.** Next.js + Electron-like folder picker isn't free in a pure web app. Two options: (a) a text input with autocomplete from `~/`-rooted paths via a `/api/fs/browse` endpoint, (b) defer the visual picker and require user to paste an absolute path in v1. (b) is faster to ship; (a) is the better UX. Pick based on time budget.

4. **Showing per-row branch name.** Session rows could show the branch (e.g. `bounce/seo-geo-plan`) inline. Useful but adds visual weight. v1 default: hide on the list, show in session detail. Reconsider after dogfooding.

5. **What `last_outcome_event_at` does for the orchestrator chat.** The orchestrator is type=orchestration, has no workspace, and isn't in the Needs Review surface. We still set `last_outcome_event_at` for it (cheap, future-useful) but it's never read for review state.

If anything else feels under-specified during implementation, leave a TODO in code with a one-line question and post it back.

---

## TL;DR for the implementer

Build a `workspaces` table. Add `workspace_id`, `worktree_path`, `branch_name`, `base_sha`, `last_outcome_event_at`, `last_viewed_at` to `chat_sessions`. Build a left-nav tree with a Needs Review surface, drag-and-drop reorder, and collapsible workspace sections. For git workspaces, each execution session creates its own `git worktree` off the workspace's base branch. "Needs review" is derived from two timestamps — no state column. Diff stats are computed on demand. Skip scripts, preview URLs, AI action prefs, and team-shared config — all v2.
