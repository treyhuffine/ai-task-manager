# One Ri: build notes

Working notes for building [the homes build specification](homes-spec.md). The spec is the contract. This file records how the build runs, what was found, and the design decisions the spec leaves to implementation. Sections are numbered by the spec task they serve.

## P0.1 Isolated development setup

Production must stay untouched while this is built (spec §10.4). A worktree isolates code, not data: every path helper falls back to `~/ri` when `RI_ROOT` is unset, and a shell started inside a harness session inherits that session's caller credential and Claude Code's own session variables. Isolation therefore comes from paths, checked before anything runs.

### The launcher

`pnpm iso <root> [--init] [--port <n>] [--tunnel <name>] [--check] [-- <command...>]` (`scripts/isolated.ts`, rules in `src/lib/config/dev-isolation.ts`):

- Builds a clean environment. Inherited `RI_*` variables (including `RI_SESSION_CREDENTIAL`), `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID` and `CLAUDE_EFFORT` are removed. `CLAUDE_CODE_MESSAGING_SOCKET` and its token point at the session that launched the command, so a harness started by a dev server would otherwise run as that session's child.
- Pins `RI_ROOT`, `RI_DB_PATH`, `RI_CONFIG_DIR` and `RI_WORK_DIR` under the root and resolves them through the real path helpers.
- Refuses when a resolved path lands in `~/ri` (production), `~/ri-dev` (other sessions' dev server on 42241) or `~/ri-test` (the smokes wipe it), when the root contains one of those, when the port is in use, when the root's config carries production's token or tunnel name, and when it would install the shipped skill machine-wide.
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
  prepare(req: PrepareRequest): Promise<PrepareResult>;    // worktree on the branch, files to copy, setup script
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

### Upstream fixes carried as patches

- `@agentex/workspace` 0.0.4, `revParseGitPath` (`patches/@agentex__workspace@0.0.4.patch`). `git rev-parse --git-path` prints a path relative to the repository in a main checkout, and the library then read it relative to the process's working directory. A server or worker started outside the checkout it opens read another repository's metadata, or failed with `ENOTDIR` when its own directory was a linked worktree, which broke agent folder views in a dev home run from a worktree and 8 existing tests. The patch resolves the path against the repository. Fix it in `agentex/packages/workspace/src/git/commands.ts` and drop the patch at the next release.
