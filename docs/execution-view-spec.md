# Execution View Refactor: Implementation Spec

Self-contained plan for rebuilding the agent execution surface around a
four-zone layout — rail / chat / file tree / file viewer + terminal —
so the user can actually review what the agent built without leaving
the page. Builds on `docs/executor-wiring-spec.md` (which landed the
agent runtime) and `docs/workspaces-spec.md` (which landed the
data model). The current `ExecutionView` (`src/components/executions/execution-view.tsx`)
collapses tree → changed-files-list and tucks terminal in a drawer; this
spec replaces it with a review-grade surface.

## Goal

When the user opens an execution, in one screen they can:

1. See the chat and the agent's work output simultaneously — never alt-tab.
2. Navigate the **full** project tree (not just changed files).
3. Filter to **just** the changed files with one click.
4. View any file's contents (CodeMirror 6).
5. View any changed file's diff side-by-side (CodeMirror 6 merge view).
6. Run terminal commands inline.
7. Trigger review-and-ship actions (commit, push, open PR, merge) from
   a state-driven action bar above the chat.

Non-goals (v1): multiple chats per worktree, editable diffs, live
preview of a running webapp, user-configurable sort orders.

## Layout

```
┌──┬───────────────┬─────────────┬───────────────────────────┐
│ R│ Chat          │ File tree   │ File viewer               │
│ a│ ───────────── │             │                           │
│ i│ Action bar    │ [Chgd][All] │                           │
│ l│ ───────────── │  src/       │                           │
│  │ transcript    │  ▾ comp…    │                           │
│  │               │   foo.tsx   │                           │
│  │               │   bar.tsx M │                           │
│  │               │             ├───────────────────────────┤
│  │               │             │ Terminal                  │
│  │ ┌───────────┐ │             │ $                         │
│  │ │ composer  │ │             │                           │
│  │ └───────────┘ │             │                           │
└──┴───────────────┴─────────────┴───────────────────────────┘
 56px  flex (resizable)            resizable (vertical split)
```

- **Rail** (`PowerRail`, existing): collapsed to 56px icon strip when in
  execution view. Tasks, notes, sessions remain reachable. Hover or
  hotkey expands.
- **Chat column** (resizable, min 360px, default ~40%): header (existing
  `ExecutionHeader`) → new `ExecutionActionBar` → transcript → composer.
- **File tree column** (resizable, min 200px, default ~18%): segmented
  control `[Changed (N)] [All]` at the top, file list below.
  Alphabetical, stable, never reshuffles. Changed files get M/A/D badge
  and a subtle relative-time chip ("2m", "1h") on the right edge.
- **File viewer + Terminal** (resizable, min 400px, default ~42%):
  vertical split. Viewer on top, terminal below. Vertical handle between.
  Terminal collapses to a thin strip when its panel is dragged shut.

Layout sizes persist per-session in localStorage. Min widths prevent
columns from collapsing into uselessness.

## Decisions log

| Topic                              | Decision                                                              |
|------------------------------------|-----------------------------------------------------------------------|
| Layout orientation                 | Chat-left (Bolt/Lovable), not chat-right (Cursor)                     |
| Editor + diff library              | CodeMirror 6 + `@codemirror/merge`                                    |
| Resizable panels                   | `react-resizable-panels` via shadcn `<Resizable*>`                    |
| File tree                          | Hand-rolled Tailwind component (no library)                           |
| Tree views                         | `[Changed (N)] [All]` segmented control                               |
| Tree sort                          | Alphabetical by path. Stable. No user-configurable sort in v1.        |
| Recency signal                     | Subtle relative-time text on changed files, like the rail (`5m`/`2h`) |
| Initial file focus                 | Most recently changed file (by git mtime + executor events)           |
| Auto-snap on new turn              | **No.** Surface "↻ N new edits" pill instead. User clicks to navigate.|
| Action bar location                | Inside chat column, below header, above transcript                    |
| Action bar visibility              | State-driven (worktree status determines which actions appear)        |
| Action intelligence (PR title etc) | Prompt-injected into chat session; agent drafts, library executes     |
| Header details                     | Workspace, branch, base, status inline (existing). Path → `ⓘ` popover.|
| Right-side context pane            | **Removed.** Files → tree. Actions → action bar. Details → header popover. |
| Diff slideout                      | **Removed.** Diff renders inline in file viewer.                      |
| Terminal location                  | Stacked below file viewer in right column (not full-width)            |
| Preview tab                        | Skipped. Add later as viewer mode if a real need surfaces.            |
| Multi-chat per worktree            | Deferred. Revisit after one week of dogfooding the new layout.        |
| PR creation                        | Agent shells out via `gh pr create` (existing Bash tool). No MCP tool.|
| PR intelligence prompt             | Always includes the diff summary so it works without prior conversation.|
| Diff view selection                | Auto-scroll to first hunk (matches GitHub).                           |
| Tree refresh                       | `tool_use` event invalidation (instant) + 30s slow poll. No `fs.watch`.|

## Architecture

### Data flow

```
ExecutionView
├── PowerRail                 (existing, collapsed variant when activeView !== 'command')
├── ResizablePanelGroup horizontal
│   ├── Panel: Chat
│   │   ├── ExecutionHeader   (existing — adds ⓘ popover for path/base)
│   │   ├── ExecutionActionBar (NEW — state machine)
│   │   ├── ExecutionTranscript (existing)
│   │   └── ExecutionComposer (existing)
│   ├── Panel: FileTree (NEW)
│   │   ├── ViewToggle [Changed][All]
│   │   ├── ChangesPill "↻ N new edits"
│   │   └── TreeList
│   └── Panel: ViewerAndTerminal
│       └── ResizablePanelGroup vertical
│           ├── Panel: FileViewer (NEW — wraps CM6)
│           │   ├── if changed → DiffView (CM6 merge)
│           │   └── if unchanged → FileView (CM6 read-only)
│           └── Panel: ExecutionTerminalPanel (existing — repositioned)
```

### New hooks

```
useSessionTree(sessionId)         GET /api/sessions/[id]/tree
useSessionFile(sessionId, path)   GET /api/sessions/[id]/file?path=
useRecentEdits(sessionId)         derives from useSessionEvents — last N tool_use rows with file paths
useExecutionActions(sessionId)    composes useCommit/usePush/usePullBase + new openPr/mergePr
```

### New API routes

```
GET  /api/sessions/[id]/tree              → { entries: TreeEntry[] }
GET  /api/sessions/[id]/file?path=<rel>   → { content, encoding, mime, size, sha, isBinary }
POST /api/sessions/[id]/pr                → ask agent to draft + open PR (prompt injection)
POST /api/sessions/[id]/merge             → merge PR (uses @agentex/github)
```

Existing routes reused unchanged:
- `GET /api/sessions/[id]/diff[?file=]` — diff hunks (already structured)
- `GET /api/sessions/[id]/status` — worktree status (ahead/behind/dirty)
- `POST /api/sessions/[id]/commit` — commit
- `POST /api/sessions/[id]/push` — push
- `POST /api/sessions/[id]/pull-base` — pull base

### Tree shape

```ts
interface TreeEntry {
  path: string;          // relative to worktree root
  name: string;          // basename
  kind: 'file' | 'dir';
  size?: number;         // bytes, files only
  status?: 'added' | 'modified' | 'deleted' | 'staged' | 'untracked'; // git status
  mtime?: string;        // ISO, used for relative-time chip on changed files
}
```

The server returns a **flat** list of all tracked + untracked files
(respecting `.gitignore`). Source: `git ls-files --cached --others
--exclude-standard` plus a small index of modified-but-tracked from
`ws.git.status()`. Client builds the tree shape for rendering. For very
large repos (>10k files), the server can later switch to lazy directory
loading — not needed for v1.

### File contents

```ts
interface FileResponse {
  path: string;
  content: string | null;      // null when isBinary
  encoding: 'utf8' | 'base64';
  mime: string;
  size: number;
  sha?: string;                // content hash for cache key
  isBinary: boolean;
}
```

Size cap: 1 MiB. Larger files return `{ isBinary: true, content: null }`
with a "File too large to preview" affordance in the viewer.

### Action state machine

`useExecutionActions` exposes state derived from worktree status:

```ts
type ActionState =
  | { kind: 'clean_no_branch' }       // not a git workspace or fresh worktree
  | { kind: 'dirty' }                 // uncommitted changes
  | { kind: 'ahead_no_pr', ahead: number }
  | { kind: 'pr_open_in_sync' }       // PR exists, head == PR head
  | { kind: 'pr_open_ahead' }         // local has commits not in PR
  | { kind: 'pr_open_behind_base' }   // base branch moved
  | { kind: 'pr_mergeable' }          // PR exists, green, in sync
  | { kind: 'archived' };
```

Each state maps to a set of `actionButtons[]` with their handler.
Visibility-only — never disable; missing actions just don't render.
Exception: `Merge` shows greyed when PR exists but not mergeable, with
a tooltip explaining why.

### Action intelligence: hybrid model

Mechanical actions go direct to the library:
- `commit` → `POST /api/sessions/[id]/commit` (existing, uses `ws.git.commit`)
- `push` → `POST /api/sessions/[id]/push` (existing)
- `pull-base` → `POST /api/sessions/[id]/pull-base` (existing)
- `merge` → new route, uses `@agentex/github`

Intelligence actions inject a prompt into the current chat session.
The agent doesn't get any new tools — it shells out to the existing
git/gh CLI via its `Bash` tool, same as it would for any other git
operation.

- `Open PR` → injects a user-role message: "Open a PR for this work.
  Generate a title (≤72 chars, imperative mood) and a body describing
  what changed and why, then run `gh pr create --title ... --body ...`."
  The prompt **always includes a compact diff summary** (files changed
  + shortstat from `useSessionStatus` / `useDiffStats`) so the agent
  has context even when the user clicks Open PR cold without a prior
  assistant turn.
- `Commit (no message)` → similar pattern: "Draft a commit message for
  the currently staged changes, then run `git commit -m '...'`."

The action bar's job is just to seed the prompt and dispatch the
message; the agent's existing Bash tool handles execution. No new
MCP tools, no new executor wiring.

### Tree refresh strategy

Two tiers. No file system watcher.

1. **Tier 1 — `tool_use` event invalidation (instant).**
   `useSessionStream` already pushes new `chat_events` rows into the
   query cache as the executor emits them. Extend that stream consumer
   to recognize file-mutating tool calls and invalidate the
   `useSessionTree` query immediately. Tool names + Bash patterns that
   trigger invalidation:
   - `Edit`, `Write`, `MultiEdit`, `NotebookEdit` (Claude Code natives)
   - MCP filesystem write tools (`mcp__*__write_file`, etc.)
   - `Bash` whose command matches mutating shape: `rm`, `mv`, `mkdir`,
     `touch`, `cp` (to a worktree path), `git checkout` (state-changing),
     redirected stdout (`>` / `>>`).
   - Use a small allowlist function `isMutatingToolUse(event)`. False
     positives are cheap — at worst we refetch the tree.
   - Lag from agent edit → tree update: bounded by the SSE stream
     latency, typically <500ms.

2. **Tier 2 — 30s slow poll (catches external edits).**
   The user can edit files in VS Code (via `OpenWorktreeButton`) without
   the agent's involvement. The slow poll catches those. `git ls-files`
   is fast even on large worktrees — the poll cost is negligible.

`fs.watch` / chokidar are explicitly out of scope for v1. Cross-platform
brittleness (macOS FSEvents dropped-event bugs, Linux inotify watch
limits, FD leaks across hot reloads) isn't worth the marginal speedup
over Tier 1+2 for a local app. If 30s external-edit lag is later felt
as a real pain point, add Node's built-in `fs.watch` then — one hook,
no new dependency.

### Recency signal

Two layers, both subtle:

1. **Per-file timestamp chip.** Changed files in either tree view show
   `formatCompactRelative(mtime)` on the right edge (`5m`, `2h`). Uses
   the existing helper at `src/lib/utils/relative-time.ts:5`. Updates
   every 60s via a `useTick` (already used by the rail).

2. **New-edits pill** at the top of the tree view: `↻ 3 new edits` when
   files have been modified since the user's last interaction (last
   `last_viewed_at` ping). Clicking the pill: in `Changed` mode, scrolls
   the most-recent changed file into view and selects it. In `All` mode,
   flips to `Changed` and selects it. Dismisses on click. Does **not**
   auto-snap the viewer otherwise.

## Removed surfaces

These files get deleted (or gutted) once the new layout lands:

- `src/components/executions/execution-context-pane.tsx` — split into
  FileTree (files), ActionBar (actions), and Header popover (details).
- `src/components/executions/diff-slideout.tsx` — replaced by inline
  CM6 merge view in FileViewer. The structured-diff API stays; the
  slideout component goes.

## Build phases

Each phase is independently shippable. Don't merge a phase until the
prior one is stable.

### Phase 1 — Resizable shell

Layout skeleton. No new functionality. Existing components render in
new slots.

### Phase 2 — File tree

Tree API + component. Reads from worktree, shows tracked+untracked,
clicking selects a file in a stubbed viewer.

### Phase 3 — File viewer + diff (CodeMirror 6)

Real viewer. Switches to CM6 merge view for changed files. Initial
focus rules. "↻ N new edits" pill.

### Phase 4 — Action bar

State machine, mechanical wiring (commit/push/pull-base existing), new
PR + merge routes, prompt-injection for intelligence ops.

### Phase 5 — Terminal repositioning

Move terminal from full-width-bottom to vertical-stack in right column.

### Phase 6 — Rail collapse + header popover

Rail icon-strip variant for execution view. Header gains `ⓘ` popover
for full path/base/started. Remove `ExecutionContextPane` and
`DiffSlideout`.

### Phase 7 — Polish

End-to-end states (no PR, dirty, ahead, behind, merged, archived,
non-git). Mobile fallback (single-pane). Empty states.

## Implementation checklist

Each item is one PR (or one commit). Order matters — earlier items
unblock later ones.

### Phase 1 — Resizable shell

- [x] `pnpm dlx shadcn@latest add resizable` — adds `react-resizable-panels`
      dep and `src/components/ui/resizable.tsx`.
- [x] Add `useExecutionLayoutSizes(sessionId)` hook
      (`src/hooks/use-execution-layout-sizes.ts`) — reads/writes per-session
      panel sizes to localStorage under key `flow.execution.layout.<id>`.
      Returns `{ sizes, setSizes }` with a debounce on writes.
- [x] Rewrite `src/components/executions/execution-view.tsx` top-level
      structure to three horizontal `<ResizablePanel>`s (Chat, FileTree,
      ViewerAndTerminal). Keep all existing components, just place them
      in the new slots (FileTree slot = stub, ViewerAndTerminal slot =
      moved terminal panel). Min widths: 360/200/400.
- [x] Convert `ViewerAndTerminal` slot to vertical `<ResizablePanelGroup>`
      with a stub `<FileViewer>` panel on top and existing
      `<ExecutionTerminalPanel>` on bottom. Default split 70/30.
- [x] Delete the full-width bottom terminal render from `ExecutionView`
      (`execution-view.tsx:259-269`).
- [x] Verify mobile (under `lg`) layout still uses single-pane chat-only
      view (existing `.lg:contents` guard).

### Phase 2 — File tree

- [x] Add server util `src/lib/workspaces/list-tree.ts` that runs
      `git ls-files --cached --others --exclude-standard` in the worktree
      and merges with `ws.git.status()` to attach status flags. Returns
      flat `TreeEntry[]`.
- [x] Add route `src/app/api/sessions/[id]/tree/route.ts` — GET, returns
      `{ entries: TreeEntry[] }`. Uses `openWorktreeHandle` like
      `diff/route.ts`. Falls back to `fs.readdir` walk for non-git
      workspaces.
- [x] Add API client `src/lib/api/sessions.ts` — `sessionsApi.tree(id)`
      typed against `TreeEntry`.
- [x] Add hook `src/hooks/use-execution.ts` — `useSessionTree(id)`,
      polled every 30s (slow tier; instant updates come from tool_use
      stream below), invalidated on running→idle transition (same hook
      the existing diff/status invalidation uses).
- [x] Add `isMutatingToolUse(event)` helper
      (`src/lib/executor/mutation-detect.ts`) — returns true for
      `Edit`/`Write`/`MultiEdit`/`NotebookEdit`/MCP filesystem writes,
      and for `Bash` whose command matches a mutating pattern (`rm`,
      `mv`, `mkdir`, `touch`, `cp`, `git checkout`, redirected stdout).
- [x] Extend `useSessionStream` to invalidate the
      `['session', id, 'tree']` query whenever
      `isMutatingToolUse(event)` returns true. Same place the stream
      already inserts events into the cache.
- [x] Build `src/components/executions/file-tree/file-tree.tsx` — top
      level. Owns selected-path state, view mode state (`'changed' | 'all'`),
      and renders the tree list. Persists view mode per-session in
      localStorage (`flow.execution.tree-view.<id>`).
- [x] Build `src/components/executions/file-tree/tree-view-toggle.tsx` —
      `[Changed (N)] [All]` segmented control. N comes from
      `entries.filter(e => e.status).length`.
- [x] Build `src/components/executions/file-tree/tree-list.tsx` —
      virtualized list (`@tanstack/react-virtual`, already in deps).
      In `Changed` mode, flat list of changed entries. In `All` mode,
      collapsible folders with M/A/D badges on changed files. Sort:
      alphabetical by path within each folder; folders before files.
- [x] Build `src/components/executions/file-tree/tree-entry-row.tsx` —
      single row. File icon (lucide), name, status badge if changed,
      `formatCompactRelative(mtime)` chip on right edge if changed.
      Click → `onSelect(path)`.
- [x] Build `src/components/executions/file-tree/changes-pill.tsx` —
      `↻ N new edits` chip. Visible when `entries` has files modified
      after `session.last_viewed_at`. Click → scroll latest into view
      and select it. Dismiss on click.
- [x] Wire tree into `ExecutionView` — replace stub slot. Pass selected
      path down to `FileViewer` stub.

### Phase 3 — File viewer + diff (CM6)

- [x] `pnpm add codemirror @codemirror/view @codemirror/state @codemirror/language @codemirror/merge`
- [x] `pnpm add @codemirror/lang-javascript @codemirror/lang-typescript @codemirror/lang-python @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-html @codemirror/lang-css`
      *(TypeScript support comes through `lang-javascript` with the `typescript` flag — no separate `lang-typescript` package installed.)*
- [x] `pnpm add @uiw/react-codemirror` — React wrapper (~50 KB). Pin
      version to current major.
- [x] Add server util `src/lib/workspaces/read-file.ts` — reads a file
      from worktree, returns `{ content, encoding, mime, size, isBinary }`.
      Detects binary by null-byte scan in first 8 KiB. Caps at 1 MiB.
- [x] Add route `src/app/api/sessions/[id]/file/route.ts` — GET with
      `?path=<rel>` query. Path must be inside worktree (reject `..`).
- [x] Add API client `src/lib/api/sessions.ts` — `sessionsApi.file(id, path)`.
- [x] Add hook `useSessionFile(id, path)` — keyed cache, no polling
      (file content doesn't move during a single view).
- [x] Build `src/components/executions/viewer/language-for.ts` — maps
      file extension → CM6 language extension. Defaults to plaintext.
- [x] Build `src/components/executions/viewer/cm-theme.ts` — light +
      dark CM6 theme matching app's Tailwind tokens. Uses
      `EditorView.theme` + a syntax highlight `HighlightStyle`.
- [x] Build `src/components/executions/viewer/file-view.tsx` — read-only
      CM6 wrapping `@uiw/react-codemirror`. Loads content via
      `useSessionFile`. Empty state for binary, too-large, deleted.
- [x] Build `src/components/executions/viewer/diff-view.tsx` — CM6
      merge view (`@codemirror/merge`'s `MergeView`). Side-by-side, read-only
      both sides. Old content comes from a dedicated `useSessionBaseFile`
      hook (uses `?base=1` on the file route → `ws.git.show base:path`),
      new content from `useSessionFile`. Auto-scrolls to first hunk on mount
      and file change.
- [x] Build `src/components/executions/viewer/file-viewer.tsx` — top
      level. Routes between `<DiffView>` and `<FileView>` based on whether
      selected file is in `tree.entries` with a `status`. Header strip
      shows path, "Diff | Current" toggle (only when changed), and a
      "Reveal in Finder" affordance.
- [x] Wire viewer into `ExecutionView` — replace stub. Selected path
      flows from FileTree → FileViewer.
- [x] Add `useInitialSelectedFile(session, tree, events)` hook —
      computes initial focus: prefer most recent tool-use file path
      from `useSessionEvents`, fall back to most recent by `mtime` in
      `tree.entries.filter(e => e.status)`, fall back to `null`. Runs
      once per session-open.
- [x] Hook up `ChangesPill` to FileViewer: clicking the pill selects
      the latest-edited file and switches to Diff view.

### Phase 4 — Action bar

- [x] Add hook `src/hooks/use-execution-actions.ts` — derives `ActionState`
      from `useSessionStatus` + `useSessionPr` (new — see below).
- [x] Add `useSessionPr(id)` hook — calls new `GET /api/sessions/[id]/pr`
      that uses `@agentex/github` to look up the PR for the session's
      branch. Cached, invalidated on push.
- [x] Add route `src/app/api/sessions/[id]/pr/route.ts` — GET returns
      `{ pr: PrInfo | null, ghStatus? }`. POST drafts the prompt and
      dispatches into the chat session as a user-role message.
- [x] Add route `src/app/api/sessions/[id]/merge/route.ts` — POST merges
      the PR via `@agentex/github`. Body chooses method (default squash).
- [x] Add prompt template `src/lib/executor/prompts/open-pr.ts` — exports
      `buildOpenPrPrompt(sessionContext)` that returns the user-role
      message body, always including a compact diff summary.
- [x] Build `src/components/executions/action-bar/execution-action-bar.tsx` —
      horizontal strip. Renders the buttons returned by `useExecutionActions`.
      Order tailored per `ActionState`: dirty → Commit; ahead_no_pr →
      Push + Open PR; pr_open_in_sync → Merge; pr_open_ahead → Push +
      (disabled Merge); pr_open_behind_base → Pull base + (disabled Merge);
      pr_merged → "✔ Merged" chip.
- [x] Build `src/components/executions/action-bar/commit-button.tsx` —
      reuses existing `CommitModal`.
- [x] Build `src/components/executions/action-bar/open-pr-button.tsx` —
      on click, POST to `/api/sessions/[id]/pr` (which injects the prompt).
      Disabled while agent is running (let the current turn finish first).
- [x] Build `src/components/executions/action-bar/merge-button.tsx` —
      on click, confirm dialog, then POST to `/api/sessions/[id]/merge`.
      Shows greyed with tooltip when PR is not mergeable (state explains why).
- [x] Insert `<ExecutionActionBar>` in `ExecutionView` between
      `<ExecutionHeader>` and `<ExecutionTranscript>`. Only renders for
      `workspace.is_git === true`.
- [x] Wire `useSessionPr` invalidation on push success.

### Phase 5 — Terminal repositioning

- [x] Update `ExecutionTerminalPanel` to render correctly when placed in
      a vertical resizable panel (currently designed for full-width dock).
      Remove the `open`/`onToggle` props — panel visibility is now
      controlled by the resizable handle (drag to collapse).
- [x] Auto-create the first terminal when the panel first becomes
      non-zero-height (existing logic, just trigger source changes).
- [x] Persist the vertical split per-session. *(Already landed in Phase 1
      via `useExecutionLayoutSizes`.)*

### Phase 6 — Rail collapse + header popover

- [x] Add a `compact` prop to `PowerRail` — forces the existing
      skinny-icon variant when set. Reuses the rail's existing
      `SkinnyView`. Hover-to-expand-overlay deferred (⌘\ toggle still
      works in execution view).
- [x] Update `Dashboard` to pass `compact` when `isExecutionView`.
- [x] Add `<DetailsPopover>` to `ExecutionHeader` desktop variant —
      `ⓘ` icon button between status pill and menu. Popover content
      mirrors mobile's existing popover (workspace, branch, base, status,
      worktree path, started_at). Lifts the mobile pattern to desktop.
- [x] Delete `src/components/executions/execution-context-pane.tsx`.
- [x] Delete `src/components/executions/diff-slideout.tsx`.
- [x] Remove `ExecutionContextPane` import and `diffFile` state from
      `ExecutionView`. *(Already done in Phase 1 rewrite.)*

### Phase 7 — Polish

- [x] Empty state for FileTree when worktree has no files yet — TreeList
      renders "No files" when entries is empty.
- [x] Empty state for FileViewer when no file selected — "Select a file
      to preview" hint with pointer to the tree.
- [x] Empty state when not a git workspace — FileTree drops the Changed
      segmented toggle (renders a plain "Files (N)" header), ActionBar
      hides, FileViewer routes through FileView only (DiffView never
      triggers since `entry.status` is undefined for bare workspaces).
- [x] Verify behavior across `ActionState` values: dirty, ahead_no_pr,
      pr_open_in_sync, pr_open_ahead, pr_open_behind_base, pr_mergeable,
      archived. Each branches the `Buttons` switch in `execution-action-bar`.
      *(Manual verification by states pending live testing; storybook
      not part of the project.)*
- [x] Verify on a 100+ file worktree (perf check) — TreeList uses
      `@tanstack/react-virtual` with 26px row height + 12-row overscan,
      so worktrees with 10k files still render in constant time.
- [x] Verify CM6 themes work in both light and dark mode — `cmTheme`
      reads `theme` from `useDashboard` and picks light/dark highlight
      style.
- [x] Mobile fallback: single-column chat-only view (existing) stays
      intact. The `lg:hidden` chat column path renders `chatColumn`
      alone; tree / viewer / terminal only mount under the `hidden
      lg:flex` branch.
- [x] Update `docs/chat-sessions.md` if any user-visible flow changed.
      Reviewed — the doc covers session semantics, not UI layout. No
      update required.

## Future scope: multi-chat per worktree

Not in v1, but worth capturing the analysis so the future port is cheap.
Use case: user wants to ask a side question ("how does this util work?")
without polluting the main execution thread.

**Schema permits it today.** `chat_sessions` (`src/lib/db/schema.ts:258`)
has no UNIQUE on `worktree_path` — multiple rows can already point to
the same path. Strictly zero schema changes are required to associate N
sessions with one worktree.

**What's missing:** a role flag to distinguish primary from side
threads. One column addition:

```ts
role: text('role', { enum: ['primary', 'ask'] }).notNull().default('primary'),
```

- `primary` — owns the executor, full tool surface, can write.
- `ask` — read-only against the worktree, restricted tool allowlist.

**Runtime work, not schema work.** The executor's
`Map<chat_session_id, AgentSession>` already keys by session, so N
sessions running concurrently against one worktree is mechanically fine.
The hard part is preventing two writing agents from racing on the same
files. Solution: when `role === 'ask'`, configure `@agentex/agent` with
a tool allowlist that drops `Edit`, `Write`, `MultiEdit`, mutating
`Bash` patterns, and write-capable MCP tools. Reads (`Read`, `Grep`,
`Glob`, `Bash` with read-only commands) stay enabled.

**UI sketch** (when it ships): an icon at the top of the chat column
opens a small popover with `[+ New ask thread]` and a list of ask
threads on this worktree. Switching threads swaps the chat content but
keeps the file tree + viewer + terminal stable (they're worktree-scoped,
not session-scoped). Primary thread is always the bottom-most entry,
visually distinguished.

**Cleaner long-term model** (not required): extract a `worktrees`
table that owns `path`, `branch_name`, `base_sha`. `chat_sessions`
keeps a `worktree_id` FK. Reduces the duplicated state today where
every session row carries the worktree fields. Defer until the spec
above gets cramped.

## Reference paths

- Existing view: `src/components/executions/execution-view.tsx`
- Existing header: `src/components/executions/execution-header.tsx`
- Existing terminal panel: `src/components/executions/execution-terminal-panel.tsx`
- Existing composer: `src/components/executions/execution-composer.tsx`
- Existing transcript: `src/components/executions/execution-transcript.tsx`
- Existing rail: `src/components/dashboard/power-rail.tsx`
- Existing execution hooks: `src/hooks/use-execution.ts`
- Existing diff slideout (to delete): `src/components/executions/diff-slideout.tsx`
- Existing context pane (to delete): `src/components/executions/execution-context-pane.tsx`
- Existing API root: `src/app/api/sessions/[id]/`
- Existing time helper: `src/lib/utils/relative-time.ts:5`
- Drawing reference: `examples/IMG_8651 Medium.jpeg`
- Prior design conversation: `examples/execution-view.md`
