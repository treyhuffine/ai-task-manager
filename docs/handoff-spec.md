# Handoff: spec and task list

**Status:** not started. Written 2026-09-22.
**Replaces:** `docs/local-remote-takeover-spec.md` ("Take over locally").
**Part of:** `docs/homes-spec.md` (Stage 1: its Phase 1 is this doc's Phases 1 and 2, and its Phase 4 is this doc's Phases 3 to 9).
**How to use this doc:** it is the task list. Check a box (`- [x]`) when the work lands on `main`, and append the short commit hash when useful. Keep the "Done when" lines honest: a phase is done when every line under it is true, not when the code compiles. Record surprises inline under the task they affect.

---

## 1. Summary

Your home (the Mac Mini) runs Ri and your agents. Sometimes you want an execution on your laptop instead: iterate fast, run the dev server locally, pair with an agent in your terminal. Handoff moves the work, not the database.

- The home stops the execution's agent, commits and pushes its branch, and writes a short handoff note.
- On the laptop, `ri continue` makes a worktree for that branch from the laptop's own checkout, copies `.env*`, runs the workspace's Setup script, and starts Claude Code or Codex there with the note as the first message.
- The laptop chat streams into the home and shows up on the same execution, tagged with the device it ran on.
- `ri return` pushes the laptop's work and hands the execution back. The home fast-forwards its worktree, writes a note about what changed, and the home agent keeps going.

The laptop has no Ri database. It holds a worktree, the harness's own chat file, and one small config file that says which home it is connected to.

Work can also start on the laptop. `ri new "<prompt>"` creates the execution in the home and runs it on the laptop from the first message, and `ri track` adopts an agent you already started there by hand. Either way, `ri return` moves it to the home so it keeps going while the laptop is closed.

Handoff replaces "Take over locally". Takeover needs a pasted one-hour token per use, clones into a separate folder, never delivers its note to the agent, and can silently lose the laptop's work on resume (§5.2).

---

## 2. Decisions

1. **Work moves by git branch.** The branch pushed to the workspace's remote is the only thing that carries code between machines. No file sync.
2. **Chats don't move.** A chat belongs to the machine and harness that ran it. Context moves as a handoff note in each direction. The home shows every chat of an execution, in order, each tagged with where it ran.
3. **One place at a time.** While an execution is handed off, the home refuses to run agents in it or change its worktree's git state. The home can always take it back ("Bring back").
4. **The laptop is a paired device, not a second home.** Its CLI authenticates with its own device key (an `api_keys` row of type `computer`), stored once by `ri connect`. No per-handoff tokens and no auth bypass paths.
5. **Handoff CLI commands never open a Ri database.** They talk to the connected home over HTTP only.
6. **The laptop worktree comes from the laptop's own checkout** of the repo, found by matching the git remote URL. Same Setup script and environment contract as the home (`docs/worktree-scripts.md`).
7. **Handoff does not open PRs.** The branch is the handoff. If the execution already has a PR, the notes mention it. Opening a PR stays a separate action.
8. **Returning continues the home agent by default.** `ri return` asks, defaulting to yes. `--park` returns without starting the agent.
9. **Notes are written by the background harness** (`runHarnessText`), with a mechanical fallback. A slow or failed summary never blocks a handoff.
10. **v1 laptop harnesses: Claude Code and Codex.** Both keep local transcript files that agentex can read. OpenCode and Cursor are out of scope on the laptop side.
11. **Takeover leaves the UI in the same commit that adds "Continue on…"**, so there are never two ways shown. Its columns are dropped later in the schema cleanup phase.
12. **Each phase lands as its own commit(s) on `main`** in the live checkout.
13. **Every execution lives in one place at a time:** the home or one device. It starts where you start it. From the app it starts on the home, and from `ri new` on a laptop it starts on the laptop. Handoff moves it either way. There is no runner picker.

---

## 3. Open questions

Not decided. None of these block the phases below.

- **Carrying the same conversation across machines** (copy the Claude session file and resume it on the other side). A later experiment, see §8.
- **Rail indicator.** This spec adds a small device icon to executions that are active elsewhere. Revisit after use.
- **Wording.** This spec uses "Continue on {device}" and "Bring back". "Hand off to {device}" is the alternative.

---

## 4. Glossary

- **Home:** the Ri instance that holds your data and runs your agents. Today, the Mac Mini.
- **Device:** anything paired to the home with its own key (`api_keys` row). A laptop whose CLI ran `ri connect` is a device of type `computer`.
- **Handoff:** a record that an execution's branch is being worked on by a device. Active until it is returned, reclaimed, or cancelled.
- **Device chat:** a chat that ran on a device (for example Claude Code in the laptop terminal) and was uploaded to the home. Read-only in the home.
- **Handoff note:** a short summary written when work moves. Outbound (home to device) and inbound (device to home).
- **Source chat:** the home chat that was active when the handoff started. The inbound note goes back to it.

---

## 5. Background: what exists today

### 5.1 Takeover, as built

- `POST /api/sessions/[id]/takeover` waits up to 5 s for the turn to finish, else aborts it, WIP-commits, pushes, mints a one-hour token, and stores six `takeover_*` columns on `executions` (`schema.ts:915-935`, partial unique index at 967-969).
- The browser shows `ri takeover <origin>/t/<token>`. The laptop CLI calls `GET /api/takeover/<token>` (the proxy lets `/api/takeover/*` skip the bearer check, `proxy.ts:78-87`), clones into `~/ri/.work/clones/<workspaceId>`, checks out the branch, and opens the editor.
- `ri resume` commits, pushes, and calls `POST /api/takeover/<token>/resume`, which fetches, fast-forwards, and inserts a synthetic message with the diff (capped at 200k chars).
- UI: `src/components/executions/takeover/*`, `src/hooks/use-takeover.ts`, the `takenOver` action-bar state, and a send gate in `src/app/api/sessions/[id]/messages/route.ts:86-95`.
- No test covers takeover behavior.

### 5.2 Problems this replaces

1. **The note never reaches the agent.** Resume writes the diff note into Ri's copy of the chat (`role: 'user'`, `source: 'system'`) and does not dispatch it. The harness keeps its own transcript, and the next Send dispatches only the new message (`messages/route.ts`, around line 260). The agent never learns what changed on the laptop.
2. **Resume can lose the laptop's work.** The git handle's `raw()` does not throw on a non-zero exit, so the catches around `fetch` and `merge --ff-only` never run. A failed fast-forward diffs the home's unchanged HEAD, posts "(no file-level changes detected)", and clears the takeover.
3. **Token-in-URL auth.** `/api/takeover/*` bypasses the bearer check. Expired takeovers are never cleared, so the chat stays blocked (409) until someone clicks Cancel.
4. **A second clone instead of your checkout.** The laptop clones into a separate folder and never copies `.env*` or runs Setup, so running the app locally takes manual work.
5. **Only the messages route is gated.** `commit`, `pr`, `help-with-error`, and `resolve-conflicts` still dispatch the agent during a takeover.
6. **`--no-open` doesn't work.** The command checks `opts.noOpen`, but commander sets `opts.open = false` (`takeover.ts:126, 174`).

### 5.3 Pieces we reuse

- **Git:** the `@agentex/workspace` handle from `openWorktreeHandle` (`src/lib/workspaces/index.ts:505`): `status`, `commit`, `push`, `raw`. `raw` never throws, so every call checks `exitCode`. The push route's non-fast-forward detection (`src/app/api/sessions/[id]/push/route.ts:14-31`).
- **Stopping work:** `stopExecutionAgent(executionId)` (`src/lib/sessions/workstream-runtime.ts:36`) cancels runs and aborts every chat on an execution. It replaces takeover's 5 s idle wait.
- **Chats on an execution:** `createExecutionChat` (`src/lib/db/queries.ts:5849`). One execution already hosts many chats (`schema.ts:852-857`).
- **Worktree provisioning:** `copyFilesToWorktree` (`src/lib/workspaces/files-to-copy.ts:80`), `runWorktreeScript` (`src/lib/workspaces/index.ts:56`), and the env contract in `docs/worktree-scripts.md` (`RI_SOURCE_CHECKOUT_PATH`, `RI_WORKTREE_PATH`, `RI_BRANCH_NAME`, `PORT`).
- **History import:** agentex `localHistory.discover / read / fingerprint` is read-only and has no database side, so it runs on the laptop. On the home, `historyEventInput` (`src/lib/import/external-agents.ts:590-619`) and `createHistoryWindowWriter` (801-883) commit one window plus its cursor in one transaction, and don't care where the window came from.
- **Summaries:** `runHarnessText` (`src/lib/harness/one-shot.ts:113`), `buildRetrospectiveSample` (`src/lib/sessions/derive-label.ts:161`), `condenseEvents` (`src/lib/orchestrator/session-oversight.ts:46`).
- **Harness commands:** `HARNESS_REGISTRY` and `resumeCommandForHarness` (`src/lib/harness/registry.ts`, around line 202). Verified flags: `claude --session-id <uuid> [prompt]`, `claude --resume <id> [prompt]` (reuses the id, `--fork-session` is opt-in), `codex [prompt]`, `codex resume [SESSION_ID] [PROMPT]`.
- **Devices:** `api_keys` (`schema.ts:665-691`), the Devices settings pane (`src/components/settings/devices-section.tsx`), pairing links (`buildPairingUrl`, `src/lib/auth/bootstrap.ts:95`).
- **Unchanged:** same-machine detection (`src/hooks/use-client-location.ts`), open-in-editor via `POST /api/fs/open`, host info.

### 5.4 Gaps this spec fills

1. **Handlers can't tell which device called.** `proxy.ts` validates the bearer and returns a bare `NextResponse.next()` (`proxy.ts:108`).
2. **The CLI has no notion of a remote home.** `serverFetch` always uses `localToken` and a loopback URL (`src/lib/orchestrator/server-client.ts:39-97`). `ri pair` prints the local host's own pairing link. Any command that touches `getDb()` creates `~/ri/data.db`.
3. **The history reader can't follow a growing file.** agentex rejects a file that changes during a read (`source_changed_during_read`), and the importer's final commit sets `syncOffset = Math.max(lastNextOffset, after.size)` (`external-agents.ts:975`), so a half-written last line is skipped forever. This also affects today's home imports.
4. **The home would treat uploaded chats as its own imports.** Its scans would mark them "missing" (the transcript isn't on the home's disk), and "take over import" would try to resume them locally.
5. **`GET /api/devices` returns whole `api_keys` rows, including `hash`** (`src/app/api/devices/route.ts:23`).
6. **No "check out an existing remote branch" path.** `createWorktreeForSession` always creates a new branch, and `ensureWorktreeReady` gives a missing worktree a fresh branch off base (`src/lib/runs/dispatch.ts:499`). Work that starts on a device (§6.17) and returns needs the home to build a worktree from a branch that only exists on the remote. Fixed in Phase 3.

### 5.5 Coordination with the agents view (`docs/agents-view-spec.md`)

- Its **Phase 0** (foreign keys off during migrations, then `foreign_key_check`) has landed as `runMigrations` (`src/lib/db/migrate.ts`). This spec's **Phase 8** needs it, because dropping `executions.takeover_chat_session_id` requires rebuilding `executions`.
- Its **Phase 1** moves the engine onto `chat_sessions.harness`. Device chats are created through `createExecutionChat`, so they follow whichever representation is current when this lands.
- Its **Phase 4** adds `chat_events.sender_session_id`. When it exists, the inbound handoff note records the device chat as its sender.
- The UI says "agent" for a workspace. Copy in this spec follows that.
- The execution view redesign comes next. Handoff UI lives in the execution header menu, a banner, the composer gate, and transcript cards, all of which carry over.

---

## 6. Design

### 6.1 The flow, end to end

**Home to laptop**

1. In the home UI, from any browser: execution menu, **Continue on…**, pick a device. Or on the laptop: `ri continue`, then pick from the list.
2. The home runs `POST /api/executions/:id/handoffs` (§6.5): checks, stop the agent, commit if dirty, push, record the base SHA, write the outbound note, save the handoff, drop a marker in the source chat.
3. On the laptop, `ri continue [ref]`:
   - claims the handoff (`POST /api/handoffs/:id/pickup`)
   - finds the local checkout (§6.7) and makes or refreshes the worktree (§6.8)
   - copies `filesToCopy` from the local checkout and runs Setup
   - starts the harness in the worktree with the note as its first message (§6.9)
   - uploads the chat to the home every few seconds while it runs, plus a final flush on exit (§6.10)
4. Optional, in another terminal: `ri serve` runs the workspace's Start script in the worktree on a free port.

**Laptop to home**

5. `ri return`, from inside the worktree: flush the chat upload, commit if dirty (after showing `git status --short` and confirming), push, then `POST /api/handoffs/:id/return {headSha, continue}`.
6. The home (§6.11): fetch, check the pushed head, fast-forward its worktree, write the inbound note, close the handoff, then either send the note to the source chat and run the agent, or park it behind a button.
7. From the home at any time: **Bring back** (`POST /api/handoffs/:id/reclaim`). Same as step 6, using whatever the branch has on the remote. Needed when the laptop is closed, lost, or offline.

### 6.2 Data model

**New table `handoffs`**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | UUIDv7 |
| `created_at`, `updated_at` | shared `timestamps` spread | |
| `execution_id` | text, NOT NULL, FK `executions.id` ON DELETE CASCADE | |
| `source_chat_session_id` | text, FK `chat_sessions.id` ON DELETE SET NULL | The home chat the inbound note returns to |
| `device_id` | text, NOT NULL, FK `api_keys.id` | Target device. Keys are soft-revoked, never deleted |
| `status` | text, NOT NULL, enum `active \| returned \| reclaimed \| cancelled` | Policy value, no DB default. `createHandoff` sets `active` |
| `remote_name` | text, NOT NULL | The remote the home pushed to |
| `branch` | text, NOT NULL | |
| `base_sha` | text, NOT NULL | Home HEAD after the pre-handoff commit, which is what the device starts from |
| `returned_sha` | text | Head the home fast-forwarded to on return or reclaim |
| `note_to_device` | text, NOT NULL | Outbound note |
| `note_to_home` | text | Inbound note |
| `note_to_home_sent_at` | text | When the inbound note was dispatched. Null on an ended handoff means it is parked |
| `picked_up_at` | text | |
| `ended_at` | text | |

Indexes:
- Partial unique `(execution_id) WHERE status = 'active'`: one active handoff per execution.
- `(device_id, status)`.

**`chat_sessions`**, two nullable columns (`ALTER TABLE ADD COLUMN`, no rebuild):
- `origin_device_id` text, FK `api_keys.id` ON DELETE SET NULL. Null means the chat ran on the home.
- `handoff_id` text, FK `handoffs.id` ON DELETE SET NULL. Set on device chats created for a handoff.

**`external_session_imports`**:
- Add `origin_device_id` text, FK `api_keys.id` ON DELETE SET NULL. Null means the transcript is on the home's own disk.
- Replace the unique index on `(provider_type, external_session_id)` with two partial unique indexes: the same columns `WHERE origin_device_id IS NULL`, and `(origin_device_id, provider_type, external_session_id) WHERE origin_device_id IS NOT NULL`. This is an index-only change. A single index with a nullable column would not dedupe the home's own rows, because SQLite treats NULLs as distinct.
- For device rows, `source_path` holds an opaque label (`device:<deviceId>:<provider>:<externalSessionId>`), never the laptop path. agentex marks `transcriptPath` as local-only.

**Text unions, no migration:**
- `ChatEventSource` (`src/db/types.ts:336`) gains `'handoff'`.
- `chat_sessions.surface_kind` gains `'device_agent'`. Device chats get their own kind so code that keys on `'imported_agent'` (take-over-import, resync) never touches them.

**Types** in `src/db/types.ts`: `HandoffRecord`, `HandoffStatus`, and `CreateHandoffInput`, with `status` re-optionalized through `PolicyOptional` per CLAUDE.md.

### 6.3 Knowing which device made a request

- `proxy.ts` deletes any inbound `x-ri-api-key-id` header on every request, then, once a key validates, forwards `x-ri-api-key-id: <key.id>` with `NextResponse.next({ request: { headers } })`. Stripping on every path (including the public bypasses) means the header can't be spoofed.
- The session cookie carries the same token, so browser requests are identified too.
- New `src/lib/auth/request-device.ts`: `getRequestApiKeyId(request)` and `requireRequestDevice(request)` (loads the row and rejects missing or revoked keys).
- New `GET /api/devices/me` returns `{ id, name, deviceType, createdAt }`.
- `GET /api/devices` returns a DTO without `hash`, plus `cliLastSeenAt` from a new nullable `api_keys.cli_last_seen_at` column. The proxy sets it whenever the user agent starts with `ri-cli/`. A laptop's browser and CLI may share one key, so the last user agent alone can't tell whether a device has the CLI. The "Continue on…" picker lists only devices with a CLI.

### 6.4 Connecting a laptop CLI: `ri connect`

**In the home UI:** Settings, Devices, **Connect a computer**. This mints a key (`deviceType: 'computer'`, name "New computer") and shows two steps:
1. Install the Ri CLI (link to the install instructions).
2. Run `ri connect` and paste this link. [Copy link]

The same steps appear inside the "Continue on…" dialog when no CLI device exists yet.

**`ri connect [address or link]`:** with a home address and no token, it uses approve-to-connect (`docs/homes-spec.md` §6.3): this machine shows a code and a device you already use approves it. Pasting a pairing link, described below, stays as the fallback.

**The pasted-link path:**
- `ri connect --link` prompts for the link with hidden input, which keeps the token out of shell history. Passing the link as an argument still works for scripts. `ri connect` with no argument uses approval and lists homes found on the network.
- Parses `<base>/#token=<token>`.
- Calls `GET <base>/api/health` (unauthenticated) and requires `{ ok, app }` with Ri's app id. Otherwise: "That URL isn't a Ri home."
- Calls `GET <base>/api/devices/me` with the bearer to learn its own device id.
- If the device still has the default name, renames it to this machine's name (`PATCH /api/devices/:id`).
- Writes `<getConfigDir()>/home.json` with mode 0600 in a 0700 directory: `{ version: 1, homeUrl, token, deviceId, deviceName, connectedAt, checkouts: {} }`.
- Prints "Connected to <homeUrl> as <deviceName>."

**Other commands:**
- `ri connect --status` shows the home, device name, and whether the home is reachable.
- `ri disconnect` revokes its own key (best effort) and deletes `home.json`.

**`src/cli/lib/home-client.ts` (`homeFetch`):**
- reads `home.json` and sends `Authorization: Bearer` plus `User-Agent: ri-cli/<version> (<hostname>)`
- 15 s default timeout
- gzips large request bodies (`Content-Encoding: gzip`)
- maps failures to plain messages. 401: "This computer's key was revoked. Run `ri connect` again." Network: "Can't reach your home at <url>."

**Constraints:**
- The laptop may keep running its own standalone Ri during the transition. `home.json` is a separate file, and handoff commands never call `getDb()`, so nothing collides.
- `src/lib/auth/config-file.ts:4-5` says remote-device tokens never touch disk. Rescope that comment to browser devices and point to `home.json`.
- **TLS:** `http://` (LAN, Tailscale) and valid `https://` (Beamd, Cloudflare, Tailscale Serve) work. Ri's self-signed gateway certificate fails Node's verification. `ri connect` explains this and suggests the Beamd or Tailscale URL, or `NODE_EXTRA_CA_CERTS`.

### 6.5 Starting a handoff (home)

`POST /api/executions/:id/handoffs` with `{ deviceId, sourceChatSessionId? }` returns 201 `{ handoff, command }`, where `command` is `ri continue <ref>` and `ref` is the last 8 characters of the execution id. `ri continue` also accepts a full id or the branch name.

**Checks, with stable error codes:**

| Code | When |
|---|---|
| `not_found` | Unknown execution |
| `archived` | Execution archived |
| `not_git` | Workspace is not a git repo |
| `no_worktree` | No worktree or branch yet (not provisioned, or setup failed) |
| `live_mode` | `worktreePath` equals the workspace `cwd` (live mode or an imported chat). A handoff needs an isolated worktree |
| `base_branch` | The branch is the workspace's base branch |
| `no_remote` | The remote (`workspace.remoteName ?? 'origin'`) is missing |
| `already_handed_off` | An active handoff exists. If it targets the same device, return it instead (safe retry) |
| `taken_over` | A legacy takeover is active (only while takeover code exists) |
| `device_not_cli` | The target is not a non-revoked CLI computer key |

**Steps, in order:**
1. `stopExecutionAgent(executionId)`.
2. If the worktree is dirty: `git add -A` and commit `Handoff: work in progress before continuing on <device>`.
3. Push the branch. A non-fast-forward rejection returns 409 `non_fast_forward`: "The branch on <remote> has commits the home doesn't have. Pull them first." Nothing is recorded. The WIP commit stays, since it is real work.
4. `base_sha = HEAD`.
5. Build the outbound note (§6.6).
6. In one transaction, insert the `handoffs` row (status `active`) and a marker event in the source chat (`role: 'system'`, `source: 'handoff'`, content "Continued on <device>").
7. Publish on the realtime bus so headers, banners, and the rail update.

**Source chat:** `sourceChatSessionId` from the UI (the chat on screen), else the execution's most recently active chat that isn't a device chat.

### 6.6 Handoff notes (`src/lib/handoff/notes.ts`)

**Outbound (home to device)**
- **Inputs:**
  - the execution label and the titles of its linked tasks
  - a sample of the source chat (`buildRetrospectiveSample` plus a condensed tail via `condenseEvents`)
  - commits ahead of base (`git log --oneline <base>..HEAD`, at most 20)
  - `git diff --shortstat` against the merge base
  - whether a WIP commit was made
  - the PR number, if any
- **AI part:** `runHarnessText({ label: 'handoff-outbound', tier: 'fast', maxTurns: 1, timeoutSec: 45, system, prompt })`. Markdown, at most about 400 words, with four headings: Goal, Done so far, Next step, Watch out for.
- **Fallback** on error or timeout: the label, tasks, last user message (600 chars), last assistant message (1,200 chars), commit list, and diffstat.
- **Always appended, never AI-written:** a "Where things are" block with the branch, the base SHA, `git log <base_sha>..HEAD` to see what the home did, and "Run `ri serve` to start the dev server."
- **Cap:** 8,000 chars total.

**Inbound (device to home)**
- **Inputs:**
  - the device chat(s) linked to the handoff, from events already uploaded to the home
  - the git delta `base_sha..returned_sha`: commit subjects, `--name-status`, `--shortstat`
  - the device name
- **AI part:** headings What changed and why, Decisions made, Left undone.
- **Fallback:** the last user and assistant messages of the device chat, plus the git delta.
- **Mechanical tail:** "Pulled <n> commits from <device>. See `git diff <base_sha>..HEAD`."
- **No full patch.** The home agent has the worktree and can read the diff itself. Takeover's 200k-char diff spent context for nothing.
- If no device chat was uploaded (the user edited by hand), the note is git-only.

Both notes run through the background harness per CLAUDE.md "Background AI calls", with the default write-blocking tool list.

### 6.7 Finding the laptop's checkout (`src/cli/lib/handoff/checkout.ts`)

`resolveLocalCheckout(workspace)` tries, in order:
1. `home.json.checkouts[workspaceId]`, if the path exists and its remote still matches.
2. The current directory's repo (`git rev-parse --show-toplevel`), if a remote URL matches.
3. Otherwise ask: "Where is <agent name> checked out on this computer?" The user can type a path, or clone the remote into `<getClonesDir()>/<slug>`.

The answer is remembered in `home.json.checkouts`.

**Matching is by URL, not remote name**, because the laptop's remote may not be called `origin`. Normalize by stripping the protocol, user, `.git`, and trailing slash, lowercasing the host, and turning `git@host:org/repo` into `host/org/repo`. The home sends its remote URL in the pickup response.

### 6.8 The laptop worktree (`src/cli/lib/handoff/worktree.ts`)

`ensureHandoffWorktree({ checkout, localRemote, branch, workspace, executionId })`:

- **Path:** `<getWorkDir()>/worktrees/<slug>/<slug>-<last 6 of executionId>`. It's stable per execution, so a second handoff of the same work reuses the worktree, its installed dependencies, and the harness's chat history for that folder.
- **Fetch first:** `git fetch <localRemote> <branch>` in the checkout.
- **Branch already checked out elsewhere** (`git worktree list --porcelain`): use that path if it is clean and can fast-forward, and tell the user.
- **Worktree path exists:** it must be clean. Fast-forward it to `<localRemote>/<branch>`. If it has commits that aren't on the remote, stop: "This worktree has commits that aren't on <remote>. Push or discard them first." `--reset` stashes, then resets, after confirming.
- **Local branch exists:** fast-forward it (stop if diverged, same message), then `git worktree add <path> <branch>`.
- **Otherwise:** `git worktree add -b <branch> <path> <localRemote>/<branch>` and set the upstream.
- Every git call checks its exit code.
- **Provisioning:**
  - On first creation, copy `workspace.filesToCopy` globs from the checkout into the worktree.
  - Run `setupCommand` with `sh -lc` in the worktree, setting `RI_SOURCE_CHECKOUT_PATH` (the laptop checkout), `RI_WORKTREE_PATH`, and `RI_BRANCH_NAME`, and streaming its output.
  - Setup runs again on later pickups, because lockfiles change (the same rule as resume on the home).
  - On a setup failure, show the output and ask whether to continue.
- `copyFilesToWorktree` and the script runner must import cleanly without the database. Extract DB-free modules if they currently pull in `queries.ts`.

### 6.9 Launching the harness on the laptop (`src/cli/lib/handoff/launch.ts`)

- **Harness:** `--harness` if given, else the source chat's harness if it is Claude or Codex, else Claude. It must be on `PATH`, otherwise error with an install hint.
- **Model:** the harness default. `--model` overrides it.
- **Resume or new:** the pickup response includes this device's latest chat for this execution. If its transcript still exists locally (`localHistory.discover`), ask "Resume your last chat on this computer? [Y/n]". The note becomes the next message either way. `--new` skips the question.
- **Argv templates**, added to `HARNESS_REGISTRY` beside `resumeCommandTemplate`. They are argv arrays, not shell strings:
  - Claude new: `claude --session-id <uuid> <note>`
  - Claude resume: `claude --resume <id> <note>`
  - Codex new: `codex <note>`
  - Codex resume: `codex resume <id> <note>`
- **Spawn** with `stdio: 'inherit'`, the worktree as cwd, and no shell. The note is one argv element, capped at 8k chars, far under macOS's 1 MiB argument limit.
- **Session id:**
  - Claude uses the preset UUID.
  - Codex can't preset one. After launch, poll `localHistory.discover` for a session whose `cwd` is the worktree and whose `startedAt` is at most 5 s before launch. Take the newest, and poll for up to 60 s.
- **Register the device chat on the home** (§6.10) as soon as the id is known, so it shows up right away.
- **Signals:** Ctrl-C belongs to the child. The CLI keeps its uploader alive until the child exits, then does a final flush.
- `--open` opens the worktree in the preferred editor (keeps `src/cli/lib/open-editor.ts` and `cli-config.ts` in use).

### 6.10 Uploading device chats

**Home endpoints**

`POST /api/device-chats` with `{ handoffId, providerType, externalSessionId, title?, startedAt }` returns `{ chatSessionId, cursor }`.
- The caller's key must equal `handoff.device_id`.
- Idempotent on `(device, provider, externalSessionId)`: a repeat call returns the existing chat and its cursor.
- In one transaction it creates:
  - a chat through `createExecutionChat` on the handoff's execution, with `surface_kind: 'device_agent'`, `origin_device_id`, `handoff_id`, and the harness from `providerType`
  - an `external_session_imports` row with `origin_device_id`, `source_kind: 'file'`, the opaque `source_path`, and `status: 'importing'`

`POST /api/device-chats/:chatId/windows` takes the body below and returns `{ cursor }`. The body may be gzipped:
```
{ expectedOffset, replace, events: LocalHistoryYield[], nextOffset,
  source: { size, modifiedAtNs, prefixSha256 } }
```
- The caller must be the chat's origin device.
- If `expectedOffset` differs from the ledger's `syncOffset`, return 409 with the server's cursor. The client adopts it. This replaces `withSourceSyncLock`, which only works inside one process.
- Each event goes through `historyEventInput` plus `redactAgentRuntimeValue`. The local import path currently skips redaction, but the live path applies it.
- Commit with `createHistoryWindowWriter(...).commit(pending, ledgerUpdate)`, setting `syncOffset = nextOffset` and never the file size.
- `replace: true` on the first window keeps the existing "delete this chat's imported events in the same transaction" behavior.
- The writer's existing event publishing streams the chat into the home UI live.
- Request bodies are capped at 16 MiB after decompression (413 above that).
- Next does not decompress request bodies, so add `src/lib/api/read-json-body.ts`, which honors `Content-Encoding: gzip`.

**Laptop uploader (`src/cli/lib/handoff/uploader.ts`)**
- **When:** every 3 s while the harness runs, and once at exit.
- **Reading:** fingerprint the transcript, then read complete lines from the cursor up to the last newline (tail mode). Cut windows at line boundaries using the existing 8 MiB rule (`external-agents.ts:77`) and POST each one.
- **Replace detection:** if the file moved, shrank, or its prefix hash changed, send `replace: true` from offset 0. Reuse the existing logic (`createPrefixDigest`, `external-agents.ts:204-235`, and the replace decision at 889-916), moved into a DB-free module shared with the home importer.
- **Tail reader:** agentex rejects growth during a read.
  - Preferred fix: an agentex option such as `read(session, { fromOffset, untilOffset })` that stops at `untilOffset` and ignores growth past it. Check whether one already exists before building anything.
  - Fallback: copy bytes `[0, lastNewline]` to a temp file and read that.
- **Home unreachable:** keep the cursor and pending state in `<getWorkDir()>/handoffs/<handoffId>.json`, retry each tick, and print one warning line rather than one per tick.
- **Return:** `ri return` flushes first, and refuses to return until the upload is complete unless `--skip-chat` is passed.

**Home-side exclusions.** Every home path that assumes the transcript is on the home's own disk skips rows with `origin_device_id`:
- the missing-row pass in `discoverExternalAgentSessions` (`external-agents.ts:503-549`)
- the cold-start sweep in `syncAllImportedSessions` (1166-1218, 1109-1113)
- the imported-chat branch of `reconcileSession` (`src/lib/executor/reconcile.ts:139-155`)
- the Settings imports panel
- `takeOverImportedSession` and `POST /api/sessions/[id]/take-over-import`

**Read-only in the home.** A device chat's composer says: "This chat runs on <device>. Continue it there, or bring the work back."

### 6.11 Returning (home)

`POST /api/handoffs/:id/return` with `{ headSha, continue, resolve? }`. Only the handoff's device may call it.

1. Load the handoff. If it isn't active, return 409 `not_active` with its status. If it was already returned at the same `headSha`, return 200 (safe retry).
2. Open the home worktree. If the folder is missing, or the home never had one (work that started on the device, §6.17), provision it on the execution's branch. Use the local branch if there is one, otherwise fetch `<remote>/<branch>` and track it (the reprovision fix in Phase 3).
3. `git fetch <remote> <branch>`. Require `git merge-base --is-ancestor <headSha> <remote>/<branch>`, else 409 `not_pushed`.
4. Require the home worktree to be clean and its HEAD to be an ancestor of `<remote>/<branch>`. Otherwise return 409 `home_dirty` or `home_diverged`, with the file list or commits.
   - With `resolve: 'stash'`: stash (`git stash push -u -m "ri handoff <id>: home changes before return"`), make a backup branch `ri/handoff-backup/<id>` at the old HEAD if diverged, then continue.
   - Nothing is ever discarded.
5. `git merge --ff-only <remote>/<branch>`, checking the exit code.
6. Build the inbound note (§6.6).
7. In one transaction:
   - set `status = 'returned'`, `returned_sha`, `note_to_home`, and `ended_at`
   - insert a marker in the source chat: "Back from <device>: <n> commits, <m> files changed"
8. If `continue`, send the note (`sendHandoffNote`):
   - insert it as a user message (`source: 'handoff'`, sender set to the device chat once `sender_session_id` exists)
   - dispatch it through the same path as the messages route (`ensureWorktreeReady`, then `executor.dispatch`)
   - if the source chat is archived or gone, create a chat with `createExecutionChat` and send it there
   - set `note_to_home_sent_at`
9. Publish on the realtime bus.

The response is `{ status, commits, filesChanged, continued }`.

**Other home endpoints:**
- `POST /api/handoffs/:id/reclaim` with `{ continue, resolve? }` runs steps 2 to 9, taking `<remote>/<branch>` as the head.
  - Never picked up and the branch didn't move: status `cancelled`, and no note.
  - Otherwise: status `reclaimed`, and the note adds "Brought back from <device>. Anything not pushed from <device> is still there."
  - Any authenticated key may call it, which is the home UI's Bring back.
- `POST /api/handoffs/:id/send-note` dispatches a parked note. This is the "Continue with this note" button.
- `POST /api/handoffs/:id/pickup` (device only) sets `picked_up_at` and returns the workspace fields the laptop needs (`id`, `slug`, `name`, remote URL, `filesToCopy`, `setupCommand`, `startCommand`), plus the branch, `base_sha`, `note_to_device`, the source chat's harness, and this device's latest chat on the execution.
- `GET /api/devices/me/handoffs?status=active` lists handoffs for the calling device.

**`ri return` on the laptop:**
- It finds the handoff from the current folder (worktree path to local state file), or from `--execution <ref>`.
- If the harness is still running in that worktree, it warns and asks before continuing.
- It flushes the upload. If the tree is dirty it shows `git status --short`, confirms (`--yes` skips this), and commits `Handoff: work from <deviceName>`.
- Push: a non-fast-forward rejection prints "The branch moved on <remote>. Run `git pull --rebase` and try again."
- Continue question: "Keep the agent going on the home? [Y/n]". `--continue` and `--park` answer it.
- On 409 `home_dirty` or `home_diverged` it shows the details and offers `--resolve stash`.
- **Home unreachable after the push:** it saves `pendingReturn` locally and prints "Pushed. Your home isn't reachable, so it doesn't know yet. Run `ri return` again, or use Bring back in the app."
- **Worktree:** kept by default, so the next handoff is fast. `--remove` removes it with `git worktree remove`, and refuses if it is dirty.

**`ri handoffs`** lists active handoffs for this device and local handoff worktrees with their state. **`ri handoffs prune`** removes local worktrees whose handoff has ended and that are clean and fully pushed.

**`ri serve`**, run inside a handoff worktree, runs the workspace's `startCommand` with `sh -lc` and `PORT` set:
- The port is stable per execution: a hash maps it into 4300-4999, taking the first free port from there.
- It prints `http://localhost:<port>` and forwards signals to the server process.

### 6.12 Gating the home while handed off

`assertNotHandedOff(executionId)` (`src/lib/handoff/gate.ts`) throws `HandoffActiveError { handoffId, deviceName }`.

**Called from:**
- `executor.dispatch` (`src/lib/executor/adapter.ts`, around line 605). This single hook covers messages, commit, pr, help-with-error, resolve-conflicts, and scheduled runs.
- The git-changing session routes before they touch the worktree: `push`, `pull-base`, `merge`, `auto-merge`, `wip`, `continue`, `retry-setup`, `retry-setup-script`.

**How callers see it:**
- Routes map the error to 409 `{ error: 'handed_off', device, handoffId }`.
- The `send_session_message` action maps it to `ActionError('conflict', 'This execution is active on <device>. Bring it back first.')`.
- A scheduled run into a handed-off execution fails with a new `runs.errorCode` value, `handed_off`, a clear summary, and no retry.

**Not blocked:** reads (diff, status, files, history, tree) and terminals. The banner makes the state obvious.

**Archive and revoke:**
- Archiving is allowed after a confirm. It ends the handoff (`cancelled` if not picked up, `reclaimed` otherwise) with no git changes. The device's `ri return` then gets 410 `execution_archived` and says the pushed commits are safe on the remote.
- Revoking a device (`DELETE /api/devices/:id`) with active handoffs lists them in the confirm, and the revoke reclaims each one without continuing.

### 6.13 Home UI

- **Execution header menu:** **Continue on…** replaces "Take over locally". It shows even when the browser is on the home. When a check fails (not git, no worktree, live mode, archived) it is disabled with the reason.
- **Continue-on dialog:**
  - Lists CLI computers with a "last seen" time.
  - Picking one starts the handoff and shows "On <device>, run: `ri continue <ref>`" [Copy], then "Waiting for <device>…", which flips to "Picked up" over the realtime bus.
  - With no CLI device, it shows the connect-a-computer steps inline.
- **Banner** (replaces the takeover banner): "Active on <device> since 3:42 pm" or "Waiting for <device>". Its **Bring back** button has two options: "Bring back and continue" and "Bring back".
- **Composer gates:**
  - Home chats on the execution say "This work is active on <device>. Bring it back to continue here."
  - Device chats are read-only with their own message (§6.10).
- **Chat tabs:** device chats show a device badge and a laptop icon, and update live as uploads land.
- **Transcript cards:**
  - `source: 'handoff'` markers render as dividers: "Continued on MacBook" and "Back from MacBook: 3 commits, 5 files changed".
  - The inbound note renders as a card titled "Handoff note from MacBook", collapsed after six lines.
  - A parked note shows "Continue with this note".
- **Action bar:** a `handedOff` state replaces `takenOver`. The bar hides and the banner carries the actions.
- **Rail:** a small device icon on executions active on a device.
- **Settings, Devices:** **Connect a computer**, a CLI badge on CLI devices, and the revoke confirm listing active handoffs.
- **Client:**
  - `src/lib/api/handoffs.ts` and `src/hooks/use-handoff.ts` (start, reclaim, send note).
  - These are not entity mutations, so they don't go through the optimistic layer. Invalidate the session, execution, and rail queries on settle, and follow realtime events.
- **Copy:** no em dashes or semicolons (CLAUDE.md).

### 6.14 Agent surface (orchestrator)

- `list_executions` gains `handoff: { status, device, since } | null`, so agents know not to message work that is active elsewhere.
- `send_session_message` returns the gate as a `conflict` `ActionError`.
- **No new actions in v1.** Handing off is a human workflow. If agents need it later, reserve the names `handoff_execution` and `bring_back_execution`.

### 6.15 Security

- Every handoff and device-chat route requires the bearer. No proxy bypass.
- Device scope:
  - `pickup`, `return`, `device-chats`, and `windows` require the caller's key id to equal the handoff's `device_id` (or the chat's origin device).
  - Start and reclaim accept any authenticated key, which is how the home UI calls them.
- `x-ri-api-key-id` is stripped from every inbound request before auth.
- `home.json` is 0600 in a 0700 directory. `ri connect` reads the link from a hidden prompt by default.
- Laptop transcript paths never leave the laptop.
- Redaction is applied on the home to every uploaded event.
- Body size limits are in §6.10.

### 6.16 Edge cases

| Case | Behavior |
|---|---|
| Push rejected when starting | 409 `non_fast_forward`. No handoff recorded. The agent stays stopped, and the WIP commit stays |
| Note summary slow or failing | Mechanical fallback note, and the handoff proceeds |
| Device never picks up | Banner says "Waiting for <device>". Bring back sets `cancelled` with no git change |
| Laptop lost, closed, or offline | Bring back pulls whatever is on the remote. Unpushed laptop work stays on the laptop |
| `ri return` after Bring back | 409 `not_active`. The CLI says when it was brought back, whether the local commits are pushed, and to run `ri continue` to take it again |
| Home dirty or diverged at return | 409 with details. `--resolve stash` stashes and makes a backup branch. Nothing is discarded |
| Home worktree folder missing at return | Recreated on the same branch before the fast-forward |
| Execution archived during a handoff | The handoff ends. `ri return` gets 410 and says the pushes are safe on the remote |
| Device revoked during a handoff | The revoke reclaims the handoff. The CLI gets 401 and says to reconnect |
| Branch checked out in the laptop's main checkout | Use that checkout if it is clean and can fast-forward, and say so |
| Laptop's local branch diverged | Stop with instructions. `--reset` stashes and resets after confirming |
| Harness missing on the laptop | Error with an install hint and `--harness` |
| Home chat ran on Cursor or OpenCode | The laptop uses Claude, and the note says which harness the home chat used |
| Transcript rewritten mid-session | The prefix hash changes, so upload replaces from offset 0 |
| Very large transcript | 8 MiB windows, gzip, 16 MiB body cap |
| Two returns race | `endHandoff` only moves from `active` inside a transaction. The loser gets 409, or 200 on a same-head retry |
| Home uses Ri's self-signed HTTPS | `ri connect` explains and suggests the Beamd or Tailscale URL, or `NODE_EXTRA_CA_CERTS` |
| Takeover active (while both exist) | Starting a handoff returns 409 `taken_over` |
| Laptop's remote isn't named `origin` | Matched by URL |
| No `filesToCopy` or Setup configured | Skipped |
| Scheduled trigger fires into a handed-off execution | The run fails with `handed_off` and shows in run history |
| `ri continue <ref>` for work with no active handoff | The CLI starts one targeting itself, with the same checks |


### 6.17 Starting work on a device

Most agent work on the laptop won't start on the home. This section covers work that starts there.

**`ri new "<prompt>"`**, run inside a repo checkout on a connected device:
1. Match the repo to a home agent (workspace) by remote URL (§6.7). If none matches, stop: "No agent in your home uses this repo. Add it in the app first."
2. `POST /api/devices/me/executions { workspaceId, label, prompt, baseBranch?, harness }` creates, in one transaction:
   - an execution with a branch name (the home's naming, `<slug>/<label-slug>`) and no worktree on the home
   - an active handoff to this device with `source_chat_session_id` null, `base_sha` set to the base branch's current commit on the remote, and `note_to_device` set to the prompt

   It returns the handoff, the branch, and the base SHA.
3. The laptop makes the worktree on a new local branch from `<remote>/<base>` (the §6.8 path), runs Setup, launches the harness with the prompt, registers the device chat, and uploads it as in §6.10.

The home shows the execution under its agent, marked "On <device>", from the first second.

**`ri track`**, run in a folder where you already started Claude or Codex by hand:
1. Find the newest session whose cwd is this folder (agentex `localHistory.discover`). `--session <id>` picks a different one.
2. Match the repo to a home agent and read the current branch.
3. If the current branch is the base branch (for example `main`), offer to create a branch for this work first (`git switch -c <name>`), because handoff moves work by branch. `--no-branch` tracks the chat only, and that execution can't be returned until it has a branch.
4. Create the execution and the active handoff as in `ri new`, with `base_sha` set to the merge base with the base branch. Then register and upload the session as a device chat, and keep following it until the harness exits or the transcript has been idle for 10 minutes. `--detach` follows in the background.

`ri track` leaves the work where it is. It doesn't move it into a Ri worktree.

**Returning** is the normal `ri return` (§6.11). The home has no worktree for this execution yet, so it provisions one on the execution's branch from the remote (the Phase 3 fix). There is no source chat, so the inbound note goes to a new chat on the execution.

**Sessions you never register** stay private to the laptop, as they are today. `ri import-chats` (`docs/homes-spec.md` Phase 5) can bring them in later as read-only chats.

**Limit:** a folder that only exists on the laptop (not a git repo with a remote the home can reach) can be tracked, but it can only ever run on the laptop, and `ri return` refuses with the reason.

---

## 7. Phases

Order: 1 to 9. Phase 8 needs Phase 7, and agents-view Phase 0 (landed). Do Phase 8 last of the build phases: it is the one step that is hard to undo (§7.1).

### Phase 1: Know which device made a request

- [ ] `proxy.ts`: strip inbound `x-ri-api-key-id` on every request, and forward the validated key id. Add the first `proxy.ts` tests: the header reaches the handler, and a spoofed header on a bypass path is dropped.
- [ ] `src/lib/auth/request-device.ts` with `getRequestApiKeyId` and `requireRequestDevice`, plus tests.
- [ ] `GET /api/devices/me`, plus a test.
- [ ] Add `api_keys.cli_last_seen_at` (nullable text, additive migration), set by the proxy for `ri-cli/` user agents.
- [ ] `GET /api/devices` returns a DTO without `hash`, with `cliLastSeenAt`. Update `src/lib/api/devices.ts` and the Devices pane types.
- [ ] Fix `ri pair --type` help text (`src/cli/index.ts:74`) to list the accepted types: computer, phone, tablet, service, other.

**Done when:** a route test proves the handler sees the calling key's id, a spoofed header never reaches a handler, and the device list contains no hashes.

### Phase 2: Connect a laptop CLI to a home

- [ ] `src/cli/lib/home-config.ts`: read and write `home.json` (version, 0600 file, 0700 directory), plus tests.
- [ ] `src/cli/lib/home-client.ts` (`homeFetch`): bearer, user agent, timeout, gzip, readable errors, plus tests.
- [ ] `ri connect [link]` with the hidden prompt, health check, `/api/devices/me`, rename, write, and `--status`.
- [ ] `ri disconnect`.
- [ ] Settings, Devices, **Connect a computer**: mint the key, copy the link, show the steps.
- [ ] Rescope the comment at `src/lib/auth/config-file.ts:4-5`.
- [ ] ESLint `no-restricted-imports` blocking `@/lib/db` (and `queries`) from `src/cli/commands/{connect,continue,return,serve,handoffs,new,track}.ts`, `src/cli/lib/home-*.ts`, and `src/cli/lib/handoff/**`.
- [ ] A test that runs the new commands' entry points against a temp `RI_ROOT` and asserts no `data.db` is created.
- [ ] `docs/remote-access.md`: a section "Connect a laptop's CLI to your home".

**Done when:** on the laptop, `ri connect` against the Mac Mini succeeds over the LAN address and over the Beamd URL, `ri connect --status` shows it, the device appears as a CLI device in Settings, and no `data.db` was created on the laptop.

### Phase 3: Handoffs on the home

**Schema**
- [ ] The `handoffs` table, the `chat_sessions` columns, the `external_session_imports` column and index change, and the `ChatEventSource` and `surface_kind` unions (§6.2). Types in `src/db/types.ts`.
- [ ] Generate the migration. Review that the SQL is only `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, and `CREATE`/`DROP INDEX`, with no table rebuild.
- [ ] Dry run on a copy of prod `data.db`. Record before and after counts for `executions`, `chat_sessions`, `chat_events`, and `external_session_imports`. `PRAGMA foreign_key_check` must be empty.

**Queries** (`src/lib/db/queries.ts`)
- [ ] `createHandoff`, `getHandoff`, `getActiveHandoffForExecution`, `listHandoffs({ deviceId?, status? })`, `endHandoff` (a transactional move out of `active` that returns null if it wasn't active), `markHandoffPickedUp`, and `markHandoffNoteSent`.
- [ ] Tests, including one active handoff per execution and concurrent `endHandoff`.

**Git** (`src/lib/handoff/git.ts`)
- [ ] `checkpointAndPush`, `fetchBranch`, `isAncestor`, `fastForwardTo`, `stashChanges`, `createBackupBranch`, `commitsBetween`, `nameStatusBetween`, and `shortstatBetween`. Every call checks `exitCode`.
- [ ] Tests with temp repos and a bare remote: clean, dirty, push rejected, fast-forward, diverged, dirty home.

**Reprovision on the execution's own branch** (fixes gap 6, also used by `docs/homes-spec.md` moves)
- [ ] When an execution's worktree folder is missing, `ensureWorktreeReady` and `resumeWorktreeForSession` check out the execution's existing branch: the local branch if present, otherwise fetch `<remote>/<branch>` and track it. Only when the branch exists nowhere do they fall back to a fresh branch off base, with a setup warning that says so.
- [ ] Tests: local branch, remote-only branch, branch gone.

**Notes** (`src/lib/handoff/notes.ts`)
- [ ] Outbound and inbound builders, fallbacks, and caps.
- [ ] Tests with a mocked `runHarnessText`: success, throw, timeout.

**Gate** (`src/lib/handoff/gate.ts`)
- [ ] `assertNotHandedOff`, wired into `executor.dispatch`, the git-changing session routes (§6.12), `src/lib/runs/dispatch.ts` (the `handed_off` error code), and the `send_session_message` mapping.
- [ ] Tests: messages route 409, push route 409, a scheduled run fails with `handed_off`.

**Routes**
- [ ] `POST /api/executions/:id/handoffs` with every check in §6.5, each with a test.
- [ ] `GET /api/devices/me/handoffs`.
- [ ] `POST /api/handoffs/:id/pickup`.
- [ ] `POST /api/handoffs/:id/return`.
- [ ] `POST /api/handoffs/:id/reclaim`.
- [ ] `POST /api/handoffs/:id/send-note`.
- [ ] Archive (`sessions/[id]/archive`) and device revoke (`devices/[id]`) end active handoffs.
- [ ] Realtime publish on every transition.
- [ ] `list_executions` includes `handoff`.

**Done when:** route tests cover start, pickup, return with continue, return parked, send-note, and reclaim (including every 409), and a test asserts that a return with `continue` dispatches the note to the source chat's agent.

### Phase 4: `ri continue`, `ri return`, `ri serve`

- [ ] Checkout resolution and remote URL normalization (§6.7), plus tests.
- [ ] `ensureHandoffWorktree` (§6.8), plus temp-repo tests:
  - a new local branch from the remote
  - fast-forwarding an existing local branch
  - stopping on divergence
  - a branch already checked out
  - reusing the worktree
- [ ] DB-free provisioning: `filesToCopy` copy and the Setup runner importable without the database (extract modules if needed), plus a test.
- [ ] `HARNESS_REGISTRY`: new-session and resume argv templates for Claude and Codex, plus tests.
- [ ] `ri continue [ref]`: list and pick, start a handoff if none is active, pickup, checkout, worktree, Setup, resume-or-new, launch. Flags: `--harness`, `--model`, `--new`, `--no-setup`, `--checkout <path>`, `--open`.
- [ ] Local state in `<getWorkDir()>/handoffs/<id>.json`.
- [ ] `ri return` with `--continue`, `--park`, `--yes`, `--remove`, `--resolve stash`, `--execution <ref>`, and `--skip-chat`, plus the offline `pendingReturn` path.
- [ ] `ri serve` (stable port, prints the URL, forwards signals).
- [ ] `ri handoffs` and `ri handoffs prune`.
- [ ] Register the commands in `src/cli/index.ts`.

**Done when**, with the real Mac Mini and laptop and Claude Code:
- The worktree is made from the laptop's checkout, `.env*` is copied, and Setup runs.
- Claude starts with the note, and `ri serve` serves the app locally.
- `ri return` pushes, and the home agent continues with the inbound note. The note is git-only until Phase 5.

### Phase 5: Laptop chats show up in the home

- [ ] A tail reader, either an agentex option or the snapshot fallback (check agentex first). Tests: a growing file, a half-written last line picked up next tick, a replaced file.
- [ ] Move `createPrefixDigest` and the replace decision into a DB-free module shared by the home importer and the uploader.
- [ ] Fix the home importer's final commit to `syncOffset = lastNextOffset` (`external-agents.ts:975`), so a half-written last line is read on the next sync, plus a test.
- [ ] `src/lib/api/read-json-body.ts` (gzip aware), plus a test.
- [ ] `POST /api/device-chats`, plus tests (device scope, idempotency).
- [ ] `POST /api/device-chats/:chatId/windows`, plus tests (offset 409, replace, dedupe on resend, redaction, size limit).
- [ ] Home-side exclusions for device rows (§6.10), plus tests for each path.
- [ ] The uploader in `ri continue` (tick, final flush, offline state) and the flush in `ri return`.
- [ ] Codex session discovery by cwd and start time.
- [ ] The inbound note reads the device chat.

**Done when:**
- Laptop Claude and Codex chats appear in the home within about 5 s of each message.
- Upload catches up after the home was unreachable for a minute.
- The home's own import scans never mark them missing.
- The inbound note summarizes what happened on the laptop.

### Phase 6: Start work on a device

Needs Phases 3 to 5.

- [ ] `POST /api/devices/me/executions`: creates the execution (branch named like the home's, no home worktree) and an active handoff to the calling device in one transaction (§6.17), plus tests: workspace match, non-git refusal, device scope.
- [ ] `ri new "<prompt>"`: match the repo to an agent, create the execution, make the worktree on a new branch from `<remote>/<base>`, run Setup, launch the harness with the prompt, register and upload the chat. Flags: `--harness`, `--model`, `--label`, `--base <branch>`, `--no-setup`, `--open`.
- [ ] `ri track`: find the newest session for this folder (`--session <id>` to pick), match the agent, offer a branch when on the base branch (`--no-branch` to track the chat only), create the execution, upload, and follow until the harness exits or the transcript is idle for 10 minutes (`--detach` to follow in the background).
- [ ] `ri return` on device-started work: the home provisions from the remote branch, and the inbound note goes to a new chat on the execution. Refuse with a reason for folders with no reachable remote.
- [ ] Tests with temp repos for `ri new` and `ri track`: new branch, tracking on a feature branch, tracking on `main` with branch creation, chat-only tracking.

**Done when:** on the laptop, `ri new` shows "On MacBook" in the home within seconds, `ri track` adopts a hand-started Claude session, and `ri return` on either one keeps the work going on the Mac Mini with the laptop closed.

### Phase 7: Home UI, and takeover leaves

- [ ] `src/lib/api/handoffs.ts` and `src/hooks/use-handoff.ts`.
- [ ] Continue-on dialog, including the inline connect steps.
- [ ] Banner, composer gates, and the `handedOff` action-bar state.
- [ ] Device badges on chat tabs, and read-only device chats.
- [ ] Transcript cards for markers, the inbound note, and parked notes.
- [ ] Rail device icon.
- [ ] Settings, Devices: CLI badge, and the revoke confirm lists active handoffs.
- [ ] Before removing takeover, check prod: `SELECT count(*) FROM executions WHERE takeover_started_at IS NOT NULL`. Cancel any that are active.
- [ ] Remove takeover:
  - routes: `sessions/[id]/takeover`, `sessions/[id]/takeover-cancel`, `api/takeover/[token]`, `api/takeover/[token]/resume`
  - queries: `startExecutionTakeover`, `clearExecutionTakeover`, `findChatSessionByTakeoverToken`
  - flattened fields: `queries.ts:5294-5298` and `types.ts:309-313`
  - rail redaction: `dto/rail-session.ts:30-34`
  - the proxy bypass: `proxy.ts:78-87`
  - the send gate on `takeoverStartedAt`: `messages/route.ts:86-95`
  - UI: `components/executions/takeover/*`, `use-takeover.ts`, the header and view mounts, and the `takenOver` state
  - client: `sessionsApi` methods and types
  - CLI: `takeover.ts`, `resume.ts`, `takeover-state.ts`, and their registration
  - dead code: the unused `deep-link-button.tsx`
  - test fixtures that mention takeover fields
- [ ] Keep, since they only share a name: take-over-import, `ImportedTakeoverBar`, `useTakeOverImport`, `WipHandoffBanner`. Also keep same-machine detection, host info, `getClonesDir`, `open-editor.ts`, and `cli-config.ts`.
- [ ] Update the comments that mention takeover (`use-client-location.ts:16-19`, the host-info route, `paths.ts:146-147`, `execution-header.tsx:802-807`).
- [ ] Screenshots of the dialog, banner, and cards, on desktop and tablet widths.

**Done when:** the whole flow works from the UI plus `ri continue` and `ri return`, takeover is gone from the UI and CLI, and `pnpm ts`, `pnpm lint`, `pnpm test`, `pnpm smoke`, and `pnpm smoke:agent` pass.

### Phase 8: Drop the takeover columns

Needs agents-view Phase 0, which has landed. Wait until you have lived with handoff and are sure you won't want takeover back (§7.1).

- [ ] Remove the six `takeover_*` columns and `uniq_executions_takeover_token` from `schema.ts`.
- [ ] Generate the migration and hand-check it:
  - the index drops first
  - the five plain columns use `ALTER TABLE ... DROP COLUMN`
  - `takeover_chat_session_id` has a foreign key, so it needs an `executions` rebuild that copies `rowid` and every other column, run under the foreign-keys-off runner (`runMigrations`)
- [ ] Dry run on a copy of prod. Record before and after counts for `executions`, `chat_sessions`, `chat_events`, `execution_tasks`, `runs`, and `handoffs`. `PRAGMA foreign_key_check` must be empty.
- [ ] Snapshot prod `data.db` before the first boot on the new code.

**Done when:** the numbers are recorded here, prod boots, and a handoff round trip still works.

### Phase 9: Docs and end-to-end check

- [ ] Add a "Superseded by `docs/handoff-spec.md`" header to `docs/local-remote-takeover-spec.md`.
- [ ] `docs/executions-spec.md`: a short "Handoffs" section (one place at a time, device chats).
- [ ] `docs/cli-distribution.md`: the new commands.
- [ ] CLAUDE.md, one line under Rules: "Handoff CLI commands (`ri connect`, `ri continue`, `ri return`, `ri serve`, `ri handoffs`) never open the database. They talk to the connected home over HTTP only."
- [ ] Manual check with the Mac Mini and the laptop. Note results here:
  1. Connect over LAN and over Beamd.
  2. Hand off a running execution: the agent stops, a WIP commit is pushed, and the note appears.
  3. `ri continue`: worktree, `.env*`, Setup, and Claude starts with the note.
  4. `ri serve` shows the app on the laptop.
  5. The laptop chat appears live in the home with a device badge.
  6. The home composer is blocked, and a trigger into that execution fails with `handed_off`.
  7. `ri return`: the home fast-forwards and the agent continues with a note that reflects the laptop chat.
  8. A second handoff of the same execution reuses the worktree, and "resume last chat" works.
  9. Bring back with the laptop offline pulls what was pushed.
  10. A Codex round trip.
  11. Revoking the laptop with an active handoff reclaims it.
  12. `ri new` in a laptop repo: the execution shows "On MacBook" in the home at once, and its chat streams.
  13. `ri track` in a folder where Claude was started by hand: the session shows up in the home and keeps following.
  14. `ri return` on work that started on the laptop: the home builds a worktree from the remote branch and its agent continues.

**Done when:** every step passes and the results are recorded above.

### 7.1 Reverting

Everything here can be undone, and one step is harder than the rest.

- **Code:** every phase is its own commits on `main`. `git revert` them, rebuild, and restart.
- **Database:** every migration here only adds tables and columns, and every new column on an existing table is nullable or defaults to 0. An older build ignores them, and `runMigrations` only applies migrations newer than the last one recorded, so older code boots on a newer database. Keep that rule for every new column so rollback stays safe.
- **The laptop's connection:** `ri disconnect` deletes `home.json` and revokes the key.
- **Handoffs in flight:** Bring back every active handoff before reverting, so no execution is left marked "On <device>".
- **Takeover:** Phase 7 removes it from the UI and CLI. Reverting those commits brings it back, since its columns are still there.
- **The hard step is Phase 8.** Once the takeover columns are dropped, getting takeover back needs a new migration that re-adds them. Do Phase 8 only when you're sure.

---

## 8. Not in this spec

- **Carrying the same conversation across machines.** Copy Claude's session file into the other machine's project folder for its worktree path, then `--resume` it. Worth a measured experiment after Phase 9. It is fragile because transcripts hold absolute paths and are keyed by folder.
- **Syncing uncommitted files without a commit** (mutagen, sshfs).
- **Direct device-to-device handoffs** (laptop to desktop). Bring back, then continue on the other device.
- **OpenCode and Cursor on the laptop.**
- **Sending messages to a laptop terminal chat from the home or a phone.**
- **Team homes (spaces), members, and Nostr.** See `docs/homes-spec.md`.
- **Retiring the laptop's standalone Ri and moving its data,** and "move my home to this machine". See `docs/homes-spec.md` Phases 6 to 8.

---

## 9. File reference

**New**
- `src/lib/handoff/{git,notes,gate,service}.ts` and tests
- `src/lib/auth/request-device.ts`
- `src/lib/api/read-json-body.ts`
- A DB-free home for the prefix digest and replace decision (for example `src/lib/import/source-fingerprint.ts`)
- `src/app/api/devices/me/route.ts`, `src/app/api/devices/me/handoffs/route.ts`
- `src/app/api/executions/[id]/handoffs/route.ts`
- `src/app/api/handoffs/[id]/{pickup,return,reclaim,send-note}/route.ts`
- `src/app/api/device-chats/route.ts`, `src/app/api/device-chats/[id]/windows/route.ts`
- `src/cli/commands/{connect,disconnect,continue,return,serve,handoffs,new,track}.ts`
- `src/app/api/devices/me/executions/route.ts`
- `src/cli/lib/{home-config,home-client}.ts`
- `src/cli/lib/handoff/{checkout,worktree,provision,launch,uploader,tail-reader,state}.ts`
- `src/lib/api/handoffs.ts`, `src/hooks/use-handoff.ts`
- `src/components/executions/handoff/{continue-on-dialog,handoff-banner,handoff-card}.tsx`
- `src/components/settings/connect-computer.tsx`
- Drizzle migrations (Phase 3 additive, Phase 8 cleanup)

**Modified**
- `src/proxy.ts`
- `src/app/api/devices/route.ts`, `src/app/api/devices/[id]/route.ts`
- `src/lib/db/schema.ts`, `src/db/types.ts`, `src/lib/db/queries.ts`
- `src/lib/executor/adapter.ts` (dispatch gate)
- Git-changing session routes under `src/app/api/sessions/[id]/`: `push`, `pull-base`, `merge`, `auto-merge`, `wip`, `continue`, `retry-setup`, `retry-setup-script`, `archive`
- `src/lib/runs/dispatch.ts`
- `src/lib/orchestrator/registry.ts` (`list_executions`, `send_session_message`)
- `src/lib/harness/registry.ts` (argv templates)
- `src/lib/import/external-agents.ts`, `src/lib/executor/reconcile.ts`
- `src/app/api/sessions/[id]/take-over-import/route.ts`
- Execution header, execution view, action bar, chat tabs, transcript rendering, and the rail session row
- `src/components/settings/devices-section.tsx`, `src/lib/api/devices.ts`
- `src/lib/auth/config-file.ts` (comment), `src/cli/index.ts`
- `docs/remote-access.md`, `docs/executions-spec.md`, `docs/cli-distribution.md`, `docs/local-remote-takeover-spec.md`, `CLAUDE.md`

**Removed** (Phases 6 and 7): everything listed under Phase 6's "Remove takeover" task, and the six `takeover_*` columns plus their index.
