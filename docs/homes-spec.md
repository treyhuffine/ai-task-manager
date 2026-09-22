# Homes, devices, and spaces: spec and task list

**Status:** not started. Written 2026-09-22.
**How to use this doc:** it is the task list. Check a box (`- [x]`) when the work lands on `main`, and append the short commit hash when useful. Keep the "Done when" lines honest: a phase is done when every line under it is true, not when the code compiles. Record surprises inline under the task they affect.

**Related docs**
- `docs/handoff-spec.md`: moving an execution between your home and a laptop. It is part of Stage 1 here and is specified in full there.
- `docs/agents-view-spec.md` (in progress): the coordination points are in §6.14.
- `docs/philosophy-and-vision.md` §10 to §14: the reasoning this builds on (Path E, "every principal gets a home", "sync down is liberal, sync up is deliberate").
- Superseded in part by this doc:
  - `docs/team-product-direction.md`: naming and table design.
  - `docs/deployment-mode-spec.md`: its shared-instance premise. Its preview gate carries over.
  - `docs/local-remote-takeover-spec.md`: superseded by handoff.

---

## 1. Summary

Ri should run your whole life from one place: personal, projects, and every business you are part of. Agents do most of the work and you make the decisions. This spec turns the model we settled on into buildable steps.

**The model in plain English**
- **You have one home.** It is the Ri that holds your stuff and runs your agents. It lives on whichever machine is always on (your Mac Mini). If you only have a laptop, the laptop is your home.
- **Everything else is a device.** Your laptop, phone and any browser are windows into your home. You add one with a QR code or a link, over any address that reaches the home: your home network, Tailscale, Beamd, or your own domain.
- **Every team has its own home, called a space.** A family, a company. Same software, running as a team home. It holds the shared tasks and notes, the members, and who is assigned to what. Its own agents keep it tidy.
- **Your home connects to your spaces.** It pulls in what is assigned to you, keeps your personal notes about that work private, and sends changes to the shared parts back. Your morning deck is built from all of it.
- **Your home is your identity.** Each space keeps its own member list, joined by invite link. Your home holds your membership in each one. There is no central account system and no Nostr for now.

```
phone    ─┐
laptop   ─┼─> your home (Mac Mini) ─┬─> Family space
browser  ─┘                         ├─> Acme space
                                    └─> other spaces
```

**What changes for you**
- `ri` on your laptop opens your Mac Mini home instead of starting a second home.
- `ri agent` on the laptop (what Claude Code calls through the Ri skill) talks to your home.
- `ri continue` pulls an execution onto your laptop and `ri return` sends it back (handoff).
- Installing Ri on a new machine asks "start a new home, or connect to mine?", so nobody ends up with two homes again.
- "Move my home here" moves everything to another machine in one guided step. The same bundle is a real full backup.
- Later: a Family space on the Mac Mini that your wife can use from her phone, then company spaces.

---

## 2. Decisions

Locked in the design conversation on 2026-09-22.

1. **One person, one home.** A second machine becomes a device of your existing home. First run on a new machine asks, and makes connecting the easy path.
2. **The home goes on the machine that is always on.** If there isn't one, the laptop. The upgrade moment ("want agents working while you sleep?") is moving the home, to your own box or to hosting.
3. **Devices have no database.** A device's data root holds `home.json` (which home, which key), handoff worktrees, and nothing else. Any code path that would create a database on a device fails loudly instead.
4. **Home or device is decided per data root.** `data.db` present means a home. `home.json` alone means a device. Neither means first run. A root with both is a home (a machine in transition), and only the handoff commands use its `home.json`.
5. **A home has an identity:** one `home` row with an id, a kind (`personal` or `team`), and a name. The kind is stored at creation. If `RI_MODE` is set, it must match or the server refuses to boot. This replaces both `MODE=personal|team` (team-product-direction) and `RI_MODE=solo|team` (deployment-mode-spec).
6. **A team home is called a space**, in the UI and in docs. It is not a "workspace" (that means a code folder, shown as "agent" in the UI) and not a "hub".
7. **Personal homes have no accounts.** Devices and their keys are the only principals, and all of them are you.
8. **Spaces have members.** One space is one team, so there is a single `members` table and no separate memberships. People join by invite link. Each member's devices are `api_keys` rows linked to that member.
9. **Your home joins a space as one of your devices** (device type `home`) and holds that key. That is how "one identity across spaces" works without a central account system.
10. **Nostr is not used now.** When spaces need a portable sign-in, Nostr becomes one linked sign-in method (NIP-98 signed requests, NIP-46 remote signers) alongside company single sign-on. Internal member ids are the keys, never public keys, because Nostr has no widely adopted key rotation or recovery.
11. **Space permissions are about actions, not hidden rows.** Everyone in a space sees the space. Roles (`owner`, `admin`, `member`) gate actions like managing members, deleting, and approving agent proposals.
12. **Sync down is liberal, sync up is deliberate.** Assigned space tasks arrive automatically. Anything personal reaches a space only through an explicit act ("Share to Family").
13. **The space owns the truth of a task:** title, description, outcome, status, due date, assignment. **You own your relationship to it:** area, order, energy, effort, snooze, reminders, your context, personal subtasks. Shared fields sync both ways. Personal fields never leave your home.
14. **A synced task's `body` is read-only locally in v1.** Your own writing about a space task goes in your context field, subtasks, or linked notes. Two-way body sync risks clobbering an open editor and leaking triage merges (§5.2).
15. **The space arbitrates conflicts:** last writer wins per field, in the order changes arrive at the space, with every overwritten value kept in version history so it can be undone.
16. **Space notes are not mirrored into your home.** Agents search a space's notes when relevant. Mirroring is a later decision.
17. **The deck is composed in your home from every source**, labelled by space, with a per-source quota so one busy space can't crowd out everything else. Spaces have no deck.
18. **Agents run on the home.** A laptop runs an execution only through handoff. No runner pool and no per-run runner picker.
19. **The home's URL is part of its identity.** Prefer a stable name (a Beamd tunnel name or your own domain), so moving the home doesn't mean re-pairing devices.
20. **Staged delivery.** Stage 1 (one home, many devices) is lived with before Stage 2 (spaces) starts. Each Stage 3 item gets its own spec before work begins.
21. **Each phase lands as its own commit(s) on `main`** in the live checkout.

---

## 3. Open questions

Not decided. None of these block Stage 1.

- **Offline access on a device** (a read-only cache when the home is unreachable). Deferred. Revisit if it bites.
- **Automatic demotion of the old machine after a move**, so it becomes a device without running `ri connect`. This spec keeps it manual.
- **Whether a space shows its agents and executions to every member**, or only to admins. The default here is admins only.
- **Whether every member may assign work**, or only admins. The default here is every member.
- **Realtime push from a space to your home** (a server event stream) versus polling. v1 polls.
- **Hosting:** where hosted homes run, pricing, and whether hosting offers an optional account. Out of scope until Phase 19.

---

## 4. Glossary

- **Home:** a Ri instance that holds data and runs agents. A personal home has one person. A space is a team home.
- **Space:** a home with kind `team`. A family or a company. Members use it directly or through their own home.
- **Device:** anything paired to a home with its own key (`api_keys` row): a browser, a phone, a laptop's CLI, or another home (type `home`).
- **Data root:** the folder a Ri home or device uses (`~/ri`, `~/ri-dev`, `~/ri-spaces/family`). The role is decided per root.
- **Member:** a person in a space. Personal homes have no members.
- **Source:** a space (later also a third-party tool) your home pulls tasks from. One `sync_sources` row each.
- **Synced task:** a task in your home that is a local copy of a space task, linked by `external_source_id` and `external_id`.
- **Shared fields, personal fields:** the field split in §6.9.
- **Handoff:** moving an execution to a device and back (`docs/handoff-spec.md`).
- **Stable home URL:** an address that survives a move, like a Beamd tunnel name or your own domain.

**Words we don't use**
- "Hub": say home or space.
- "Workspace switcher": say space switcher.
- `source` as a new column name: it already means three things (`entity_versions.source`, `stream.source`, `DeckItem.source`). New sync columns use `external_source_*`.

---

## 5. What exists today

### 5.1 Built and reused

- **Device keys:** `api_keys` (`schema.ts:665-692`), pairing links and QR codes (`buildPairingUrl`, `src/app/pair/page.tsx`), `/api/devices`, and the Devices settings pane.
- **Remote access:** the Beamd tunnel with a named, auto-reconnecting URL (`docs/remote-access.md`, `src/lib/auth/beamd-base-url.ts`).
- **Safe backups:** `backupDb`, the SQLite online backup (`src/lib/backup/index.ts:20-24`). This is the one reusable primitive.
- **Status changes:** idempotent and checked against an expected count (`task_status_changes`, `queries.ts:1001-1015, 1126-1154`). This is the template for applying remote changes.
- **Version history:** `entity_versions` history and revert for task and note updates (`queries.ts:2203-2248, 2306`).
- **Dedupe by external id**, for stream items only: `stream.externalSource` / `externalId` with a partial unique index (`schema.ts:208-212, 234-236`).
- **Read-only task listing** from Todoist, Linear, Jira and Asana (`src/lib/connectors/task-sources.ts`). This is the seed for third-party sources.
- **The connector engine**, including an outbound-only Slack provider (`packages/connectors`).
- **The deck is global across all tasks** (`src/lib/ai/generate-deck.ts`), so synced tasks become eligible with little change.
- **The handoff spec** already defines device identity on requests, `ri connect`, `home.json`, and `homeFetch`.

### 5.2 Gaps found while mapping

1. **`ri` on any machine silently creates a new home.** `start.ts:130, 156` call `ensureLocalToken`, and `getDb()` then creates `data.db` and the persona files. This is how a laptop ends up as a second home.
2. **No home identity, no role, no restore.**
   - `ri snapshot` excludes attachments and all of `.config` (`src/lib/export/snapshot.ts:7-9, 114-116`).
   - `scripts/backup.ts` deletes the dump it just made (its upload lines are commented out).
   - `docs/storage-architecture.md:85-87` wrongly says snapshots include attachments.
3. **`ri agent` runs in-process against a local database** (`src/cli/commands/agent.ts:80`). On a device, that means a phantom home, and the global Ri skill points agents at it.
4. **A missing worktree folder gets a fresh branch off base.** `ensureWorktreeReady` (`src/lib/runs/dispatch.ts:499`) does this instead of checking out the execution's own branch. After a move, every execution would lose its branch.
5. **Absolute paths in the database:**
   - `workspaces.cwd` and `worktree_root`
   - `executions.worktree_path` (172 of 175 rows in prod)
   - `reference_folders.path`
   - `chat_sessions.external_transcript_path` (400 of 616 rows)
   - `external_session_imports.source_path`
6. **Harness transcripts live outside the root**, keyed by absolute folder (`~/.claude/projects/<escaped cwd>`, `~/.codex`), so resuming a chat breaks when paths change. The "rollover on missing transcript" in `docs/chat-sessions.md:404, 648` is not implemented.
7. **No team data model.** No members, invites, assignment, people, space routes, sync tables, or task linkage columns.
8. **`entity_versions` can't serve as an audit trail yet:**
   - Creates are not versioned.
   - `deleteTask` and `deleteNote` purge versions (`queries.ts:845-847, 2100-2102`), although the schema says they survive.
   - Snapshots omit area, parent, tags, sort order and completion.
   - `source` has no remote actor.
   - `captureEntityVersion` runs after commit and is best effort, so it can't be a sync outbox.
9. **Actor attribution is hard-coded.** `ctx.actor` is never set by any transport (agents-view §5.4). REST routes hard-code `'human'`, and `update_task` defaults to `'ai'` even for the local CLI.
10. **Deployment mode is not implemented**, and its doc assumes one shared instance (Path B, rejected in the vision doc). Its preview gate is still right for spaces.
11. **Naming collisions:** `solo` vs `personal`, the "workspace switcher" vs workspaces, and `source` meaning three things.
12. **The web onboarding Import step only reads the server's own history** (`~/.claude` and `~/.codex`), so a laptop's agent history can't reach a remote home.
13. **Two independent "onboarded" flags:** `config.json.onboardedAt` (machine) and `user_state.onboarded_at` (database).
14. **Triage merges write into the body.** `merge_task` appends capture text to the target's body (`queries.ts:3136` to `2857`). On a synced task that would leak personal captures into the space.
15. **Open subtasks block completion.** `guardOpenChildren` (`queries.ts:1105`) would make a completion coming from the space fail when you have personal subtasks open.
16. **No realtime channel for tasks.** Inbound changes only appear on window focus or after 30 s.
17. **`cli-distribution.md` documents paths and onboarding that don't exist** (`~/.<app>/db.sqlite`, a provider-key prompt).

---

## 6. Design

### 6.1 Machine roles and home identity

**The `home` table**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | The home id. Stable across moves |
| `created_at`, `updated_at` | shared `timestamps` spread | |
| `kind` | text, NOT NULL, enum `personal \| team` | A fact, required at creation, no default |
| `name` | text, NOT NULL | Shown to devices and in space member lists |

- **Exactly one row.** The migration seeds it only for existing databases (`INSERT ... SELECT` guarded on `user_state` having a row), with kind `personal`, since every existing database is a personal home.
- **Fresh databases** get the row from their creator with an explicit kind: `ri start` creates `personal`, and `ri space create` creates `team`. On a fresh database, `user_state` is empty while migrations run, so the seed never fires there.
- **`getHome()`** throws if the row is missing.
- **At boot**, if `RI_MODE` is set and differs from `home.kind`, refuse to start with a clear message.

**Roles** (`src/lib/config/role.ts`)
- `getMachineRole(root)` returns `home` (`data.db` exists), `device` (only `home.json` exists), or `fresh` (neither).
- **`getDb()` guard:** in a device root, throw `DeviceRootError` ("This computer is a device of <home URL>. Run this on your home, or run `ri` to open it.") instead of creating a database.

**What `ri` (no subcommand) does per role**
- **Home:** today's behavior.
- **Device:** opens the home in the browser, logged in (`buildPairingUrl(token, homeUrl)`), then exits. `--no-open` prints the link instead. If the home is unreachable it says so and prints the URL. The browser and the CLI on one laptop share one key, so one laptop is one device.
- **Fresh:** the first-run choice (§6.2).

**`ri status`** (new, any role) shows the role, the root, the home's name and URL, this device's name, whether the home is reachable, and on a home whether the Beamd tunnel is up.

**The two onboarding flags stay, with defined meanings.** Document this in code comments and `docs/storage-architecture.md`.
- `user_state.onboarded_at`: this home finished onboarding. It moves with the home.
- `config.json.onboardedAt`: this machine finished CLI setup. It stays with the machine.

### 6.2 First run: new home or connect

When `ri` runs in a fresh root on a terminal:

```
Set up Ri on this computer
  1. Start a new home here
  2. Connect this computer to my existing home
  3. Move my existing home to this computer
```

- **The default is 1** unless there is a sign a home already exists. The default becomes 2, with a one-line reason, when:
  - a pairing link was passed (`ri --connect <link>`), or
  - Beamd is logged in on this machine and the default tunnel name is already taken (`name_taken`).
- **Option 2** runs `ri connect` (handoff spec §6.4), then opens the home.
- **Option 3** runs the move flow (§6.6).
- **Without a terminal** (no TTY), keep today's behavior and print one line: "Started a new home. If you already have one, run `ri connect` instead."
- **The web welcome wizard** gets a small link on its first step: "Already have a Ri home? Use this computer as a device instead." By then this server is already running, so the link explains how to stop it and run `ri connect`.

### 6.3 Devices

`docs/handoff-spec.md` Phases 1 and 2 already specify:
- the request-level device identity (`x-ri-api-key-id`)
- `GET /api/devices/me`
- `ri connect`, `home.json` and `homeFetch`
- the "Connect a computer" settings flow

This spec adds:
- **`api_keys.cli_last_seen_at`** (nullable text), set by the proxy when the user agent starts with `ri-cli/`. A laptop's browser and CLI may share a key, so "is this a CLI device" can't come from the last user agent. This amends handoff §6.3.
- **`api_keys.member_id`** (nullable, FK `members.id`) for spaces (§6.7). It stays null in personal homes.
- **A new device type `home`**, for another Ri home connected as a device (§6.8).
- **Pairing works over any URL that reaches the home.** Settings shows the stable home URL first. Pairing over plain HTTP from outside a private network shows a warning, because the token would cross the open internet in the clear.

### 6.4 `ri agent` and the Ri skill on a device

On your laptop, Claude Code or Codex uses the Ri skill, which calls `ri agent <action>`. That must reach your home.

- **New route `POST /api/orchestrator/actions/[name]`.** JSON params in, the same `{ ok, action, result | error }` envelope as `runAction` out. It runs `runAction(name, params, { remote: true, actor: { source, deviceId } })` and requires the bearer.
- **`src/cli/commands/agent.ts`:** on a device root, send each action through `homeFetch` instead of calling `runAction` in-process. On a home, nothing changes.
- **Device calls use `ctx.remote = true`.** A laptop can't meaningfully pass paths on the home's disk. Actions that require the trusted local CLI keep refusing, with a clear message. The task lists those actions and decides each one.
- **Other command groups:** the `ri trigger` group routes the same way, since it is built on `runAction`. `ri browser` refuses on a device ("the agent browser runs on your home").
- **The global skill** (`configureGlobalSkill`) writes a device variant: no app root path, plus a note that `ri agent` talks to <home name> over the network.
- **`ActionContext.actor` gains `deviceId`.** The agents-view spec (Phase 4) wires session and execution provenance. Land both in one shape (§6.14).

### 6.5 Where work runs

- **Agents run on your home.** It is always on, so long work continues while your laptop is closed.
- **For a tight loop, first move your view, not the work:** open the preview through the tunnel, and edit the home's files from your laptop editor over SSH (Cursor and VS Code both do this).
- **When the work must run on the laptop, use handoff** (`docs/handoff-spec.md`): `ri continue`, `ri serve`, `ri return`. Code moves by branch, chats stay where they ran and are uploaded to your home, and notes carry context both ways.

**Device agent history import (`ri import-chats`)**

On a device, after handoff Phase 5, this uploads the laptop's existing agent history to your home.
- **Finds** the laptop's Claude and Codex sessions (agentex `localHistory.discover`), grouped by repo.
- **Matches** each repo to a home workspace by git remote URL, not by folder path, since paths differ between machines. It reuses the normalization in handoff §6.7. Unmatched repos are listed and skipped.
- **Uploads** each chosen session as a device chat through the handoff §6.10 endpoints, attached to a new imported execution in the matched workspace. The chat has `origin_device_id` set and "take over" disabled.
- **Endpoint change:** `POST /api/device-chats` accepts `{ workspaceId }` (creates an imported execution) as well as `{ handoffId }`. The device scope rule is the same: the chat's origin device is the caller.
- **Re-runs** only upload new sessions and new lines, using the existing cursors.
- **The web Import step** gains a hint: "To import history from another computer, run `ri import-chats` there."

### 6.6 Moving a home

One guided step moves a home to another machine. It keeps the home's id, keeps every device working when the URL is stable, and fences the old machine so it can never start as a second home. The same bundle also works as a file, which gives Ri a real full backup and restore for the first time.

**The bundle** (`src/lib/home/bundle.ts`)

A `.tar.gz` with `manifest.json`: home id, name, kind, schema version, source root, source home directory, created at, and a sha256 per file.

It includes:
- `data.db`, via `backupDb` (never a file copy)
- `attachments/` and `.archive/`
- the persona files (`CLAUDE.md`, `MEMORY.md`, `USER.md`, `SOUL.md`), `skills/`, deck instructions, and `triage-context.md`
- from `.config`:
  - `connectors/` with its key
  - `agents/credentials.json` with its key
  - `notifications/vapid.json` (the database's push subscriptions only work with this keypair)
  - `preview.json`
  - `sources/` (space credentials, §6.8)
- the home-scoped `config.json` fields: `localToken`, `tunnelName`, `tunnelUrl`, `autoTunnel`, `voiceEnabled`, `globalSkillEnabled`, and the browser preferences
- an optional `transcripts/` section: the Claude and Codex files referenced by `chat_sessions.external_transcript_path`, plus the orchestrator's app-root sessions, stored with their original absolute paths

It excludes machine-local things:
- `.work/` (worktrees, clones, runtime files), `.config/tls/`, `.config/browser/`, and `.config/cli-config.json`
- the `config.json` fields `lastPort`, `staticUrl` and `browserChromiumPath`
- the derived mirror folders (`tasks/`, `notes/`, `areas/`, `stream/`), which `reconcileAll` rebuilds
- `snapshots/`

The bundle contains secrets. It is written with mode 0600, and the CLI says so.

**Commands**
- **`ri home export <file>`** (home only). Checkpoints the database and writes the bundle. This is the full backup. `--no-transcripts` skips the transcript section.
- **`ri home import <file>`** (fresh root only, and it refuses if `data.db` exists). Restores, then runs the same post-restore steps as a move.
- **`ri home move-here`** (a fresh root, or first-run option 3). The network move below.

**Network move, step by step**
1. **Pair first.** On the new machine, `ri connect` to your current home as a normal device (link or QR). This proves you own the home without a new token type.
2. **Preflight.** `ri home move-here` asks the home via `POST /api/home/move/preflight`, which returns:
   - running agents and queued runs
   - executions whose branches have unpushed commits or dirty worktrees
   - active handoffs
   - sizes (database, attachments, transcripts)
   - whether the home URL is stable (a Beamd name or custom domain) or will change (a LAN or Tailscale address)
3. **Fix-ups.** The CLI shows the preflight and offers them: push every unpushed branch (the handoff `checkpointAndPush` helper), bring back handoffs, stop agents.
4. **Request.** `POST /api/home/move/request` records a move request. Every open browser of the home shows a blocking prompt: "<device> wants to become your home. Approve?", with the preflight summary. Approval needs a person in the home UI. The CLI waits.
5. **Moving state.** On approval the old home enters it:
   - scheduler and triggers stop, and agents are stopped
   - every write returns 503 `home_moving`
   - reads keep working
   - "Cancel move" in the old home's UI undoes this until completion
6. **Download.** `GET /api/home/move/bundle` streams the bundle. Only the requesting device may call it, and only after approval. If the download fails, it restarts.
7. **Restore.** The new machine verifies checksums and restores into its root before anything calls `getDb()`. Migrations run on first open.
8. **Path rewrite** (below).
9. **Tunnel handover, when the URL is a Beamd name.** The old home closes its tunnel and sets `autoTunnel` to false (`POST /api/home/move/release`). The new machine logs into Beamd (device-code flow) and opens the same name (`openAndSaveBeamdBaseUrl`). With a stable URL, devices, push notification links and connector OAuth redirects keep working.
10. **Complete.** The new machine calls `POST <old>/api/home/move/complete`. The old home writes a `MOVED` marker in its root (new URL and date) and stops its server.
    - A home refuses to boot with a `MOVED` marker.
    - `ri` on that root offers to rename it to `~/ri.moved-<date>` and run `ri connect`.
11. **Old host key.** On first start, `ensureLocalToken` mints a new host key. The old host key row becomes "<old machine> (former home)" with type `computer`, so the old machine can later reconnect as a device. It can also simply be revoked.
12. **Setup checklist** in the new home's UI: harness logins, global skill, voice, TLS if used, browser profile logins, and connector checks.

**If the URL changes** (a LAN or Tailscale address), the preflight says so first and recommends a Beamd name or a custom domain. After the move:
- Phones and browsers pair again (the new home shows a pairing QR).
- CLI devices run `ri connect --url <new url>`, which keeps the same key, because the key moved with the database.

**Path rewrite** (`src/lib/home/rewrite-paths.ts`), in one transaction on the new machine:
- **Detect identical paths and skip.** Many Mac to Mac moves keep the same username and root, and need no rewrite.
- **Old root prefix to new root prefix** in `workspaces.worktree_root`, `executions.worktree_path`, `chat_sessions.external_transcript_path`, `external_session_imports.source_path`, and reference folders under the root.
- **Old home directory to new home directory** (a different username) in the same columns, plus `workspaces.cwd` and `reference_folders.path`.
- **Missing workspace folders.** If a `workspaces.cwd` doesn't exist on the new machine:
  - With a git remote: offer to clone it to the same relative path under the home directory. The CLI lists first and clones on confirm.
  - Otherwise the UI shows "Folder not found on this computer" with "Choose folder".
- **Transcripts.** Each bundled transcript is written to its new location, with the Claude project folder name re-derived from the rewritten cwd. A chat whose transcript can't be placed keeps its Ri history, and starts a fresh harness session on next send with a summary of the old chat as the first message (reusing the handoff note builder). This also implements the rollover that `docs/chat-sessions.md` describes.
- **Worktrees are not moved.** Executions get new worktrees on next use, on their own branch (below).

**Reprovision on the execution's own branch** (fixes §5.2 gap 4, used by moves and by handoff Phase 9)
- When an execution's worktree folder is missing, `ensureWorktreeReady` and `resumeWorktreeForSession` check out the execution's existing branch: the local branch if present, otherwise fetch `<remote>/<branch>` and track it.
- Only when the branch exists nowhere do they fall back to a fresh branch off base, and they record a setup warning saying so.

### 6.7 Spaces

A space is a Ri home with kind `team`. It runs the same codebase, the same queries and the same agents.
- **What it holds:** the team's shared tasks, notes, areas, members, assignments, and its own agents.
- **What it doesn't have:** a deck.
- **How members use it:**
  - directly, from a browser or phone paired as their device
  - through their own home, which syncs their assigned work

**Creating and running a space**
- **`ri space create <name> [--root <path>] [--port <n>] [--tunnel-name <name>]`** creates:
  - a data root (default `~/ri-spaces/<slug>`)
  - a database with a `team` home row
  - an owner member for you
  - an owner device key for your browser

  It prints the space URL, a pairing link for your browser, and a "connect your home" link (§6.8).
- **`ri start --root <path>`** starts it (the same as `RI_ROOT`).
- **Several homes on one machine** need distinct ports and Beamd tunnel names, and `ri space create` picks both. Document a launchd plist per root so each one stays running.

**`members`** (used only in spaces)

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `name` | text, NOT NULL | |
| `role` | text, NOT NULL, enum `owner \| admin \| member` | Policy, no default. The creator sets it |
| `status` | text, NOT NULL, enum `active \| removed` | Policy, no default |
| `removed_at` | text | |

- **Every request in a space resolves to a member** through its key (`api_keys.member_id`). A key without a member is refused in a space, except for `/api/health` and the join routes.
- Removing a member revokes all of their keys.

**`invites`**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `token_hash` | text, NOT NULL, unique | Only the hash is stored |
| `role` | text, NOT NULL, enum | The role to grant |
| `created_by_member_id` | text, NOT NULL, FK `members.id` | |
| `expires_at` | text, NOT NULL | 7 days by default |
| `accepted_at`, `accepted_member_id` | text | Single use |
| `revoked_at` | text | |

- **The link** is `<space url>/join#invite=<token>`. The token sits in the URL fragment, so it never reaches server logs.
- **Opening it in a browser:** `/join` asks for a name, then `POST /api/join { invite, name }` creates the member and a device key for this browser and logs it in.
- **Pasting it into your own home** joins and connects in one step (§6.8).
- **More devices:** a member adds them from the space's own "Add device" flow while logged in. The new key gets their member id.

**Permissions** (`src/lib/space/permissions.ts`, `can(member, action, entity?)`)

| Action | owner | admin | member |
|---|---|---|---|
| Read everything | yes | yes | yes |
| Create and edit tasks and notes | yes | yes | yes |
| Assign and unassign | yes | yes | yes |
| Delete tasks and notes | yes | yes | only their own |
| Approve agent proposals | yes | yes | on items assigned to them |
| Invite, remove members, change roles | yes | yes, except owners | no |
| Space settings, agents, connectors | yes | yes | no |

- **Enforcement** is in route handlers and orchestrator actions, through `requireMember(request)` and `ctx.actor.memberId`.
- **Personal homes skip this** based on the home kind.
- **"Only their own"** needs `created_by_member_id` on tasks and notes.

**Space-safe rules** (carried over from `docs/deployment-mode-spec.md`)
- **Preview is off in spaces**, so no untrusted app code runs on the space's origin, unless the owner turns on `allow_unsafe_preview`.
- **No host code runs because of a member's free text without an approval step.** The team-agents phase formalizes propose-then-approve.
- **Every member sees the same data** (it is a commons). The exception is device and key management: members manage their own keys, and admins see all.

**Space UI (v1, deliberately small)**
- **Shown:**
  - Tasks: a board by status, an assignee filter, "Mine", and an assign control
  - Notes
  - Members: list, invite, roles
  - Activity: recent changes and who made them, from versions and status changes
- **Hidden:** the deck, stream capture and triage, personal settings (voice, persona files). Agents and executions are visible to admins only.
- **A space banner** in the top bar shows the space's name and color, so a space tab is never mistaken for your home.

### 6.8 Connecting your home to a space

**Joining**
1. In the space, logged in from a browser: Settings, **Connect my Ri home**. The space mints a key of type `home` for your member and shows a link: `<space url>/#token=<key>`.
2. In your home: Settings, Spaces, **Connect a space**, then paste the link. Your home:
   - calls `GET <space>/api/health`, which must report a Ri space
   - calls `GET <space>/api/devices/me` to learn your member id and name
   - calls `GET <space>/api/space` to get the space's id, name and color
   - stores the connection
3. **Shortcut:** pasting an invite link into Connect a space runs `POST <space>/api/join { invite, name, deviceType: 'home' }`, so a new member joins and connects in one step.

**`sync_sources`** (in your home)

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `kind` | text, NOT NULL, enum `ri_space` | Later also `linear`, `jira`, `asana`, `todoist`. A fact |
| `remote_home_id` | text | The space's home id |
| `label` | text, NOT NULL | |
| `color` | text | |
| `base_url` | text, NOT NULL | |
| `remote_member_id`, `remote_member_name` | text | |
| `cursor` | text | Last change-feed sequence |
| `last_pulled_at`, `last_pushed_at`, `last_error` | text | |
| `status` | text, NOT NULL, enum `active \| paused \| revoked` | Policy, no default. The creator sets `active` |
| `mirror_to_disk` | integer boolean, NOT NULL | No schema default. The connect dialog asks, defaulting to on |

The key lives in `.config/sources/<id>.json` (0600, sealed like connector secrets), never in the database. It moves with the home in the bundle.

**The space's change feed**
- **`change_log`** (in spaces): `seq` (integer primary key, autoincrement), `created_at`, `entity_type`, `entity_id`, `revision`, `kind` (`upsert` or `delete`). It is appended in the same transaction as every task write in a team home, inside `queries.ts`.
- **`tasks.revision`**: integer, NOT NULL, default 0. A zero counter, which CLAUDE.md allows as a structural default. Incremented on every shared-field or status write in a team home.
- **`GET /api/space/changes?since=<seq>&limit=500`**, callable by `home` devices. It returns:
  - tasks assigned to the member that changed after `seq`
  - tombstones for tasks unassigned from them or deleted
  - for each task: shared fields, revision, assignee name, and last actor
  - the new cursor

**Pull** (`src/lib/sync/pull.ts`)

Runs every 60 s per active source, on window focus, and on "Sync now". Each change goes through `applyRemoteTask`, which lives in `queries.ts` per the query-layer rule:
- **Upsert** by `(external_source_id, external_id)`. For Ri spaces, the local task id equals the space's task id, so `[[task:id]]` links and parents resolve across the boundary.
- **Write shared columns only.** Personal columns are never touched.
- **Status changes** go through `transitionTaskFromSync`:
  - It records a `task_status_changes` row with `actor_source: 'sync'`, the remote actor, and the idempotency key `sync:<source>:<revision>`.
  - It may move between any two statuses. The local transition rules don't override the space's decision.
  - A completion with open personal subtasks completes the task, leaves the subtasks open, and flags it as "completed in <space>". This fixes §5.2 gap 15.
- **Embeddings and search index** update as usual.
- **The markdown mirror** only writes synced tasks when `mirror_to_disk` is on, with `space`, `external_id` and `external_url` in the frontmatter.
- **Tombstones:**
  - Unassigned sets `sync_state = 'unassigned'`. Deleted sets `deleted_upstream`.
  - The task leaves the deck and active views but keeps your personal enrichment.
  - Two actions: "Keep as a personal task" (sets `detached` and stops syncing) and "Remove".
- **Publish a task-changed event** on the realtime bus, so open lists update without waiting for focus.

**Push** (`src/lib/sync/push.ts`)
- **`sync_outbox`** rows are written in the same transaction as the local change:
  - by `updateTask`, when shared fields change on a synced task
  - by the lifecycle commands, for status
- **Columns:** `id`, timestamps, `source_id`, `entity_id`, `op` (`patch` or `status`), `payload` (shared fields only), `base_revision`, `idempotency_key`, `state` (`pending | sent | acked | rejected | failed`, a policy value the creator sets to `pending`), `attempts`, `last_error`.
- **A worker sends pending rows in order per task:**
  - `POST <space>/api/space/tasks/:id/patch { fields, baseRevision, idempotencyKey }`
  - `POST <space>/api/space/tasks/:id/transition { to, baseRevision, idempotencyKey }`
- **The space applies the change:**
  - last writer wins per field
  - records a version with the member as the actor
  - bumps the revision
  - returns the task's current shared state, which your home applies with `applyRemoteTask`
- **Rejections** (permission, deleted in the space) mark the row `rejected`, apply the space's state, and show a small notice on the task.
- **Durability:** the outbox survives restarts and time offline. The space dedupes by `idempotency_key`.

### 6.9 The field split

| Shared: synced both ways | Personal: never leaves your home | Local only |
|---|---|---|
| title, description, outcome | area, sort order | ids, timestamps, status counters |
| status, completed at | energy, effort, context tags | workspace (code folder), raw input |
| hard deadline | your context (`userContext`), `aiContext` | folded headings, last viewed, surfaced, progress |
| recurrence, only when the space set it | reminder, snooze (`resurfaceAfter`), times deferred | embeddings, search index rows, mirror file |
| assignment (read-only locally, kept in `external_meta`) | personal subtasks (local rows under the synced task) | blocked-on (v1) |
| body (read-only locally in v1) | linked notes, target frequency, personal attachments | |

- **Read-only fields are enforced in the query layer.** `updateTask` rejects edits to read-only shared fields of a synced task (body, assignment) with a clear error, and the UI shows them as read-only.
- **Triage merges** into a synced task append to `userContext` or create a personal subtask, never the body. This fixes §5.2 gap 14.
- **Local deletes are blocked.** A synced task belongs to the space, so deleting it locally isn't allowed. Instead there are two options: "Hide from my deck" (a personal snooze) and "Detach".

**Sharing up** (deliberate)
- **Where:** "Share to <space>" on a personal task or note, and "New task in <space>" in the task composer when a space is the active scope.
- **How:** it calls `POST <space>/api/space/tasks` (or `/notes`) with the shared fields and the local id. Ids are UUIDv7, so there is no collision.
- **After:** the space creates the item with that id, and the local task converts in place into a synced task. Your personal fields stay put.

**Provenance across the boundary**
- **New actor value:** `entity_versions.source` and `task_status_changes.actor_source` gain `'sync'`.
- **New columns on both tables:** nullable `origin_source_id` (FK `sync_sources.id`) and `remote_actor` (JSON: member id, member name, and whether it was a person or an AI).
- **In the UI:** "Changed by Alice in Family".

**Task table additions** (personal homes and spaces share one schema)
- `external_source_id` (text, FK `sync_sources.id` ON DELETE SET NULL), `external_id`, `external_url`
- `remote_revision` (integer), `remote_synced_at` (text)
- `sync_state` (text, enum `linked | unassigned | deleted_upstream | detached`, null for native tasks)
- `external_meta` (JSON: assignee name, the space's status label, priority)
- `revision` (integer, NOT NULL, default 0, used by spaces)
- `assignee_member_id` and `created_by_member_id` (FK `members.id`, used by spaces)
- a partial unique index on `(external_source_id, external_id) WHERE external_id IS NOT NULL`

These are all `ALTER TABLE ADD COLUMN`. There is no rebuild, so `tasks_fts` rowids are untouched.

**Note table additions:** `created_by_member_id` (spaces). Note sync is Stage 3.

### 6.10 The deck and navigation across spaces

**Deck** (`src/lib/ai/generate-deck.ts`)
- **Eligibility:** synced tasks with `sync_state = 'linked'` are eligible like native tasks. Others are not.
- **Per-source quotas:** candidate selection takes up to 30 personal tasks plus up to 15 per space, instead of one 50-row list by sort order. Tune after use.
- **Prompt rows** get the space label, who assigned it, and the space's due date.
- **`DECK.md`** gains one line: space work and personal work are ranked together, by the same judgment.
- **Client types:** `DeckItem` and `AlternativeItem` get `spaceId` and `spaceLabel`, derived from the task row. `DeckChange` stores the space label. None of these is named `source`.
- **UI:** a space pill next to the area pill, and a space filter next to the area filter.
- **Actions:** completing a synced task from the deck pushes through the outbox. "Not today" stays personal.

**Space switcher**
- **A scope pill in the top bar** (`src/components/dashboard/top-hud.tsx`): All, Personal, Family, Acme.
  - Stored as `user_state.active_space_id` (nullable, where null means All).
  - Filters the content plane (deck, tasks, notes). The default is All.
- **Not a rail tab.** The rail lists agents and executions (the agents-view redesign), while spaces are about tasks and notes.
- **"Open <space>"** opens the space's own UI in a new tab, logged in. Your home asks the space for a browser login link with its `home` key (`POST <space>/api/devices/browser-link`), which mints one browser key for your member the first time and reuses it after.
- **A small colored space dot** marks space tasks everywhere a task appears: lists, deck, links.

### 6.11 Identity

**How identity works with no central account system**
- **Personal home:** you are the only principal. Devices are keys.
- **Space:** members join by invite link. Their devices, including their own home, are keys linked to the member.
- **You across spaces:** your home holds your membership key for each space. Each space knows you as its own member record.

**Later sign-in methods (Phase 17)**
- **`member_identities`** (in spaces): `member_id`, `kind` (`nostr | oidc | email`), `subject` (a hex public key, issuer plus subject, or an address), `verified_at`. Unique on `(kind, subject)`.
- **Sign in with Nostr:** a NIP-98 signed request. The space looks up the identity and mints a device key. With NIP-46, a signer app holds the key so it never touches Ri. You link Nostr to an existing member by signing a challenge while logged in.
- **Company single sign-on:** OIDC.
- **Invite links stay the baseline for everyone.**
- **A hosted service may offer an optional account later** as a convenience. Nothing in Ri requires one.

### 6.12 Team agents (Stage 3 outline)

- **Groundskeeper:** a standing agent in each space that keeps the shared list from rotting: stale tasks, duplicates, unassigned work, notes drift. Modelled as a trigger per `docs/heartbeat-spec.md`, suggest-first and graduated by acceptance.
- **Slack bot:** the space's chat surface through an inbound Slack connector (Events API). It needs:
  - mapping Slack users to members
  - multi-party sessions
  - propose-then-approve for every change it makes, with a named member approving

### 6.13 Hosting (Stage 3 outline)

- **A hosted home is simply a home on someone else's always-on machine.** "Move my home to hosting" is the move flow with a hosted target.
- **The hosted domain gives a stable URL**, and the data stays yours (`ri home export` at any time).
- **This is the natural upgrade:** "want agents working while you sleep and don't own a server?"

### 6.14 Coordination with the agents view

- **`ActionContext.actor`:** agents-view Phase 4 adds session and execution provenance. This spec adds `deviceId` (Phase 3) and `memberId` (Phase 10). Agree one shape before either lands.
- **The `harness` column:** agents-view Phase 1 moves the engine onto `chat_sessions.harness`. Imported and device chats are created through `createExecutionChat`, so they follow it.
- **Rail vs top bar:** the rail belongs to agents and executions. The space switcher lives in the top bar.
- **Migrations:** nothing in this spec rebuilds a table. The one rebuild in this whole plan is handoff Phase 7 (dropping takeover's foreign-key column), which waits on agents-view Phase 0.

### 6.15 Your own machines

Your setup today: the laptop has `~/ri` (a second home), the Mac Mini has `~/ri` (your real home), and the laptop also has `~/ri-dev` (your dev home for building Ri). The target: the Mac Mini is the only home, the laptop is a device, and `~/ri-dev` stays for development. Phase 8 is the runbook. Every step renames rather than deletes, and counts rows before anything moves.

---

## 7. Phases

**Stage 1: one home, many devices.** Phases 0 to 8.
**Gate:** live with Stage 1 for at least two weeks, with one home and the laptop as a device. Record friction here before Stage 2.
**Stage 2: spaces.** Phases 9 to 14.
**Gate:** live with the Family space for two weeks and record a go or no-go.
**Stage 3:** Phases 15 to 19. Each one needs its own spec first.

### Phase 0: Align the docs

- [ ] `docs/team-product-direction.md`: a header pointing here. Replace "workspace switcher" with space switcher, `MODE=personal|team` with `home.kind`, `source`/`external_id` with `external_source_id`/`external_id`, and "users, memberships" with `members`.
- [ ] `docs/deployment-mode-spec.md`: a header saying its shared-instance premise is superseded (Path B), and that its preview gate and space-safe rules carry into spaces (§6.7).
- [ ] `docs/philosophy-and-vision.md` §17: update the identity question. Invite links now, then linked sign-in methods (Nostr, single sign-on) later, and no central accounts.
- [ ] `docs/storage-architecture.md`: say snapshots exclude attachments and `.config`, align the `data.db` sync statement with `paths.ts`, and point machine moves to §6.6.
- [ ] `docs/cli-distribution.md`: the real paths (`~/ri/data.db`, `.config/config.json`), the real onboarding, and the new commands.

**Done when:** no doc describes a design this spec replaces without saying so.

### Phase 1: Device identity and `ri connect`

This is `docs/handoff-spec.md` Phases 1 and 2, plus:

- [ ] `api_keys.cli_last_seen_at`, set by the proxy for `ri-cli/` user agents. The "Continue on…" picker and the Devices pane use it.

**Done when:** handoff Phases 1 and 2 are done, and the laptop shows as a CLI device.

### Phase 2: Home identity and machine roles

- [ ] The `home` table, the migration seed for existing databases, and explicit creation with a kind for fresh ones (§6.1).
- [ ] `getHome()` and the `RI_MODE` boot check, plus tests.
- [ ] `src/lib/config/role.ts` (`getMachineRole`), plus tests: home, device, fresh, and a root with both.
- [ ] The `getDb()` device guard, plus a test that nothing is created in a device root.
- [ ] `ri` by role: a device opens the home logged in, a fresh root gets the first-run choice (§6.2), plus tests of the branching.
- [ ] First-run defaults: the `--connect <link>` flag and the Beamd `name_taken` probe, plus the no-TTY message.
- [ ] Web welcome: the "use this computer as a device instead" link and its help text.
- [ ] `ri status`.
- [ ] Settings: a "This computer is your home" section with the home name (editable), the id, and whether the URL is stable.
- [ ] Document the two onboarding flags (§6.1).
- [ ] CLAUDE.md: a short "Homes and devices" section covering roles per root, devices never opening the database, spaces as team homes, and `external_source_*` naming.

**Done when:** `ri` in a fresh root asks. On the laptop, in a fresh root after `ri connect`, `ri` opens the Mac Mini home. No command creates a database in a device root.

### Phase 3: `ri agent` and the Ri skill on a device

- [ ] `POST /api/orchestrator/actions/[name]`, plus tests: the envelope matches the in-process call, `remote: true`, and `deviceId` is on the actor.
- [ ] `ActionContext.actor.deviceId`, agreed with agents-view Phase 4 (§6.14).
- [ ] Route `src/cli/commands/agent.ts` by role, plus tests.
- [ ] Route the `ri trigger` group the same way. `ri browser` refuses on a device.
- [ ] Audit every action that requires the trusted local CLI and decide its device behavior. Record the decisions here.
- [ ] The device variant of the global skill.
- [ ] Smoke test: in a device root, `ri agent create_task` creates the task on the home.

**Done when:** Claude Code on the laptop, using the Ri skill, creates and updates tasks on the Mac Mini home, and nothing is written locally.

### Phase 4: Handoff

This is `docs/handoff-spec.md` Phases 3 to 8.

**Done when:** the handoff spec's end-to-end checklist passes.

### Phase 5: Device agent history import

Needs handoff Phase 5.

- [ ] `POST /api/device-chats` accepts `{ workspaceId }` and creates an imported execution, plus device-scope tests.
- [ ] Match workspaces by git remote URL (handoff §6.7 normalization), plus tests.
- [ ] `ri import-chats`: find, group, match, choose, upload, and resume on re-run, plus tests.
- [ ] The web Import step hint.

**Done when:** the laptop's Claude and Codex history appears in the Mac Mini home, under the right agents, marked as coming from the laptop.

### Phase 6: Full export and import, and reprovisioning on the branch

- [ ] The bundle format, manifest and writer (`src/lib/home/bundle.ts`), plus tests: contents, exclusions, checksums, 0600.
- [ ] `ri home export` with `--no-transcripts`.
- [ ] Restore (`src/lib/home/restore.ts`), plus tests. It refuses when `data.db` exists, verifies checksums, merges the home-scoped config fields, and runs before any `getDb()`.
- [ ] `ri home import`.
- [ ] Path rewrite (`src/lib/home/rewrite-paths.ts`), plus tests: identical paths skip, a root change, a username change, a missing cwd.
- [ ] Transcript placement with the re-derived Claude project folder, plus tests.
- [ ] Rollover on a missing transcript: start a fresh harness session seeded with a summary (the handoff note builder), plus a test.
- [ ] Workspaces with a missing folder: the UI state, "Choose folder", and "Clone from remote".
- [ ] Reprovision on the execution's own branch (`ensureWorktreeReady`, `resumeWorktreeForSession`), plus tests.
- [ ] Round-trip test: export a seeded test home, import it into a new root at a different path, boot, and check row counts, that device keys are valid, and that a chat resumes or rolls over.
- [ ] `docs/storage-architecture.md`: `ri home export` is the full backup. `ri snapshot` stays the quick database-plus-mirror snapshot.

**Done when:** a real `ri home export` of the Mac Mini home imports into a temporary root on the laptop (nothing replaced), boots, and shows the same row counts. Then delete the temporary root.

### Phase 7: Move a home over the network

**Schema:** a `home_moves` table on the old home:
- `id`, timestamps, `device_id` (FK `api_keys.id`)
- `state` (`requested | approved | moving | completed | cancelled`, a policy value the creator sets)
- `preflight` (JSON)
- `approved_at`, `completed_at`, `new_home_url`

**Tasks**
- [ ] The preflight route, plus tests.
- [ ] CLI fix-ups: push every unpushed branch, bring back handoffs, stop agents.
- [ ] The move request and the blocking approval prompt on every open browser (over the realtime bus), plus tests.
- [ ] The moving state: 503 `home_moving` on writes, scheduler and triggers stopped, and "Cancel move", plus tests.
- [ ] The bundle stream route, only for the requesting device and only after approval.
- [ ] `ri home move-here` end to end: connect, preflight, request, wait, download, restore, rewrite, tunnel, complete.
- [ ] Beamd handover: release on the old home, then device-code login and open the same name on the new machine.
- [ ] The complete route, the `MOVED` marker, the boot refusal, and `ri` on a `MOVED` root offering rename plus `ri connect`.
- [ ] Rename and retype the old host key.
- [ ] The new home's setup checklist UI.
- [ ] The changed-URL path: the preflight warning, `ri connect --url` keeping the key, and a pairing QR for phones.

**Done when:** moving the dev home (`~/ri-dev`) from the laptop to the Mac Mini over Beamd keeps its id and every paired device, and the laptop's old root refuses to start as a home. Then move it back the same way.

### Phase 8: Consolidate your machines (runbook)

- [ ] On the laptop, inventory `~/ri` with a read-only script in `personal/`: row counts per table, plus the tasks, notes and areas whose ids don't exist on the Mac Mini home (checked through its API).
- [ ] Decide what to keep. Copy it to the Mac Mini home through its API, with a one-time script in `personal/` using `ri agent create_task` / `create_note` from a device root and `POST /api/attachments`. Record the counts here.
- [ ] Run `ri import-chats` on the laptop for its Claude and Codex history (Phase 5).
- [ ] `ri stop` the laptop home, rename `~/ri` to `~/ri.retired-<date>`, and `ri connect` to the Mac Mini. The laptop is now a device.
- [ ] Keep `~/ri-dev` for building Ri. It is a separate root and stays a dev home.
- [ ] Give the Mac Mini a stable URL: a Beamd name with auto-reconnect on startup, or your own domain.

**Done when:** the laptop has no home, `ri` opens the Mac Mini, and nothing from the old laptop home you wanted to keep is missing.

### Phase 9: Audit trail and provenance foundations

- [ ] Stop purging versions when tasks and notes are deleted (`queries.ts:845-847, 2100-2102`), plus tests.
- [ ] Version creates (a baseline version on create), plus tests.
- [ ] Task snapshots include area, parent, tags, sort order and completion.
- [ ] Add `'sync'` to `entity_versions.source` and `task_status_changes.actor_source`, and add `origin_source_id` and `remote_actor` to both.
- [ ] REST routes take the actor from the request's device instead of hard-coding `'human'`. `ctx.actor` carries `deviceId` and, in spaces, `memberId`.

**Done when:** every task and note change, including creates and deletes, leaves a version recording who made it.

### Phase 10: Spaces

**Schema:** `members`, `invites`, `api_keys.member_id`, `tasks.assignee_member_id`, `tasks.created_by_member_id`, `notes.created_by_member_id`, `tasks.revision`, and `change_log`.

**Tasks**
- [ ] `ri space create`, `ri start --root`, choosing a port and tunnel name, and a launchd doc.
- [ ] Team kind: resolve each request to a member (proxy plus helper), and refuse keys without a member.
- [ ] Invites: create, list, revoke, the `/join` page, and `POST /api/join`.
- [ ] Member device pairing from inside a space.
- [ ] The permissions module and its enforcement in routes and actions, plus tests per role.
- [ ] Space-safe rules: preview off unless allowed, plus tests.
- [ ] `change_log` and the revision bump in `queries.ts` (team kind only), plus tests.
- [ ] `GET /api/space` (id, name, color).
- [ ] Space UI: the tasks board (status, assignee filter, "Mine", assign), notes, members, activity. Hide the deck, stream and personal settings. Add the space banner.

**Done when:** a space running on the Mac Mini under its own root, with two members (one using only a phone), can create, assign and complete tasks, and each change shows who made it.

### Phase 11: Connect your home to a space (pull)

- [ ] The task sync columns and index, the `sync_sources` table, and credentials in `.config/sources` (added to the bundle).
- [ ] In the space: "Connect my Ri home" (mint a `home` key), the browser-link route, and `GET /api/space/changes`.
- [ ] In your home: Settings, Spaces, with connect (by link or invite), list, pause and remove.
- [ ] `applyRemoteTask`, `transitionTaskFromSync`, and tombstones, plus tests: idempotency, status changes in any direction, open subtasks, personal fields left untouched.
- [ ] The pull worker (every 60 s, on focus, and "Sync now") with backoff, plus tests.
- [ ] The per-source mirror setting and frontmatter fields.
- [ ] Realtime task-changed events for inbound changes.
- [ ] Synced task UI:
  - the space dot
  - shared fields read-only until Phase 12
  - "No longer assigned to you" with Keep and Remove

**Done when:** tasks assigned to you in the Family space appear in your home within a minute, and your area and order for them survive later updates from the space.

### Phase 12: Push, the field split, and sharing up

- [ ] The `sync_outbox` table, written inside the `updateTask` and lifecycle transactions for synced tasks, plus tests that only shared fields are sent.
- [ ] Space patch and transition routes with last-writer-wins, idempotency, and versions that record the member, plus tests.
- [ ] The push worker (in order per task, with retries and rejections), plus tests.
- [ ] Field split enforcement in `updateTask` (body and assignment read-only), plus the UI read-only states.
- [ ] Triage merges into synced tasks go to `userContext` or a subtask, plus a test.
- [ ] Local delete of a synced task is blocked. Add "Hide from my deck" and "Detach".
- [ ] "Share to <space>" for tasks (id kept, converted in place) and notes. "New task in <space>" when a space is the active scope.

**Done when:** completing a Family task in your home shows it done in the space for your wife within a minute, and your personal notes on it never appear in the space.

### Phase 13: The deck and navigation across spaces

- [ ] Per-source quotas in deck candidate selection, plus a test.
- [ ] Space label, assigner and due date in the prompt, and the `DECK.md` line.
- [ ] `spaceId` and `spaceLabel` on deck items and alternatives, the label on `DeckChange`, and the pill and filter.
- [ ] The space scope pill in the top bar, `user_state.active_space_id`, and filtering of the deck, tasks and notes.
- [ ] "Open <space>" with the browser login link.

**Done when:** one deck mixes personal and Family work with clear labels, and the scope pill narrows every view.

### Phase 14: Family space pilot

- [ ] Create the Family space on the Mac Mini with its own root, port and Beamd name.
- [ ] Invite your wife. She joins from her phone.
- [ ] Connect your home to Family.
- [ ] Use it for two weeks and record the friction here.

**Done when:** two weeks of real use are behind you, the notes are recorded, and there is a go or no-go for Stage 3.

### Phase 15: Space notes by relevance (write its spec first)

- [ ] The spec.
- [ ] A member search API in the space (`GET /api/space/search`), and an orchestrator action in your home that searches connected spaces (`search_spaces`).
- [ ] "Share to <space>" for notes, if Phase 12 didn't already cover it.

### Phase 16: Team agents (write its spec first)

- [ ] The spec: the groundskeeper and the Slack bot.
- [ ] The groundskeeper as a space trigger (heartbeat design), suggest-only at first.
- [ ] Inbound Slack connector (Events API), mapping Slack users to members, multi-party sessions, and propose-then-approve.

### Phase 17: Sign-in methods (write its spec first)

- [ ] The spec.
- [ ] `member_identities`, Nostr sign-in (NIP-98), remote signers (NIP-46), and linking an identity to a member.
- [ ] OIDC single sign-on.

### Phase 18: Third-party sources (write its spec first)

- [ ] The spec.
- [ ] `sync_sources` kinds for Linear, Jira, Asana and Todoist, built on the existing task-source adapters. Extend them with status, assignee and updated time, and reuse `applyRemoteTask` and the outbox. Write-back goes through connector actions and their approval rules.

### Phase 19: Hosting (write its spec first)

- [ ] The spec: the business model and the infrastructure.
- [ ] Moving a home to a hosted target.

---

## 8. Schema summary

| Change | Phase | Migration |
|---|---|---|
| `api_keys.cli_last_seen_at` | 1 | Add column |
| handoff schema (`handoffs`, chat and import columns) | 4 | See handoff spec (additive) |
| `home` table and seed | 2 | New table plus a guarded insert |
| `home_moves` table | 7 | New table |
| `entity_versions` and `task_status_changes`: `origin_source_id`, `remote_actor`, and the `'sync'` value | 9 | Add columns (the enum is TypeScript only) |
| `members`, `invites`, `change_log` | 10 | New tables |
| `api_keys.member_id`, `tasks.assignee_member_id`, `tasks.created_by_member_id`, `notes.created_by_member_id`, `tasks.revision` | 10 | Add columns |
| `sync_sources` | 11 | New table |
| Task sync columns and the partial unique index | 11 | Add columns plus an index |
| `sync_outbox` | 12 | New table |
| `user_state.active_space_id` | 13 | Add column |
| `member_identities` | 17 | New table |

- **Nothing here rebuilds an existing table.** Every migration is still generated, reviewed for rebuilds, and dry-run on a copy of prod with row counts recorded in its phase.
- **Policy columns** (status, role, state) are NOT NULL with no default, and their creators set them, per CLAUDE.md "Column defaults".

---

## 9. Not in this spec

- **An offline cache on devices.**
- **Syncing between personal homes with no space in the middle** (Path D in the vision doc).
- **Full CRDT replication between machines** (Path C).
- **Several people sharing one personal home** (Path B).
- **A central account system.**
- **A laptop CLI connected to more than one home.** Browsers can pair with any number of homes and spaces, since each origin has its own key.
- **Carrying live harness conversations across machines** (handoff §8).

---

## 10. File reference

**New (by phase)**
- **2:** `src/lib/config/role.ts`, the `home` table and `getHome()`, plus first-run and status in `src/cli/commands/start.ts` and a new `src/cli/commands/status.ts`.
- **3:** `src/app/api/orchestrator/actions/[name]/route.ts`.
- **5:** `src/cli/commands/import-chats.ts`.
- **6:** `src/lib/home/{bundle,restore,rewrite-paths}.ts`, and `src/cli/commands/home.ts` (`export`, `import`, `move-here`).
- **7:** `src/app/api/home/move/{preflight,request,bundle,release,complete}/route.ts`, plus the approval prompt and setup checklist components.
- **10:** `src/lib/space/{permissions,members,invites}.ts`, `src/app/join/page.tsx`, `src/app/api/join/route.ts`, `src/app/api/space/route.ts`, `src/cli/commands/space.ts`, and the space UI shell.
- **11:** `src/lib/sync/pull.ts`, `src/app/api/space/changes/route.ts`, `src/app/api/devices/browser-link/route.ts`, and the Spaces settings section.
- **12:** `src/lib/sync/push.ts` and `src/app/api/space/tasks/[id]/{patch,transition}/route.ts`, plus `src/app/api/space/tasks/route.ts` and `src/app/api/space/notes/route.ts` for sharing up.
- **13:** the space pill and filter, and the top-bar scope pill.

**Modified**
- **Core:** `src/proxy.ts`, `src/lib/db/index.ts` (`getDb` guard), `src/lib/db/schema.ts`, `src/db/types.ts`, and `src/lib/db/queries.ts` (`applyRemoteTask`, `transitionTaskFromSync`, the outbox, the field split, version fixes, `change_log`).
- **CLI:** `src/cli/index.ts`, `src/cli/commands/{start,agent,trigger}.ts`, and the global skill writer.
- **Worktrees:** `src/lib/runs/dispatch.ts` and `src/lib/workspaces/index.ts` (reprovision on the branch).
- **Deck:** `src/lib/ai/generate-deck.ts`, the deck components, and `src/types/dashboard.ts`.
- **Settings and welcome:** the Devices and Settings panes, and the welcome wizard.
- **Docs:** the ones listed in Phase 0.
