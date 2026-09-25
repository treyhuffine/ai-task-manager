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

- `GET /api/workers/me/commands?after=<seq>` is a server-sent event stream. It sends `command`, `request` (an ephemeral read), `revoked`, and a keepalive `ping`. `after` is the worker's durable receipt cursor (see Command receipt and recovery), never merely the last command it saw.
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

- **The home's own runner keeps the same states** in `worker_commands`, writing `started` before and `finished` after each effect outside the database. After a home restart the same recovery table applies, using the home's own native history and worktrees.

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

- **Files the person attached, from the home to the worker:** `GET /api/workers/me/attachments/:fileName?command=<commandId>`. It is allowed only when the worker key's computer is that command's target, the command isn't stale, and the file name is in that command's payload. The worker checks the sha256, stores the file under `<workDir>/attachments/<placement>/`, outside the repository, and gives the harness that path.
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
| Owner-computer surfaces | terminals; previews; open in editor; agent-folder terminals | Only on the owner computer, with an honest unavailable state elsewhere (P3.5) |
| Live state | runtime status; stream seed; history running flags; slash command inventory; rail; pending list; run observe | The live-state facade |
| Boot and background | cold-start reconcile; 60 s health sweep; orphaned setup scripts; orphaned previews; preview idle eviction; scheduler | Runner work for the home's own sessions. A worker reconciles its own. Scheduling stays home only |
| Agent folder operations | agent tree and file; branches; base status; agent pull base; GitHub lists; detect stack; `create_workspace` detection; `list_skills`; reference folder resolution; harness discovery and one-shot calls keyed by folder | Resolved per computer through that computer's setup |

### Paths that already break "the process serving the UI owns the execution"

Found while mapping. Each is fixed where its phase lands.

1. `ri trigger run`, `ri agent run_trigger`, `ri run cancel` and `ri agent cancel_run` run `dispatchRun` or `abort` inside the short-lived CLI process (`src/cli/commands/trigger.ts:149,287`, `registry.ts:2275,2335`). The server can't see, stop or answer that harness, and cancel does nothing there. Route them through the server (P2.4).
2. `archive_workspace` (`registry.ts:1468`) archives in the database only. The REST route also kills terminals and closes sessions (P2.4).
3. The takeover block exists only in the messages route. Commit, PR, resolve-conflicts, help-with-error, the scheduler, coalesce and health redispatch still dispatch. Owner routing replaces it (P2.4, P4.5).
4. The event seam is partial. Reconcile replays, Codex replay, user messages, run rows and every live-state publish bypass `EventWriter` (P2.1).
5. Orchestrator, connector and browser server URLs for harness sessions are `http://localhost:<port>` with the local bearer token (`harness-surface.ts:623,646,670`), so a harness can only run beside the server today (P2.7).
6. Preview uses `worktreePath ?? workspace.cwd` (`preview/service.ts:117`), so it can start in the source checkout while a worktree is still being prepared (P3.5).
7. A quiet heartbeat archives its chat without closing the harness (`heartbeat/quiet.ts:40`), and handles have no idle timeout (P2.1).
8. Interrupt leaves pending prompts registered. Only close rejects them (`adapter.ts:815,872`) (P2.4).

Other facts that shape the work:

- Migrations are read from `process.cwd()/drizzle`, so the CLI only works from the repository root.
- The realtime bus is in-process, so a CLI write publishes nothing. Live paths already go through the server.
- Session credentials are HMACs keyed by the home's local token. A home must sign credentials for sessions it sends to a worker, because the worker never holds that token.
- `ensureLocalToken` mints a new host key when the database lacks one, so a restored database without its config quietly gets new credentials.

### Upstream fixes

- `@agentex/workspace` 0.0.4 resolved `git rev-parse --git-path` output against the process's working directory instead of the repository. A server or worker started outside the checkout it opened read another repository's metadata, or failed with `ENOTDIR` from a linked worktree. That broke agent folder views in a dev home run from a worktree, and 8 existing tests. It was patched here first, then fixed upstream in 0.0.5, which Ri now uses, and the patch is gone. 0.0.5 also stores base metadata per worktree: 0.0.4 shared one file across all worktrees of a repository, so a new sibling worktree overwrote an older one's base. Worktrees made before 0.0.5 fall back to the old file.

