# One Ri: build notes

Working notes for building [the homes build specification](homes-spec.md). The spec is the contract. This file records how the build runs, what was found, and the design decisions the spec leaves to implementation. Sections are numbered by the spec task they serve.

## P0.1 Isolated development setup

Production must stay untouched while this is built (spec §10.4). A worktree isolates code, not data: every path helper falls back to `~/ri` when `RI_ROOT` is unset, and a shell started inside a harness session inherits that session's caller credential and Claude Code's own session variables. Isolation therefore comes from paths, checked before anything runs.

### The launcher

`pnpm iso <root> [--init] [--port <n>] [--tunnel <name>] [--check] [-- <command...>]` (`scripts/isolated.ts`, rules in `src/lib/config/dev-isolation.ts`):

- Builds a clean environment. Inherited `RI_*` variables (including `RI_SESSION_CREDENTIAL`), `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID` and `CLAUDE_EFFORT` are removed. `CLAUDE_CODE_MESSAGING_SOCKET` and its token point at the session that launched the command, so a harness started by a dev server would otherwise run as that session's child.
- Pins `RI_ROOT`, `RI_DB_PATH`, `RI_CONFIG_DIR` and `RI_WORK_DIR` under the root and resolves them through the real path helpers.
- Refuses, after following symlinks, when a resolved path lands in `~/ri` (production), `~/ri-dev` (other sessions' dev server on 42241) or `~/ri-test` (the smokes wipe it), when the root contains one of those, when the port is in use, when the root's config carries production's token or tunnel name, and when it would install the shipped skill machine-wide.
- `--init` creates the root (0700) and seeds `globalSkillEnabled: false` and `onboardedAt`. The terminal wizard otherwise runs on the first interactive `start` and installs the skill into `~/.claude/skills`, replacing production's copy.

### Running the dev home

```sh
pnpm iso ~/ri-homes --init --port 42251 --check
pnpm iso ~/ri-homes --port 42251 -- pnpm -s cli:dev start --dev --no-open --no-voice --port 42251
```

- Open it at `http://127.0.0.1:42251`, not `localhost`. Every instance names its session cookie `ri_session`, and browsers don't separate cookies by port, so a dev tab on `localhost:42251` and a production tab on `localhost:4224` in one browser log each other's live updates out. Production is normally reached at its Beamd address, which is a different host.
- Stop it by stopping the launcher process. Never use `ri stop` for an isolated instance: without a runtime record, `stop` falls back to the default dev port, which belongs to a different instance.
- The dev address (a separate Beamd name) is set up when cross-device testing starts. Pass it with `--tunnel`, and leave production's `ri-trey` tunnel alone.

Verified 2026-09-24: the dev home started from this worktree with its own host token, the startup sweep found nothing to act on, `lsof` showed the server holding only `~/ri-homes/data.db`, and production kept running on the same process with no machine-wide skill installed.

### Existing roots (Mac Mini, 2026-09-24)

Taken with `scripts/inventory-root.ts`, which reads a root without writing to it. `~/flow*` roots are retired and out of scope.

| Root | What it is | Notes |
| --- | --- | --- |
| `~/ri` | Production home | 5.3 GB database (652k chat events), 613 tasks, 247 notes, 17 areas, 14 agents (9 active), 186 executions (49 active), 645 chats, 11 schedules, 9 keys. 507 attachment files, all referenced ones present. 425 native transcript paths recorded, 251 still on disk. One active execution has 15 commits on no remote ("Validate New Calculations Against Old Values", InsiderFinance). No reference folders. About 11 GB of old `data.db.bak-*` copies and 74 GB of worktrees sit in the root. |
| `~/ri-dev` | Other sessions' dev home, running on 42241 | Not used by this build |
| `~/ri-test` | Smoke home | Wiped by every smoke run |
| `~/ri-homes` | This build's dev home | Created for this build |

The laptop's home is inventoried before the consolidation rehearsal (P5.1), from a consistent backup rather than a broad copy of its folder.

### Backup and restore

`src/lib/home/backup.ts`, driven by `scripts/home-backup.ts`:

- `backup <root> <out>`: a checksummed copy of the database, attachments, `.archive`, persona and memory files, user skills, and `.config` apart from what belongs to the machine (`browser/`, `tls/`, `cli-config.json`, connector locks). Every other top-level entry is listed in the manifest with the reason it was left out.
- The source is only read. A database with `-wal`/`-shm` files may be in use, so it is copied with SQLite's online backup in one step (a stepped backup restarts whenever another connection writes, and a running home always writes). A database without them is cloned. Opening a WAL database read-only creates those files, which the tests caught.
- `verify <dir>` checks every file's size and checksum, `quick_check`, and every table's row count against the manifest.
- `restore <dir> <new-root>` refuses a root that already has a database and verifies what it wrote.
- `dev-copy <root>` (`src/lib/home/dev-copy.ts`) makes a restored copy safe to boot, as §10.4 requires. It clears the token and tunnel, revokes every key, disables schedules and notification channels, removes connector credentials and push subscriptions, clears every chat's native session id (Claude Code resumes a session by id from any folder, so the copy's first message would append to production's transcript), and moves every folder path under `<root>/.detached/` so provisioning, continuing or scripts fail as "folder missing" instead of touching production's repositories.
- `pnpm iso <root> -- pnpm tsx scripts/home-backup.ts open-check` opens a restored root through the app and reads it through the shared queries.

Rehearsed 2026-09-24 on production: backup 16.6 s (660 files, 5.6 GB, `quick_check` ok), verify 3.6 s, restore 11.5 s, `dev-copy` (6 keys revoked, 10 schedules disabled, 427 native sessions and 209 folder paths detached), then `open-check` read 613 tasks and 247 notes. The production root's listing was identical before and after. The baseline backup is `~/ri-backups/ri-20260924T210433Z`, and the rehearsal copy was deleted.

## P0.2 Test fixtures

In `src/test/fixtures/`, each checked against the real app by `fixtures.test.ts`:

- `home.ts`: `createTestHome()` gives a private root with every path override set, a config with a known host token, and a database opened through `getDb()`. `cleanup()` restores the environment. `createTestComputer(name)` makes a second root that stands in for another computer (config, work dir, and a user folder for its projects) without a database or environment changes.
- `git.ts`: bare remotes, clones anywhere, commits, and `createTwoComputerLayout()`, the spec's §4.1 example: the app at `~/dynamism/ri` with `../agentex` on the MacBook, and at `~/ai-task-manager` with `../code/agentex` on the Mac Mini, with an optional monorepo subfolder.
- `fake-harness.ts`: `installFakeHarness('claude')` swaps the agentex provider for one that spawns nothing and follows the real event order. Turn scripts can say things, raise a prompt and wait for the answer, emit raw events, and fail. Tests can interrupt, crash or close a session. Driven through the real executor, it covers a turn persisting events and capturing the native session id, a crash followed by a resume of the same native session, a permission prompt answered through the pending-input registry, and an interrupt.
- `migrations.ts`: `createDatabaseAt(dbPath, tag)` builds a database exactly as an older build left it, to seed and then upgrade through `getDb()`.

The worker connection fixtures (a fake worker and a home served over HTTP for reconnect, replay and revocation tests) are built with the worker protocol in P2.2, since they exercise that protocol.

## P1.1 Identity as built

- `home` and `computers` tables (migration `0002`), queries in the "Home and computers" section of `queries.ts`, logic in `src/lib/home/identity.ts`.
- A new home is named "My Ri" and is editable later. A computer is named from macOS's Computer Name ("AI Mac Mini"), falling back to the hostname without `.local`.
- The first boot writes `machine.json` with create-if-absent, so the CLI's `start` and the server booting a new root at the same time agree on the ids. If the database insert loses a race, the winner's row decides.
- `machine.json` also records a fingerprint of this machine (a hash of the OS machine id, never the id itself) and the folder's real location. A whole-folder copy carries the file along, so a copy on another Mac (Migration Assistant, a disk clone) needs claiming, and so does a copy or move to another folder on the same Mac. Files written before this was added are bound the first time they match. What this can't prevent: once a copy is claimed, the original keeps running where it is until it's retired (P5.3).
- A root that needs claiming: `ri start` refuses with the reason, the server's boot hook starts no background work (mirror, reconcile, sweeps, tunnel, triggers, scheduler), and the proxy answers `503 home_not_active` to everything except health and session, webhooks, OAuth callbacks and takeover included. `ri home claim` makes this machine the host, reusing its computer row when the home already has one, and leaves the previous host as an active computer that can reconnect as a worker.
- `dev-copy` gives a development copy a new home id and host computer, names it "<name> (dev copy)", and revokes the original's computers in the copy.
- Backup manifests record the home id.

## P1.2 and P1.3 as built

- A folder's role comes from what it holds (`src/lib/config/role.ts`). `getDb()` refuses to create a database where `connection.json` exists, and the CLI's pre-action guard refuses data commands on fresh and connected folders (`src/cli/lib/role-guard.ts`).
- `src/lib/connection/home-client.ts` is the only way a connected computer calls its home. It maps failures to the spec's states (§3.5): unreachable, access removed, a different home at the address, not active, an older home, an untrusted certificate.
- The proxy forwards the validated key as `x-ri-api-key-id` and `x-ri-api-key-type`, and `x-ri-caller-location`, after deleting any inbound copies, on every route. Handlers read them with `src/lib/auth/request-key.ts`.
- `ActionContext.caller` says whether the caller holds the home's own key: the one `ensureLocalToken` minted and keeps in this root's config (`src/lib/auth/host-key.ts`), which the home's CLI and its sessions use. A key's `deviceType` label never decides it, and the device APIs no longer let anyone set `host`. It is permission to act on the home's folders, not proof of where the caller physically is.
- Actions a connected computer can't run, and why:
  - Folder paths resolve on the home: `create_workspace`, and `list_skills` with a folder. A connected computer sets up its own folders through its local setup (P1.4).
  - The trusted local CLI only, as for MCP: `repair_attachment_metadata`, bare-path reference folders, and connector scopes or the browser switch in `update_workspace`.
  - `ri browser` drives the browser on the machine it runs on, so it stays refused on a connected computer.
- `ri trigger run` and `ri run cancel` on a connected computer run inside the home's server. On the home itself they still run in the CLI process, which is gap 1 in P0.4, fixed in P2.4.

## P1.4 Setups as built

- Files: `local-file.ts` (format, revision, writes, Git exclude), `registry.ts` (this computer's `<config>/setups.json`, locations only), `resolve.ts` (reports), `service.ts` (attach, ref, relink, restore, detach, all followed by a full report), `home-context.ts` (the home's side and its in-process link). The CLI's link is `src/cli/lib/setup-link.ts`.
- Actions: `register_computer`, `rename_computer`, `get_setup_context`, `report_agent_setups`, `list_agent_setups`. The calling computer comes from the key: the host key means the home's own computer, and any other key must have registered.
- A connected computer registers on its first `ri setup` or `ri connect`, and keeps the id in `connection.json` and in `known-homes.json`, which outlives `ri disconnect`. The key is linked to the computer in `api_keys.computer_id`. Registering doesn't let the home run work on that computer, which needs P2.2's separate worker credential. The pairing key itself keeps the full access it always had.
- Re-pairing keeps the computer: a new key that presents the remembered id is linked to the same computer. It never binds to the home's own computer or a removed one.
- Every setup change reads the file fresh and refuses a file that can't be read or belongs to another home. Moving an agent sets up the new folder first and clears the old one only after that succeeds. An agent taken out of a readable shared file is simply no longer reported, while a deleted file still is, so it can be restored. Detach never unregisters a folder another agent still uses.
- A report about a folder or file that can't be read keeps the last observed references in the index. That's what restore rebuilds from. An agent removed from a computer's files disappears from the index on the next complete report.
- Deliberately not in P1.4: creating an agent from a computer with no folder on the home (it needs `workspaces.cwd` to become optional, which is P1.5), editing setups from the web UI, and suggesting folders from harness history.

## P1.5 Adoption as built

- `src/lib/setups/adopt.ts` plans and applies. `planHomeAdoption` / `adoptHomeSetups` in `home-context.ts` run it for the live home, and `ri setup adopt` is the command.
- Adoption is explicit, not automatic at boot, because it writes into the person's folders. The production cutover runbook runs it once. `ri setup` on the home says when agents still need it.
- Stored reference paths are written as absolute paths. The spec allows it (§4.3: absolute paths stay local to that computer), and it changes nothing about where they point.
- Home hooks: `POST /api/workspaces` and `create_workspace` check the folder can hold the setup before creating anything, then call `setHomeFolder`. If that still fails, the new agent is archived and the error returned. `PATCH /api/workspaces/:id` with `cwd` sets up the new folder before changing the database, and returns 400 with the old setup intact on failure. The reference routes and actions call `applyReferenceToHomeSetups` and return which setup files were updated or failed. A rename carries this computer's own value to the new name. The dev-only scratch agent is left as it was.
- `workspaces.cwd` is the home computer's observed folder, updated from its reports and never the other way round. It stays until P2 moves the executor to setups. An agent with no folder on the home (created from another computer) needs `cwd` to become optional, and comes with P3.1's "use the first setup the person enables".
- Production preview (`scripts/plan-adoption.ts ~/ri`, read-only): 9 setup files, one in each active agent's folder (`/Users/agent/ai-task-manager` and eight under `/Users/agent/code`), with no references.

## Review of P0 and P1 (46a2b02)

An independent review ran the branch through `pnpm iso` in `/private/tmp`, and found four high and seven medium issues. Each was first reproduced by the reviewer's probe, now kept as `src/test/regressions/homes-review.test.ts`. All are fixed:

1. `deviceType: 'host'`, which any paired device could set, decided "on the home". Now the home's own key decides, and `host` is reserved.
2. Webhooks, OAuth callbacks and takeover skipped the unclaimed-home check. The check now runs before them.
3. The launcher compared paths as spelled, so a symlink into production passed. It follows links now.
4. A failed folder change deleted the old setup and returned 200. It now sets up the new folder first and fails with the old one intact.
5. Answering "No" still set an empty home aside. It now takes only an explicit yes, and only after the home accepted the link.
6. Detaching one agent from a shared folder left it stuck as broken. Detaching it again unregistered the folder, silently dropping the other agent too.
7. Renaming a reference reset this computer's own value to the default.
8. Setup changes didn't check the file's home before writing.
9. Gateway errors (a tunnel's 502 while the home sleeps) counted as the home answering, so the offline bar never showed on a phone.
10. A whole-folder copy that included `machine.json` started as the home. Identity is now bound to the machine and folder.
11. `getDb()` opened a database beside a connection record.

The review agreed with the P0.3 runner design, and asked for the exact home and worker messages (command ids, placement generations, event positions, replay that can't double-count) to be written down before P2 code. They are in [P2 protocol](#p2-protocol-home-and-worker-messages).

**Re-check at 8ad4a01.** Eight fixes were confirmed closed. Three were partial, with six new code cases now kept in `src/test/regressions/homes-recheck.test.ts`, and three protocol gaps. All are fixed:
- A dangling symlink (one pointing at a file not yet created) still passed the launcher. Paths are now resolved one component at a time, following dangling and relative links, and a path that can't be resolved, such as a symlink loop, is refused.
- Two reference bugs:
  - A deliberate omission (`null`) was treated as unmapped and reset.
  - Renaming a global reference took over an agent's own reference of the old name.

  Both are fixed. A setup file that can't be updated is now reported as a failure, not skipped.
- A rejected edit could already have moved the folder. The whole patch is validated first, and the move is undone if the database still refuses.
- A failed cleanup of the old folder left the agent set up twice. The old folder is checked before anything is written, and the new one is put back if the cleanup still fails (`src/lib/setups/move-undo.test.ts`).
- Three protocol gaps are now covered:
  - durable command receipt, with recovery for every command kind;
  - notifications queued in the event's own transaction, with sending to outside services stated as at-least-once;
  - dedicated worker routes for attachments and artifacts, with the bytes stored before the event that refers to them is acknowledged.

**Targeted review at 1d76d11.** It covered the path walker, folder moves, and the new P2 sections, and found five code cases and three protocol gaps. Notification queueing was confirmed complete. The reviewer's probes are kept in `src/test/regressions/homes-targeted-path-review.test.ts` and `homes-targeted-move-review.test.ts`. All are fixed:
- `link/..` still escaped the launcher's check, because `..` was collapsed before the link in front of it was followed. The walker now keeps `..` until everything before it is resolved, in the input and in link targets.
- Moving an agent had three more ways to lose or duplicate a setup:
  - a failure while unregistering the old folder, after its file was gone, left no setup anywhere;
  - a failed registration, or a failed report to the home, happened outside the undo;
  - moving to another name for the same folder (a symlink) deleted the live file.

  Every setup operation (attach, move, reference, relink, restore, detach) is now one `SetupChange` (`src/lib/setups/change.ts`). It records the exact bytes and registration it replaces, and undoes everything, newest first, if a step, the report, or the caller's last step fails. Folders compare by identity on disk, so a second name for a folder is a change of spelling only, and the registry holds a folder once.
- A rejected agent edit moved the folder back through an ordinary move, which rebuilt the setup from defaults and lost local choices such as a left-out reference. Saving the agent is now the change's last step, so a refusal undoes the move exactly.
- Three protocol gaps are now covered:
  - Command numbers are assigned when a command is first streamed, so a cancelled command leaves no hole in the receipt cursor.
  - The setup script in `prepare` is journaled like `run_script` and never re-run automatically.
  - An artifact's bytes and its event are both kept on the worker before any upload, under a file name minted once, so an outage or crash loses neither and a retry repairs the same file.

## P2 protocol: home and worker messages

Written before P2 code, as the review asked. It refines the P0.3 records below; where they differ, this section wins. It is the contract the worker, the home's routes, and the home's in-process runner all follow.

### Credentials

- **Worker key.** An `api_keys` row with `computer_id` set and a worker scope, issued only by redeeming an enrollment grant (P2.2). A viewing key never gains it. The worker routes accept only worker keys, and a worker key reaches nothing else. The computer the worker acts as comes from the key, never from a field it sends.
- **Session tokens for sessions on a worker.** A harness on the laptop still calls the home's orchestrator, connector and browser servers. Giving it the worker key would let a session act as the worker, so the home mints a token per session instead. The token is bound to the chat, the computer and the placement generation, reaches only those servers, and resolves to that session as the actor, with location `elsewhere`. The home's own sessions keep using the home's key.

### Connection

- `GET /api/workers/me/stream?after=<seq>` is a server-sent event stream. It sends `hello`, `command`, `request` (an ephemeral read), `revoked`, and a keepalive `ping`. `after` is the worker's durable receipt cursor (see Command receipt and recovery), never merely the last command it saw.
- `POST /api/workers/me/commands/:id/ack` reports a command's delivery state.
- `POST /api/workers/me/requests/:id/result` answers a read.
- `POST /api/workers/me/events` delivers a batch of journaled events, and returns the highest contiguous position stored.
- `POST /api/workers/me/heartbeat` sends every 20 seconds: protocol, version, harnesses, `awake | asleep | stopped`, and the placements the worker holds (execution id and generation).
- Every request carries `x-ri-worker-protocol`. A home that can't speak it answers `426` with "Update Ri on MacBook". It never sends a command the worker can't read.

### Commands

```ts
interface WorkerCommand {
  id: string;            // UUIDv7, stable: the idempotency key
  seq: number;           // per computer, assigned when first streamed: where a stream resumes
  kind: 'prepare' | 'send' | 'interrupt' | 'stop_task' | 'stop' | 'answer_pending_input'
      | 'run_script' | 'write_setup' | 'git';
  target: { executionId?: string; chatSessionId?: string; generation?: number };
  actor: { source: 'human' | 'ai' | 'system'; sessionId?: string | null; apiKeyId?: string | null };
  issuedAt: string;
  payload: unknown;      // per kind
}
```

- **Persisted first.** A command is written to `worker_commands` in the same transaction as what it acts on. For `send`, that's the user's `chat_events` row, whose id the payload carries. Only then is it streamed.
- **Numbered when streamed, never when queued.** In one transaction the home gives a queued command the computer's next `seq` and marks it `sent`, then writes it to the stream. A command cancelled while queued, or found stale before streaming, never gets a number. So the numbers a worker sees have no holes, and its contiguous receipt cursor always advances. A command resent after a reconnect keeps its number.
- **Delivery states:**
  - `queued`: saved at home.
  - `sent`: written to the stream.
  - `delivered`: the worker acknowledged it applied it. For `send`, the harness accepted the message.
  - `failed`: the worker refused it, with a reason.
  - `stale`: the generation didn't match.
  - `uncertain`: see below.
  - `cancelled`: withdrawn before `sent`. A `sent` command can't be cancelled. Stopping the execution is the way out.
- **`send` carries everything to start or resume the session:**
  - the session spec (harness, model, permission mode and its provider config, instructions, reference aliases and descriptions, the orchestrator and connector servers with the session's token, first-turn brief), plus the chat's current native session id;
  - the text as the harness should receive it, with markers and sender label already applied;
  - attachments as `{ fileName, originalName, mimeType, size, sha256 }`, which the worker downloads through the worker attachment route (see Attachments and artifacts). A home disk path is never sent;
  - the `runId` the home created for the turn.
- **Reads are not commands.** Tree, file, diff, status, diff stats, folder discovery and history listing go as `request` with a timeout and are never persisted.

### Command receipt and recovery

Seeing a command on the stream is not receipt, and applying it is not acknowledgement: either can be cut off by a crash or a dropped connection. So both sides keep durable state.

- **The worker journals every command before acting on it.** It is appended to `<workDir>/commands/<homeId>.jsonl` as `received` and flushed to disk. The worker's receipt cursor is the highest `seq` with a contiguous run of durable `received` records, and that cursor is what it asks the stream to resume after. A command id already in the journal is never applied twice: a replayed one gets its recorded outcome back.
- **Each command then records what happened.** `started` goes in before a command with effects outside the journal (injecting a message, running a script, a Git operation). `finished`, with its result or error, goes in afterwards. The acknowledgement is sent only after `finished` is on disk.
- **Acknowledgements are resent until the home confirms them.** The ack route is idempotent by command id and returns the state the home recorded. The worker keeps resending on reconnect until the recorded state matches.
- **The home resends what wasn't acknowledged.** After a reconnect, `sent` commands with no ack go out again, and the worker's journal keeps them from being applied twice.
- **After a worker restart,** each command left `received` or `started` without `finished` is recovered by kind:

| Kind | Recovery |
| --- | --- |
| `send` | Look for the message in the native history: found is `delivered`, missing is `uncertain`. Never re-sent automatically |
| `interrupt`, `stop_task`, `stop` | Safe to repeat. Re-apply if the placement is still this computer's |
| `answer_pending_input` | Re-apply if the prompt with that request id is still pending, otherwise `stale` |
| `prepare` | Journaled step by step, because only some steps can safely be repeated. Creating the worktree, checking out the branch at the checkpoint and copying files are idempotent: inspect and continue from the step that stopped. The setup script is not. It records its own `started` and `finished`, and `started` without `finished` is `uncertain`, as for `run_script`. Preparation stops there, and the home shows "Setup may not have finished" with Run again and Continue without it. It is never re-run automatically |
| `write_setup` | Revision-checked: the file at the target revision means done, at the base revision means apply, anything else means conflict |
| `run_script` | Not idempotent. `started` without `finished` is `uncertain`, shown with Retry, never re-run automatically. The one exception is a preview start: if its supervised process is alive, it's running |
| `git` | Push: done if the remote ref equals the local one, otherwise push again, which is safe. Base update: done if the base is already merged. Checkpoint commit: done if HEAD is the recorded commit |

- **Recovery waits for the home.** A restarted worker recovers nothing until the home has opened its stream and a heartbeat has confirmed which placements are still its own. A placement the home releases is journaled and fences every older command for it (P2 review fixes).
- **A delivered send's turn is tracked until it ends.** The journal records when a turn's result is journaled. A turn still open when the worker restarts was cut off with the process, and is reported to the home as failed, never sent again.
- **The home's own runner keeps the same states** in `worker_commands`, writing `started` before and `finished` after each effect outside the database. After a home restart the same recovery table applies, using the home's own native history and worktrees. The home's restart reaps only runs it ran itself: a connected computer's runs end when its worker reports them.

### Fencing

- Every execution-scoped command carries the placement generation the home had when it queued it. This includes `interrupt`, `stop_task`, `stop` and `answer_pending_input`, not only `send`.
- The worker keeps the generation of each placement it holds. It acknowledges any mismatch as `stale` and does nothing.
- A pending-input answer must match the request id, chat, and generation. A late answer to a prompt from before a move is rejected.
- **On reconnect**, the heartbeat lists the placements the worker holds. The home answers with any that are no longer the worker's (the computer was revoked, or the execution moved), and the worker stops those before it processes any queued command. A revoked worker gets `revoked` and nothing else, so replaying an old queue can't give it control back.

### Events

```ts
interface WorkerEvent {
  position: number;      // per computer journal, contiguous from 1
  eventId: string;       // UUIDv7 minted on the worker when parsed
  generation: number;
  executionId?: string;
  chatSessionId: string;
  occurredAt: string;
  kind: 'chat_event' | 'signal';
  chatEvent?: CreateChatEventInput & { partRevision?: number };   // id = eventId
  signal?:
    | { type: 'turn_start' | 'turn_end'; turnId: string }
    | { type: 'turn_result'; runId: string; status: string; costUsd: number | null; summary: string | null; error: string | null }
    | { type: 'pending_input'; requestId: string; request: unknown }
    | { type: 'pending_resolved'; requestId: string }
    | { type: 'native_session'; harness: string; nativeSessionId: string; nativePath: string | null }
    | { type: 'background_tasks'; active: string[] }
    | { type: 'inventory'; commands: unknown }
    | { type: 'prepare_result'; commandId: string; ok: boolean; worktreePath?: string; checkpointSha?: string;
        setup?: 'done' | 'none' | 'failed' | 'uncertain'; error?: string }
    | { type: 'process_state'; running: boolean };
}
```

- **The worker stamps what it knows.** Each event carries the generation of the placement that ran it (for a turn's output, that of the send that opened the turn), which the home requires for an execution's events, and a chat event carries the run of the message that opened its turn. A turn result counts only for a send this computer was given for that chat and turn, and a result's cost only for such a send's run (P2 review fixes).
- **The worker journals before it sends.** Each event is appended to `<workDir>/journal/<homeId>.jsonl` with its position and flushed to disk before being posted. The last acknowledged position is kept beside it, and the acknowledged prefix is compacted. After a restart or reconnect the worker resends from the last acknowledged position plus one.
- **The home applies one event per transaction, in order.** A position at or below the stored one is a replay and is skipped. A gap stops the batch and returns the stored position, so the worker resends from there. Otherwise, in one transaction: apply the event, then advance `computers.acked_event_seq`.
- **Applying is idempotent by key:**
  - A chat event inserts by id, and nothing happens on conflict.
  - A cumulative part replaces only with a higher `partRevision`.
  - `turn_result` completes the run by `runId` only if it is still running, and records cost only on that transition.
  - `native_session` upserts the binding.
- **Notifications are recorded in the same transaction as the event that causes them.** When an event completes a run, the pending `notification_deliveries` rows for its channels are inserted in that same transaction, with a key that names the thing itself: `run:<runId>:finished`, never a replay's event id. `notification_deliveries` is already unique on dedupe key and channel. The notifier is split in two: queueing inside the transaction, and sending pending rows after commit, at startup, and periodically. A crash between commit and send therefore loses nothing: the rows are waiting.
- **Sending to outside services is at-least-once, not exactly-once.** The local rows guarantee each notification is queued exactly once and attempted until it's sent. But if the process dies after a provider (web push, Telegram) accepted a message and before the row is marked sent, it will be sent again. Where a provider accepts an idempotency key, the dedupe key is passed as that key.
- **The realtime publish runs after commit.** It only refreshes screens, so a lost publish is corrected by the next read.
- **Old generations stay history, not state.** An event from an older generation is still stored as history, because it happened. Its signals don't change running flags, pending prompts, or run state for the new placement.

### Attachments and artifacts

A worker key reaches only worker routes, and a session token only the agent servers, so files move through two worker routes of their own. Neither falls back to a viewing key or the home's key.

- **Files the person attached, from the home to the worker:** `GET /api/workers/me/attachments/:fileName?command=<commandId>`. It is allowed only when the worker key's computer is that command's target, the command isn't stale, and the file name is in that command's payload. The worker checks the sha256, stores the file under `<workDir>/attachments/<homeId>/<chat>/`, outside the repository, and gives the harness that path. Built in P2.5.
- **Files an agent produced** follow the rules below once Ri keeps any. Today it keeps none (P2.5), so they aren't built yet, and the home drops any file a computer's chat event names.
- **Files the agent produced are kept on the worker first.** When the harness produces a file, the worker mints its home file name there and then (`<UUIDv7>.<ext>`, the attachments naming). It copies the bytes to `<workDir>/artifacts/<homeId>/<fileName>` and flushes them to disk, and only then journals the chat event carrying the `Attachment` record with its sha256. Both are on the worker's disk before anything goes to the home. So an outage or a crash loses neither, and a turn that keeps running while the home is unreachable keeps its files.
- **Uploaded under that name, idempotently:** `PUT /api/workers/me/artifacts/:fileName`, with the sha256 and the same 50 MiB cap and type allowlist as `POST /api/attachments`. The home accepts it only for a name in the attachments format, and only for a chat on a placement this computer held at the event's generation (`execution_placements`). It writes the bytes durably (a temp file, fsync, rename). The same name with the same sha256 again succeeds and changes nothing. The same name with different bytes is refused. A retry therefore repairs the file the journal already names, never makes another.
- **Bytes before the event is posted.** Before posting a batch, the worker uploads every file its events refer to that the home hasn't confirmed. When the home applies an event, it checks each referenced file is on disk with that sha256. If one isn't (a home restored from a backup, say), the batch stops at that event with 409 naming the missing files, and the worker uploads them again from its spool and resends. So an event is acknowledged only once its files are at home.
- **Acknowledgement clears the spool.** A spooled file is deleted once the event that refers to it is acknowledged. An upload whose event never arrives is swept at home after 7 days.

### Uncertain delivery

- For a `send`, `started` is written before the message is injected and `finished` once the harness accepts it (Command receipt and recovery).
- If the worker restarts between the two, it looks for the message in the native history. Found means `delivered`. Not found, or no history to check, means `uncertain`.
- An uncertain send is shown as such, and is retried only when the person asks (P3.2). It is never retried automatically, which could run a turn twice.

### While the home is unreachable

- A turn already running finishes under the permissions it started with. Its output, files included, is journaled.
- A permission prompt waits. The worker accepts no new turns and no approvals, apart from the person stopping work through the companion on that computer.
- The home never reassigns an execution because contact was lost, and shows "MacBook disconnected. Last heard from …" rather than stopped.

### The home's own computer

- The in-process runner uses the same command records and delivery states, delivering at once.
- It sends its events through the same idempotent apply functions, straight into the database. There's no journal, because there's no network in between.
- Run completion, cost and notifications are therefore driven by `turn_result` everywhere, rather than by `dispatch` awaiting a whole turn.

## P2.1 The runner split

`src/lib/executor/adapter.ts` does three jobs in one module: it resolves what a session needs from the database, it runs harness processes, and it keeps the live state (running flags, background tasks, pending prompts, command inventory). P2.1 separates them along the runner boundary in P0.3, with no change in behavior on the home's own computer.

### The pieces

- **`src/lib/runner/`**, the code that runs on the executing computer. It imports no database, notification or realtime module, directly or through anything it imports. `src/lib/runner/boundary.test.ts` walks the import graph and fails on one. It holds:
  - `types.ts`: `SessionSpec`, `SendRequest`, `RunnerSink`, `RunnerSignal`, `ExecutionRunner`.
  - `local-runner.ts`: the harness sessions and all live state, which move here from `adapter.ts` and `pending-input.ts`. It spawns from a spec, sends, interrupts, stops tasks, closes, recycles, and answers prompts. Everything it learns goes to its sink.
  - `parse.ts`: `parseStreamEvent`, unchanged, so a worker mints event ids when it parses, as the protocol says.
- **`SessionSpec`**, built by the home (`src/lib/executor/session-spec.ts`). It is plain JSON: the harness, the working folder, the native session id, the permission mode and the mode to return to after plan mode, the model, variant and effort, the provider config the home decided (MCP servers with their addresses and credentials, tool filters, extra arguments), the session instructions as text, any first-turn brief, the session credential, and whether user skills may be attached. What only the executing computer knows stays with the runner: the harness runtime's environment and binary paths, where session instructions are written, user skill folders, and legacy skill link cleanup.
- **The home sink** (`src/lib/executor/home-sink.ts`) applies what a runner reports:
  - chat events, inserted or, for a cumulative part, replaced, through `EventWriter`;
  - run telemetry from result events;
  - `native_session`, which saves the chat's native session id;
  - `pending_input` and `pending_resolved`, which write the request and response rows, notify that input is needed, and mirror leaving plan mode;
  - `running`, `background_tasks` and `pending_changed`, which publish to the realtime bus;
  - `turn_result`, which finishes the run and wakes anything waiting on the turn.
- **The live-state facade** (`src/lib/executor/live-state.ts`) answers "is it running, what's pending, which tasks, which commands" for routes, the rail and health. Today it reads the local runner. From P2.4 it merges the mirrors of each worker's reported state. `status-snapshot.ts` reads through it, instead of reaching into the adapter's global state by symbol.
- **`adapter.ts`** stays the home's executor API, with the same exports, so its 30 callers and 25 test files are unchanged. `dispatch` validates the selection, checks the budget, creates the run, builds a spec when the runner has no live session, sends, and waits for the turn. Control functions look up the runner for the chat (`runnerFor`, the local runner until P2.4) and call it.

### Sending and finishing a turn

- `runner.send` resolves when the harness has accepted the message (the delivery acknowledgement), not when the turn ends. The runner then watches the turn and reports `turn_result` with the turn id and run id.
- The home passes a spec only when the runner has no live session for the chat, so a follow-up to a live session does no spec work, exactly as today. If the session died in between, the runner answers `needs_spec`, and the home builds one and sends again.
- **Runs finish from `turn_result`**, through one function (`finishRun` in `src/lib/runs/finish.ts`). It completes or fails the run only while it's still queued or running, records the trigger's last run, settles a quiet heartbeat, ends the run's telemetry window, touches the chat's outcome on failure, and notifies. Manual sends and scheduled runs both use it, so a run finishes even if whatever started it is gone, which is what a worker's turn needs.
- `dispatch` still returns when the turn ends, by waiting on the turn's result at the home. Callers that hold a lease or a timeout keep working. A timeout fails the run first, and the later `turn_result` then changes nothing.
- The concurrency gate (a harness without concurrent send takes one message at a time) stays before the run is created, reading the facade and the target computer's harness capabilities, so a refused send still creates no run. A send holds its place from the gate until the runner has it, since building a spec takes a moment, and keeps the chat marked running meanwhile. The runner enforces the gate again.

### Pending prompts

The prompt store moves into the runner, because the harness waits there. The runner decides auto-allow from the spec's permission mode, and on an allowed exit from plan mode it switches to the spec's pre-plan mode, as the adapter did by reading the database. Changing the mode is refused while a turn runs and recycles the session, so the spec's mode stays current. Answers go through `runner.answerPendingInput`, which checks the request belongs to that chat.

### Closing the P0.4 gaps assigned to P2.1

- The event seam: reconcile and Codex replay write through the sink's writer, and running flags, background tasks and pending prompts publish only from the home sink. User messages and run rows are the home's own records and stay home-side.
- A quiet heartbeat check-in now closes its harness when it archives the chat. The runner closes a session idle for 30 minutes with no pending prompt and no background task. The next message resumes it by native session id.

### As built

- `src/lib/runner/`: `types.ts`, `local-runner.ts`, `live-state.ts` (the state and its readers, with no agent engine import), `pending.ts` and `pending-classify.ts` (the prompt store, and turning a request into a prompt), `parse.ts`, `sink.ts`, `errors.ts`, `first-turn.ts`. `boundary.test.ts` walks their import graph, and checks itself against the home sink, which must fail.
- Home side: `session-spec.ts`, `home-sink.ts`, `live-state.ts` (the facade), `placement.ts` (`runnerFor`), `turns.ts`, and `src/lib/runs/finish.ts`. `adapter.ts` keeps its exports. `pending-input.ts` and `status-snapshot.ts` re-export the runner's store and state, and the two prompt-list routes read the light facade.
- `EventWriter.write` resolves true when the event was new. The live writer takes run telemetry only from a result event it inserted. Reconcile replays through the plain writer, and all three replay paths (Claude, Codex, OpenCode) take a writer, so a worker can feed the same loops into its journal. The Codex path no longer inserts directly.
- `dispatch(chat, message, options)` drops its unused writer argument. Scheduled runs pass their `runId`, so the turn's result finishes them. The scheduler's finalizers call `finishRun`.
- The prompt answer route answers through `answerPendingInput`, the runner's check that a prompt belongs to the chat.
- An agent main chat's brief is returned as text (`instructions`), and the runner writes the file.
- The idle close runs in the server's 60-second sweep.
- Tests: `runner-split.test.ts` (12, through the real executor with the fake harness: a spec only when a session must start, `needs_spec`, a second message refused without a run while the first starts on a one-at-a-time harness, runs finished from the turn result with or without a waiter, a late result after a timeout, prompts answered only by their own chat, plan mode followed after leaving it, the idle close and resume, a waiting session left alone, and the quiet heartbeat's close). Three of them were checked by breaking the behavior they cover. The boundary test adds 11.
- Live on the dev home: a Demo execution resumed its Claude session from a spec, answered, and its run completed from the turn result, with cost and summary. A follow-up went into the same Claude process without building a spec.

## P2.2 Enrollment and the worker connection

P2.2 is the transport: how a computer becomes a worker, how it stays connected, and how the home asks it things. Durable commands and events, with their journals, are P2.3. Routing real work to a worker is P2.4.

### Records (migration 0004, additive)

- **`computer_grants`**: short-lived, single-use grants. `kind` is `enroll` (become a worker) or `associate` (link this computer's browser). Each has the sha256 of its secret, the computer it names (an enroll grant may name none, making a new computer when redeemed), the key that created it, `expires_at`, and when and by which key it was redeemed. Enroll grants last 10 minutes, and association grants 2 minutes.
- **`worker_enrollments`**: one row per worker key (`api_key_id`, primary key) with its `computer_id` and the grant it came from. This row is what makes a key a worker key. A viewing key never gets one: only redeeming an enroll grant creates a worker key, and it's a new key. Revoking the key ends the enrollment.
- **`computers`** gains what a worker reports: `worker_protocol`, `worker_version`, `harnesses` (JSON) and `reported_state` (`awake | asleep | stopped`). All are null until a worker reports, and stay null for the home's own computer.

### Enrolling

1. On the computer to enroll, `ri worker enroll` explains what enrolling allows and asks to continue. That confirmation on the computer itself is the local approval.
2. It asks the home for an enroll grant for this computer, with the computer's existing viewing key. That request is the owner's authorization, and it names the computer the key belongs to.
3. It redeems the grant at `POST /api/workers/enroll`. The grant is the only credential this route takes. The home creates the worker key and its enrollment in one transaction, and marks the grant used.
4. The worker key goes in `<configDir>/worker.json` (0600), which is machine-local and never backed up.

An owner can also create a grant elsewhere (`ri worker grant` on the home, and in the UI later) and type its code on the computer (`ri worker enroll --code`).

### The boundary

The proxy resolves each key's scope, forwards it as `x-ri-api-key-scope` with the worker's `x-ri-computer-id`, and strips inbound copies of both. A worker key reaches only `/api/workers/me/*`, and only a worker key reaches them. Everything else answers 403, so a worker key can't read tasks, and a viewing key can't pose as a worker. Handlers check the enrollment again.

### The connection

- The worker opens `GET /api/workers/me/stream`, a server-sent event stream. It carries `hello` (the home's id and the protocol it speaks), `request`, `revoked`, and a `ping` every 15 seconds. Commands join it in P2.3, with the `after` cursor.
- Every worker request carries `x-ri-worker-protocol`. A home that doesn't speak that protocol answers 426 with "Update Ri on MacBook", and the worker stops rather than retrying.
- The worker posts `POST /api/workers/me/heartbeat` every 20 seconds: protocol, version, harnesses, and `awake`. The home stores it and updates `last_seen_at`.
- On a dropped connection the worker reconnects with backoff from 1 to 30 seconds, with jitter. A 401 or a `revoked` event stops it: the key was revoked, and it says so.
- The stream checks the key on every ping, so a revoked worker is cut off within 15 seconds.

### Requests

A request is a read with a timeout, never persisted (P2 protocol, Commands). The home sends `request` with an id and kind on the stream, and the worker answers at `POST /api/workers/me/requests/:id/result`. The first kind is `describe_harnesses`, which the worker answers from its own harness runtime. An unanswered request fails after its timeout, and an unknown kind is answered as unsupported.

### This Mac

The worker links its computer's browser through the home, with no loopback server. `ri worker open` asks the home for an association grant (`POST /api/workers/me/associations`), then opens `<home>/#associate=<grant>` in this computer's default browser. The web app redeems the grant with its own viewing key (`POST /api/devices/associate`), which records that the browser's key is on that computer. The grant only proves the page was opened by that computer's worker, and it links identity only: the browser key gains no worker authority.

### As built

- Migration `0004_low_roulette`, additive: `computer_grants`, `worker_enrollments`, and the four reported columns on `computers`.
- Queries: `createComputerGrant`, `redeemEnrollGrant` (one transaction: the computer, the new key, its enrollment, retiring an earlier worker key for the computer, and the used grant), `redeemAssociateGrant`, `getWorkerEnrollment`, `isWorkerApiKey`, `listEnrolledComputerIds`, `recordWorkerHeartbeat`.
- The proxy forwards `x-ri-api-key-scope` and `x-ri-worker-computer-id`, stripping inbound copies, and holds the boundary for `/api/workers/me` and everything under it. `/api/workers/enroll` takes only its grant. Handlers check again through `requireWorker` (`src/lib/workers/route-auth.ts`), which also answers 426 to another protocol.
- Home side: `src/lib/workers/protocol.ts` (shared with the worker), `hub.ts` (live streams and waiting requests), the routes under `/api/workers`, `/api/devices/associate`, `/api/computers` and `/api/computers/:id/harnesses` (`?fresh=1` asks the worker). Revoking a worker key closes its stream at once. A worker error answers 424, not a 5xx, because clients read gateway statuses as the home being unreachable.
- Worker side: `src/lib/worker/` (`config.ts`, `client.ts`, `sse.ts`, `harnesses.ts`, `run.ts`), inside the import boundary with the runner. `ri worker enroll | run | status | open | disable | grant`.
- Orchestrator actions `list_computers` and `describe_computer_harnesses`, which reach the server's hub over HTTP, since the home's CLI runs actions in its own process.
- The web app redeems `#associate=` on load and on a hash change, remembers the computer in `ri.thisComputer`, and says "This browser is on MacBook".
- Tests: `src/lib/workers/workers.test.ts` (17), over real HTTP through the real proxy and routes (`src/test/fixtures/home-server.ts`), with the real worker loop. They cover enrolling, single-use and expired codes, the home's own computer refused, another protocol refused with what to do, one worker per computer, both sides of the key boundary with forged headers, a request answered and one answered by the wrong computer, reconnecting after a drop, a stale stream replaced, revocation, a different home, turning itself off, This Mac, and the stream reader. The boundary test covers the worker. Writing them found that `/api/workers/me` itself was outside the boundary, which is fixed, and two tests that raced under full-suite load, which now wait on the right side.
- Live on the dev home, after its restart applied 0004 (snapshot first, in `~/ri-homes-snapshots`): the stand-in laptop enrolled, connected, and its heartbeat reported protocol 1 and version 0.1.0. A fresh harness request went down the stream, and the worker answered with this Mac's real harnesses (Claude 2.1.281 and Codex 0.153.4 installed, Cursor and OpenCode missing). Revoking its key stopped the worker at once with the reason, and it removed its enrollment. In a real browser, an association link linked a throwaway key to the stand-in and showed "This browser is on MacBook (stand-in)", both in a new tab and by a hash change in an open page. That second case failed first and is now handled.

## P2.3 Journals and applying what a worker reports

P2.3 makes the P2 protocol's delivery rules real: durable commands with a receipt cursor and acknowledgements, a worker journal of events applied in order at home, cumulative parts that only move forward, and notifications that can't be lost between an event and its delivery. P2.4 then routes real work (send, interrupt, stop, answers) through it.

### At home

- **Migration 0005, additive.** `worker_commands` as in P0.3, with `seq` set when first streamed. `computers.acked_event_seq`, an integer counter starting at 0, the highest contiguous event position stored. `chat_events.part_revision`, null except on a cumulative provider part.
- **Commands.** `queueWorkerCommand` writes a command in the caller's transaction and wakes that computer's stream. The stream, on connecting with `after`, numbers queued commands in order and marks them `sent`, then sends every command numbered after the cursor that is still waiting for an acknowledgement. An acknowledged command is never resent. Re-enrolling a computer marks its unacknowledged commands `uncertain`, since the earlier worker may have acted on them and the new one has no record. `POST /api/workers/me/commands/:id/ack` records `delivered`, `failed`, `stale` or `uncertain` idempotently and returns the state it holds. A command can be cancelled only while queued.
- **One set of apply functions** (`src/lib/executor/apply.ts`) for everything a runner reports, used by the home's own runner through its sink and by `POST /api/workers/me/events` for a worker. Each event is applied in its own transaction together with advancing `acked_event_seq`: a chat event inserts by id or replaces a part only with a higher revision, a turn result finishes its run, a prompt writes its row. Realtime publishes and notification sending happen after commit.
- **Notifications split in two.** `queueNotification` writes the pending delivery rows inside the transaction that caused them. Sending runs after commit, at startup, and every 5 minutes for rows left pending, so a crash between commit and send loses nothing. Sending to outside services is at least once.
- **Run telemetry** from a result event runs synchronously inside the same transaction.

### On the worker

- **Command journal** `<workDir>/commands/<homeId>.jsonl`: `received` is appended and flushed to disk before a command is acted on, `started` before any effect outside the journal, `finished` with the result after. The receipt cursor is the highest number with every earlier one received, and it's what the stream resumes after. A command id already journaled is never applied again. Its recorded outcome is acknowledged instead.
- **Acknowledgements** are sent after `finished` is on disk, and resent on reconnect until the home confirms the state.
- **Event journal** `<workDir>/journal/<homeId>.jsonl`, with positions from 1 and the last acknowledged position beside it. The worker's runner sink appends each event and signal, flushed to disk, then the poster sends batches from the last acknowledged position. A 409 or a gap answer resends from what the home says it has. The acknowledged prefix is compacted.
- **Recovery after a restart** runs each command left `received` or `started` through its kind's rule (the table in "Command receipt and recovery"). Kinds register their handler and their recovery together, so a kind can't exist without one.

### As built

- Migration `0005_clumsy_clint_barton`, additive: `worker_commands`, `computers.acked_event_seq`, `chat_events.part_revision`, and `chat_sessions.computer_id` (null is the home's own computer). The generated `ALTER` for the last dropped its `ON DELETE set null`, so the SQL was corrected by hand to match the schema. Rehearsed on a copy of the dev home first.
- Home: `queueWorkerCommand`, `takeCommandsForStream`, `ackWorkerCommand` (a final state stays final; uncertain can still resolve), `cancelWorkerCommand`, the event position, and a revision guard in `replaceChatEventPart`. Routes: the stream sends commands from `after` and when woken, `POST /api/workers/me/commands/:id/ack`, and `POST /api/workers/me/events`, which applies events only for chats that run on the calling computer.
- `src/lib/effects/after-commit.ts` collects what waits for commit. `finishRun` splits into `finishRunInTransaction`, the notifier into `queueNotification`, `deliverNotification` and `drainPendingNotifications` (at startup and every 5 minutes), and run telemetry has a synchronous core. The home sink is a thin wrapper over `apply.ts`.
- Pending prompt rows now take their ids from the request id. They used a fresh random id each time, so the same prompt applied twice would have been stored twice, although a comment said otherwise.
- Worker: `command-journal.ts` (received, started, finished, confirmed, the receipt cursor, and compaction that keeps the cursor's place), `event-journal.ts` (positions, acknowledgement, compaction, and a rebase when the home holds more than the journal, as after the work folder was cleared), `sink.ts`, `poster.ts` (one post at a time, and says which positions are gone if the home was restored from an older backup), `commands.ts` (per chat order, no double application, recovery by kind, acknowledgements resent until confirmed), and `durable-file.ts`. The worker loop wires them in, and `ri worker run` installs the worker sink for this computer's runner.
- A kind the worker doesn't handle fails with "This computer doesn't handle … commands yet. Update Ri here." Real kinds arrive with P2.4.
- Tests: `src/lib/workers/journals.test.ts` (16, over real HTTP with journals on disk): once-only application whatever is resent, recovery after a restart without running again, an acknowledgement outliving an outage, the receipt cursor, cancellation leaving no gap, re-enrollment, an unhandled kind, events in order, offline and across a restart, replays and gaps, refusal for another computer's chat, a cleared journal, compacted positions, part revisions, and the notification drain. Four were checked by breaking the behavior they cover.
- Live on the dev home, after its restart applied 0005 (snapshot first): a queued command was numbered, streamed to the stand-in laptop as it connected, journaled received, finished and confirmed, and recorded at home as failed with that message. A restarted worker didn't receive it again. Stopping the worker with Ctrl-C now sends its last heartbeat as `stopped`. It didn't at first: tsx exits on a signal when no listener remains, and the worker's `once` listener was removed before it ran.

## P2.4 Routing work to the computer that runs it

P2.4 puts the protocol to work: an execution can be started on a connected computer, and everything about it (sends, interrupts, stops, prompt answers, file views) reaches that computer.

### Placement

- **`execution_placements`** (migration 0006, additive), as in P0.3: one open placement per execution, whose generation every execution command carries. An execution with no row runs on the home's own computer at generation 1, which covers every execution from before this build with no backfill. `worker_commands.source_event_id` is unique, so one message queues one send.
- **`chatPlacement`** says where a chat runs: its execution's placement, or for a chat without one, its `computer_id` (null is the home). `runnerFor` returns the home's own runner or a **remote runner**, which turns each call into a durable command stamped with the placement generation. A send is `queued`, not `delivered`, and a stop is `queued`, not yet closed. Callers that report stops (the coordinated stop, the task stop) report a queued one as pending, not as a failure.
- **Fencing.** Events are checked against placements: from the current one they apply fully, from one this computer held before they're kept as history without changing live state, and anything else is refused. On the worker, a command from a generation older than the newest it has seen for that execution is `stale`.

### Starting and sending

- `dispatchExecutionSession`, the create route and `start_execution` take a `computerId`. A computer that isn't enrolled, or doesn't have the agent set up and ready, is refused with the reason, never swapped for another (spec §3.3). The home creates the execution and its placement, and queues a `prepare`.
- The worker finds the agent's folder in its own setup files, makes the worktree there (or uses the folder itself for live mode or a folder that isn't a repository), notes it in its journal before anything else so recovery reuses it, and copies the agent's files. The home records the worktree on the placement and the branch on the execution. `executions.worktree_path` stays the home's own path, so nothing on the home looks for the other computer's folder. A setup script follows as its own `run_script`, never repeated after a restart that caught it running.
- A message sent before the worktree exists isn't held back. It's queued at once, with a note that its folder is the worktree this computer prepares for the execution. The worker carries out an execution's commands in order, so the prepare finishes first. The message is saved from the start.
- `dispatch` builds the spec for the computer that runs it: capabilities from its worker's report, reference paths from its setup report, and, since P2.7, the home's servers at the worker's address for the home with a session token. The home's own model catalog stands in for the computer's. A second dispatch of a message already queued (the health check's orphan re-fire) returns before creating a run.
- A send acknowledged failed, stale or uncertain finishes its run in the same transaction, since no turn result will come.

### On the worker

`executionHandlers` carries out `send`, `interrupt`, `stop_task`, `stop`, `answer_pending_input`, `prepare` and `run_script` through the local runner. Each kind has its own recovery rule after a restart:

- **send:** received but never started is sent. Started is looked up in Claude's transcript for the session: found is `delivered`, and missing or not checkable is `uncertain`.
- **interrupt, stops:** repeated.
- **answer_pending_input:** stale once the prompt is gone.
- **prepare:** resumes from its note.
- **run_script:** uncertain.

Heartbeats carry the worker's live state, which replaces the home's mirror for that computer, and the placements it holds. The home answers with any it no longer holds, and the worker stops their sessions.

### Reads and live state

- **Execution reads** (tree, file, diff, status, diff stats, bulk diff stats, work in progress) for an execution elsewhere are answered by its worker. `src/lib/workspaces/execution-reads.ts` is the same library code the routes use, with no database. The request names the execution, never a path: the worker reads only an execution it prepared, in the worktree it prepared, and the agent's folder from its own setup files. A computer that isn't connected answers 409 with "Laptop is not connected right now".
- **Live state** for chats elsewhere is the home's mirror (`remote-live.ts`): running, prompts, background tasks and inventory from each worker's signals, replaced by each heartbeat's snapshot. The live-state facade merges it with the home's own runner, and prompt answers check the prompt belongs to the chat as its computer last reported.
- **The health check** leaves a chat elsewhere alone: no reconcile of a transcript the home doesn't have, and no clearing of mirrored state. It only makes sure a message that never reached the queue gets there.

### The P0.4 gaps closed here

1. `run_trigger` and `cancel_run` from the home's CLI now run in the server, where the harness can be watched and stopped.
2. `archive_workspace` stops the agent's chats and terminals like the app route, through one `archiveAgent`.
3. `dispatch` refuses a chat someone took over, whichever path sends: commit, PR, conflicts, help, scheduler, coalesce, or health.
8. Interrupting a turn denies the prompt it was waiting on.

### Also found and fixed

A test could reach production. The home's self-calls fall back to port 4224 when nothing says otherwise, and production answers there on this machine. The test setup now points them at a closed port, and the whole suite still passes, so no test relied on a real server.

### As built

- Home: `execution_placements` queries (`placementOf`, `createPlacement`, `markPlacementPrepared`, `chatPlacement`, `heldPlacement`), `remote-runner.ts`, `remote-live.ts`, `computers.ts` (capabilities and working folder per computer), `remote-reads.ts`, and the create route's and the ack route's new paths.
- Worker: `handlers.ts` (the kinds above, `executionReads`, `agentFolderHere`, `findInClaudeHistory`), and the journal's notes, generations, placements and prepared worktrees. `ri worker run` gives the worker its handlers and reads.
- Tests:
  - `remote-execution.test.ts` (5) and `remote-start.test.ts` (3) run the worker in a process of its own (`src/test/fixtures/worker-process.ts`) against the home over real HTTP. They cover a turn run there, sending once, a prompt answered from home, an interrupt, a stale placement, preparing from its own repository with a message sent first and the setup script after, reads, a disconnected computer, and refusing a computer without the agent.
  - `handlers.test.ts` (8) covers each recovery rule and the fence.
  - `runner-split.test.ts` adds the three gaps, and `journals.test.ts` the heartbeat's release.
- Live on the dev home, after its restart applied 0006 (snapshot first): `start_execution` with the stand-in laptop's computer made a worktree in the stand-in's own Demo clone, and real Claude answered there, "pong from the laptop". The run completed with its cost and summary. The worktree's tree, status and diff stats came back through the home's own API.

## P2.5 Attached files

P2.5 gets the files a person attaches to a message to the computer that runs the chat, and settles what "retained output" means today.

### Files the person attached

- **Where the path is decided.** Expanding a message used to turn each file the agent reads itself (text, code, images, PDF, JSON, XML) into its path at home, before anything knew where the chat runs. Now expansion extracts only what the agent can't read (docx, xlsx, audio, as before) and leaves the rest as `[[file:]]` markers. `dispatch` takes the message's attachments and places them where it routes the send: home paths for a chat at home (`placeFilesAtHome`), and for a chat elsewhere the markers stay and the send carries the files as `{ fileName, originalName, mimeType, size, sha256 }` (`describeInputFiles`). A home disk path is never sent. The messages route and the health check's re-fire are the two callers that carry attachments, and both pass them.
- **The worker attachment route**, `GET /api/workers/me/attachments/:fileName?command=<id>`, serves a file only for a send that names it, to the computer it went to, while that send is out and unacknowledged, and while the chat's placement is still at the send's generation. Anything else is 404 (not this computer's, or not in the send), 409 (acknowledged, or stale) or 400 (not a stored file name).
- **On the worker**, the send handler fetches each file before journaling `started`, since fetching is safe to repeat. Each is written to a temporary name, checked against its size and sha256, flushed, and renamed. A copy already there that checks out is used as it is, and a partial one a crash left is replaced. The home and chat ids name the folder, so only plain ids are accepted. A dropped connection or short or damaged bytes are tried three times. A file that can't be brought (gone from home, refused, or damaged every time) fails the send with the reason, which finishes its run. The harness gets this computer's path where each marker was.
- **Recovery** looks for the message in the native history as the harness got it. The placed path depends only on the home, the chat and the file name, so recovery computes the same text without fetching again.
- The files stay with the chat on that computer for later turns to read. They go when the execution's folder there does, which comes with archiving on connected computers (P3 and P4).

### Output an agent produced

- What an agent makes on a connected computer is its work in the worktree there. It stays on that computer. The home shows it through the worker's reads (tree, file, diff, P2.4), and it leaves through Git. Nothing about it needs uploading.
- "Retained artifacts" in the spec are something else: files an agent produces that Ri keeps at home as attachments, the way it keeps uploads. Ri has none from a harness. The runner persists messages, tool calls and results as chat events, never a file as an attachment. What does save attachments (uploads, capture, the Pebble webhook, favicons, the browser's downloads and page captures) runs at home, the browser included. `runs.artifactRefs` is a different thing: which tasks and notes a run's actions changed.
- So there is nothing on a connected computer to upload yet, and the upload protocol above (spool, `PUT /api/workers/me/artifacts/:fileName`, the apply-time check, clearing on acknowledgement, the 7-day sweep) stays specified and unbuilt. Building it with no producer would be transport nobody exercises.
- What P2.5 does enforce is the rule that matters now: a computer never presents a file only it has as a download. `WorkerChatEvent` has no `attachments`, and the home drops any a computer's chat event names.
- The first producer brings the upload with it: say, harness image output kept in the transcript, or an action that attaches a file from an agent's disk to a note (with P2.7, a remote session's `describe_paths` would otherwise point at the home's attachments directory).

### As built

- `src/lib/attachments/markers.ts`: the marker rules, with no database, shared by home and worker. `expand-markers.ts` leaves files the agent reads itself as markers.
- Home: `src/lib/executor/input-files.ts`, `DispatchOptions.attachments`, `SendRequest.files`, `SendPayload` in `protocol.ts` (shared by the remote runner and the worker), and the worker attachment route.
- Worker: `src/lib/worker/input-files.ts` (`fetchInputFiles`, `placeInputFiles`, `inputFilesDir`), used by the send handler and its recovery.
- Tests:
  - `attachments.test.ts` (8) runs the route and the worker's fetch over real HTTP: who may fetch what and when, reuse of a good copy, replacing a partial one a crash left, damaged bytes, a file gone from home, folder names only from plain ids, and a computer's chat event naming a file.
  - `handlers.test.ts` (+3): fetched before `started`, a failed fetch leaves the send unstarted, and recovery looks for the placed text.
  - `remote-execution.test.ts` (+1): with the worker in its own process, the fake harness there gets the laptop's own copy, and the command carries markers and checksums, never a home path.
  - `runner-split.test.ts` (+1): a chat at home gets home paths, and a marker for a file not attached stays.
  - `markers.test.ts` (4).
- Live on the dev home: an image and a text file uploaded there, sent through the messages route to a new execution on the stand-in laptop. Real Claude there read both from `~/ri-homes-laptop/.work/attachments/<home>/<chat>/` and answered "LAPTOP HERON 42" on green, with the passphrase from the text file. The send carried markers and checksums, no home path, and the laptop's copy matched the home's sha256.

## P2.6 Who is acting

P2.6 makes every command say who caused it, from their credentials, and keeps approving a permission a person's call.

### The actor

- `src/lib/auth/actor.ts` derives it, never from anything a caller says about itself:
  - A request with a chat's signed session credential is that agent. Any other request the proxy let through is a person, on the key it accepted.
  - An orchestrator action with a session credential is that agent. Without one, it's a person only from the home's own CLI, run there or passed to the server with the home's key. Over HTTP with any other key it's an agent, since a person elsewhere answers in the app and an agent there could hold a key it found on disk.
  - A stored message's sender is its `sender_session_id`, else the person, for the health check's re-fire.
- It goes on every command to a connected computer: sends (messages route, re-fire), answers, interrupts, task stops, restarts, resyncs, takeovers, the coordinated stop, agent archive, and `prepare` (the create route, and `start_execution`, which now forwards the calling chat's credential). Scheduled and internal work stays `system`.
- The label on a message another chat sent is applied at home, so it reaches a connected computer in the send's text, as it reaches a home harness.

### Only a person approves a permission

- One rule, `answerRefusal` in the runner's pending module: an agent can't allow a permission request, which covers tools and leaving plan mode. It can deny one, which never widens what the agent there may do, and it can answer a question.
- The home checks it before an answer leaves (the answer route answers 403 `human_only`, and the action throws `unsupported`, both saying to ask the person). The runner holding the prompt checks it again: the home's own, or a connected computer's worker, on the actor the command carries. So an agent approval that got past the home is refused on the laptop.
- `answerPrompt` (`src/lib/executor/answer-prompt.ts`) is the one way to answer, for the route and the action. The action now answers in the server as its caller, instead of calling the route with the home's key, which would have made every agent look like a person there. An agent's deny tells the blocked agent who denied it.
- The orchestrator's brief and the action's description say permission prompts belong to the user.
- Permission modes: new sessions default to `auto_all`, `start_execution` may set the mode of the execution it starts, and no action changes an existing session's mode. So an agent can't widen a session's mode to get around a prompt.
- **Open decision (Trey, 2026-09-25: fine for now, keep noted).** The spec's §6 says an agent can't *approve* a permission request, and the P2.6 line says it can't *answer* one. This build follows §6: an agent can still deny one, so the orchestrator can redirect a stuck agent with a reason. Refusing agent denials too is a one-line change to `answerRefusal`.
- The limit: an agent that reads the home's own key file can pass for a person on the home. Credentials can't separate processes on one machine (the isolation is paths, not keys). Sessions on connected computers get tokens of their own in P2.7, not a key.

### Ownership before delivery

- The home marks a queued command stale, instead of streaming it, when its chat or execution no longer runs on that computer at its generation, and finishes a send's run. The worker's fence can't catch this case: a laptop that was away never saw the newer placement. Checked each time the stream sends. Only a move replaces a placement (P3), but the check is in place first.
- Answers are bound to the request id and the chat at home and on the worker, and to the generation by the fence. The worker takes commands only from its enrolled home's stream.

### Also found and fixed

- Stopping `ri worker run` left its harness sessions running, which kept the process alive after "Stopped.". It now closes them, and each chat resumes from its native session on its next message.
- Sessions on a connected computer never closed when idle. The 30-minute idle close ran only at home. `ri worker run` now sweeps every minute too.

### As built

- `src/lib/auth/actor.ts`, `answerRefusal` and `HUMAN_ONLY_APPROVAL` in `src/lib/runner/pending.ts`, `answerPrompt`, `staleQueuedCommands` in queries, `settleUndelivered` (`src/lib/workers/undelivered.ts`, shared by the ack route and the stream), `closeAllSessions` in the local runner.
- The runner interface takes the actor on interrupt, stop, task stop and answer. The adapter's `abort`, `stopTask`, `close` and `answerPendingInput` pass it on.
- Tests:
  - `runner-split.test.ts` (+3): a person approves and an agent is refused but may deny, through the real route with a real credential. An agent answers a question through the action. The action refuses an agent, and a caller elsewhere without a session, and accepts the home's own CLI.
  - `remote-execution.test.ts` (+3), with the worker in its own process: the home refuses an agent approval and queues nothing, an approval smuggled past the home is refused on the laptop while the prompt keeps waiting, and the person's goes through under their key. Sends through the real proxy and messages route carry the person, or the sending chat with its label. A message saved while the laptop was away, for a placement replaced meanwhile, is never sent, and its run fails with `placement_moved`.
  - `handlers.test.ts` (+1) and `remote-start.test.ts` (the prepare's actor).
  - Each new guard was checked by removing it and watching its test fail.
- Live on the dev home: real Claude on the stand-in laptop, in ask mode, asked to run a command. An approval carrying the orchestrator chat's credential was refused with 403 and queued nothing, and the prompt kept waiting. The person's approval went through, Claude wrote the file in the laptop's worktree, and the send and the answer carry the person's key. Stopping the stand-in's worker then closed its Claude session and exited, with no process left.

## P2.7 Sessions elsewhere: the home's servers, the environment, persona and memory

P2.7 gives a session on a connected computer what a session at home has, without a home path, a home key, or a managed file in a repository. Today only executions run elsewhere (an agent's main chat can live elsewhere once P3.1 lets an agent have no folder at home), so executions are where each piece is exercised, and the main chat's piece is built on the same path.

### The home's servers, reached with a session token

- **Session token.** For a session elsewhere, the home mints `ri_session_<chat>.<computer>.<generation>.<signature>`, signed with the home's key (HMAC, as the session credential is). It carries no authority of its own: the proxy accepts it only while that chat is placed on that computer at that generation and the computer's worker is enrolled. A move, a new generation, or turning off the computer's local execution ends every token for it, with nothing to revoke.
- **Where it reaches.** Only the three servers a harness uses: the orchestrator MCP, the connectors MCP and the browser MCP, and on each only the session's own scope. An execution reaches connectors for its own agent's allowlist (`?ws=` its agent) and the browser in its own agent's profile (`?profile=ws-<agent>`). An agent's main chat also reaches the orchestrator MCP. Anything else is 403. The actor is the session, from the token, with location `elsewhere`, so path-taking actions refuse it as they refuse any caller elsewhere.
- **Addressed through the worker.** The home doesn't know the address a computer reaches it by, and shouldn't guess. It sends each server as `ri-home:/api/...` with the token, and the worker puts its own home address in front before starting the harness. The token never touches argv: agentex stages MCP configs as a 0600 file.

### The environment manifest

The spec (§4.3) asks for a resolved environment manifest per execution: source folder, working folder, connected folders, Git checkpoint and capabilities, in the session instructions and in a readable local file outside the repository.

- **The home decides what's expected**: the agent, the home and computer names, the working folder, the mode (a worktree, live in the agent's folder, or a plain folder), the branch and base, the reference aliases with their descriptions, and what the session can use (harness, model, permission mode, connectors, browser).
- **The computer running it resolves what only it knows**, when the session starts: the agent's folder from its own setup files, each reference from the agent's local setup (`resolveSetups`, as the setup reports do), and the checked-out branch and commit. A reference that's omitted, unset or missing is listed as such, never replaced. A worker never starts against the home's cached copy of its own paths.
- **Delivered twice.** Written to `<workDir>/session-instructions/<chat>.environment.json`, beside the session instructions and outside every repository, and rendered as a short "Your environment" block at the end of the session instructions, which names the file. Written when the session starts, so a change to the agent applies to the next session, never mid-turn.
- Every execution gets it, at home too.

### Persona and memory

- **Persona as text, never as a file.** A session at home that uses the persona reads USER.md and SOUL.md at the home. A session elsewhere gets their text in its session instructions instead, and nothing is copied to that computer as a file. Today that's an agent's main chat, which runs elsewhere from P3.1. Executions don't use the persona, at home or elsewhere.
- **Memory stays at home.** MEMORY.md has no copy anywhere else. Two actions, for any session: `read_memory` returns it, and `submit_memory_finding` sends a finding to the home's main chat, labeled with the session that found it, for the orchestrator to record in MEMORY.md with its own file tools if it's worth keeping. A session elsewhere reaches them through the orchestrator MCP or the CLI there, which calls the home.

### Also for a main chat elsewhere

An agent's main chat brief named other home paths besides the persona: its folder (the home's copy of the agent's folder) and where attached files are. Elsewhere, the folder is the one on that computer, its connected folders are the ones that computer reported, and an attached file is the path its message gives (P2.5).

### As built

- Token: `src/lib/auth/session-token.ts` (`mintSessionToken`, `verifySessionToken`, `sessionMayReach`), accepted in `src/proxy.ts` before any key lookup, with scope `session` and the chat in a proxy-owned header (`SESSION_CHAT_HEADER`, stripped from anything a caller sends). The orchestrator MCP route and `actorFromRequest` take the session from it. `getWorkerEnrollmentForComputer` in queries.
- Spec: `buildSessionSpec` turns a session elsewhere's servers into `ri-home:` addresses with its token (`reachedFromElsewhere`), and the worker's send handler puts its home address in front (`atHome`). `HOME_ADDRESS_SCHEME` in the protocol.
- Environment: `src/lib/runner/environment.ts` (`resolveEnvironment`, `renderEnvironment`), `SessionSpec.environment` built by the home (`expectedEnvironment`), resolved and written by the local runner when a session starts (`writeSessionEnvironment`, removed with the instructions).
- Persona and memory: `personaSection` and `elsewhere` in the main chat brief, `AgentMainChatSpawnArgs.elsewhere` with the folder and references there, `read_memory` and `submit_memory_finding` in the registry, and the orchestrator skill's action list.
- Tests:
  - `session-token.test.ts` (5): the token holds while placed, ends on a new generation or a revoked worker, reaches only its servers in scope, and passes the real proxy as its session from elsewhere.
  - `remote-execution.test.ts` (+1), with the worker in its own process: the harness there gets the browser server at the laptop's address for the home with a session token, never the home's key. The token initializes that MCP server through the real proxy, and is refused in another profile and on a worker route.
  - `environment.test.ts` (3): resolved from this computer's setup (a worktree, live, a plain folder, each reference state), the home's view kept when there's no setup here, and the rendered block.
  - `remote-start.test.ts` (+1): a laptop execution's environment file and block, with a reference mapped on the laptop and one left out, and nothing of Ri's in the repository. `runner-split.test.ts` (+1): the same for an execution at home.
  - `agent-main-chat.test.ts` (+2): the brief elsewhere carries the persona as text, its folder there, and memory as actions, with no home path. Its spec reaches the orchestrator with a session token at `ri-home:`.
  - `registry.memory.test.ts` (3): memory read from the home, a finding reaching the main chat labeled with its execution, and the main chat told to edit the file itself.
- Live on the dev home, with real Claude on the stand-in laptop: it called `browser_status` on the home's browser server, and the home logged `POST /api/orchestrator/browser/mcp?profile=ws-<Demo>` answering 200, with the session's token. Asked about its environment, it named the laptop's worktree, the agent's folder on the laptop, its branch and base, and the `agentex` folder as the laptop maps it (`macbook/dynamism/agentex`), not the home's (`mini/code/agentex`). The worktree stayed clean.

## P2.8 Faults

P2.8 tests each fault the spec names, end to end where it matters, with the worker in a process of its own against a home over HTTP. Mapping them to what's already tested found three gaps, fixed here.

### The gaps

- **Turning off a computer's local execution left its work hanging.** Revoking a worker key (from the computer, or the owner revoking the device) closed its stream and nothing else. Its queued commands waited forever, its sent ones stayed sent, and runs on it stayed running with no one left to report them. Now one path (`retireWorker`) does it all in a transaction: queued commands are cancelled, sent ones become uncertain, and runs still open there fail with the reason, their waiting turns settled. Its live state leaves the home's mirror.
- **A worker that said it was stopping left its prompts at home.** The stopped heartbeat now clears that computer's mirror, since a stopping worker closes its sessions and their prompts with them. A computer that just goes quiet keeps its mirror: unknown is not stopped.
- **A hard crash left the harness running its tool call.** A restarted worker now stops what its predecessor left, before recovering anything. It finds them by what's certain rather than a recorded pid (agentex doesn't expose the Claude process): an orphan whose command line names this worker's own session instructions folder, which every harness it starts is given. So another worker's harnesses, anything the user runs, and a reused pid never match. Their turns are then reported cut off, as before.

### The matrix

| Fault | What must hold | Tested by |
| --- | --- | --- |
| Home outage | A turn already running finishes under its permissions, its output journaled, and everything reaches the home in order once it's back. No new turn or approval meanwhile | `faults.test.ts`: the home stops mid-turn and restarts on the same address |
| Worker crash | A command interrupted mid-way recovers by its kind's rule. A turn cut off is reported failed, never re-sent. A leftover harness is stopped | `handlers.test.ts`, `homes-p2-review.test.ts`, `faults.test.ts` |
| Reconnect | Unacknowledged commands are resent and applied once | `journals.test.ts` |
| Revocation | The worker stops, recovers nothing, and the home settles its work | `homes-p2-review.test.ts`, `faults.test.ts` |
| Replay | Events and commands resent are applied once | `journals.test.ts` |
| Stale approval | An answer for a prompt that's gone, or from an earlier placement, changes nothing | `handlers.test.ts`, `faults.test.ts` |
| Ambiguous acknowledgement | A lost acknowledgement is resent and recorded once. A send cut off between started and finished is checked against native history, else uncertain | `journals.test.ts`, `handlers.test.ts` |
| Continued output | Output from a turn that kept running while the home was away is kept | `faults.test.ts` (the home outage) |

### Also found and fixed

- **The test worker's crash wasn't a crash.** The worker fixture ran through the `tsx` wrapper, which runs the script as a child of its own, so a SIGKILL meant as a crash killed only the wrapper and left the worker running, orphaned. Six were found still running after the first runs of these tests, and were stopped. The fixture now starts the worker as a direct child of Node with tsx's loader.
- The real worker's steps on the way out (close its sessions, tell the home it's stopping) are one function, `finishWorker`, used by `ri worker run` and the test worker alike.
- **A turn's run is fixed when the turn starts.** agentex runs event handlers one at a time, so a message's result can settle before the handler for its turn's last event runs. The run of the message that opened the turn is now held on the open turn, so that order can't move a turn's cost to another run.

### As built

- `src/lib/workers/retire.ts` (`retireWorker`), used by `DELETE /api/workers/me` and `DELETE /api/devices/:id` for a worker key, with `retireComputerCommands` and `deliveredSendsWithOpenRuns` in queries, and `cancelled` among the undelivered states. `clearComputerMirror` in the live mirror, used for retirement and for a stopped heartbeat.
- `src/lib/worker/leftovers.ts` (`findLeftovers`, `stopLeftoverHarnesses`), run at the start of `runWorker`. `finishWorker` in `run.ts`.
- Fixtures: `startHomeServer({ port })` restarts a home at its address, and the worker process has `kill()`, a `SLOW` turn, and runs as a direct child.
- Tests: `faults.test.ts` (4): the home stops mid-turn and restarts on the same address, and the turn's output and completed run arrive. Turning off a crashed laptop's execution fails its turn under way and cancels its waiting message. A stopped worker's prompt leaves the home and can't be answered. A crashed worker's prompt is answered stale after it restarts, its turn reported cut off. `leftovers.test.ts` (1): real orphaned processes, only this worker's stopped.
- Live on the dev home: the stand-in's worker was killed with SIGKILL while real Claude ran a 60-second command. The Claude process stayed running, orphaned. On restart the worker logged `stopped 1 harness process(es) left running by an earlier worker`, the process was gone, and the run failed within four seconds with the restart message.

## P2.9 Terminal history from connected computers

P2.9 imports terminal sessions a person picks from a connected computer, read-only, reusing the home's own history import (`src/lib/import/external-agents.ts`) on the computer that has the native files.

### What moves to the computer, and what stays

- **Discovery and reading are split out, with no database** (`src/lib/import/history-source.ts`): listing a harness's sessions through agentex, and reading one transcript from a byte offset. The home runs them for its own files, and a worker runs them for its own. The rest of the importer (the ledger, the chat, the windowed commits) stays at home.
- **Two requests, never commands.** `list_history` returns each session's key, harness, id, title, folder, times and branch: what a person needs to choose, and never a transcript or its path. `read_history` returns one window of a selected session's events, from an offset the home names, with the size and a hash of the transcript up to where it stopped. Only what's selected is read, and only by the home's asking. Nothing else leaves the computer.
- **The same checks as at home.** The home sends the size and hash of what it already has. If the computer's transcript no longer starts with those bytes (rewritten, truncated, replaced), the read starts over from zero and the home replaces what it had, as the home's own sync does.

### At home

- **Identity is qualified by computer.** The import ledger gets `computer_id` (null for the home's own), and its uniqueness becomes (computer, harness, native id), so the same native id on two computers is two sessions. Migration: a nullable column and a replaced index, no table rebuild.
- **Into an agent set up on that computer.** A session imports into the agent whose folder on that computer is the session's folder (its setup report). A session from any other folder is listed with the fix (set the folder up as an agent there first), since an agent with no folder at home comes with P3.1.
- **Known sessions aren't imported twice.** A session Ri already runs on that computer (an execution there whose native session is that id) is shown as Ri's own. One already imported is synced instead.
- **Placed where it lives.** The imported execution has a placement on that computer, so its folder views go to that worker and nothing at home reconciles it as local. It's read-only here: no "Continue here", which would move a session between computers (P4).
- **Freshness.** Opening the chat, and the background sweep, read what's new from the computer when it's connected. When it isn't, the chat keeps what was imported and when it was last synced.
- **Harnesses.** Claude and Codex keep their history in files, which the worker reads. OpenCode serves its history from a running OpenCode process, so its sessions on a connected computer are listed but not imported yet.

### What a listing shows

Each session's title is what a person chooses by. agentex takes it from the harness's own title, or else the first prompt, as it does for the home's own imports. The listing also carries each transcript's size, so an import is judged current when the home holds all of it, as at home. It never carries a transcript's path or any of the conversation beyond the title.

### Also found and fixed

- `external-agents.ts` had a raw NUL byte in a template string, the one byte its own comments say it avoids, which made `grep` treat the file as binary. It's an escape now, the same string.

### As built

- `src/lib/import/history-source.ts`: discovery, candidates, key parsing, the prefix digest and event mapping moved from `external-agents.ts` unchanged, plus `listedSession` and `readHistoryWindow`. `src/lib/worker/history.ts` answers `list_history` and `read_history`, among the requests every worker answers.
- `src/lib/import/remote.ts`: `discoverRemoteSessions`, `importRemoteSessions`, `syncRemoteImport`, `syncRemoteImportsOn`. The home's own importer ignores imports from other computers and sends their syncs here. `GET` and `POST /api/imports/agents` take a computer, and "Continue here" is refused for a session that lives elsewhere, saying where.
- Migration 0007: `external_session_imports.computer_id` and the two partial unique indexes. No table rebuild.
- The import panel has a picker for whose history (this computer, or a connected one). It says which agent each folder imports into, and why a row can't be imported.
- Not yet: the chat view doesn't say which computer an execution is on. Pressing "Continue here" on an import from elsewhere shows the refusal. Showing it up front belongs to P3.5's owner-computer views.
- Tests: `remote-history.test.ts` (4), with the worker in its own process and its own Claude history. The listing has nothing of a transcript's content or place. A chosen session imports read-only into the agent there, placed on that computer, and only that one: one Ri runs there is recognized, and one from another folder is refused with the fix. It syncs what's new, starts over when the transcript was rewritten, keeps what it has while the computer is away, and its status tracks how much of the transcript the home holds. The same native id on two computers is two imports. The home's own importer tests pass unchanged.
- Live on the dev home, after its restart applied 0007 (snapshot first, all 201 chat events kept): the stand-in's real Claude history listed 516 sessions in 76 folders, 9 of them recognized as Ri's own, with no transcript path. A terminal session run in the Demo agent's folder imported into Demo with both messages. Continuing it in the terminal and opening the chat at home brought the new exchange. "Continue here" was refused with where it lives. The panel, screenshotted, showed the picker, "Imports into the Demo agent", the reason on other folders, and "Imported" once synced.

## P2 review fixes

The review of P2.1–P2.6 (`09d788b..694cf64`, 2026-09-25) found 11 reproducible failures. Its probes are kept as `src/test/regressions/homes-p2-review.test.ts`: all 12 failed before the fixes and pass now, along with the migration check. Three probes were adapted to the real path, each noted in the file: re-enrollment goes through the enroll service, the sink probe first journals the send that started the chat's session, and the home-restart probe's run has its send.

### A worker's reports count only for its own work

1. **A turn result finishes only its own send's run.** A worker's `turn_result` is bound to the send this computer was given for that chat and turn (`sendForTurn`), from the placement that ran it. The run finished is the send's, whatever the event names. A turn it wasn't sent is ignored. Before, a worker could finish any run on the home by naming it.
8. **The heartbeat mirrors only this computer's chats, at the generation it runs them.** The snapshot carries each chat's generation, and the home drops every chat, prompt and background task that isn't placed on this computer at that generation. Before, a worker could show a home-only chat as running, with a made-up prompt, and a late heartbeat could restore an old placement's state.
11. **A result's cost goes to its own run.** The worker stamps each chat event with the run of the chat's open turn. The home charges a result to that run when it's one of this computer's sends, and never to whatever run is active at home. Before, an old placement's result charged the new placement's run.

### Generations and ownership on the worker

5. **Events carry the generation that ran them.** The worker's sink stamps each event with the chat's generation from its command journal, the newest command for that chat. The home refuses an execution's event without one, instead of assuming the placement it has when the event arrives. Before, every real event had none, so buffered output from before a move was refused rather than kept as history.
2. **No command's effect before the home accepts the worker.** Recovery waits for the first stream the home opens (key valid, protocol and home right) and a heartbeat confirming which placements are still this computer's. A placement the home releases is journaled (`released`) and fences every older command for it, across restarts. Before, a restarted worker whose key was revoked ran a setup script it had received before learning it was revoked.

### Runs that never end

6. **A turn a worker restart cut off is reported.** The command journal keeps which delivered sends' turns have ended (`turn_ended`, written when the result is journaled). On restart, after recovery, each one still open is reported to the home as failed ("The turn stopped when Ri's worker on MacBook restarted"), with the generation that ran it. It is never sent again. Before, its run stayed running forever.
3. **The home's restart reaps only its own runs.** `reapStaleRunningRuns` leaves runs of chats on connected computers, including sends still waiting to be delivered: their worker reports how they end. Before, a home restart failed every laptop run in flight, and the laptop's success couldn't undo that.
9. **One message, one run, however many dispatches overlap.** The check that a message was already sent and the reservation of it happen in the same tick, so overlapping dispatches of one chat event can't both create a run. Before, two overlapping retries made two runs for one send, and one never ended.
10. **Re-enrolling settles the runs it makes uncertain.** `enrollWorker` (the enroll route's path) finishes the runs of sends an earlier worker never acknowledged, in the same transaction that marks them uncertain.

### Durability and preparation

4. **A torn journal tail is repaired before anything is appended.** Opening either journal cuts a last record a crash left incomplete, or adds the newline to a whole one, keeping every whole record. Before, the next append ran on from the fragment and turned it into damage mid-file, and the worker couldn't start.
7. **The setup script runs only in a worktree the worker made.** The prepare result says whether it made one (`isolated`), and the home also requires a repository and not live mode. Before, the home compared its own path with the laptop's, so live mode or a plain folder on the laptop looked like a new worktree, and the setup script ran in the person's own folder.

### Also found and fixed

- Tests run under `pnpm iso` inherited that instance's database, config and work paths, so a test that set only the root read and wrote the instance's database. Seven tests failed there for it. The test setup now gives every run a fresh root and clears the other path overrides. The review's three unhandled closed-database rejections don't reproduce after this, in either kind of run.
- The migration probe counted migrations after 0003 rather than expecting three, so the next migration doesn't break it.

### Tests and live checks

- Beyond the probes: an execution event without a generation is refused. A result is charged to its own run from an old placement, and to no run this computer wasn't sent. A late heartbeat from before a re-placement changes nothing. The command journal keeps releases, chat generations and open turns across restarts and compaction, and repairs a torn tail. A send for a released placement is stale.
- Suite: 2,536 passed, both plainly and under `pnpm iso`.
- Live on the dev home, with real Claude on the stand-in laptop:
  - A turn completed and its cost landed on its own run.
  - The home restarted while a turn was running there. The run stayed running, then completed with its cost when the laptop finished.
  - The worker was killed with SIGKILL mid-turn. After it restarted, the run failed within two seconds with the restart message.
- Seen in that crash: the orphaned Claude process finished the tool call it was running, then exited on its own at its next write, since its output pipe was gone. So a hard crash leaves at most one tool call running. Cleaning such leftovers up on restart belongs with P2.8's crash tests.

## P2 re-review fixes

The re-review of `183391a` (2026-09-25) confirmed the eleven fixes and found two more. Its probes are kept as `src/test/regressions/homes-p2-recheck-extra.test.ts`.

1. **A dispatch the home stopped before saving its send is reaped.** A run is created before its send is prepared and saved, so a home that stops in between leaves a run no worker ever heard of. The boot reaper now keeps a connected computer's run only when a send was saved for it (`hasSendForRun`), and reaps the rest like any other.
2. **A turn's cost goes to the message that opened it.** The runner records each message's harness id (agentex's command uuid) with its run, and each `turn_start` names the message that opened the turn. What a turn produces, its result and cost included, belongs to that message's run (`producingRun`), at home and on a connected computer. Before, output was charged to the newest message sent, so two overlapping turns costing $3 and $5 were recorded as $0 and $8.
   - A message the harness folds into a turn already running (Claude drains one sent mid-turn) is answered by that turn: its run finishes with it, and the turn is charged once, to the message that opened it.
   - A turn the harness starts on its own (a background task finishing) belongs to no message and no run.
   - A harness that doesn't name the opener: the oldest message still out.
   - The worker stamps a turn's output and result with the generation of the send that opened it, not of the newest command for the chat. This also closes the re-review's third probe, in which a newer command relabeled an old turn's result.

### P4 acceptance, recorded

- A command the home streamed before a disconnect, for a placement that changed since, must not run when resent. Only P4's transfer changes a placement under a running worker today, and whether such a command becomes stale or uncertain (the worker may have received it) belongs to P4, with the transfer lock. The probe stays in the file, skipped, for P4 to turn on.

### Also found and fixed

- **Two messages to a chat with no live session started two harnesses.** The second replaced the first, whose process was never tracked or closed, and the messages went to different native sessions. Session starts are shared per chat now. Found while making the overlapping-cost test deterministic.
- **The test suite called OpenAI.** With `OPENAI_API_KEY` in the shell, every task or note a test saved was sent for an embedding, and the answer arrived after the test had closed its database: the "closed database" rejections from both reviews. The test setup now clears provider keys, and tests that need one set their own.
- **The markdown mirror could keep stale content.** Two overlapping syncs of one entity shared a temp file name and ran in parallel: one failed its rename, and an older one could finish last. Syncs of an entity now run in order, and each write has its own temp file. This was the late log behind the re-review's teardown error.
- The suite now runs clean: 2,543 passed, exit 0, three runs in a row and once under `pnpm iso`, with no unhandled errors.

### Live check

With real Claude on the stand-in laptop, a second message sent while the first message's turn was running a 20-second command was folded into that turn ("The command printed 111, and 6 × 7 = 42"). The turn's $0.080 went to the first message's run, and the second message's run completed at $0.

## Dogfood gate A: the real laptop and phone

Automated coverage used a stand-in laptop on the Mac Mini (`~/ri-homes-laptop`). The gate itself needs the real devices. Status: **passed on 2026-09-25**, on the real MacBook and iPhone.

Checked afterwards in the dev home's database and log:

- One `home` row. No second home was created.
- The MacBook registered as its own computer under the MacBook CLI key, and was renamed "MacBook". The key is bound to that computer.
- The Ri agent has two setups, both ready: the Mini's `~/ri-homes-projects/ai-task-manager` with agentex at `../code/agentex`, and the MacBook's `~/ri-homes-projects/dynamism/ri` with agentex at `../agentex`. The folder and the reference were each given once, in one `setup attach`.
- The task created in the MacBook's terminal is in the home. Every terminal step reached the home's action route, and none ran locally.
- The browser and the phone each signed in with their own key, both used today. A note was created and edited, and a task was created and started, in the app. The log can't say which device made each write.
- `~/ri-homes-connected` holds no database. It isn't inspected directly: after `connect` wrote the connection record, any database open there would have been refused, and every later command succeeded.

Found while testing: the dev server blocked its live-reload socket for the Beamd address, because `*.beamd.run` was missing from `allowedDevOrigins`. It's added now. Production builds ignore the option.

Still to do: revoke the three dev pairing keys in the dev home's Settings, Devices, once they're no longer needed. The stand-in computers from the automated checks ("MacBook (stand-in)" and "AI Mac Mini") are fixture records on the dev home only.

The dev home runs on the Mac Mini at `https://ri-homes-trey.beamd.run` (Beamd name `ri-homes`, beside production's `ri`, which is untouched). It has a dev "Ri" agent set up on the Mini at `~/ri-homes-projects/ai-task-manager`, with agentex at `../code/agentex`. Pairing keys for a phone, the MacBook's CLI and the MacBook's browser were minted on the dev home. Revoke them in its Settings, Devices after testing.

On the MacBook, with nothing of production's touched:

```sh
git clone git@github.com:treyhuffine/ai-task-manager.git ~/ri-homes-src
cd ~/ri-homes-src && git checkout ai-task-manager/session-e4aa22 && pnpm install
pnpm iso ~/ri-homes-connected -- pnpm -s cli:dev connect           # paste the "MacBook CLI" link
pnpm iso ~/ri-homes-connected -- pnpm -s cli:dev agent rename_computer --name MacBook
git clone git@github.com:treyhuffine/ai-task-manager.git ~/ri-homes-projects/dynamism/ri
git clone git@github.com:dynamismlabs/agentex.git ~/ri-homes-projects/dynamism/agentex
pnpm iso ~/ri-homes-connected -- pnpm -s cli:dev setup attach Ri ~/ri-homes-projects/dynamism/ri --ref agentex=../agentex
pnpm iso ~/ri-homes-connected -- pnpm -s cli:dev agent create_task --title "Captured from the MacBook"
pnpm iso ~/ri-homes-connected -- pnpm -s cli:dev agent list_agent_setups   # Ri: Mac Mini and MacBook, both ready
```

Then open the "MacBook browser" link on the laptop and the "phone" link on the phone. Capture and edit tasks and notes on each and see them everywhere. Pass when: there is one home and one Ri agent with both layouts ready, `~/ri-homes-connected` holds no `data.db`, and no step asked for a path more than once.

## Dogfood gate B: real work across the laptop, Mini and phone

Status: **started on 2026-09-25**, on the dev home with the real MacBook's worker awake.

Found while testing:

- The phone's main chat did nothing. A home where nobody had picked an orchestrator mode stores none, and the server runs that on the MCP surface, but the chat panel and Settings fell back to the retired Classic chat on their own. Classic posts to `/api/chat`, which main deleted in 3dd6586, so each send was a 404 (two in the dev home's log). Production never showed it because its stored mode is `harness_mcp`. The server and the UI now resolve the mode through one function (`resolveOrchestratorMode`, `src/lib/orchestrator/mode.ts`): unset and `legacy` both mean MCP. The Classic option, its chat component and a helper only it used are gone. The same bug is on main, and any fresh install hits it. Fixed there too (bcd0e1d).
- The phone's Agents tab showed agents working while only the main chat was. Its badge counted every running chat, where the desktop pills count only executions (the rail's sessions). It counts executions now, by the pills' own classifier (`executionActivity` in `bucket-config.tsx`), and a turn in the main chat or an agent's main chat no longer reads as an agent at work. Fixed on main too (48ccc69).
- The main chat sent "Hello" into an imported terminal session, which is read-only until a person takes it over. Only the composer enforced that: the messages route, `send_session_message` and dispatch let it through. This import lived on the stand-in laptop, whose worker was off, so the message waited in its queue to start a blank session there, under a transcript it never saw. Every send path now refuses an import nobody has taken over (`isImportMirror`, `src/lib/import/mirror.ts`), and the orchestrator's brief says so. On main, the same hole forked a local import. Fixed there too (48ccc69), with a dispatch test on a real import. The one stray message on the dev home was withdrawn through the query layer (`cancelWorkerCommand` and `settleUndelivered`, snapshot first), and the dev home restarted.
- Open: a message waiting for a computer that's asleep reads as "working", in the rail and to the orchestrator, which told Trey the session "started working on it". The messages route holds the chat busy until the far end answers, and nothing says "waiting for the MacBook". Where a message is belongs with P3.5's owner-computer views.

## P0.3 Records and the runner boundary

### Principles

- One authority per value (spec §2.3). The home owns identity, work and conversation. A computer owns its paths and processes. The home keeps an observed index of what computers report and never edits a disconnected computer's paths.
- Extend existing records. Executions, chats and chat events keep their ids and meaning, and gain placement.
- Schema per repository rules: shared timestamps, no policy defaults, state columns NOT NULL with the creator setting them. Ri has one user and isn't live, so migrations are written clean, and existing data moves through a rehearsed one-time step rather than compatibility shapes.

### Identity

**`home`**, exactly one row:

| Column | Notes |
| --- | --- |
| `id` | Stable home id, independent of any address |
| `kind` | `personal \| team`, a fact set at creation |
| `name` | Shown to computers and, later, to spaces |
| `host_computer_id` | FK `computers.id`. The computer whose in-process runner serves this home |

**This machine's identity** lives in `<config>/machine.json` (`{ version, homeId, computerId }`, 0600). It is machine-local, so the backup leaves it out. At boot a home compares it with `home.host_computer_id`:

- Both present and equal: normal.
- No home row (a new database, or one from before this build): create the host computer and the home, writing `machine.json` first with the new ids so a crash between the two steps repeats the same ids.
- A home row but no matching `machine.json`: the database was restored or copied onto another machine. The home refuses to run as the authority until that root is explicitly selected (§10.3), which prevents two roots acting as one home. `dev-copy` gives a copy a new home id and host computer, because a development copy is a different home.

**`computers`**, one row per enrolled machine, the host included:

| Column | Notes |
| --- | --- |
| `id`, timestamps | |
| `name` | Human name ("Mac Mini"), editable |
| `platform`, `hostname` | Reported. The hostname is display only and never identity (§3.3) |
| `status` | `active \| revoked`, set by the creator. `revoked_at` |
| `worker_protocol`, `worker_version` | Reported by a worker. Null for the in-process host |
| `harnesses` | JSON, reported: installed harnesses, versions, login state, models |
| `reported_state` | `awake \| asleep \| stopped`, as last reported. Availability is derived: asleep only when reported, unavailable when contact is older than the liveness window (§3.5) |
| `last_seen_at` | |
| `acked_event_seq` | Highest contiguous worker event position the home has stored |

Worker credentials are `api_keys` rows with `computer_id` set (P2.2). Browser and phone keys stay as they are, and a viewing key never becomes a worker key.

### Setups

**`.ri.local.json`** in each source folder is the authority for that computer's paths (spec §4.1). The worker keeps the list of registered files in its private config, and the home computer does the same in its own.

**`agent_setups`** is the home's observed index, one row per agent per computer:

| Column | Notes |
| --- | --- |
| `workspace_id`, `computer_id` | Unique together, both cascade |
| `source_path` | Absolute path on that computer, as reported |
| `config_revision` | sha256 of the file as last observed. Edits made through the UI carry it and fail on a mismatch |
| `references` | JSON: each alias with its form (`path`, `agent`, `omitted`), resolved path and whether it exists |
| `status` | `ready \| missing_folder \| invalid_config \| wrong_home \| missing_reference`, as reported |
| `problem`, `reported_at` | |

Reference aliases, scope and descriptions stay in `reference_folders` at the home. Each computer's physical mapping for an alias lives in its local files. `workspaces.cwd` and `worktree_root` become the host computer's observed values during the move to setups, and are dropped once nothing reads them (P1.5).

### Placement

**`execution_placements`**, the history of where an execution runs:

| Column | Notes |
| --- | --- |
| `execution_id`, `computer_id` | |
| `generation` | 1 for the first placement, then one more per continuation. Unique per execution |
| `worktree_path` | On that computer. Moves here from `executions.worktree_path` |
| `checkpoint_sha` | The Git commit the placement started from (continuation) |
| `start_reason` | `created \| adopted \| continued` |
| `ended_at`, `end_reason` | `transferred` in this release |

A partial unique index allows one open placement per execution. The open placement is the owner, and its generation is the ownership generation every command carries.

**`native_sessions`**, the history of harness sessions behind a chat: `chat_session_id`, `computer_id`, `placement_id` (execution chats), `harness`, `native_session_id`, `native_path` (a path on that computer), `started_at`, `ended_at`, `end_reason`. `chat_sessions.external_session_id` stays the current binding. The history keeps old bindings when a continuation starts a fresh session (§5.1).

**Chats without an execution** run where `chat_sessions.computer_id` says. Null means the home's own computer, which is right for the app's main chat, content chats and scheduled orchestrator fires, because they belong to the home wherever it is. An agent main chat fixed to another computer has it set (§7).

### Commands

**`worker_commands`**, persisted before delivery (§5.4):

| Column | Notes |
| --- | --- |
| `id` | Stable command id, the deduplication key |
| `computer_id` | Target |
| `seq` | Per computer, set when the command is first streamed. Null while queued, and for a command cancelled or found stale before streaming |
| `execution_id`, `chat_session_id` | Target, when execution-scoped |
| `generation` | The target's ownership generation when queued. A command from an older generation is rejected |
| `kind` | `send_message`, `interrupt`, `stop`, `stop_task`, `answer_pending_input`, `prepare`, `run_script`, `write_setup`, `git` |
| `payload`, `actor` | JSON. The actor comes from credentials, never from the caller's claim |
| `state` | `queued \| sent \| delivered \| failed \| cancelled \| uncertain \| stale` |
| `attempts`, `sent_at`, `delivered_at`, `finished_at`, `result`, `error` | |

A user message is one transaction: the `chat_events` row, plus a `send_message` command whose payload names that event. The saved, waiting, delivered, failed and uncertain states in the UI (P3.2) read from the command. The home's own runner uses the same records and delivers at once, so every placement behaves the same way.

Reads are not persisted: tree, file, diff, status, diff stats, folder discovery and history listing. They are request and response over the worker connection with a timeout.

### Events from a worker

- A worker mints each `chat_events.id` (UUIDv7) when it parses the event, so a replay inserts nothing new.
- Cumulative provider parts carry a revision (`chat_events.part_revision`). The home replaces a part only with a newer revision, so a late replay cannot overwrite newer text.
- The worker writes every event and signal to a local journal before sending, with a position per computer. The home stores them in order and acknowledges the highest contiguous position (`computers.acked_event_seq`). On reconnect the worker replays from there.

### The runner boundary

Today `ensureHarnessSession` and `dispatch` mix two jobs. The split:

**The home prepares a session spec**, a plain serializable description: harness, permission mode and its provider config, model, variant and effort, the orchestrator, connector and browser servers (with home URLs and credentials suited to where the session runs), agent instructions, reference aliases and descriptions, the session credential, the chat's current native session id, and any first-turn brief. Everything that needs the database is resolved here.

**The runner turns a spec into a running harness** on its computer. It has no database access:

```ts
interface ExecutionRunner {
  readonly computerId: string;
  describeHarnesses(): Promise<HarnessReport[]>;           // runtime, capabilities, models on this computer
  prepare(req: PrepareRequest): Promise<PrepareResult>;    // worktree on the branch, files to copy, setup script (journaled apart)
  send(req: SendRequest): Promise<DeliveryAck>;            // spawn or resume, then inject; acks delivery, not turn end
  interrupt(chatSessionId: string): Promise<void>;
  stopTask(chatSessionId: string, taskId: string): Promise<void>;
  stop(req: StopRequest): Promise<StopReport>;             // harness, background tasks, owned processes; confirmed
  answerPendingInput(req: AnswerRequest): Promise<AnswerResult>;
  read(req: ReadRequest): Promise<ReadResult>;             // execution-scoped tree, file, diff, status, stats
}
```

**Everything the runner learns flows back through one sink**: chat events (insert and cumulative replace, the existing `EventWriter`), plus signals for turn start and end, turn result, background tasks, pending input raised and resolved, native session id captured, and command inventory. On the home, the sink writes the database, publishes to the realtime bus and notifies, as today. On a worker, it writes the journal and posts to the home.

**Run bookkeeping becomes event driven.** `dispatch` awaits a whole turn and then marks the run complete. A home cannot hold that promise across a worker disconnect, so run completion, failure, cost and notifications react to the turn-result signal, for every placement.

**Home only:** runs, budget, notifications, saved model defaults, unread and activity, labels, the scheduler, triggers, deck, orchestrator actions, search and embeddings.

**Runner only:** agentex sessions, harness discovery, pending-input resolvers and turn state held in memory, worktrees, Git and files, setup scripts, previews and terminals, and reading native transcripts, including reconcile after a crash.

**Live state.** Running flags, background tasks and pending prompts live with the runner. The home keeps a mirror of each worker's reported state and marks it unknown when contact is lost. Rail, runtime status, stream seeding and oversight actions read one facade over the local state and those mirrors.

## P0.4 Execution entry points

Every current path that starts, messages, controls or reads an execution, and the boundary each goes through. File references are at `200fb36`.

| Group | Entry points | Goes through |
| --- | --- | --- |
| Send a message | messages route; commit, PR, resolve-conflicts and help-with-error routes; scheduler `dispatchRun` and coalesce; health orphan redispatch; webhook triggers; `start_execution` and `send_session_message` (already over HTTP) | Persist the command, then route to the owner's `runner.send` |
| Control | interrupt; stop background task; restart; resync; `stop-agent`; session and agent archive; close chat; main chat retire; the `recycle*` family; run cancel; heartbeat quiet settle | `runner.interrupt`, `runner.stopTask`, `runner.stop` |
| Pending input | pending-input list and answer routes; `get_pending_input`, `answer_pending_input`; rail pending snapshot | `runner.answerPendingInput`, bound to request id, chat and generation. Listing reads the live-state facade |
| Preparation | `dispatchExecutionSession` provisioning; `ensureWorktreeReady`; retry setup; retry setup script; continue; take-over-import | `runner.prepare` |
| Execution reads | tree; file GET; diff; status; diff stats (one and bulk); WIP detect; the diffs the commit and PR routes read | `runner.read` |
| Execution writes and Git | push; pull base; merge; auto-merge; file PUT, DELETE, create, rename, resolve-conflict; dir; WIP copy and move; takeover | Owner-routed commands. Retire takeover (P4.5) |
| Terminals | execution terminals, agent-folder terminals | Run on the owner computer in its resolved folder. P3.5 must expose Home and worker terminals through authenticated owner routing to personal viewing surfaces, per [spec §5.6](homes-spec.md#56-in-app-terminals-and-cli-location). This is a build requirement, not a shipped worker capability |
| Other owner-computer surfaces | previews, open in editor | Safe preview access with an honest unavailable state where unsupported, and local editor opening through the companion (P3.5) |
| Live state | runtime status; stream seed; history running flags; slash command inventory; rail; pending list; run observe | The live-state facade |
| Boot and background | cold-start reconcile; 60 s health sweep; orphaned setup scripts; orphaned previews; preview idle eviction; scheduler | Runner work for the home's own sessions. A worker reconciles its own. Scheduling stays home only |
| Agent folder operations | agent tree and file; branches; base status; agent pull base; GitHub lists; detect stack; `create_workspace` detection; `list_skills`; reference folder resolution; harness discovery and one-shot calls keyed by folder | Resolved per computer through that computer's setup |

### Paths that already break "the process serving the UI owns the execution"

Found while mapping. Each is fixed where its phase lands.

1. `ri trigger run`, `ri agent run_trigger`, `ri run cancel` and `ri agent cancel_run` run `dispatchRun` or `abort` inside the short-lived CLI process (`src/cli/commands/trigger.ts:149,287`, `registry.ts:2275,2335`). The server can't see, stop or answer that harness, and cancel does nothing there. Route them through the server (P2.4). Fixed in P2.4.
2. `archive_workspace` (`registry.ts:1468`) archives in the database only. The REST route also kills terminals and closes sessions (P2.4). Fixed in P2.4.
3. The takeover block exists only in the messages route. Commit, PR, resolve-conflicts, help-with-error, the scheduler, coalesce and health redispatch still dispatch. Owner routing replaces it (P2.4, P4.5). Fixed in P2.4.
4. The event seam is partial. Reconcile replays, Codex replay, user messages, run rows and every live-state publish bypass `EventWriter` (P2.1). Fixed in P2.1: every replay path writes through a writer, and live state publishes only from the home sink. User messages and run rows are the home's own records.
5. Orchestrator, connector and browser server URLs for harness sessions are `http://localhost:<port>` with the local bearer token (`harness-surface.ts:623,646,670`), so a harness can only run beside the server today (P2.7). Fixed in P2.7: a session elsewhere gets them at its worker's address for the home, with a session token.
6. Preview uses `worktreePath ?? workspace.cwd` (`preview/service.ts:117`), so it can start in the source checkout while a worktree is still being prepared (P3.5).
7. A quiet heartbeat archives its chat without closing the harness (`heartbeat/quiet.ts:40`), and handles have no idle timeout (P2.1). Fixed in P2.1.
8. Interrupt leaves pending prompts registered. Only close rejects them (`adapter.ts:815,872`) (P2.4). Fixed in P2.4.

Other facts that shape the work:

- Migrations are read from `process.cwd()/drizzle`, so the CLI only works from the repository root.
- The realtime bus is in-process, so a CLI write publishes nothing. Live paths already go through the server.
- Session credentials are HMACs keyed by the home's local token. A home must sign credentials for sessions it sends to a worker, because the worker never holds that token.
- `ensureLocalToken` mints a new host key when the database lacks one, so a restored database without its config quietly gets new credentials.

### Upstream fixes

- `@agentex/workspace` 0.0.4 resolved `git rev-parse --git-path` output against the process's working directory instead of the repository. A server or worker started outside the checkout it opened read another repository's metadata, or failed with `ENOTDIR` from a linked worktree. That broke agent folder views in a dev home run from a worktree, and 8 existing tests. It was patched here first, then fixed upstream in 0.0.5, which Ri now uses, and the patch is gone. 0.0.5 also stores base metadata per worktree: 0.0.4 shared one file across all worktrees of a repository, so a new sibling worktree overwrote an older one's base. Worktrees made before 0.0.5 fall back to the old file.

