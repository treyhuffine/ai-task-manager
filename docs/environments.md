# Environments: production and development

How Ri runs on the Mac Mini as production, how development runs beside it without touching it, and how production's data is protected. Written 2026-10-06.

## In one paragraph

Production runs from this checkout, `~/ai-task-manager`, serving the real home `~/ri` on port 4224, and changes when you rebuild and restart it. Development runs from the same checkout with hot reload, serving its own home `~/ri-dev` on port 42241, full of a fictional person's data and marked **Dev** on every screen. Nothing in development reads or writes `~/ri`. Production's database changes only when production starts, and `~/ri` is backed up every night.

## Production on the Mac Mini

| | |
| --- | --- |
| Code | this checkout (`pnpm build` to rebuild the app) |
| Home | `~/ri` (database, config, attachments, worktrees) |
| Address | `http://localhost:4224`, and the Beamd tunnel the home is configured with |
| Start | `pnpm cli:dev start` in a terminal. Ctrl-C stops it. |
| Pick up changes | `pnpm build`, then restart |

Run it from the CLI, not the desktop app. The Mini's job is to be the always-on home, a server that keeps running with no window. The desktop app's own features (menu bar, global Quick Capture, native notifications) are for the computer you sit at. The packaged desktop app and headless runtime (docs/desktop.md) can take over later, once adopting an existing home is productized.

### The database changes only when production starts

Every process that opens a home's database used to apply any migrations it found in its code: the server on boot, but also every `ri agent` command an agent ran. So a migration an agent was still writing reached the production database the next time any agent used the CLI (2026-10-05). Now only a starting server applies migrations (`allowMigrations()` in `instrumentation.ts`, `ri start` and `ri service start`, and `pnpm db:migrate`). Any other process that finds migrations still to apply refuses and changes nothing:

> This code has one database change that isn't applied to ~/ri/data.db yet (0008_x). Ri applies database changes when it starts, so restart Ri to apply it. Nothing was changed.

A brand-new database is still set up wherever it's opened (tests, a fresh home, the dev seed).

The same goes for the rest of the setup (search tables, triggers, backfills): only a starting server does it. Any other process joins the home as its server left it, loading `sqlite-vec` and checking the history read-only, so it never takes the write lock just to open. Before, an agent's `ri` command that opened the database while the server was writing waited about 5 seconds and then failed with "database is locked". Now it opens in a millisecond (measured on a copy of the production database). The CLI also reads migrations from its own install now, not from the shell's working folder, so `ri` works from any folder and never picks up a worktree's draft.

What can still change production before a restart: rebuilding the app (`pnpm build`) replaces the files the running server serves, so pages can misbehave until you restart.

### Backups

`~/ri` is backed up every night at 03:30 into `~/ri-backups/daily`, keeping the newest 7.

```sh
pnpm backup              # back up now
pnpm backup status       # the nightly job, and the backups on disk
pnpm backup install      # (re)install the nightly job
pnpm backup uninstall    # stop it (backups are kept)
```

Each backup is a full `createHomeBackup` (`src/lib/home/backup.ts`): a consistent copy of the database taken while Ri keeps running, attachments, persona and memory, skills, and the config a restored home needs (host token, integration secrets), with a checksum per file. The agent browser's profile (2.4 GB of cookies and cache) and `.work` (worktrees, caches) are left out. The database is compressed with zstd: the 9.6 GB database is 0.96 GB, a whole backup 1.23 GB, about 30 seconds. The job is a launchd agent, `~/Library/LaunchAgents/app.ri.home-backup.plist`, logging to `~/ri-backups/daily/backup.log`. Nothing in it opens the home through the app, so a backup never migrates or writes what it copies.

To restore, with Ri stopped:

```sh
cd ~/ri-backups/daily/ri-<date>-<time>
zstd -d data.db.zst                                    # gives data.db
pnpm tsx scripts/home-backup.ts verify .               # every checksum and row count
mkdir ~/ri-backups/replaced && mv ~/ri/data.db ~/ri/data.db-wal ~/ri/data.db-shm ~/ri-backups/replaced/
cp data.db ~/ri/data.db
```

Or restore the whole backup into a new folder with `pnpm tsx scripts/home-backup.ts restore <backup> <new-root>`.

These backups are on the Mini's own disk. Time Machine is set up to copy the disk, `~/ri-backups` included, to an external drive, which is what survives the Mini's disk failing. Check it's actually running (`tmutil latestbackup`): on 2026-10-06 it couldn't mount its drive.

## The MacBook

Run the desktop app as a **connected device** of the Mini's home, not as a second home. That's the model in docs/homes-model.md: one Ri lives on the Mini, the MacBook is a window onto it and, if you allow it, a computer that runs agents for it.

1. On the MacBook, in a checkout at the same commit as the Mini (both sides must speak the same protocol): `nvm install && nvm use` (Node 26.5.0), `pnpm install --frozen-lockfile`, `pnpm desktop:package`. The app is `release/desktop/mac-arm64/Ri.app` (unsigned, built locally, so it opens).
2. On the Mini, Settings, **Devices**: make sure the Beamd address is set. If a **MacBook** device is already listed, use **New pairing link** on its card. Otherwise **Add device**, **Type: Computer**, **Create pairing link**. Copy the **Remote** link (shown once).
3. Open Ri.app on the MacBook. In **Ri on this device**, under **Connect to your Home**, paste the link into **Pairing link**. Tick **Run agents on this device using its folders and tools** if you want it to run agents (it needs Claude Code or Codex signed in on the MacBook). **Connect**, then **Open Ri**. Don't choose **Use this device as Home**.

Pairing needs trusted HTTPS, so use the Beamd link, not a localhost or LAN one. Agents can be turned on later from **Tools > Ri on This Device… > Enable local execution**. Without the app, opening the Remote link in a browser signs it in as a viewer. docs/desktop.md (P5.4) has the details.

## Development

```sh
pnpm dev                 # the dev home on http://localhost:42241, hot reloading
pnpm dev:reseed          # rebuild the dev home from the synthetic dataset
pnpm ri:dev agent ...    # the CLI against the dev home
```

- **The dev home** is `~/ri-dev`. `pnpm dev`, `pnpm desktop:dev` and `ri start --dev` all open it, and only one at a time (they share an owner lock).
- **You can always tell.** Every screen of a non-production home has an amber strip along the top, a **Dev** tab, and `Dev ·` before the tab title (`HomeEnvironmentMarker`). It comes from the server per request, never from the build.
- **First visit:** open the pairing link `pnpm dev` prints.
- **It never opens production.** `pnpm dev` refuses a database, config or work folder inside `~/ri`, and `--dev` on any command means the dev home even when `RI_ROOT` names production (`resolveDevAppRoot`).
- **`ri` aimed at the dev home finds the dev server.** `pnpm dev` publishes the home's runtime record once the server answers, as `ri start` does, so `RI_ROOT=~/ri-dev` alone is enough.

### The dataset

`pnpm dev:reseed` fills the dev home with Maya Okafor: co-owner of a small coffee roastery, building an iOS birding app with agents, training for a marathon, renovating a 1924 bungalow. Nothing in it resembles your own data, so a glance tells you which home you're in. It covers every state the app shows:

- 9 areas (one inactive, one archived), 88 tasks across all five statuses, with subtasks, blockers, overdue and upcoming deadlines, reminders, snoozes, recurrences and tasks deferred too often
- 34 notes with links between them, attachments (a roast chart, tile samples, an app mockup, a PDF, a CSV) and bookmarks
- 24 captures in every triage state, with a triage pass waiting on three proposals
- 5 agents with real git projects in `~/ri-dev/.work/seed-projects` (local remotes, a few weeks of history) and one plain folder
- 9 executions with transcripts and real branches: finished and unread, waiting on an answer, a PR with a preview and an accepted review, a failed setup script, pinned, a Codex session with uncommitted work, archived work merged into main
- the main chat, an older main chat, focused chats on a note and a task, and an agent's own chat
- four days of decks, today in two versions
- triggers with run history: completed, failed three times running, skipped and cancelled

Dates are relative to when you reseed, so it always looks current. The seed goes through `queries.ts`, so the mirror, links and attachments are kept the way the app keeps them, and transcripts go through the runner's own `parseStreamEvent`. Source: `scripts/seed-dev/` (`seed.ts` is the runner, the content is in `areas.ts`, `tasks.ts`, `notes.ts`, `stream.ts`, `executions.ts`, `conversations.ts`, `decks.ts`, `automations.ts`).

Reseeding keeps your token and paired devices, moves the old home to `~/ri-dev.previous` (one reseed is always undoable), and refuses while anything has the dev home open. The seed itself refuses a production path and a home that already has data.

**A dev server costs nothing on its own.** Every clock-driven trigger is seeded paused: the morning deck refresh, the heartbeat, the morning and weekly stream triage, and the seeded schedules. What still runs AI: a message you send, a capture (the triage debounce), and the first look at the deck on a new day, which generates one.

## How sessions stay in their own home

Every harness gets an allowlisted environment from agentex, so a server's `RI_ROOT` never reaches its sessions. Each home's server writes a launcher, `<work dir>/bin/ri`, and gives every session it runs that folder first on its PATH and its path in `RI_SESSION_CLI` (`src/lib/executor/session-cli.ts`). The launcher pins the home and the server's own checkout, so `ri` in a dev session acts on the dev home and `ri` in a production session acts on production, wherever the shell's working folder is.

Codex runs commands in a login shell, which rebuilds PATH with the system folders first, where macOS's own `/usr/bin/ri` (Ruby's documentation tool) lives, so plain `ri` there isn't Ri. `"$RI_SESSION_CLI" agent ...` is. Codex's sandbox also refuses writes outside its folder, including the home's database, so a Codex session's own `ri agent` writes fail regardless (with a misleading "Ri is preparing an update").

Sessions on a connected device reach the home over HTTP and keep that device's own `ri`.

## Related

- docs/desktop.md: the desktop app, the headless runtime and its update flow
- docs/homes-model.md: one home, devices that connect to it
- docs/homes-cutover.md: retiring a MacBook home and connecting it instead
