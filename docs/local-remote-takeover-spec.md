# Local/Remote Client Awareness + Take Over Locally: Implementation Spec

Self-contained plan for adapting the execution view to the machine the
user is currently on, plus a "Take over locally" escape hatch when the
agent gets stuck and the user wants hands on the code from their laptop.

Builds on `docs/execution-view-spec.md` (the four-zone execution surface
that landed CM6 + diff + terminal + action bar). Goal: support running
the app on an always-on back-machine and accessing it from anywhere
(localhost, Tailscale, ngrok, LAN) without losing the ability to grab
the wheel manually when needed.

## The architectural premise

The agent does its work on whatever machine the app runs on — that's
where the worktrees, the database, and the executor process all live.
The browser is the only thing on the remote/client side. So actions
split into two regimes:

- **Same-machine** (browser host === app host). Worktree paths in the
  UI are valid filesystem paths on the client machine. Native deep
  links (`file://`, `cursor://`, `vscode://`) work directly.
- **Cross-machine** (browser host ≠ app host). The browser cannot
  reach into the laptop's filesystem, but **the existing Flow CLI on
  the laptop can.** The browser hands off via a single copy-paste
  command; the CLI clones to a canonical path, opens the editor, and
  later pushes back + resumes the agent.

No file sync daemon, no sshfs, no companion app. Just git + the CLI
that already ships with Flow.

## Goals

1. The execution view knows whether the user is on the host machine
   or on a remote client, and adapts the affordances it shows.
2. Same-machine clients get one-click "Reveal in Finder" and "Open
   in editor" on every file and worktree.
3. Remote clients get a "Take over locally" flow that pauses the
   agent, pushes the branch, generates a copy-paste CLI command, and
   resumes cleanly when the user finishes locally.
4. The local clone lives at a predictable, conventional path
   (`<local-app-root>/clones/<workspace-id>/`) — one clone per
   workspace, branches multiplex over it.
5. A manual-paste fallback exists for users without the CLI installed,
   but it's the unfavored path.

## Non-goals (v1)

- Bidirectional file sync (mutagen, sshfs, code-server tunnel).
- Background polling that detects "user pushed something on its own —
  explicit Resume button or `flow resume` instead.
- A `flow connect <host>` persistent-auth handshake — the short-lived
  takeover token embedded in the copy-paste command covers v1.
- Custom URL scheme registration (`flow://`) — defer until there's
  real demand for one-click handoff.
- Workspaces without a git remote — takeover is hidden, no patch-file
  fallback.

## Decisions log

| Topic                              | Decision                                                                  |
|------------------------------------|---------------------------------------------------------------------------|
| Detection seed                     | `window.location.hostname ∈ {localhost, 127.0.0.1, ::1}` → host           |
| Override mechanism                 | Per-origin toggle in settings, stored client-side in localStorage         |
| Same-machine actions               | Deep links — `file://`, `cursor://file/<abs>`, `vscode://file/<abs>`      |
| Editor preference (same-machine)   | Configurable per-client (Cursor / VS Code / JetBrains). Default: Cursor   |
| Cross-machine handoff              | CLI-driven (`flow takeover <url>`). Manual-paste fallback in modal.       |
| Local clone location               | Per-workspace at `<local-app-root>/clones/<workspace-id>/`                |
| CLI auth                           | Short-lived takeover token (1h TTL), one per session, embedded in URL     |
| Browser-shown command              | `flow takeover https://<host>/t/<token>` — single line, single copy       |
| Resume mechanism                   | `flow resume` from the laptop OR "Done — pull my changes" button          |
| Pause-on-takeover                  | Wait for current tool call up to 5s, then interrupt via existing route    |
| Conflict on resume                 | Surface error inline / in CLI; agent does not auto-resolve                |
| Git remote requirement             | Hard required. Button hidden when no remote.                              |
| Where the takeover button lives    | Header overflow popover when remote + has-git-remote                      |
| Where same-machine actions live    | FileViewer header strip + tree-row context menu + header popover          |
| Schema delta                       | Five columns on `chat_sessions`: started_at, base_sha, branch, token, exp |
| Status enum                        | NOT extended. Takeover derived from columns being non-null                |

## Architecture

### Detection

`useClientLocation()` hook (`src/hooks/use-client-location.ts`):

```ts
type ClientLocation = {
  kind: 'host' | 'remote';
  reason: 'localhost' | 'override' | 'default-remote';
  hostname: string;
};
```

Logic:

1. Read `window.location.hostname`.
2. If `∈ {localhost, 127.0.0.1, ::1}` → `{ kind: 'host', reason: 'localhost' }`.
3. Else read localStorage key `flow.client.host-origins` (JSON array of
   hostnames the user has claimed as "my main machine"). If current
   hostname is in the list → `{ kind: 'host', reason: 'override' }`.
4. Else → `{ kind: 'remote', reason: 'default-remote' }`.

Reactive: re-evaluates when the localStorage list changes
(via a `storage` event listener so multiple tabs stay in sync).

### Host info (informational)

`GET /api/system/host-info` returns `{ hostname, platform, app_root }`.
Used only by the settings UI to show "Currently connected to: …" —
not part of detection logic in v1.

### Same-machine deep links

Pure utilities in `src/lib/client/deep-links.ts`:

```ts
revealInFinderHref(absPath: string): string
// macOS/Linux/Windows all use file:///<parent-dir>; OS routes per platform.

openInEditorHref(absPath: string, editor: EditorPreference): string
// cursor://file/<abs>   ·   vscode://file/<abs>   ·   jetbrains://open?file=<abs>
```

Editor preference: stored in localStorage under `flow.client.editor`.
Enum `'cursor' | 'vscode' | 'jetbrains'`. Default `'cursor'`.

`revealLabel(platform)` returns "Reveal in Finder" on macOS, "Show in
Explorer" on Windows, "Show in Files" on Linux.

`<DeepLinkButton>` renders an `<a>` styled as a button. Visibility
gated on `useClientLocation().kind === 'host'`. In remote mode the
button simply doesn't render — no tooltip, no disabled state.

Wired into:

- `<FileViewer>` header strip — "Reveal" + "Open in editor".
- `<TreeEntryRow>` right-click context menu — same two items.
- `<ExecutionHeader>` details popover — "Reveal worktree" link.

### Take Over Locally — flow

```
User in browser on laptop ─┐
                           │
       ┌───────────────────▼───────────────────────────────┐
       │ [Header overflow popover] → "Take over locally"  │
       └───────────────────┬───────────────────────────────┘
                           ▼
            POST /api/sessions/[id]/takeover
                           ▼
       Server: wait for in-flight tool, WIP-commit dirty
       work, push branch, generate short-lived token,
       stamp takeover_* columns
                           ▼
       ┌───────────────────────────────────────────────────┐
       │ TakeoverModal                                     │
       │                                                   │
       │   Run on your laptop:                             │
       │   ┌─────────────────────────────────────────────┐ │
       │   │ flow takeover https://host:4224/t/abc123    │ │
       │   └─────────────────────────────────────────────┘ │
       │   [Copy]                                          │
       │                                                   │
       │   [Done — pull my changes]  [Cancel]              │
       │                                                   │
       │   ⌄ Don't have the CLI installed?  (fallback)     │
       └───────────────────┬───────────────────────────────┘
                           │ user runs the command
                           ▼
   On the laptop:                                          
     1. flow takeover <url>                                
        → GET /api/takeover/<token> → clone info           
     2. Clone to <app-root>/clones/<workspace-id>/ if new, 
        fetch if exists                                    
     3. git checkout <branch>                              
     4. Open editor with the local path                    
     5. Persist state to clone dir for later resume        
                           ▼
       User edits locally, commits.                        
                           ▼
                  $ flow resume                            
                           ▼
   On the laptop:                                          
     1. Push current branch                                
     2. POST /api/takeover/<token>/resume                  
                           ▼
   On the server:                                          
     1. git fetch && git pull on host's worktree           
     2. Compute diff vs takeover_base_sha                  
     3. Insert synthetic user message into chat            
     4. Clear takeover_* columns                           
                           ▼
       Agent resumes with full context.                    
```

Two ways to close the loop, both supported:

- **`flow resume` from the laptop** — primary path, the CLI pushes
  first and then calls resume.
- **"Done — pull my changes" button in the browser modal/banner** —
  assumes the user has already pushed. Server-side `git pull` will
  surface a useful error if they haven't.

### Schema delta

Five nullable columns on `chat_sessions` (`src/lib/db/schema.ts:258`):

```ts
takeover_started_at:        text('takeover_started_at'),
takeover_base_sha:          text('takeover_base_sha'),
takeover_branch:            text('takeover_branch'),
takeover_token:             text('takeover_token'),
takeover_token_expires_at:  text('takeover_token_expires_at'),
```

Session is "in takeover" iff `takeover_started_at` is non-null. Resume
/ cancel clears all five atomically. No new status enum value — the
existing `active | archived` enum is about session lifecycle, not work
state.

Why columns instead of a JSON blob or join table: cheaper to read,
indexable if we ever want a "currently taken over" filter, matches
the existing `setup_*` pattern in the same row.

Token is opaque, generated with `randomUUID()` + base32 collapse, ~22
chars. One token per session at a time — regenerating the takeover
overwrites it.

### API routes

**Browser-called** (bearer-token middleware, same as existing routes):

`POST /api/sessions/[id]/takeover` — start a takeover.

1. Load session + workspace + worktree handle. 400 on missing fields
   or non-git workspace.
2. If `executor.isRunning(id)`: wait up to 5s for the current turn to
   settle. If still running, call `executor.interrupt(id)`.
3. Verify git remote configured. If not → 400 `no_remote`.
4. Capture current HEAD as `takeover_base_sha`.
5. If `ws.git.status()` is dirty: `ws.git.commitAll('WIP: takeover at <ISO>')`.
6. `ws.git.push()` (sets upstream on first push).
7. Generate `takeover_token` (1h TTL).
8. Stamp all five `takeover_*` columns.
9. Return:

```ts
{
  token: string;
  expires_at: string;
  cli_command: string;        // "flow takeover https://your-host:4224/t/<token>"
  fallback_command: string;   // "git fetch origin && git checkout <branch>"
  branch: string;
  base_sha: string;
  remote_url: string;
  workspace_id: string;
  started_at: string;
}
```

`POST /api/sessions/[id]/takeover-cancel` — abandon without pulling.

Verifies session is in takeover, clears the five columns, returns
`{ ok: true }`. Local clone (if made) is left alone — user can clean
up at their leisure.

**CLI-called** (token-authed, exempt from bearer middleware):

`GET /api/takeover/[token]` — resolve token to clone info.

Validates token + expiry against any `chat_sessions` row. Returns:

```ts
{
  session_id: string;
  workspace_id: string;
  workspace_name: string;
  remote_url: string;
  branch: string;
  base_sha: string;
  host_label: string;        // friendly hostname for state file
}
```

400 if token expired or no longer matches (e.g., user cancelled).

`POST /api/takeover/[token]/resume` — close the loop.

1. Validate token.
2. `ws.git.fetch()` + `ws.git.pull()` on the host's worktree. On
   conflict: 400 `pull_conflict` with the git error.
3. Compute diff `takeover_base_sha..HEAD`.
4. Build synthetic prompt with diff summary.
5. `insertChatEvent({ role: 'user', source: 'system', content: prompt })`.
6. Clear the five takeover columns.
7. Return `{ ok: true, files_changed: number, shortstat: string }`.

Resume does NOT auto-dispatch the agent. The synthetic message lands
in the transcript; the user clicks Send (or `flow resume` prints
"Agent resumed — open the session to continue").

**Informational:**

`GET /api/system/host-info` — `{ hostname, platform, app_root }`.

### Middleware change

The existing bearer-token middleware needs to allowlist `/api/takeover/*`
so token-in-path auth can take over. The handlers themselves validate
the token. Pattern:

```ts
// middleware.ts
if (req.nextUrl.pathname.startsWith('/api/takeover/')) {
  return NextResponse.next();   // auth happens in the handler
}
```

### Action bar interaction with takeover

When `session.takeover_started_at !== null`, the existing
`ExecutionActionBar`:

- Hides commit / push / open-PR / merge buttons (those are now
  meaningless — the user's machine owns the work).
- Renders a slim banner instead: "Taken over locally at <relative>"
  plus a "Resume" and "Cancel" pair.

`useExecutionActions` gets a new `ActionState` variant `'taken_over'`
that short-circuits the rest of the state machine.

### Settings UI

`src/components/settings/client-settings.tsx` — new settings section:

- "Currently connected to: <hostname>" (read-only, from `host-info`).
- "Treat this hostname as my host machine" toggle. Hidden when
  hostname is already localhost. Persists to the
  `flow.client.host-origins` localStorage array.
- Editor preference dropdown (Cursor / VS Code / JetBrains).
  Persists to `flow.client.editor`.

No server persistence — these are per-browser/per-origin preferences.

## CLI commands

The CLI is the existing Flow CLI (same binary that runs `flow start`
on the host). New commands live in `src/cli/commands/` per the
"shared CLI commands" convention in CLAUDE.md (not orchestrator
registry — these are user-facing commands, not agent actions).

### `flow takeover <url>`

```
flow takeover https://your-host:4224/t/<token>
```

Logic:

1. Parse host URL + token from the argument. URL shape:
   `<scheme>://<host>:<port>/t/<token>`. Reject malformed.
2. `GET <host>/api/takeover/<token>` → clone info.
3. Resolve local clone path:
   `getClonesDir() + '/' + workspace_id`
   (new `getClonesDir()` helper in `src/lib/config/paths.ts`, returns
   `<app-root>/clones/`).
4. If path doesn't exist → `git clone <remote_url> <path>`.
   If path exists → `cd <path> && git fetch origin`.
5. `git checkout <branch>` (creating tracking branch on first checkout).
6. Persist state to `<clone-path>/.flow-takeover.json`:

   ```json
   {
     "host": "https://your-host:4224",
     "token": "<token>",
     "session_id": "<id>",
     "workspace_id": "<id>",
     "branch": "<branch>",
     "started_at": "<ISO>"
   }
   ```

7. Open the editor. Read editor preference from `getCliConfig().editor`
   (new field, defaults to `cursor`). Invocation:
   `open "cursor://file/<absPath>"` on macOS,
   `xdg-open "..."` on Linux,
   `start "" "..."` on Windows. Falls back to printing the path if
   `open` is unavailable.
8. Print:

   ```
   ✓ Branch checked out at <path>.
   ✓ Opened in Cursor.

   When you're done, run:
     flow resume
   ```

Failure modes:

- **`getaddrinfo ENOTFOUND` or 404 on takeover-info** → "Token expired
  or cancelled. Ask the browser to start a new takeover."
- **`git clone` fails (no creds, network)** → surface the git error,
  point to `gh auth login` or SSH key setup.
- **Workspace dir exists but isn't a git repo** → bail with "Clone
  path is occupied by non-git content: <path>. Move or remove it."

### `flow resume`

```
flow resume                   # most recent takeover
flow resume --workspace <id>  # disambiguate when multiple are open
```

Logic:

1. Discover takeover state:
   - Scan `<app-root>/clones/*/. flow-takeover.json`.
   - If multiple and no `--workspace` arg → error with the list.
   - If `--workspace` given, pick that one.
   - If exactly one → use it.
2. `cd <clone-path>`. If `git status` shows uncommitted changes →
   prompt: "Uncommitted changes. [c]ommit / [s]tash / [a]bort?".
   Default behavior: commit with timestamped message `Takeover edits <ISO>`.
3. `git push origin HEAD`. Surface git errors (auth, non-fast-forward).
4. `POST <host>/api/takeover/<token>/resume`. Surface 400 errors
   inline (`pull_conflict`, expired token, etc.).
5. On success: delete `<clone-path>/.flow-takeover.json`. Print:

   ```
   ✓ Pushed <branch> to origin.
   ✓ Server pulled <N> files, posted diff to agent.

   Open the session to continue.
   ```

### `flow takeover --list` (optional polish)

Print all active takeovers on this machine (scans state files). Lets
the user see what's still hanging if they forgot to resume.

## Build phases

Each phase ships independently. Don't merge a phase until the prior
one is stable.

### Phase 1 — Detection + same-machine deep links

- [ ] `src/hooks/use-client-location.ts`
- [ ] `src/app/api/system/host-info/route.ts`
- [ ] `src/hooks/use-host-info.ts`
- [ ] `src/lib/client/deep-links.ts` — `revealInFinderHref`,
      `openInEditorHref`, `revealLabel(platform)`
- [ ] `src/lib/client/editor-preference.ts` — get/set localStorage +
      `useEditorPreference()` hook
- [ ] `src/components/executions/deep-link-button.tsx`
- [ ] Wire into `viewer/file-viewer.tsx` header strip
- [ ] Wire into `file-tree/tree-entry-row.tsx` right-click context menu
- [ ] Wire into `execution-header.tsx` details popover
- [ ] Settings page section — `client-settings.tsx`

### Phase 2 — Schema + takeover routes (server side)

- [ ] Drizzle migration: add five `takeover_*` columns to
      `chat_sessions`. `pnpm db:generate`.
- [ ] Queries in `src/lib/db/queries.ts`:
      `markSessionTakenOver(id, { base_sha, branch, token, expires_at })`,
      `findSessionByTakeoverToken(token)`,
      `clearSessionTakeover(id)`
- [ ] `POST /api/sessions/[id]/takeover` — full handler
- [ ] `POST /api/sessions/[id]/takeover-cancel`
- [ ] `GET /api/takeover/[token]/route.ts`
- [ ] `POST /api/takeover/[token]/resume/route.ts`
- [ ] Middleware allowlist for `/api/takeover/*`
- [ ] `src/lib/api/sessions.ts` — `takeover()`, `cancelTakeover()`

### Phase 3 — CLI commands

- [ ] `getClonesDir()` helper in `src/lib/config/paths.ts`
- [ ] `getCliConfig()` editor preference (new field) in CLI config
      module — separate from browser localStorage; this is laptop-local
- [ ] `src/cli/commands/takeover.ts` — `flow takeover <url>` command
- [ ] `src/cli/commands/resume.ts` — `flow resume [--workspace]`
- [ ] `src/cli/lib/open-editor.ts` — platform-aware `open` wrapper
- [ ] `src/cli/lib/takeover-state.ts` — read/write `.flow-takeover.json`
      per clone dir, plus `findAllActive()` for the disambiguation case
- [ ] Wire into CLI command registry (wherever existing commands like
      `flow start` are registered)
- [ ] Verify CLI commands work end-to-end against a local server before
      shipping the UI

### Phase 4 — Takeover UI

- [ ] `src/hooks/use-takeover.ts` — wraps the takeover + cancel
      mutations and reads takeover state off `useSessionStatus`
- [ ] `src/components/executions/takeover/takeover-button.tsx` —
      header overflow item. Hidden when `client.kind === 'host'` OR
      `!workspace.is_git` OR `!hasGitRemote`
- [ ] `src/components/executions/takeover/takeover-modal.tsx` — single
      `flow takeover <url>` command with copy button, "Done" +
      "Cancel" buttons, collapsible fallback panel with the raw
      `git fetch && git checkout <branch>` instructions
- [ ] `src/components/executions/takeover/takeover-banner.tsx` —
      slim banner above transcript when session is in takeover state,
      shows relative-time + Resume + Cancel buttons
- [ ] Update `useExecutionActions` — `'taken_over'` `ActionState`
- [ ] Wire `<TakeoverButton>` into `<ExecutionHeader>` overflow menu
- [ ] Wire `<TakeoverBanner>` into `<ExecutionView>` above transcript

### Phase 5 — Polish

- [ ] No-remote guard: button hidden up front, route also defends in
      depth with 400 `no_remote`
- [ ] Conflict surfacing: resume's `pull_conflict` renders inline in
      the banner and CLI both
- [ ] HMR origin fix: `experimental.allowedDevOrigins` in `next.config.ts`
- [ ] `flow takeover --list` for finding orphaned takeovers
- [ ] End-to-end manual test: localhost host + laptop on Tailscale
- [ ] End-to-end manual test: same on ngrok
- [ ] End-to-end manual test: phone (browser only, no CLI) → fallback
      path with manual git commands

## Files

### New

- `docs/local-remote-takeover-spec.md` (this doc)
- `src/hooks/use-client-location.ts`
- `src/hooks/use-host-info.ts`
- `src/hooks/use-takeover.ts`
- `src/lib/client/deep-links.ts`
- `src/lib/client/editor-preference.ts`
- `src/app/api/system/host-info/route.ts`
- `src/app/api/sessions/[id]/takeover/route.ts`
- `src/app/api/sessions/[id]/takeover-cancel/route.ts`
- `src/app/api/takeover/[token]/route.ts`
- `src/app/api/takeover/[token]/resume/route.ts`
- `src/cli/commands/takeover.ts`
- `src/cli/commands/resume.ts`
- `src/cli/lib/open-editor.ts`
- `src/cli/lib/takeover-state.ts`
- `src/components/executions/deep-link-button.tsx`
- `src/components/executions/takeover/takeover-button.tsx`
- `src/components/executions/takeover/takeover-modal.tsx`
- `src/components/executions/takeover/takeover-banner.tsx`
- `src/components/settings/client-settings.tsx`

### Modified

- `src/lib/db/schema.ts` — five columns on `chat_sessions`
- `src/lib/db/queries.ts` — takeover lifecycle helpers
- `src/lib/config/paths.ts` — `getClonesDir()`
- `src/lib/api/sessions.ts` — takeover API methods
- `src/hooks/use-execution-actions.ts` — `'taken_over'` `ActionState`
- `src/components/executions/viewer/file-viewer.tsx` — deep-link buttons
- `src/components/executions/file-tree/tree-entry-row.tsx` — context menu
- `src/components/executions/execution-header.tsx` — popover + overflow item
- `src/components/executions/execution-view.tsx` — banner slot
- `middleware.ts` — allowlist `/api/takeover/*`
- `next.config.ts` — `experimental.allowedDevOrigins`

## Edge cases

- **CLI not installed on laptop.** Modal's fallback panel shows the raw
  `git fetch && git checkout <branch>` + the remote URL. Editor opens
  via folder-picker (no canonical path). One-time inconvenience, hopefully
  prompts the user to install Flow.
- **Multiple takeovers from the same laptop.** Each workspace gets its
  own clone dir. `flow resume` without `--workspace` defaults to the
  most recently started; with multiple in flight it errors and lists
  them so the user disambiguates.
- **Token expired before the user got to it.** CLI hits 400 from
  `/api/takeover/<token>` with `token_expired`. Prints "Ask the
  browser to start a new takeover." Browser side: the modal shows
  expiry countdown; on expiry the banner offers "Restart takeover"
  which re-runs the takeover route (generates fresh token).
- **User runs `flow resume` after server already pulled** (e.g. they
  clicked "Done" in the browser). API returns 400 `not_in_takeover`.
  CLI prints "This takeover already resumed on the server. Nothing
  to do." and deletes the local state file.
- **Local clone dir exists but isn't a git repo** (user manually
  created `<clones-dir>/<workspace-id>`). CLI bails with a clear
  message; user moves the dir aside.
- **User force-pushes locally.** Server-side `git pull` will fail
  non-fast-forward. Surface to banner and CLI. Manual recovery: user
  fetches + force-resets the server worktree via the in-browser
  terminal panel, then retries resume.
- **WIP commit creates a meaningless commit.** Acceptable — squashed
  on merge. Opt-out (refuse takeover when dirty) is a later config
  flag if anyone asks.
- **Network drops mid-push.** Takeover columns are written AFTER the
  push succeeds. Failed push → no state change, user retries.
- **CLI run on a machine with `<APP>_ROOT` pointing elsewhere.** The
  CLI honors the same env-var overrides as the server (`getAppRoot()`
  helper), so the clone goes wherever the user has Flow configured
  on that machine. Same precedence as documented in CLAUDE.md.

## Reference paths

- Existing PR route (similar shape): `src/app/api/sessions/[id]/pr/route.ts`
- Existing push route: `src/app/api/sessions/[id]/push/route.ts`
- Existing interrupt route: `src/app/api/sessions/[id]/interrupt/route.ts`
- Workspace git surface: `src/lib/workspaces/index.ts`
- Action bar state machine: `src/hooks/use-execution-actions.ts`
- Header popover: `src/components/executions/execution-header.tsx`
- Drizzle schema: `src/lib/db/schema.ts:258` (chat_sessions)
- Queries layer: `src/lib/db/queries.ts`
- Paths helpers: `src/lib/config/paths.ts`
- Execution view shell: `src/components/executions/execution-view.tsx`
- CLI command convention: `src/cli/commands/` (per CLAUDE.md)
