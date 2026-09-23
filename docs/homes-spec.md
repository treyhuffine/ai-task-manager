# Homes, devices, and spaces: spec and task list

**Status:** not started. Written 2026-09-22, rewritten 2026-09-23 as one doc.
**How to use this doc:** it is the task list. Check a box (`- [x]`) when the work lands on `main`, and append the short commit hash when useful. Keep the "Done when" lines honest: a phase is done when every line under it is true, not when the code compiles. Record surprises inline under the task they affect. Try each phase on the dev home first (Phase 0).

**Related docs**
- `docs/cursor-multi-machine-agents.md`: the Cursor, Claude Code and Codex research behind §6.4 to §6.8.
- `docs/agents-view-spec.md`: the agent view this builds on. Coordination is in §5.4.
- `docs/philosophy-and-vision.md` §10 to §14: the reasoning behind homes and spaces.
- `docs/workspaces-spec.md`, "Deferred: cross-machine execution": the model this doc now builds. It describes a home plus the computer you sit at, with GitHub carrying the code, and it added the `EventWriter` seam in advance.
- Replaced by this doc:
  - `docs/handoff-spec.md`, merged in here and removed on 2026-09-23.
  - `docs/local-remote-takeover-spec.md`, the "Take over locally" design.
  - The shared-instance premise of `docs/deployment-mode-spec.md`.
  - The naming and table design in `docs/team-product-direction.md`.

---

## 1. Summary

Ri should run your whole life from one place: personal life, projects, and every business you are part of. Agents do most of the work and you make the decisions. It should feel effortless on every device, and the only thing you type is the task.

**The model in plain English**
- **You have one home.** It holds your data and it is where your agents live. It runs on whichever machine is always on, like your Mac Mini. If you only have a laptop, the laptop is your home.
- **Every computer can run agents for your home.** Connect your laptop once, and it runs a small background worker for your home. The worker has no database of its own. Phones and browsers are windows only.
- **Where work runs is a chip.** Every execution shows which computer it runs on. When you start one, **Run on** picks the computer, and it defaults to your home. **Move to** moves it in one click. There is no separate local mode.
- **An agent is one thing on every computer.** Your "Ri app" agent is one entry in the rail, with one set of instructions. It knows its folder on each computer. Ri finds that folder, or clones the repo, for you.
- **Every team has its own home, called a space.** A family or a company, for example. A space holds the shared tasks and notes, the members, and who is assigned to what. Your home connects to your spaces and pulls in what is yours. Your morning deck covers all of it.
- **Your home is your identity.** Each space keeps its own member list, and people join by invite link. Your home holds your membership in each one. There is no central account system.

```
phone    ─┐                          ┌─> Family space
browser  ─┼─> your home (Mac Mini) ──┼─> Acme space
laptop   ─┘        ▲                 └─> other spaces
   └─ worker ──────┘   (runs agents for your home)
```

**What it feels like**
- Every device shows the same agents, executions and chats.
- **Starting work:** type the task, glance at the Run on chip, and send.
- **Following along:** an agent working on your laptop streams its chat to your home, so you can follow it and answer it from your phone.
- **Closing the laptop:** pick **Move to Mac Mini** and the work keeps going.
- **Adding a computer or phone:** open Ri on it, then approve it from a device you already use.
- **No commands:** nobody types anything into a terminal. The command line is for agents and for recovery.

---

## 2. Decisions

These were locked in the design conversations on 2026-09-22 and 2026-09-23.

**Homes and devices**
1. **One person, one home.** A second machine connects to your existing home. First run makes connecting the easy path.
2. **The home goes on the machine that is always on.** If there isn't one, it goes on the laptop. Moving the home to an always-on machine, your own box or hosting, is the upgrade path.
3. **Devices have no database.** A connected computer's data root holds only two things: `home.json` (which home, which device, which key) and its worker's worktrees. Any code path that would create a database there fails loudly instead.
4. **Home or device is decided per data root.**
   - `data.db` present: a home.
   - `home.json` alone: a device.
   - Neither: first run.
   - Both: a home in transition. Only its worker uses `home.json`.
5. **A home has an identity.** It has one `home` row with an id, a kind (`personal` or `team`), and a name. The kind is stored at creation. If `RI_MODE` is set, it must match, or the server refuses to boot.
6. **A device is a machine, and keys are its credentials.** A `devices` table holds machines, and each `api_keys` row belongs to a device. Re-pairing a machine gives it a new key without making it a new device.
7. **You approve a new device from one you already use.** The new device shows a code, and any signed-in device approves it. The pairing link and QR code stay as fallbacks.
8. **The first-run choice is never a trap.** First run says the choice can be changed later, and that Ri will guide the move.
9. **The home's URL is part of its identity.** Prefer a stable name, like a Beamd tunnel name or your own domain, so moving the home doesn't mean re-pairing devices.
10. **Nobody types commands.** Everything a person does is in the app. The command line exists for three things: agents (`ri agent`), setting up a computer the first time (until there is a Mac app), and recovery.

**Where work runs**

11. **Every computer can run a Ri worker.** A connected laptop runs a small background worker with no database, and the worker runs agents for the home. Phones and browsers never run agents. This is a home plus the computers you sit at, not a fleet.
12. **Where work runs is a chip.** Every execution runs on one device at a time, and that device is shown everywhere the execution appears. **Run on** picks it when you start. It defaults to the home, then remembers your last choice for each agent. **Move to** changes it. There is no separate local mode.
13. **Work moves by git branch.** Moving an execution commits and pushes its branch, and the target builds its worktree from that branch. No file syncing.
14. **Whether conversations move is still open.** In v1, a move starts a fresh harness session on the target, inside the same Ri chat, with a note about where things stand. A spike (Phase 9) tests carrying the harness's own session across, the way Claude Code's teleport does.
15. **Background work runs on the home.** Triggers, the heartbeat, deck delegation, and executions started by agents all run on the home. The exception is an agent that only exists on one computer.

**Agents across machines**

16. **An agent is one thing on every computer.** It has one row, one name, one set of instructions and scripts, and a folder on each computer. The same git repo on two computers is one agent, with one rail entry.
17. **Ri finds the folder.** When an agent has no folder on a computer, Ri asks that computer's worker to find the repo, and offers to clone it if it's missing. Paths only show in the agent's Setup tab.
18. **A folder without a git remote belongs to one computer.** Its agent runs only there.

**Spaces**

19. **A team home is called a space,** in the UI and in docs.
20. **Personal homes have no accounts.** Devices are the only principals, and all of them are you.
21. **Spaces have members,** stored in one `members` table. People join by invite link. Each member's devices are `devices` rows linked to that member.
22. **Your home joins a space as one of your devices** (kind `home`), and it holds that key. That is how one identity works across spaces without a central account system.
23. **Nostr is not used now.** Later it can be one way to sign in to a space (NIP-98 signed requests, NIP-46 remote signers), alongside company single sign-on. Internal member ids are the keys, never public keys, because Nostr has no widely used way to rotate or recover a key.
24. **Space permissions are about actions, not hidden rows.** Everyone in a space sees the whole space. Roles (`owner`, `admin`, `member`) control what each person can do.
25. **Sync down freely, sync up deliberately.** Tasks assigned to you in a space arrive on their own. Anything personal reaches a space only when you share it on purpose ("Share to Family").
26. **The space owns the truth of a task:** title, description, outcome, status, due date, and assignment. **You own your relationship to it:** area, order, energy, effort, snooze, reminders, your context, and personal subtasks.
27. **A synced task's body is read-only in your home in v1.** Your own writing about it goes in your context field, subtasks, or linked notes.
28. **The space settles conflicts.** For each field, the last change to reach the space wins. Every overwritten value stays in version history, so it can be undone.
29. **Space notes are not copied into your home.** Agents search them when they're relevant.
30. **Your deck is built in your home from every source,** labelled by space, with a per-source limit. Spaces have no deck.

**Delivery**

31. **Staged.** You live with Stage 1 before Stage 2 starts. Each Stage 3 item gets its own spec first.
32. **Rollback stays safe.** Migrations only add, and every new column on an existing table is nullable or defaults to 0. Replaced columns are dropped only in Phase 13, after you've lived with Stage 1.
33. **Each phase lands as its own commit or commits on `main`,** after being tried on the dev home.

---

## 3. Open questions

- **Conversations moving with the work** (the Phase 9 spike). If carrying the harness session works reliably for Claude and Codex, it becomes the default and the note becomes the fallback.
- **Terminal and Preview from another device.** In v1 they only work on the computer where the execution runs. Relaying them through the worker is Phase 20.
- **Onboarding as an AI chat instead of a wizard.** Either way it must cover the steps in §6.2. The current wizard is fine for now.
- **A Mac app,** so a computer can join without the command line (Phase 26).
- **Two agents on one repo.** When a new folder matches several agents, Ri asks which one. Should Ri ever create a second agent without asking? Default here: never.
- **Offline access on a device,** such as a read-only cache when the home is unreachable. Deferred.
- **Automatic demotion of the old machine after a home move.** This spec does it by hand.
- **Space defaults.** Only admins see a space's agents, and every member can assign work. Revisit after the Family pilot.
- **Realtime push from a space to your home, versus polling.** v1 polls.
- **Hosting.** Out of scope until Phase 25.

---

## 4. Glossary

- **Home:** the Ri instance that holds your data and where your agents live. A space is a team home.
- **Device:** a machine connected to a home (a `devices` row): a computer, a phone, a tablet, or another home. The home's own machine is the device of kind `host`.
- **Key:** a credential a device uses (an `api_keys` row). A device can have several keys over time.
- **Worker:** the background part of Ri on a connected computer. It runs agents for the home. On the home itself, the existing executor does this job.
- **Agent:** what the UI calls a workspace. It is a scope: a name, instructions, scripts, and a folder on each computer that can run it. Code still says `workspace`.
- **Agent folder:** the folder an agent uses on one computer (a `workspace_folders` row).
- **Run on:** the chip that picks which computer an execution runs on.
- **Move:** moving an execution to another computer (a `moves` row). It replaces "handoff" and "take over locally".
- **Data root:** the folder a Ri home or device uses, such as `~/ri`, `~/ri-dev`, or `~/ri-spaces/family`.
- **Member:** a person in a space.
- **Source:** a space your home pulls tasks from, and later third-party tools too (a `sync_sources` row).
- **Synced task:** a task in your home that is a local copy of a space task.
- **Stable home URL:** an address that survives a move, such as a Beamd tunnel name or your own domain.

**Words we don't use**
- "hub": say home or space.
- "workspace" in UI copy: say agent.
- "workspace switcher": say space switcher.
- "handoff" or "take over": say move.
- `source` as a new column name: it already means three things, so new sync columns use `external_source_*`.

---

## 5. What exists today

### 5.1 Built and reused

- **Devices and pairing:** `api_keys` (`schema.ts:665-692`), pairing links and QR codes (`buildPairingUrl`, `src/app/pair/page.tsx`), `/api/devices`, and the Devices settings pane.
- **Remote access:** the Beamd tunnel, with a named URL that reconnects on its own (`docs/remote-access.md`).
- **The event seam:** `EventWriter` (`src/lib/executor/event-writer.ts`). It was built so a remote machine could post chat events to the home through a `RemoteEventWriter`.
- **Execution plumbing:**
  - `stopExecutionAgent` (`src/lib/sessions/workstream-runtime.ts:36`) and `createExecutionChat` (`queries.ts:5849`).
  - Worktree setup: `copyFilesToWorktree`, `runWorktreeScript`, and the env contract in `docs/worktree-scripts.md`.
  - Git through `openWorktreeHandle` (`src/lib/workspaces/index.ts:505`).
  - The push route, which detects a rejected non-fast-forward push.
- **History import:**
  - agentex `localHistory` reads Claude and Codex transcripts and never touches a database.
  - `historyEventInput` and `createHistoryWindowWriter` (`src/lib/import/external-agents.ts:590-619, 801-883`) commit a batch of events plus a cursor.
- **Summaries:** `runHarnessText` (`src/lib/harness/one-shot.ts:113`), `buildRetrospectiveSample`, and `condenseEvents`.
- **Safe backups:** `backupDb` (`src/lib/backup/index.ts`).
- **Status changes:** idempotent and checked against a count (`task_status_changes`). This is the template for applying changes that come from a space.
- **Version history:** `entity_versions`, for task and note updates.
- **Dedupe by external id,** for stream items only (`stream.externalSource` and `stream.externalId`).
- **Read-only task listing** from Todoist, Linear, Jira and Asana (`src/lib/connectors/task-sources.ts`).
- **The agent view** (`src/components/agents/*`), with Overview, Files, Terminal, Preview and Setup tabs.
- **The migration runner** (`src/lib/db/migrate.ts`). Foreign keys are off during migrations and checked before commit. It only applies migrations newer than the last one it recorded, so older code still boots on a newer database.

### 5.2 Gaps found while mapping

1. **`ri` on any machine silently creates a new home** (`start.ts:130, 156`). That is how a laptop becomes a second home.
2. **No home identity, no role, no restore.**
   - `ri snapshot` leaves out attachments and `.config`.
   - `scripts/backup.ts` deletes its own dump.
   - `docs/storage-architecture.md` wrongly says snapshots include attachments.
3. **Handlers can't tell which device called.** `proxy.ts` checks the key but passes nothing on.
4. **The CLI has no idea a remote home exists.** `serverFetch` always uses the local token and the local address. Any command that touches `getDb()` creates a database.
5. **`ri agent` runs against a local database, in-process** (`src/cli/commands/agent.ts:80`). On a laptop, Claude Code's Ri skill writes to a phantom home.
6. **The executor is tied to the database.** `src/lib/executor/adapter.ts` imports the database, the realtime bus, runs and notifications, so it can't run on a worker as it is.
7. **An agent's folder is one absolute path on the home.**
   - `workspaces.cwd` is read about 97 times across about 30 files, mostly `src/lib/sessions/dispatch.ts` and `src/lib/workspaces/index.ts`.
   - There's no way to say where the same agent lives on another computer.
   - The folder picker (`src/components/workspaces/folder-picker.tsx`) only browses the home's disk.
8. **A missing worktree gets a fresh branch off the base.** `ensureWorktreeReady` (`src/lib/runs/dispatch.ts:499`) does this instead of using the execution's own branch. `createWorktreeForSession` also can't check out an existing branch from the remote.
9. **Absolute paths in the database:** `workspaces.cwd` and `worktree_root`, `executions.worktree_path`, `reference_folders.path`, `chat_sessions.external_transcript_path`, and `external_session_imports.source_path`.
10. **Harness transcripts live outside the data root.** They are keyed by absolute folder (`~/.claude/projects/<escaped cwd>`, `~/.codex`), so resuming a chat breaks when paths change.
11. **The history reader can't follow a file that's still being written.** The importer's final commit also sets `syncOffset = Math.max(lastNextOffset, after.size)` (`external-agents.ts:975`), so a half-written last line is skipped forever. This affects today's imports too.
12. **`GET /api/devices` returns whole key rows, including `hash`.**
13. **No team data model:** no members, invites, assignment, sync tables, or columns linking a task to a space.
14. **`entity_versions` can't serve as an audit trail yet.**
    - Creating a task or note doesn't record a version.
    - Deleting one purges its versions (`queries.ts:845-847, 2100-2102`).
    - Snapshots leave out several fields.
    - There's no way to record a change made by someone in another home.
15. **Who made a change is hard-coded.** REST routes record `'human'`, and nothing records the device.
16. **Deployment mode is unbuilt and assumes one shared instance.** Its preview gate is still right for spaces.
17. **Naming collisions:** `solo` vs `personal`, the "workspace switcher", and `source`.
18. **The web Import step only reads the server's own history.**
19. **Two independent "onboarded" flags:** `config.json.onboardedAt` and `user_state.onboarded_at`.
20. **Triage merges write into a task's body** (`queries.ts:3136`). On a synced task, that would leak into the space.
21. **Open subtasks block completion** (`guardOpenChildren`, `queries.ts:1105`).
22. **No realtime channel for tasks.**
23. **`docs/cli-distribution.md` documents paths and onboarding that don't exist.**

### 5.3 "Take over locally" as built, and why it goes

Takeover pauses an execution, pushes its branch, and gives the laptop a one-hour token to clone it. It lives in:
- `src/app/api/sessions/[id]/takeover/*` and `src/app/api/takeover/[token]/*`
- `src/cli/commands/{takeover,resume}.ts`
- `src/components/executions/takeover/*`

Its problems:
1. **Its note never reaches the agent.** Resume writes the diff into Ri's copy of the chat but never sends it. The next Send only sends the new message.
2. **Resume can lose the laptop's work.** `raw()` never throws, so a failed fast-forward reports "no changes" and clears the takeover anyway.
3. **The token rides in the URL and skips the normal key check** (`proxy.ts:78-87`). Expired takeovers stay stuck.
4. **It makes a second clone.** It doesn't use your existing checkout, and it doesn't copy `.env*` or run Setup.
5. **Only the messages route is blocked.** Commit, PR, help-with-error and resolve-conflicts all still run the agent.
6. **`--no-open` doesn't work,** and no test covers takeover.

Moving work (§6.7) replaces it. Two features only share the name, and they stay: take-over-import (continuing an imported chat) and `WipHandoffBanner`.

### 5.4 Coordination with the agents view

- **Harness column:** `chat_sessions.harness` has landed. Chats a worker runs, and chats mirrored from devices, set it like any other chat.
- **Caller identity:** every harness session carries a signed caller credential (`src/lib/orchestrator/session-credential.ts`). This doc adds `deviceId` to `ctx.actor` (Phase 3), and `memberId` in spaces (Phase 15). Keep them in one shape.
- **Migration runner:** the agents view's runner (foreign keys off) has landed, so Phase 13's one table rebuild is safe.
- **Agent view changes:**
  - The header gets device dots.
  - Setup gets a Folders list.
  - The composer gets the Run on chip.
  - Files, Terminal and Preview follow the execution's device.
- **Rail:** the rail stays about agents and executions. The space switcher goes in the top bar.
- **Open rename:** renaming workspaces to agents in code blocks nothing here. Code keeps `workspace`.

---

## 6. Design

### 6.1 Machine roles and home identity

**The `home` table**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | The home id. Stable across moves |
| `created_at`, `updated_at` | shared `timestamps` spread | |
| `kind` | text, NOT NULL, enum `personal \| team` | A fact, required at creation, no default |
| `name` | text, NOT NULL | Shown to devices, and in space member lists |

- **Exactly one row.**
  - The migration adds it only to existing databases (`INSERT ... SELECT`, guarded on `user_state` having a row), with kind `personal`.
  - Fresh databases get the row from whatever creates them, with an explicit kind: `ri start` makes `personal`, and `ri space create` makes `team`.
- **`getHome()`** throws if the row is missing.
- **At boot,** a set `RI_MODE` that differs from `home.kind` stops the server with a clear message.

**Roles** (`src/lib/config/role.ts`)
- `getMachineRole(root)` returns `home` when `data.db` exists, `device` when only `home.json` exists, and `fresh` when neither does.
- **`getDb()` guard:** in a device root, throw `DeviceRootError` ("This computer is connected to <home>. Open Ri to use it.") instead of creating a database.

**What `ri` (no subcommand) does in each role**
- **Home:** what it does today.
- **Device:** makes sure the worker is running (§6.4), opens the home in the browser already signed in (`buildPairingUrl(token, homeUrl)`), then exits.
  - The browser and the worker share one device and one key.
  - If the home is unreachable, it says so.
- **Fresh:** asks the first-run question (§6.2).

**`ri status`** (any role) shows:
- the role and the data root
- the home and its URL
- this device
- whether the home and the worker are reachable

**The two onboarding flags keep separate meanings:**
- `user_state.onboarded_at`: this home finished onboarding. It moves with the home.
- `config.json.onboardedAt`: this machine finished setup. It stays with the machine.

### 6.2 First run and onboarding

When `ri` runs in a fresh root:

```
Set up Ri on this computer
  1. Start a new home here
  2. Connect this computer to my existing home
  3. Move my existing home to this computer

You can change this later. Ri will guide you through moving your home.
```

- **Default choice.** The default is 1. It switches to 2, with a one-line reason, when:
  - a pairing link was passed, or
  - Beamd is logged in on this machine and the default tunnel name is already taken.
- **Option 2** connects by approval (§6.3), starts the worker, and opens the home. It asks one more question: "Let this computer run agents for your home?" The answer defaults to yes and can be changed later on the Connections page.
- **Option 3** runs the home move (§6.10).
- **Without a terminal,** keep today's behavior and print one line: "Started a new home. If you already have one, use Connect instead."
- **The web welcome wizard** gets a link on its first step: "Already have a Ri home? Use this computer as a device instead. You can switch later."
- **A new home's onboarding gets two more steps,** because every other device depends on them. Each can be skipped, and the Connections page keeps offering them until they're done.
  - **Reach your home from anywhere:** one button signs in to Beamd (device-code flow) and claims a stable address such as `trey.beamd.run`, with reconnect on startup turned on.
  - **Start Ri when this computer starts:** installs a login item (a launchd agent on macOS). A connected computer gets the same step, for its worker.
- **Onboarding may become an AI chat later** (§3). These steps are the content it has to cover either way.

### 6.3 Devices, keys, and connecting by approval

**`devices`**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `name` | text, NOT NULL | "Trey's MacBook Pro" |
| `kind` | text, NOT NULL, enum `host \| computer \| phone \| tablet \| service \| home` | A fact set at creation. `host` is this home's own machine. `home` is another Ri home connected to a space |
| `platform` | text | `darwin`, `linux`, `win32`, `ios`, `android` |
| `member_id` | text, FK `members.id` | Spaces only (§6.11) |
| `runs_agents` | integer boolean | A preference. Nullable, read as `?? true` for computers. This is the "Let this computer run agents" switch |
| `worker_version` | text | Null if this device never ran a worker |
| `worker_harnesses` | JSON | Harnesses installed, as reported by the worker. Default `[]` |
| `worker_state` | text, enum `online \| sleeping` | Reported by the worker. "Offline" means `worker_last_seen_at` is more than 60 s old |
| `worker_last_seen_at` | text | |
| `revoked_at` | text | |

**Keys belong to devices**
- **`api_keys.device_id`** (FK `devices.id`) starts out nullable. The migration creates one device per existing key, and every code path that creates a key sets it from then on.
- **The home's own host device** is created at bootstrap. `ensureLocalToken` attaches its key to that device, so rotating the host key never changes the device.
- **`api_keys.device_type`** is kept in step with `devices.kind` until Phase 13 drops it.

**Knowing which device made a request**
- `proxy.ts` removes any inbound `x-ri-api-key-id` and `x-ri-device-id` headers on every request, then sets them for the key it validated (`NextResponse.next({ request: { headers } })`).
- `src/lib/auth/request-device.ts` provides `getRequestDevice(request)` and `requireRequestDevice(request)`.
- `GET /api/devices/me` returns the device that made the request.
- `GET /api/devices` returns devices with their worker fields and key prefixes, never key hashes.

**Connecting by approval** (the default way to add any device)

1. **The new device asks.**
   - A computer asks through first-run option 2, which calls `POST /api/devices/requests { name, kind, platform, knownDeviceId? }`.
   - A browser or phone that opens the home's address while signed out sees **Ask to join**, next to the existing paste-a-token option.
   - The endpoint is public, so it has limits: 10 requests per minute per IP, at most 5 pending at once, and each request expires after 10 minutes.
   - The response is a request id, a short code (like `K7F-4QX`), and a poll token.
2. **The new device shows the code and waits.**
3. **Every signed-in browser of the home shows a prompt:** "MacBook Pro wants to join your home. Code K7F-4QX." with Approve and Deny. The prompt also shows the device kind, platform and IP. A push notification goes out through the notifier if one is set up. Only a device that is already signed in can approve.
4. **The new device polls** `GET /api/devices/requests/:id` with its poll token. After approval, the next poll creates the device and a key, and returns the key once.
   - If the request carried a `knownDeviceId` and the approver confirmed it, the existing device is reused instead of creating a new one.
   - The plaintext key is never stored.
5. **Denied or expired requests** show a clear message on the new device.

**`device_requests`** columns:
- `id`, timestamps
- what the new device reported: `name`, `kind`, `platform`, `ip`, `user_agent`, `known_device_id`
- `code_hash`, `poll_token_hash`
- `status`: `pending | approved | denied | expired`, a policy value the creator sets
- `expires_at`, `approved_by_device_id`
- `device_id`, set on pickup

**Fallbacks:** the existing QR code and pairing link. On a computer, `ri connect --link` reads a pasted link with hidden input, so the token stays out of shell history.

**Finding the home on your network (optional).** The home advertises itself over mDNS (`_ri._tcp`), with its name and stable address. First-run option 2 lists the homes it finds. The device stores the stable address, so it keeps working when you're away from home.

**On a connected computer**
- **`home.json`** lives in `getConfigDir()` (0600 file, 0700 directory) and holds `{ version, homeUrl, deviceId, token, connectedAt }`.
- **`homeFetch`** (`src/lib/device/home-client.ts`) makes every call from the device to the home.
  - It adds the bearer and `User-Agent: ri-worker/<version> (<hostname>)`.
  - It sets timeouts and gzips large bodies.
  - It turns failures into readable messages, like "This computer was removed from your home. Connect it again."
- **TLS:** plain `http://` works on a home network or Tailscale. So does valid `https://` (Beamd, Cloudflare, Tailscale Serve). Ri's own self-signed gateway certificate is refused, with a clear message.

**The Connections page**

One Settings page for all of this:
- **This home:** its name, id and address, whether the address is stable, whether start at login is on, and any unfinished onboarding steps.
- **Devices:** every device, with its kind, when it was last seen, and its worker state.
  - Actions: rename, revoke, and the "Let this computer run agents" switch.
  - Pending join requests, with Approve and Deny.
- **Spaces** (Stage 2): each space with its sync status. Actions: pause, remove, and Open.
- **Buttons:** **Add a device** (shows a QR code, a link, and the address to type), **Connect a space**, and **Create a space**.

### 6.4 The worker

The worker is the same Ri program, running in worker mode in a connected computer's data root. It has no database. On the home itself, the existing executor does this job, with no extra process.

**What it does**
- **Keeps an outbound connection to the home.** The laptop is usually behind a router, and the home never needs to reach into it. It uses three endpoints:
  - `GET /api/workers/me/commands`: a server-sent event stream of commands from the home.
  - `POST /api/workers/me/commands/:id/result`: the result of each command.
  - `POST /api/workers/me/heartbeat`: sent every 20 s with its version, harnesses, and `online` or `sleeping`.

  If the connection drops, it reconnects with increasing waits.
- **Runs executions assigned to its device.**
  - It uses the same session runner as the home (see "Splitting the session runner" below).
  - Worktrees live under its own data root (`<getWorkDir()>/worktrees/<slug>/<leaf>`).
  - The agent's folder on this computer is the source checkout, with `filesToCopy` and the Setup script (`RI_SOURCE_CHECKOUT_PATH` and the rest of `docs/worktree-scripts.md`).
- **Streams events to the home through `RemoteEventWriter`** (`POST /api/workers/me/events`, batched and in order). The chat shows up live on every device.
- **Takes commands from the home:**
  - `start_session`, `send_message`, `interrupt`, `stop`, `restart`, `answer_pending_input`: so a message typed on your phone, or a permission answer, reaches the agent on the laptop.
  - `prepare_worktree`, `run_script`: Setup, and the Start script for previews.
  - `read_dir`, `read_file`, `diff`: so the Files tab and diffs work from any device.
  - `find_repo`, `clone`: to find or create agent folders (§6.5).
  - `list_sessions`: sessions started by hand (§6.8).
- **Keeps the computer awake while an agent is working.** It uses macOS `caffeinate -i`, tied to the running session and released when idle. Closing the lid still sleeps the Mac. The worker reports `sleeping` first when it can.

**Splitting the session runner**
- Today, `src/lib/executor/adapter.ts` mixes two jobs:
  - running harness sessions: agentex `createSession`, turning harness output into events, and redaction
  - home bookkeeping: runs, notifications, and `chat_events`
- Split them:
  - A **session runner** with no database, used by both the home and workers.
  - **Home bookkeeping**, fed through `EventWriter`. The home uses `localEventWriter`, and workers use `RemoteEventWriter`.
- The home keeps working exactly as it does today.

**Routing on the home**
- When an execution runs on a worker, the home turns that execution's messages, interrupts, permission answers, stop and restart into commands for the worker.
- If the worker is away, the commands wait in the home and are delivered when it reconnects.

**States:** `online`, `sleeping` (which the worker reports), and `offline` (no heartbeat for 60 s). Device chips show the state.

**Starting and stopping**
- `ri` on a connected computer starts the worker in the background.
- "Start Ri when this computer starts" installs a login item, so it starts on its own.
- Turning off "Let this computer run agents" on the Connections page stops it taking new work.
- `ri stop` stops it.

**How this differs from Cursor.** Cursor runs the agent loop in its cloud and only the tools on your machine, so its conversations live in one central place. Ri runs Claude Code and Codex, whose loop and conversation both live on the machine that runs them. That's why whether conversations move is still open (§6.7, Phase 9). See `docs/cursor-multi-machine-agents.md`.

### 6.5 Agents across machines

**The rule: an agent is one thing.** It has one row, one name, and one set of instructions, scripts and connectors, plus a folder on each computer that can run it. The rail shows it once, and paths only appear in its Setup tab.

**Data**
- **`workspaces` keeps everything that's the same on every computer:** name, emoji, purpose, instructions, scripts, files to copy, connector scopes, base branch, and `is_git`.
- **New `workspaces.git_remote_url`** (nullable text): the normalized remote URL, detected when a folder is added. This is how Ri knows two folders are the same project.
- **New `workspaces.preferred_device_id`** (nullable, FK `devices.id`): where **Run on** points by default for this agent. Null means the home. It changes whenever you run on a different computer.
- **New `workspace_folders`:**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `workspace_id` | text, NOT NULL, FK `workspaces.id` ON DELETE CASCADE | |
| `device_id` | text, NOT NULL, FK `devices.id` | |
| `path` | text, NOT NULL | Absolute path on that computer |
| `worktree_root` | text | Null means that computer's default |
| `status` | text, NOT NULL, enum `ok \| missing` | A state. The creator sets `ok` |
| `last_verified_at` | text | |

`workspace_folders` is unique on `(workspace_id, device_id)`.

**Migration**
- Each workspace gets one `workspace_folders` row for the host device, copied from `workspaces.cwd` and `worktree_root`.
- Every read of `ws.cwd` (about 97 reads in about 30 files) goes through `folderFor(workspace, deviceId)`, which defaults to the home.
- `cwd` and `worktree_root` keep being written until Phase 13 drops them, so rolling back stays safe.

**One repo, one agent**

When you add a folder from any computer, Ri normalizes the folder's git remote and looks for agents with the same `git_remote_url`.
- **One match:** "Ri app is already an agent. Add this MacBook folder to it?" Yes is the default.
- **Several matches:** you pick one. Two agents can share a repo when they have different purposes.
- **No match:** it becomes a new agent.

That's what keeps your rail from doubling up: the same repo on your Mac Mini and your MacBook is one agent. A one-time check also looks for existing agents that share a remote and offers to merge them. Their executions and chats move to the agent you keep.

**Folders without a git remote** (notes, scripts) belong to one computer. The agent shows "Only on MacBook", and Run on only offers that computer.

**Finding folders so you don't type paths**

When an agent has no folder on a computer and you pick that computer in Run on, or open Setup, the home asks that computer's worker to look for the repo (`find_repo`). It checks three places:
1. **Folders where Claude Code or Codex already ran on that computer.** The harness history records the working folder of every session, which covers most repos you actually use.
2. **Common code folders, one level deep:** `~/code`, `~/dev`, `~/src`, `~/projects`, and `~/Developer`.
3. **Search places you add** on the Connections page.

It matches by remote URL and offers three options:
- **Use ~/dev/ri**
- **Choose another folder:** a folder picker that browses that computer through its worker.
- **Clone a fresh copy:** into `~/code/<repo>`, or a place you choose.

In the common case that's one tap. The answer is saved as a `workspace_folders` row.

**Creating an agent**
- **New agent,** and the launcher's folder choice, list:
  - Recents.
  - Folders grouped by computer: **On Mac Mini**, **On this MacBook**.
  - **From GitHub**, which clones onto a computer you pick.
- Picking a folder on any computer either creates the agent or adds the folder to an existing one, per the rule above.
- The folder picker (`folder-picker.tsx`) can browse any computer through its worker. Today it only browses the home's disk.

**What's the same everywhere, and what isn't**
- **Same on every computer:** instructions, purpose, connectors, scripts, files to copy, and base branch.
- **Per computer:** the folder and the worktree root. Per-computer script overrides can come later, if toolchains differ.
- **Reference folders** are paths on the home. In v1 only executions on the home use them. Executions on other computers get a note that they aren't available.
- **The agent's main chat** runs on the home, in the home's folder (the agents-view rule). If an agent has no folder on the home, its main chat runs on the computer that has the folder, while that computer is online.

**What the UI shows**
- **Rail:** the agent once. Its executions carry a device chip only when they aren't on the home ("fix login · MacBook").
- **Agent header:** a small dot for each computer that has the agent's folder, filled when that computer is online.
- **Setup tab:** a **Folders** list showing each computer, its path, and its status, with Change, Remove, and "Set up on another computer".
- **Nowhere else shows paths.**

### 6.6 Running work: Run on and location

**Location**
- **New `executions.runs_on_device_id`** (FK `devices.id`). The migration fills it with the host device for existing executions, and every code path that creates an execution sets it.
- **`executions.worktree_path` stays.** It is the worktree path on the device the execution runs on.

**The Run on chip** appears in four places:
- the agent's composer
- the new-execution flow
- "Start with agent" on a task
- deck delegation

How it behaves:
- The menu lists every computer that can run agents, each with its state.
- A computer without this agent's folder shows **Set up on MacBook** (§6.5).
- The default is the agent's `preferred_device_id`: the home at first, then your last choice for that agent.
- Background starts (triggers, the heartbeat, agents starting executions) run on the home (decision 15).

**Starting the execution**
- If it runs on the home, it starts the way it does today.
- Otherwise the home sends the worker `prepare_worktree` (the execution's branch, built from this computer's folder), then `start_session`.

**Location is always visible.** A device chip appears on:
- the execution header
- rail rows (only when the execution isn't on the home)
- the deck
- task links

The chip shows the device's state, so "MacBook is asleep" is visible without opening anything.

**Tools follow the work**
- **Chat, status and diffs** work from every device.
- **Files:** for executions on other computers, the Files tab reads through the worker.
- **Terminal and Preview** run on the computer where the execution runs. On that computer they work as today. Elsewhere, v1 shows "Open on MacBook". Relaying them is Phase 20.
- **Previews on a worker:** the agent's Start script runs on that computer, with a stable `PORT`.
- **Open in editor** opens on the computer that has the files.

**Agents calling Ri:** `list_executions` includes the device, and `start_execution` (agents-view Phase 4) takes an optional `runOn` that defaults to the home.

### 6.7 Moving work

**Move to** is in the execution header menu and the rail row menu, with an entry for each other computer.
- It's available for executions that run in a git worktree and whose repo has a remote.
- If the target computer has no folder for the agent, it offers to set one up first (§6.5).

**`moves`**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `execution_id` | text, NOT NULL, FK `executions.id` ON DELETE CASCADE | |
| `from_device_id`, `to_device_id` | text, NOT NULL, FK `devices.id` | |
| `status` | text, NOT NULL, enum `moving \| done \| failed \| cancelled` | Policy. The creator sets `moving` |
| `base_sha` | text | Head of the branch after the source's final push |
| `note` | text | The move note |
| `carried_session` | integer boolean | Whether the harness session was carried (Phase 9). Nullable |
| `error` | text | |
| `finished_at` | text | |

A partial unique index on `(execution_id) WHERE status = 'moving'` allows only one move per execution at a time.

**Steps**
1. **Hold the execution.** Mark it as moving. Messages sent to it wait.
2. **Stop the agent on the source:** `stopExecutionAgent` on the home, or `stop` on a worker.
3. **Commit and push on the source.** Uncommitted work is committed as `Move: work in progress from <device>`, and the branch is pushed.
   - Every git call checks its exit code (§5.3).
   - If the push is rejected, the move stops with a clear message and nothing else changes.
4. **The home writes the move note** (below).
5. **The target prepares its worktree** from its own folder for the agent, on the execution's branch.
   - It uses the local branch if there is one, otherwise it fetches `<remote>/<branch>` and tracks it.
   - Then it copies `filesToCopy` and runs Setup.
6. **The target starts the harness.**
   - In v1, that's a fresh harness session in the same Ri chat, which starts from the note: "This work moved from Mac Mini to MacBook. Here is where it stands: ...".
   - If the Phase 9 spike succeeds, it resumes the original harness session instead, and the note becomes the fallback.
7. **Finish.**
   - Set `runs_on_device_id` to the target.
   - Stop holding the execution and deliver any waiting messages.
   - Add a divider in the chat, "Moved to MacBook" (a `chat_events` row with `source: 'move'`).

**What stays the same:** it's one Ri chat the whole time. Only the harness session behind it may change.

**Moving when the source is away.** If the source computer is asleep or offline, **Move to Mac Mini** still works, from the last commit the branch pushed.
- The home warns first: "MacBook is offline. Anything it didn't push stays there."
- The home already has every chat event, because workers stream them live, so the note is complete even without the source.

**The move note** (`src/lib/moves/notes.ts`)
- **Inputs:**
  - the execution label and the tasks linked to it
  - a sample of the chat (`buildRetrospectiveSample`, `condenseEvents`)
  - the commits ahead of the base, and `git diff --shortstat`
  - whether a work-in-progress commit was made
  - the PR number, if there is one
- **AI part:** `runHarnessText({ label: 'move-note', tier: 'fast', maxTurns: 1, timeoutSec: 45 })`, with four headings: Goal, Done so far, Next step, and Watch out for.
- **Fallback,** if the AI part fails: the last user and assistant messages, plus the git state.
- **Always added:** a "Where things are" block with the branch, the base, and how to see the changes.
- **Size:** capped at 8,000 characters. It never includes a full patch, because the agent can read the diff itself.

**One place at a time.** Only the device in `runs_on_device_id` may run the execution or change its worktree. `assertRunsHere(executionId, deviceId)` enforces this in two places:
- **Where messages are dispatched.** That covers messages, commit, PR, help-with-error, resolve-conflicts, and scheduled runs.
- **In the routes that change git state:** push, pull-base, merge, auto-merge, wip, continue, retry-setup, and retry-setup-script.

This replaces takeover's single block on the messages route. A scheduled run aimed at an execution on an offline computer fails with `device_offline` and shows in the run history.

**Sleep and offline**
- If a worker sleeps or goes offline mid-run, the execution shows "Paused, MacBook is asleep" and offers **Move to Mac Mini**.
- When the laptop wakes, the worker reconnects and resumes the session, and waiting messages are delivered.

**Moving does not open PRs.** The branch is enough. If a PR already exists, the note mentions it.

**Archive and revoke**
- Archiving an execution that runs on a worker stops it there first.
- Revoking a device lists its executions and offers to move them home or stop them.

**Conversations that move (the Phase 9 spike)**
- **How it would work:**
  - The source worker sends the harness session file along with the move.
  - The target puts it where its harness looks for the new folder (for Claude, `~/.claude/projects/<escaped cwd>/<id>.jsonl`, and for Codex, its sessions folder).
  - The target resumes with the same id. This is what `claude --teleport` does.
- **Risks:**
  - The transcript contains absolute paths.
  - The harness version may differ between machines.
  - Codex may not resume cleanly from a different folder.
- **Passing bar:** ten moves each for Claude and Codex, where the agent keeps working coherently without anyone re-explaining.

### 6.8 Sessions started by hand, and history import

**Add to Ri**
- You start `claude` or `codex` yourself in a terminal, in a folder that belongs to an agent. The worker notices the new session (`list_sessions`, by folder).
- The app offers **Add to Ri**, in Unread and in the agent view.
- Choosing it creates an execution on that computer and follows the session's transcript, so the session shows up as a normal chat. You keep working in your terminal.
- The chat is read-only in the app, because the app can't type into your terminal, and it says so.

**Import history from this computer** (Settings, Imports) does the same for past sessions, through that computer's worker. They also come in as read-only chats.

**How it works**
- **Reading:** the worker reads transcripts with agentex `localHistory` in tail mode. It takes complete lines only, and never rejects a file for growing.
  - Preferred fix: an agentex option like `read(session, { fromOffset, untilOffset })`. First check whether agentex already has one.
  - Fallback: copy the bytes up to the last newline into a temporary file, and read that.
- **Uploading:** the worker sends batches of up to 8 MiB, split at line boundaries, to `POST /api/workers/me/sessions/:chatId/windows` with `{ expectedOffset, replace, events, nextOffset, source }`. Gzip is allowed.
  - The home checks `expectedOffset` against its own cursor. On a mismatch it returns 409 with the cursor.
  - It converts events with `historyEventInput` plus redaction, then commits them with `createHistoryWindowWriter`, setting `syncOffset = nextOffset`.
  - Request bodies are capped at 16 MiB. Next doesn't unzip request bodies, so `src/lib/api/read-json-body.ts` handles gzip.
- **Rewritten transcripts:** `createPrefixDigest` and the replace decision (`external-agents.ts:204-235, 889-916`) move into a module without database access, shared by the home importer and the worker.
- **Schema:**
  - `chat_sessions.origin_device_id` (nullable, FK `devices.id`) is set only on chats copied from a session Ri didn't start. The home never tries to resume those.
  - `external_session_imports.origin_device_id`, with its unique index split in two:
    - `(provider_type, external_session_id) WHERE origin_device_id IS NULL`
    - `(origin_device_id, provider_type, external_session_id) WHERE origin_device_id IS NOT NULL`
  - Rows from a device store an opaque `source_path` label, never the laptop's path.
  - `surface_kind` gains `'device_session'`.
- **Home-side exclusions.** Every home code path that assumes a transcript is on the home's disk skips device rows:
  - the missing-row pass (`external-agents.ts:503-549`)
  - the cold-start sweep
  - `reconcileSession`
  - the Settings Imports panel
  - take-over-import
- **Bug fix:** fix the importer's final offset (gap 11) at the same time.

### 6.9 `ri agent` and the Ri skill on a computer

On your laptop, Claude Code or Codex uses the Ri skill, which calls `ri agent <action>`. That call has to reach your home.

- **New route, `POST /api/orchestrator/actions/[name]`:** JSON params in, and the same `{ ok, action, result | error }` envelope as `runAction` out. It runs `runAction(name, params, { remote: true, actor: { source, deviceId } })`.
- **`src/cli/commands/agent.ts`:** in a device root, it sends each action through `homeFetch`. In a home, nothing changes.
- **Device calls use `ctx.remote = true`.** Actions that require the trusted local CLI keep refusing, with a clear message. Phase 3 lists them and decides each one.
- **Other command groups:** the `ri trigger` group routes the same way. `ri browser` refuses on a device.
- **The global skill** writes a device version: no app root path, and a note that `ri agent` talks to your home over the network.

### 6.10 Moving a home

One guided step moves a home to another machine. It keeps the home's id, and it keeps every device working as long as the URL is stable. It also blocks the old machine from ever starting as a second home. The same bundle doubles as a file, which gives Ri a real full backup and restore.

**The bundle** (`src/lib/home/bundle.ts`)

A `.tar.gz` with a `manifest.json`: home id, name, kind, schema version, source root, source home directory, created at, and a sha256 per file.

It includes:
- `data.db`, copied with `backupDb`
- `attachments/` and `.archive/`
- the persona files (`CLAUDE.md`, `MEMORY.md`, `USER.md`, `SOUL.md`), `skills/`, the deck instructions, and `triage-context.md`
- from `.config`: `connectors/` with its key, `agents/credentials.json` with its key, `notifications/vapid.json`, `preview.json`, and `sources/` (space credentials, §6.12)
- these `config.json` fields: `localToken`, `tunnelName`, `tunnelUrl`, `autoTunnel`, `voiceEnabled`, `globalSkillEnabled`, and the browser preferences
- an optional `transcripts/` section: the Claude and Codex files that chats on the home reference

It leaves out what belongs to this machine:
- `.work/`, `.config/tls/`, `.config/browser/`, and `.config/cli-config.json`
- `lastPort`, `staticUrl`, and `browserChromiumPath`
- the derived mirror folders, which are rebuilt
- `snapshots/`

The bundle contains secrets. It's written with mode 0600, and the app says so.

**Ways to run it**
- `ri home export <file>`: the full backup. `--no-transcripts` skips the transcripts.
- `ri home import <file>`: for a fresh root only.
- The network move below. In the app, it's first-run option 3, or **Move this home** on the Connections page.

**The network move, step by step**
1. **Connect first.** The new machine connects to your current home as a normal device, by approval. That proves you own the home.
2. **Preflight.** It reports running agents, unpushed branches, executions running on other computers, sizes, and whether the URL is stable.
3. **Fix-ups.** It offers to push every unpushed branch and stop agents on the home. It warns that executions on other computers will pause during the move.
4. **Request and approval.** A person has to approve "<device> wants to become your home" in the current home's UI.
5. **Moving state.** Writes return 503 `home_moving`, the scheduler stops, and reads keep working. **Cancel move** undoes this until the move completes.
6. **Download.** The bundle streams only to the device that asked for it.
7. **Restore.** The new machine restores before anything calls `getDb()`. Migrations run the first time it opens.
8. **Path rewrite** (below).
9. **Tunnel handover.** With a Beamd name, the old home releases its tunnel, and the new machine signs in to Beamd and opens the same name.
10. **Complete.** The old home writes a `MOVED` marker and stops. A home refuses to boot with that marker. Running `ri` on that root offers to rename it and connect as a device.
11. **Host devices.** On first start the new machine gets its own host device, and the old host device becomes a `computer`, so it can reconnect as a device.
12. **Workers reconnect.** Workers on other computers reconnect to the same URL, and their paused executions carry on.
13. **Setup checklist** in the new home's UI: harness logins, global skill, voice, TLS, browser logins, and connector checks.

**If the URL changes** (a LAN or Tailscale address), the preflight says so and recommends a stable name first. After the move:
- phones and browsers pair again
- connected computers reconnect by approval and keep their device ids

**Path rewrite** (`src/lib/home/rewrite-paths.ts`), in one transaction:
- **Skip it if nothing changed.** Many Mac-to-Mac moves keep the same username and data root, so paths stay identical.
- **Root prefix:** rewrite it in the host device's `workspace_folders`, in `executions.worktree_path` for executions on the home, in transcript paths, and in reference folders.
- **Home directory prefix:** rewrite it when the username differs.
- **Host folders missing on the new machine:** offer to clone them from their remote. If that isn't possible, mark them `missing`, and Setup shows "Folder not found on this computer" with **Choose folder**.
- **Transcripts:** each goes to its new location, with the Claude project folder name recomputed from the rewritten path.
  - If a chat's transcript can't be placed, the chat keeps its Ri history, and its next message starts a fresh harness session seeded with a summary (the move note builder).
  - This also builds the "rollover on missing transcript" behavior that `docs/chat-sessions.md` describes.
- **Worktrees don't move.** Executions get new worktrees the next time they're used, on their own branch (§6.7 step 5).

### 6.11 Spaces

A space is a Ri home with kind `team`. It runs the same code, queries and agents as a personal home.
- **It holds** the team's shared tasks, notes, areas, members, and assignments, plus its own agents.
- **It has no deck.**
- **Members use it** directly from a browser or phone, or through their own home, which syncs the work assigned to them.

**Creating and running a space**
- **In the app:** **Create a space** asks for a name, a color, and where it runs:
  - **This computer:** a new data root on this machine, with its own port and address.
  - **Another machine:** shows the command to run there.
  - Hosted comes later.
- **The share sheet:** creating a space ends on a share sheet with the invite link, a QR code, and **Copy invite** for Slack or email.
- **From the command line:** `ri space create <name>` does the same, and `ri start --root <path>` runs a space.
- **Several homes on one machine:** each needs its own port and Beamd name. The create flow picks both, and sets up a login item for each root.

**`members`** (spaces only)

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `name` | text, NOT NULL | |
| `role` | text, NOT NULL, enum `owner \| admin \| member` | Policy. The creator sets it |
| `status` | text, NOT NULL, enum `active \| removed` | Policy |
| `removed_at` | text | |

- Every request in a space resolves to a member through its device (`devices.member_id`).
- A device with no member is refused everywhere except `/api/health` and the join routes.
- Removing a member revokes all of their devices.

**`invites`**

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `token_hash` | text, NOT NULL, unique | |
| `role` | text, NOT NULL, enum | The role to grant |
| `created_by_member_id` | text, NOT NULL, FK `members.id` | |
| `expires_at` | text, NOT NULL | 7 days by default |
| `accepted_at`, `accepted_member_id` | text | Single use |
| `revoked_at` | text | |

**How invites work**
- **The link** is `<space url>/join#invite=<token>`. The token sits after the `#`, so it never reaches server logs.
- **In a browser,** `/join` asks for a name. Then `POST /api/join { invite, name }` creates the member and a device for that browser, and signs it in.
- **Pasted into your own home,** the same link joins and connects in one step (§6.12).
- **More devices:** members add them through the space's own approval flow, and each one is linked to the member.

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

- **Enforcement:** routes and orchestrator actions check these with `requireMember(request)` and `ctx.actor.memberId`.
- **Personal homes skip all of this,** based on the home kind.
- **"Only their own"** relies on `tasks.created_by_member_id` and `notes.created_by_member_id`.

**Space-safe rules** (carried over from `docs/deployment-mode-spec.md`)
- **Preview is off** in spaces unless the owner turns on `allow_unsafe_preview`.
- **No host commands from a member's free text** without an approval step.
- **Every member sees the same data,** except device management: members only see their own devices.

**Space UI (v1, deliberately small)**
- **Tasks:** a board by status, with an assignee filter, "Mine", and assign.
- **Also:** notes, members, and activity (who changed what).
- **Hidden:** the deck, stream capture and triage, and personal settings.
- **Admins only:** agents and executions.
- **A space banner** in the top bar, with the space's name and color.

### 6.12 Connecting your home to a space

**Joining**
1. **In the space,** signed in from a browser, choose **Connect my Ri home**. The space creates a `home` device for your member and shows a link.
2. **In your home,** go to Connections, choose **Connect a space**, and paste the link. Your home:
   - checks `GET <space>/api/health`
   - reads your member from `GET <space>/api/devices/me`
   - reads the space's id, name and color from `GET <space>/api/space`
   - saves the connection
3. **Shortcut:** pasting an invite link instead runs `POST <space>/api/join { invite, name, kind: 'home' }` directly.

**`sync_sources`** (in your home)

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | |
| `created_at`, `updated_at` | timestamps | |
| `kind` | text, NOT NULL, enum `ri_space` | Later `linear`, `jira`, `asana`, `todoist`. A fact |
| `remote_home_id` | text | |
| `label` | text, NOT NULL | |
| `color` | text | |
| `base_url` | text, NOT NULL | |
| `remote_member_id`, `remote_member_name` | text | |
| `cursor` | text | |
| `last_pulled_at`, `last_pushed_at`, `last_error` | text | |
| `status` | text, NOT NULL, enum `active \| paused \| revoked` | Policy. The creator sets `active` |
| `mirror_to_disk` | integer boolean, NOT NULL | No schema default. The connect dialog asks, defaulting to on |

The key lives in `.config/sources/<id>.json` (0600, sealed like connector secrets), never in the database. It moves with the home.

**The space's change feed**
- **`change_log`** (in spaces): `seq` (integer primary key, autoincrement), `created_at`, `entity_type`, `entity_id`, `revision`, and `kind` (`upsert` or `delete`).
  - A row is added in the same transaction as every task write in a team home, inside `queries.ts`.
- **`tasks.revision`:** integer, NOT NULL, default 0. It goes up on every write to a shared field or status in a team home.
- **`GET /api/space/changes?since=<seq>&limit=500`:** only `home` devices can call it. It returns:
  - tasks assigned to the member that changed after `seq`, each with its shared fields, revision, assignee name, and last actor
  - markers for tasks that were unassigned from them or deleted
  - the new cursor

**Pull** (`src/lib/sync/pull.ts`)

Your home pulls every 60 s, whenever the window gets focus, and on **Sync now**. Each change goes through `applyRemoteTask` in `queries.ts`:
- **Upsert** by `(external_source_id, external_id)`. For Ri spaces, the local id equals the space's id, so links and parent tasks resolve.
- **Shared columns only.** Personal columns are never touched.
- **Status changes** go through `transitionTaskFromSync`.
  - It writes a `task_status_changes` row with `actor_source: 'sync'`, the remote actor, and the idempotency key `sync:<source>:<revision>`.
  - It can move from any status to any other.
  - If the space completes a task while you have personal subtasks open, the task completes, the subtasks stay open, and the task is flagged "completed in <space>" (gap 21).
- **Embeddings and search** update as usual.
- **The markdown mirror** writes synced tasks only when `mirror_to_disk` is on, adding `space`, `external_id`, and `external_url` to the frontmatter.
- **Unassigned or deleted tasks:** unassigned sets `sync_state = 'unassigned'`, and deleted sets `deleted_upstream`.
  - The task leaves active views, but your own additions stay.
  - You choose "Keep as a personal task", which detaches it, or "Remove".
- **Realtime:** each change publishes a task-changed event, so open lists update (gap 22).

**Push** (`src/lib/sync/push.ts`)
- **`sync_outbox` rows** are written in the same transaction as the local change:
  - by `updateTask`, when shared fields change on a synced task
  - by the lifecycle commands, for status
- **Its columns:** `id`, timestamps, `source_id`, `entity_id`, `op` (`patch` or `status`), `payload` (shared fields only), `base_revision`, `idempotency_key`, `state` (`pending | sent | acked | rejected | failed`, a policy value the creator sets to `pending`), `attempts`, and `last_error`.
- **Sending:** a background loop sends them in order per task to `POST <space>/api/space/tasks/:id/patch` and `.../transition`.
- **The space applies each one** with last-writer-wins per field. It records a version with the member as the actor, bumps the revision, and returns the current shared state, which your home applies.
- **Rejections** mark the row `rejected`, apply the space's state, and show a notice.
- **Reliability:** the outbox survives restarts and time offline. The space ignores repeats by `idempotency_key`.

**Sharing up (deliberate)**
- **Where:** **Share to <space>** on a personal task or note, and **New task in <space>** when a space is the active scope.
- **What happens:** your home sends the shared fields and the local id. The space creates the task with that same id, and your local task becomes the synced copy in place.

**Provenance across the boundary**
- `entity_versions.source` and `task_status_changes.actor_source` gain `'sync'`.
- Both get nullable `origin_source_id` and `remote_actor` (JSON: member id, name, and whether it was a person or an AI).
- The UI shows "Changed by Alice in Family".

**New task columns** (personal homes and spaces share one schema)
- `external_source_id` (FK `sync_sources.id` ON DELETE SET NULL), `external_id`, `external_url`
- `remote_revision`, `remote_synced_at`
- `sync_state` (enum `linked | unassigned | deleted_upstream | detached`, null for native tasks)
- `external_meta` (JSON)
- `revision`
- `assignee_member_id`, `created_by_member_id`
- a partial unique index on `(external_source_id, external_id) WHERE external_id IS NOT NULL`

All of these are `ALTER TABLE ADD COLUMN`, so `tasks_fts` rowids are untouched. Notes get `created_by_member_id`. Note sync comes in Stage 3.

### 6.13 The field split

| Shared: synced both ways | Personal: never leaves your home | Local only |
|---|---|---|
| title, description, outcome | area, sort order | ids, timestamps, status counters |
| status, completed at | energy, effort, context tags | code workspace, raw input |
| hard deadline | your context (`userContext`), `aiContext` | folded headings, last viewed, surfaced, progress |
| recurrence, only when the space set it | reminder, snooze, times deferred | embeddings, search index, mirror file |
| assignment (read-only locally, in `external_meta`) | personal subtasks | blocked-on (v1) |
| body (read-only locally in v1) | linked notes, target frequency, personal attachments | |

- **Read-only is enforced in the query layer.** `updateTask` rejects edits to read-only shared fields, and the UI shows them as read-only.
- **Triage merges** into a synced task go to `userContext` or a personal subtask, never the body (gap 20).
- **You can't delete a synced task locally.** You can choose **Hide from my deck** or **Detach** instead.

### 6.14 The deck and navigation across spaces

**Deck** (`src/lib/ai/generate-deck.ts`)
- **What's eligible:** synced tasks with `sync_state = 'linked'` count just like tasks you created.
- **Limits per source:** up to 30 personal tasks plus up to 15 per space. Adjust after use.
- **Prompt rows** carry the space label, who assigned the task, and the space's due date. `DECK.md` gains one line: space work and personal work are ranked together.
- **`DeckItem` and `AlternativeItem`** get `spaceId` and `spaceLabel`, and `DeckChange` stores the label. None of these is named `source`.
- **On screen:** a space pill next to the area pill, a space filter, and a device chip on tasks whose execution is running away from the home.
- **Actions:** completing a synced task pushes through the outbox. "Not today" stays personal.

**Space switcher**
- **A scope pill in the top bar** (`src/components/dashboard/top-hud.tsx`): All, Personal, Family, Acme. It is stored as `user_state.active_space_id` (null means All), and filters the deck, tasks, and notes.
- **Open <space>** opens the space's own UI, already signed in. Your home asks the space for a browser login link through its `home` device.
- **Space tasks** show a small colored dot everywhere.

### 6.15 Identity

- **In a personal home,** you are the only principal. Your devices are machines, each with keys.
- **In a space,** members join by invite link. Their devices, including their own home, are linked to the member.
- **Across spaces,** your home holds a membership key for each space.
- **Later sign-in methods (Phase 23):**
  - a `member_identities` table: `member_id`, `kind` (`nostr | oidc | email`), `subject`, and `verified_at`, unique on `(kind, subject)`
  - Nostr sign-in with NIP-98, and remote signers with NIP-46
  - OIDC single sign-on
  - invite links stay the baseline
- **Accounts:** hosting may offer an optional account later. Nothing in Ri requires one.

### 6.16 Team agents (Stage 3 outline)

- **Groundskeeper:** a standing agent in each space that keeps the shared list tidy. It is a trigger (per `docs/heartbeat-spec.md`). It starts by suggesting changes, and earns more freedom as its suggestions are accepted.
- **Slack bot:** the space's chat, through an inbound Slack connector. It maps Slack users to members, supports conversations with several people, and turns every change it wants to make into a proposal that a named member approves.

### 6.17 Hosting (Stage 3 outline)

- **A hosted home** is a home on someone else's always-on machine.
- **Getting there** is the home move, with a hosted machine as the target.
- **Its URL** comes from the hosted domain, so it's stable.
- **The data stays yours,** and `ri home export` works at any time.

### 6.18 The experience, per machine

**Your host machine (the Mac Mini)**
- Install Ri and choose **Start a new home here**.
- The wizard runs, including the steps for a stable address and start at login.
- After that, it just runs.

**Your laptop**
- Install Ri and choose **Connect this computer to my existing home**. It lists homes on your network, or you type the address.
- Approve it from your phone or any signed-in browser.
- Leave "Let this computer run agents" on.
- From then on:
  - Opening Ri shows your home, already signed in.
  - Claude Code on the laptop manages your real tasks through the Ri skill.
  - The **Run on** chip offers "This MacBook" when you start work.
  - **Move to** sends work either way.
  - Sessions you start by hand in a terminal show up as **Add to Ri**.

**Your phone**
- Open the home's address and tap **Ask to join**, then approve it from another device. Or scan the QR code from **Add a device**.
- You can start work on any awake computer, follow it, and answer it.

**Team laptops (Stage 2)**
- **A teammate who only needs the team** opens the invite link, types their name, and is in. There's nothing to install, and it works on a phone.
- **A teammate who uses Ri personally** pastes the invite into **Connect a space**, and their assigned work appears in their own deck. Their laptop is usually their home, and it runs agents for them.
- **The space itself** runs on an always-on machine. For a company, that's a company machine or a small server.

**Everywhere:** one deck of personal and team work, each item labelled, device chips wherever work is running, the space switcher, and **Open <space>**.

### 6.19 Your own machines

**Today**
- The laptop has `~/ri`, a second home.
- The Mac Mini has `~/ri`, your real home.
- The laptop also has `~/ri-dev`, the dev home for building Ri.

**The target**
- The Mac Mini is the only home.
- The laptop is a connected computer that runs a worker.
- `~/ri-dev` stays for development.

Phase 12 is the step-by-step plan for getting there. Every step renames rather than deletes, and counts rows before anything moves.

### 6.20 Security

- **Bearer auth everywhere.** Every worker, move, device and space route needs a key. No route skips the check. Takeover's bypass goes away.
- **Device headers can't be forged.** `x-ri-api-key-id` and `x-ri-device-id` are stripped from every incoming request before auth.
- **Workers are limited:**
  - A worker only receives commands for executions whose `runs_on_device_id` is its own device.
  - It only accepts commands from its connected home.
  - It only reads files inside that agent's folders and worktrees on that computer.
- **Keys are kept safe.**
  - `home.json` is mode 0600 in a 0700 directory.
  - Setting up by pasting a link reads the token with hidden input.
  - A plaintext key is shown once and never stored.
- **Device transcript paths** never leave the device. The home stores opaque labels instead.
- **Redaction** runs on the home, for every uploaded event.
- **Size and rate limits:** request bodies are capped at 16 MiB, and join requests are rate limited and expire.
- **Space rules** are in §6.11.

### 6.21 Edge cases

| Case | Behavior |
|---|---|
| The push at the start of a move is rejected | The move stops with a clear message. The agent stays stopped and the work-in-progress commit stays |
| The move note is slow or fails | Use the simpler fallback note, and continue the move |
| The target has no folder for the agent | Move to offers to set one up first: find, choose, or clone |
| The source computer is asleep or offline | Move from the last pushed commit, after a warning |
| The laptop sleeps mid-run | Show "Paused, MacBook is asleep" and offer Move to Mac Mini. Resume when it wakes |
| A message is sent while the worker is away | It waits in the home, and is delivered on reconnect or when the work moves |
| A scheduled run targets an execution on an offline computer | It fails with `device_offline` and shows in run history |
| A device is revoked while it's running work | Revoke lists its executions and offers to move them home or stop them |
| An execution is archived while on a worker | The worker stops it first |
| The branch is already checked out elsewhere on the target | Use that checkout if it's clean and can fast-forward, and say so |
| The target's local branch has diverged | Stop with instructions. Stash and reset only after you confirm |
| The harness isn't installed on the target | Run on shows that computer as unavailable, with an install hint |
| An agent's folder is deleted on a computer | Mark it `missing`. Setup offers Choose folder or Clone |
| A hand-started session's transcript is rewritten mid-session | The start of the file changes, so upload again from the beginning |
| A very large transcript | Upload it in 8 MiB pieces, gzipped, with a 16 MiB cap per request |
| Two moves of the same execution at once | Only one active move per execution (partial unique index) |
| The home uses Ri's self-signed HTTPS | Refuse, and suggest the Beamd or Tailscale address |
| The laptop's git remote isn't named `origin` | Match by URL, not by name |

---

## 7. Phases

**Stage 1: one home, and workers on your computers.** Phases 0 to 12, each tried on the dev home first.
**Gate:** live with Stage 1 for at least two weeks, with one home and the laptop running a worker. Record the friction here, then do Phase 13.
**Stage 2: spaces.** Phases 14 to 19.
**Gate:** live with the Family space for two weeks, then decide whether to go ahead.
**Stage 3:** Phases 20 to 26. Each needs its own spec first.

### Phase 0: Safety net, dev home, and docs

**Safety net first, so every later phase can be undone**
- [ ] The bundle writer (`src/lib/home/bundle.ts`) and `ri home export`, with `--no-transcripts` (§6.10). Tests cover what goes in, what stays out, checksums, and 0600 permissions.
- [ ] `docs/storage-architecture.md`: `ri home export` is the full backup, and `ri snapshot` stays the quick snapshot. Until `ri home import` exists (Phase 10), restoring means unpacking the bundle by hand. Write those steps down, then try them once on a temporary root.
- [ ] Export both homes before Phase 1, and again before every phase that changes the database.

**Dev home**
- [ ] Run the dev home on the Mac Mini: `pnpm dev`, which uses `~/ri-dev` on port 42241, with its own Beamd name. Connect the laptop to it once Phase 1 lands. Write the steps in `docs/remote-access.md`.

**Docs**
- [ ] `docs/team-product-direction.md`: add a header pointing here. Replace "workspace switcher", `MODE`, `source`, and "users, memberships" with this doc's terms.
- [ ] `docs/deployment-mode-spec.md`: add a header saying its shared-instance premise is superseded and its preview gate carries into spaces.
- [ ] `docs/philosophy-and-vision.md` §17: invite links now, linked sign-in methods later, and no central accounts.
- [ ] `docs/storage-architecture.md`: correct what snapshots contain, align the `data.db` sync statement with `paths.ts`, and point machine moves to §6.10.
- [ ] `docs/cli-distribution.md`: the real paths and the real onboarding.
- [ ] `docs/local-remote-takeover-spec.md`, and the "Deferred: cross-machine execution" section of `docs/workspaces-spec.md`: add headers pointing here.

**Done when:** both homes have an export that has been restored once into a temporary root, the dev home is reachable from the laptop, and no doc describes a replaced design without saying so.

### Phase 1: Devices, keys, and connecting by approval

- [ ] The `devices` table:
  - backfill `api_keys.device_id` with one device per key
  - attach the host key to a host device at bootstrap
  - every code path that creates a key sets its device
- [ ] `proxy.ts`: strip and forward `x-ri-api-key-id` and `x-ri-device-id`, with the first tests for `proxy.ts`.
- [ ] `src/lib/auth/request-device.ts`, with tests.
- [ ] `GET /api/devices/me`, and `GET /api/devices` without hashes but with the worker fields.
- [ ] `device_requests` and its routes:
  - the public request route: rate limited, capped, and expiring
  - the poll route, which mints the key once
  - approve and deny
  - reconnecting a known device

  Tests cover the rate limit, expiry, single pickup, reusing a known device, and that only signed-in devices can approve.
- [ ] The approval prompt on every signed-in browser (realtime), plus a push through the notifier.
- [ ] `home.json` and `homeFetch`, with tests.
- [ ] Connecting by approval in `ri` (first-run option 2), with `ri connect --link` as the fallback.
- [ ] **Ask to join** on the sign-in page, for browsers and phones.
- [ ] The Connections page: this home, devices, pending requests, and Add a device.
- [ ] Fix the `ri pair --type` help text.
- [ ] An ESLint rule that stops device-side modules (`src/lib/device/**`, `src/worker/**`) from importing the database.
- [ ] Optional: finding the home over mDNS.

**Done when:** the laptop and a phone join the dev home by approval without copying anything, both show as devices, and re-pairing the laptop keeps the same device.

### Phase 2: Home identity and machine roles

- [ ] The `home` table, filled in for existing databases, and created with an explicit kind for fresh ones (§6.1).
- [ ] `getHome()` and the `RI_MODE` boot check, with tests.
- [ ] `src/lib/config/role.ts`, with tests: home, device, fresh, and a root that has both.
- [ ] The `getDb()` device guard, with a test that nothing gets created in a device root.
- [ ] `ri` by role:
  - a device opens the home signed in, and from Phase 4 on makes sure the worker is running
  - a fresh root asks the first-run question
- [ ] First-run defaults (a pairing link, Beamd `name_taken`), the "you can change this later" line, and the message when there's no terminal.
- [ ] The web welcome link.
- [ ] The two home onboarding steps: a stable address and start at login. Both can be skipped, and Connections offers them until done.
- [ ] `ri status`.
- [ ] Document the two onboarding flags.
- [ ] CLAUDE.md: a short "Homes and devices" section covering:
  - roles per data root
  - devices never open a database
  - workers
  - one agent with a folder per computer
  - spaces
  - `external_source_*` naming

**Done when:** `ri` in a fresh root asks the first-run question, a connected laptop root opens the dev home, and no command creates a database in a device root.

### Phase 3: `ri agent` and the Ri skill on a computer

- [ ] `POST /api/orchestrator/actions/[name]`, with tests that the envelope matches, it runs with `remote: true`, and `deviceId` is set on the actor.
- [ ] `ActionContext.actor.deviceId`, in the same shape as the session credential's actor.
- [ ] Route `ri agent` and the `ri trigger` group based on the machine's role. `ri browser` refuses on a device.
- [ ] Go through the actions that require the trusted local CLI, and record a decision for each.
- [ ] The device version of the global skill.
- [ ] Smoke test: in a device root, `ri agent create_task` creates the task on the home.

**Done when:** Claude Code on the laptop, using the Ri skill, manages tasks on the dev home, and nothing is written locally.

### Phase 4: The worker

- [ ] Split the executor into a session runner with no database, and home bookkeeping behind `EventWriter` (§6.4). The home must behave exactly as today, and `pnpm smoke:harness` must pass.
- [ ] `RemoteEventWriter`: posts events to `POST /api/workers/me/events` in ordered batches, with retry.
- [ ] The worker process (`src/worker/*`):
  - started by `ri` in a device root, and by a login item
  - sends heartbeats
  - reads the command stream and posts results
  - reconnects with increasing waits
- [ ] Commands: `start_session`, `send_message`, `interrupt`, `stop`, `restart`, `answer_pending_input`, `prepare_worktree`, `run_script`, `read_dir`, `read_file`, `diff`.
- [ ] Routing on the home: for executions on a worker, messages, interrupts, permission answers, stop, and restart become commands. They wait while the worker is away.
- [ ] Worker states (online, sleeping, offline), shown on device chips.
- [ ] Keep the Mac awake while a session runs.
- [ ] The "Let this computer run agents" switch on the Connections page.
- [ ] The worker security rules (§6.20).
- [ ] A dev-only route that starts a session on a given device in a given folder, so this phase can be tested before Phase 6. Phase 6 removes it.
- [ ] Tests: command routing, commands waiting while offline, event order, and state changes.

**Done when:** on the dev home, a session started on the laptop's worker through the dev route streams to the phone, takes messages and interrupts from the phone, and survives the laptop sleeping and waking.

### Phase 5: Agents across machines

- [ ] Add `workspace_folders`, `workspaces.git_remote_url`, and `workspaces.preferred_device_id`. Fill in host folders from `cwd` and `worktree_root`, and detect remote URLs.
- [ ] Add `folderFor(workspace, deviceId)`, and switch every `ws.cwd` read to it (about 97 reads in about 30 files). Keep writing `cwd` until Phase 13.
- [ ] One repo, one agent: when a folder is added, match it by normalized remote URL. Tests included.
- [ ] Offer to merge existing agents that share a remote. Their executions and chats move to the agent you keep.
- [ ] Worker commands `find_repo` and `clone`. Search harness history folders, common code folders, and search places the user added. Offer use, choose, or clone.
- [ ] A folder picker that browses any computer through its worker, grouped by computer: Recents, On Mac Mini, On this MacBook, From GitHub.
- [ ] Agent view: device dots in the header, and the Folders list in Setup.
- [ ] Agents without a git remote are pinned to their computer ("Only on MacBook").
- [ ] Where the main chat runs, and reference folders used on the home only (§6.5).

**Done when:** the Ri repo on the Mac Mini and on the laptop is one agent with two folders, found without typing a path, and nothing reads `workspaces.cwd` directly.

### Phase 6: Run on and location

- [ ] Add `executions.runs_on_device_id`. Fill it with the host device for existing executions, and set it everywhere an execution is created.
- [ ] Rebuild a missing worktree on the execution's own branch (gap 8), both on the home and in the worker's `prepare_worktree`. Test three cases: a local branch, a branch only on the remote, and a branch that's gone.
- [ ] Add the Run on chip to the agent composer, the new-execution flow, "Start with agent", and deck delegation. It remembers the last choice per agent, shows each computer's state, and offers "Set up on <computer>".
- [ ] Send work to the home or a worker. Background starts go to the home.
- [ ] Show the location chip on the execution header, rail rows, the deck, and task links.
- [ ] Files and diffs go through the worker. Terminal and Preview run on that computer, and other devices show "Open on <computer>". The Start script runs on the worker for previews.
- [ ] Remove the Phase 4 dev route.
- [ ] `list_executions` includes the device, and `start_execution` takes an optional `runOn`.

**Done when:** on the laptop, you start an execution with Run on set to this MacBook and preview it there, you follow and answer it from your phone, and every surface shows where it runs.

### Phase 7: Moving work, and takeover leaves

- [ ] The `moves` table and its queries, allowing one active move per execution. Tests included.
- [ ] `src/lib/moves/git.ts`: checkpoint and push, fetch, is-ancestor, fast-forward, stash, backup branch, and commits, name-status and shortstat between refs. Every call checks `exitCode`. Test it with temp repos and a bare remote.
- [ ] Move notes (`src/lib/moves/notes.ts`): AI-written with a fallback. Tests included.
- [ ] `assertRunsHere`, at the dispatch point and in the routes that change git state. Scheduled runs get the error codes `device_offline` and `moving`. Tests included.
- [ ] The whole move flow (§6.7): the fresh harness session in the same chat, seeded with the note, and the "Moved to" divider.
- [ ] Moving from a source that's asleep or offline, from the last pushed commit, after the warning.
- [ ] **Move to** in the execution header and the rail row menu.
- [ ] Archive and device revoke handle executions on workers.
- [ ] Remove takeover:
  - routes and queries
  - flattened fields
  - the rail redaction
  - the proxy bypass
  - the send block
  - UI, client, and CLI
  - the unused `deep-link-button.tsx`
  - test fixtures

  Check prod for active takeovers first. Keep take-over-import and `WipHandoffBanner`.

**Done when:** an execution moves from the Mac Mini to the MacBook and back with one click each way, stays one chat, and continues coherently from the note. Takeover is gone from the UI and the CLI.

### Phase 8: Sessions started by hand, and history import

- [ ] A tail reader: an agentex option, or the fallback of reading from a copy. Test a file that's still growing, a half-written last line picked up on the next read, and a replaced file.
- [ ] Move the prefix digest and the replace decision into a module with no database access.
- [ ] Fix the importer's final offset (gap 11), with a test.
- [ ] Schema:
  - `chat_sessions.origin_device_id`
  - `external_session_imports.origin_device_id`, and the split of its unique index
  - a new `surface_kind` value, `'device_session'`
- [ ] Worker command `list_sessions`, and **Add to Ri** in Unread and the agent view.
- [ ] Routes that upload a transcript in pieces: offset check, gzip, redaction, and a size cap. Tests included.
- [ ] Home-side exclusions for rows that came from a device, with tests.
- [ ] **Import history from this computer**, in Settings, Imports.

**Done when:**
- A `claude` session you start by hand in the laptop's Ri folder offers **Add to Ri**, becomes a read-only chat, and follows along live.
- Old laptop history imports under the right agents.

### Phase 9: Spike, conversations that move

This can run at any time. Its result decides step 6 of a move.

- [ ] A script in `personal/`:
  - run a Claude session in folder A on one machine
  - copy its transcript to the other machine, under the project folder for folder B
  - run `claude --resume <id>` in B, and check the agent continues without re-explaining
  - do ten trials, then repeat with Codex (`codex resume <id>`)
- [ ] Record the results and the decision here.
  - If both pass: moves carry the session, `moves.carried_session` is set, and the note becomes the fallback.
  - If not: record why, and keep the notes.

**Done when:** the results and the decision are recorded here.

### Phase 10: Restore, path rewrite, and transcripts

Needs Phase 0 (the bundle writer) and Phase 6 (rebuilding worktrees on the execution's own branch).

- [ ] Restore (`src/lib/home/restore.ts`), with tests. It refuses when `data.db` already exists, verifies checksums, merges config fields, and runs before `getDb()`.
- [ ] `ri home import`.
- [ ] Path rewrite, with tests: identical paths skip, the data root changes, the username changes, and a folder is missing.
- [ ] Place transcripts using the recomputed Claude project folder. Tests included.
- [ ] Fall back to a fresh session when a transcript is missing, using the move note builder. Test included.
- [ ] A host folder missing on the new machine: Setup shows it, with Choose folder and Clone.
- [ ] A round-trip test: export a seeded test home, import it into a new root at a different path, and boot it. Check row counts, devices, and that chats resume or fall back.
- [ ] `docs/storage-architecture.md`: replace the manual restore steps with `ri home import`.

**Done when:** a real export of the Mac Mini home imports into a temporary root on the laptop, boots, and shows the same row counts. Then delete the temporary root.

### Phase 11: Move a home over the network

**Schema:** `home_moves`, on the old home. Columns:
- `id`, timestamps
- `device_id` (FK `devices.id`)
- `state`: `requested | approved | moving | completed | cancelled`, a policy value the creator sets
- `preflight` (JSON)
- `approved_at`, `completed_at`, `new_home_url`

**Tasks**
- [ ] Preflight, the fix-ups, the approval prompt, and the moving state with Cancel move. Tests included.
- [ ] Streaming the bundle, only to the approved device.
- [ ] On the new machine: restore, path rewrite, and taking over the tunnel.
- [ ] Complete the move: write the `MOVED` marker, refuse to boot with it, and have `ri` on a moved root offer to rename it and connect.
- [ ] The old host device becomes a `computer`, and workers reconnect.
- [ ] The setup checklist in the new home.
- [ ] The path when the URL changes.
- [ ] **Move this home** on the Connections page, and first-run option 3.

**Done when:**
- Moving the dev home from the Mac Mini to the laptop over Beamd keeps its id and every device.
- The laptop's worker reconnects.
- The old root refuses to start as a home.
- Moving it back works the same way.

### Phase 12: Consolidate your machines

A step-by-step plan for your own setup.

- [ ] On the laptop, take stock of `~/ri` with a read-only script in `personal/`: row counts, plus the tasks, notes and areas that are missing from the Mac Mini home (checked through its API).
- [ ] Copy what you want to keep into the Mac Mini home through its API, with a one-time script in `personal/`. Record the counts here.
- [ ] Import the laptop's Claude and Codex history (Phase 8).
- [ ] Stop the laptop home and rename `~/ri` to `~/ri.retired-<date>`. Then open Ri and connect to the Mac Mini, with "Let this computer run agents" on.
- [ ] On the Mac Mini home, add the laptop's folders to your existing agents (Phase 5 finds them), and merge any duplicate agents.
- [ ] Keep `~/ri-dev` as the dev home.
- [ ] Give the Mac Mini a stable URL, with reconnect on startup.

**Done when:**
- The laptop has no home, and opening Ri there shows the Mac Mini.
- The laptop's folders belong to your existing agents.
- Nothing you wanted from the old laptop home is missing.

### Phase 13: Drop replaced columns (after the Stage 1 gate)

This is the one step that's hard to undo. Do it only when you're sure.

- [ ] Drop the six `takeover_*` columns and `uniq_executions_takeover_token`. `takeover_chat_session_id` has a foreign key, so this rebuilds `executions` (copying `rowid`) under `runMigrations`.
- [ ] Drop `workspaces.cwd` and `workspaces.worktree_root` with `ALTER TABLE ... DROP COLUMN`, once nothing writes them.
- [ ] Drop `api_keys.device_type`, which `devices.kind` replaces.
- [ ] Take a full export first. Dry-run on a copy of prod, and record before and after counts for `executions`, `chat_sessions`, `chat_events`, `workspaces`, `workspace_folders`, and `moves`. `PRAGMA foreign_key_check` must come back empty.

**Done when:** the numbers are recorded, prod boots, and moves still work.

### Phase 14: Audit trail and provenance

- [ ] Stop deleting a task's or note's versions when it's deleted. Tests included.
- [ ] Record a version when a task or note is created. Tests included.
- [ ] Snapshots include area, parent, tags, sort order, and completion.
- [ ] Add `'sync'` to `entity_versions.source` and `task_status_changes.actor_source`, and add `origin_source_id` and `remote_actor` to both.
- [ ] REST routes take the actor from the request's device. In spaces, `ctx.actor` also carries `memberId`.

**Done when:** every task and note change, including creates and deletes, leaves a version recording who made it.

### Phase 15: Spaces

**Schema:** `members`, `invites`, `devices.member_id`, `tasks.assignee_member_id`, `tasks.created_by_member_id`, `notes.created_by_member_id`, `tasks.revision`, and `change_log`.

**Tasks**
- [ ] **Create a space** in the app, and `ri space create`: choosing a port and Beamd name, a login item per root, and the invite share sheet.
- [ ] Team kind: resolve each request to a member, and refuse devices that have none.
- [ ] Invites: create, list, and revoke, plus the `/join` page and `POST /api/join`.
- [ ] Member devices join through the space's approval flow.
- [ ] The permissions module and its enforcement, with tests for each role.
- [ ] Space-safe rules: preview is off unless allowed. Tests included.
- [ ] `change_log` and the revision bump, in team homes only. Tests included.
- [ ] `GET /api/space`.
- [ ] Space UI:
  - a tasks board with status, an assignee filter, "Mine", and assign
  - notes, members, and activity
  - the space banner
  - the deck, stream, and personal settings are hidden

**Done when:** a space runs on the Mac Mini under its own root with two members (one using only a phone), they can create, assign, and complete tasks, and every change shows who made it.

### Phase 16: Connect your home to a space (pull)

- [ ] The task sync columns and index, `sync_sources`, and credentials in `.config/sources` (these go into the backup bundle).
- [ ] In the space: **Connect my Ri home**, the browser-link route, and `GET /api/space/changes`.
- [ ] In your home: the Spaces section of Connections, with connect by link or invite, status, last sync, pause, remove, and Open.
- [ ] `applyRemoteTask`, `transitionTaskFromSync`, and handling for unassigned or deleted tasks. Tests: applying the same change twice is safe, any status can move to any status, open subtasks are handled, and personal fields are never touched.
- [ ] The pull loop: every 60 s, on focus, and on **Sync now**, with backoff after failures. Tests included.
- [ ] The per-source mirror setting and the frontmatter fields.
- [ ] Realtime task-changed events.
- [ ] Synced task UI:
  - the space dot
  - shared fields stay read-only until Phase 17
  - "No longer assigned to you", with Keep and Remove

**Done when:** tasks assigned to you in the Family space appear in your home within a minute, and your area and order survive later updates.

### Phase 17: Push, the field split, and sharing up

- [ ] `sync_outbox`, written inside the `updateTask` and lifecycle transactions. Tests check that only shared fields are sent.
- [ ] The space's patch and transition routes: last writer wins, repeats are ignored, and versions record the member. Tests included.
- [ ] The push loop: in order for each task, with retries and rejections. Tests included.
- [ ] The field split is enforced, with read-only fields shown as such in the UI.
- [ ] Triage merges into synced tasks go to `userContext` or a subtask. Test included.
- [ ] Deleting a synced task locally is blocked. Add **Hide from my deck** and **Detach**.
- [ ] **Share to <space>**, which keeps the task's id and converts it in place, and **New task in <space>**.

**Done when:** completing a Family task in your home shows as done for your wife within a minute, and your personal notes on it never reach the space.

### Phase 18: The deck and navigation across spaces

- [ ] Per-source limits in the deck, with a test.
- [ ] The space label, assigner, and due date in the prompt, and the new `DECK.md` line.
- [ ] `spaceId` and `spaceLabel` on deck items, the space pill and filter, and the device chip for running executions.
- [ ] The space switcher in the top bar, stored in `user_state.active_space_id`.
- [ ] **Open <space>**, already signed in.

**Done when:** one deck mixes personal and Family work with clear labels, and the switcher narrows every view.

### Phase 19: Family space pilot

- [ ] Create the Family space on the Mac Mini.
- [ ] Invite your wife. She joins from her phone.
- [ ] Connect your home to the space.
- [ ] Use it for two weeks, and record the friction here.

**Done when:** you've used it for two weeks, the notes are recorded, and there's a go or no-go for Stage 3.

### Phase 20: Terminal and Preview from any device

Write its spec first.

- [ ] The spec.
- [ ] Relay the terminals and previews of executions on a worker through the worker's connection, so they work from any device.

### Phase 21: Space notes by relevance

Write its spec first.

- [ ] The spec.
- [ ] A search API for members in the space, and a `search_spaces` action in your home.
- [ ] **Share to <space>** for notes, if Phase 17 didn't cover it.

### Phase 22: Team agents

Write its spec first.

- [ ] The spec, covering the groundskeeper and the Slack bot.
- [ ] The groundskeeper, as a space trigger that only suggests at first.
- [ ] Inbound Slack: mapping Slack users to members, conversations with several people, and propose-then-approve.

### Phase 23: Sign-in methods

Write its spec first.

- [ ] The spec.
- [ ] `member_identities`, Nostr sign-in (NIP-98 and NIP-46), and linking an identity to a member.
- [ ] OIDC single sign-on.

### Phase 24: Third-party sources

Write its spec first.

- [ ] The spec.
- [ ] Linear, Jira, Asana, and Todoist as `sync_sources` kinds, built on the task-source adapters. They reuse `applyRemoteTask` and the outbox, and write back through connector actions.

### Phase 25: Hosting

Write its spec first.

- [ ] The spec, covering the business model and the infrastructure.
- [ ] Moving a home to a hosted machine.

### Phase 26: A Mac app

Write its spec first.

- [ ] The spec: a signed menu bar app that installs Ri, connects a computer by approval, runs its worker, and opens the home, all without the command line.

### 7.1 Reverting

Everything here can be undone. What each piece takes:

| What | How to undo | What stays behind |
|---|---|---|
| Any phase's code | `git revert` its commits, rebuild, and restart | Its new tables and columns, which older code ignores |
| The database | Nothing to do. `runMigrations` only applies newer migrations, so older code boots on a newer database | Unused tables and columns |
| Agents across machines | Revert the code. `workspaces.cwd` is still written until Phase 13, so older code keeps working | `workspace_folders` rows |
| A worker on the laptop | Move its executions home, then turn off "Let this computer run agents", or run `ri stop` | Worktrees on the laptop, which are harmless |
| The laptop as a device | Disconnect it, rename `~/ri.retired-<date>` back to `~/ri`, and start it | Anything created on the Mac Mini since then stays there. Copy it back, or use an export |
| Moves and takeover | Revert. Takeover comes back, because its columns stay until Phase 13 | `moves` rows |
| A home move | Move back with the same flow, or restore the pre-move export and delete the `MOVED` marker | Changes made on the new machine, unless you move back |
| A space | Stop it and archive its root. Your home is untouched. Disconnecting asks whether to keep its tasks as personal ones | The space's data, in its root |
| Anything else | Restore the latest `ri home export` into a fresh root | Changes made since that export |

Three rules keep this true:
- **Rename, never delete.**
- **Export before changing the database** (Phase 0).
- **Only add to the schema** until Phase 13. Phase 13 runs after the Stage 1 gate, and only when you're sure.

---

## 8. Schema summary

| Change | Phase | Migration |
|---|---|---|
| `devices`, `device_requests` | 1 | New tables |
| `api_keys.device_id` (filled in for existing keys) | 1 | Add column |
| `home`, and its first row | 2 | New table, plus a guarded insert |
| `workspace_folders` (filled in from `cwd`) | 5 | New table |
| `workspaces.git_remote_url`, `workspaces.preferred_device_id` | 5 | Add columns |
| `executions.runs_on_device_id` (filled in for existing executions) | 6 | Add column |
| `moves` | 7 | New table |
| New `chat_events.source` value `'move'`, and new `surface_kind` value `'device_session'` | 7, 8 | TypeScript unions only |
| `chat_sessions.origin_device_id` | 8 | Add column |
| `external_session_imports.origin_device_id`, and its unique index split in two | 8 | Add column, drop and recreate indexes |
| `home_moves` | 11 | New table |
| Drop `takeover_*`, `workspaces.cwd`, `workspaces.worktree_root`, and `api_keys.device_type` | 13 | Drops. One rebuild, of `executions` |
| `entity_versions` and `task_status_changes`: add `origin_source_id`, `remote_actor`, and the `'sync'` value | 14 | Add columns |
| `members`, `invites`, `change_log` | 15 | New tables |
| `devices.member_id`, `tasks.assignee_member_id`, `tasks.created_by_member_id`, `notes.created_by_member_id`, `tasks.revision` | 15 | Add columns |
| `sync_sources` | 16 | New table |
| Task sync columns, and their partial unique index | 16 | Add columns, plus an index |
| `sync_outbox` | 17 | New table |
| `user_state.active_space_id` | 18 | Add column |
| `member_identities` | 23 | New table |

- **Nothing before Phase 13 rebuilds a table.** Every migration is still generated, checked for rebuilds, and dry-run on a copy of prod, with row counts recorded in its phase.
- **Policy columns** (status, role, state) are NOT NULL with no default, and the code that creates each row sets them, per CLAUDE.md.
- **Rollback rule:** every new column on an existing table is nullable or defaults to 0.

---

## 9. Not in this spec

- **An offline cache on devices.**
- **Phones or browsers running agents.**
- **A fleet or pool of machines.** It's one home plus the computers you sit at.
- **Syncing uncommitted files between machines.** Work moves by branch.
- **Syncing personal homes directly with each other, with no space in between** (Path D).
- **Full CRDT replication** (Path C).
- **Several people sharing one personal home** (Path B).
- **A central account system.**
- **A computer connected to more than one home.** Browsers can pair with any number of homes and spaces.

---

## 10. File reference

**New**
- **Library:**
  - `src/lib/config/role.ts`, `src/lib/auth/request-device.ts`, `src/lib/device/home-client.ts`, `src/lib/api/read-json-body.ts`
  - `src/lib/moves/{git,notes,flow}.ts`
  - `src/lib/home/{bundle,restore,rewrite-paths}.ts`
  - `src/lib/sync/{pull,push}.ts`
  - `src/lib/space/{permissions,members,invites}.ts`
- **Worker:** `src/worker/*`, covering the worker process, its command handlers, and `RemoteEventWriter`. Also the session runner with no database access, split out of `src/lib/executor/adapter.ts`.
- **Routes:**
  - `src/app/api/devices/{me,requests}/…`
  - `src/app/api/workers/me/{commands,events,heartbeat,sessions}/…`
  - `src/app/api/executions/[id]/move/route.ts`
  - `src/app/api/orchestrator/actions/[name]/route.ts`
  - `src/app/api/home/move/…`
  - `src/app/api/space/…` and `src/app/api/join/route.ts`
  - `src/app/join/page.tsx`
- **CLI:** `src/cli/commands/{status,home,space}.ts`, plus the first-run and connect paths in `src/cli/commands/start.ts`.
- **UI:**
  - the Connections page and the approval prompt
  - the Run on chip, device chips, and the Move to menu
  - the Folders list in agent Setup, and the folder picker grouped by computer
  - Add to Ri
  - the space switcher, and the space pill and filter

**Modified**
- **Core:** `src/proxy.ts`, `src/lib/db/index.ts` (the `getDb` guard), `src/lib/db/schema.ts`, `src/db/types.ts`, `src/lib/db/queries.ts`
- **Execution:**
  - `src/lib/executor/adapter.ts` and `src/lib/executor/event-writer.ts`
  - `src/lib/sessions/dispatch.ts`, `src/lib/workspaces/index.ts`, `src/lib/runs/dispatch.ts`
  - every code path that reads `ws.cwd` (§6.5)
- **Import:** `src/lib/import/external-agents.ts`, `src/lib/executor/reconcile.ts`
- **Orchestrator and deck:** `src/lib/orchestrator/registry.ts`, `src/lib/ai/generate-deck.ts`
- **UI:** `src/components/agents/*`, the execution header and view, and `src/components/workspaces/folder-picker.tsx`
- **CLI:** `src/cli/index.ts`, `src/cli/commands/{start,agent,trigger}.ts`, and the global skill writer
- **Docs:** the ones listed in Phase 0

**Removed** (Phases 7 and 13)
- **Takeover:** its routes, CLI, UI, and columns (§5.3)
- **Docs:** `docs/handoff-spec.md`, merged into this doc
