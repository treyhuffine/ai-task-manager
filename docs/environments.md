# Environments: production, development and releases

How Ri runs on the Mac Mini as production, how development runs beside it without touching it, and how a change gets from one to the other. Written 2026-10-06.

## In one paragraph

Production is a **release build**: a commit of `main`, checked out and built in its own folder under `~/ri-release`, serving the real home `~/ri` on port 4224. Development is the checkout, `~/ai-task-manager`, serving the dev home `~/ri-dev` on port 42241, full of a fictional person's data and marked **Dev** on every screen. Nothing you or an agent does in the checkout (editing, `pnpm build`, `pnpm install`, generating a migration) reaches production. A change goes live when you release it (`pnpm release`) and switch to it (`ri-prod start`).

## Why

Until now production ran out of the checkout everyone edits. `pnpm cli:dev start` serves whatever `.next` was last built there, including other sessions' uncommitted edits, and a build under the running server degraded it until restart. The global `ri` ran the checkout's CLI and loaded migrations from the shell's working folder, so a draft migration in a worktree reached the production database (2026-10-05). And a session started by a dev server ran `ri` against production, because the harness never saw the dev server's `RI_ROOT`.

## Production on the Mac Mini

| | |
| --- | --- |
| Code | `~/ri-release/current`, a link to `~/ri-release/builds/<sha>` |
| Home | `~/ri` (database, config, attachments, worktrees) |
| Address | `http://localhost:4224`, and the Beamd tunnel the home is configured with |
| Start | `ri-prod start` in a terminal. Ctrl-C stops it. |
| Status | `ri-prod status`: what's live, what's ready, what's running and from where |
| CLI | `ri` in your terminal is production's CLI (`~/.local/bin/ri`) |

`ri-prod start` passes extra arguments to `ri start`, so `ri-prod start --no-open` works. It refuses while production is running, and never stops it for you: sessions run as children of the production server, and stopping it ends their turns.

### Desktop app or CLI on the Mini

The CLI, from a release. The Mini's job is to be the always-on home: a server that keeps running with no window, reachable from the phone and the MacBook. The desktop app's own features (menu bar, global Quick Capture, native notifications) are for the computer you sit at.

The packaged desktop app and headless runtime (docs/desktop.md) are where production eventually goes: a staged runtime under a login service, updated with `ri update`. They aren't the right home for production yet. They are an unsigned beta, adopting an existing home like `~/ri` still needs its verified migration process, and every promotion would be a full package build. The release folder gives production the property that matters now, code that only changes when you say so, with the same `ri start`, port, home and tunnel it has today.

## The MacBook

Run the desktop app as a **connected device** of the Mini's home, not as a second home. That's the model in docs/homes-model.md: one Ri lives on the Mini, the MacBook is a window onto it and, once you allow it, a computer that runs agents for it. When the app asks for its role, choose to connect to an existing home, and pair it at the Mini's public HTTPS address (its Beamd tunnel): pairing requires trusted HTTPS. Running agents on the MacBook is a separate consent, in the app's local "Ri on This Device" window. docs/desktop.md (P5.4) has the details.

To try development from the MacBook, use the Mini directly (Screen Sharing) or give the dev home its own tunnel. Never point the MacBook's app at both, and never reuse production's tunnel name or credentials for dev.

## Development

```sh
pnpm dev                 # the dev home on http://localhost:42241
pnpm dev:reseed          # rebuild the dev home from the synthetic dataset
pnpm ri:dev agent ...    # the CLI against the dev home
```

- **The dev home** is `~/ri-dev`. `pnpm dev`, `pnpm desktop:dev` and `ri start --dev` all open it, and only one at a time (they share an owner lock).
- **You can always tell.** Every screen of a non-production home has an amber strip along the top, a **Dev** tab, and `Dev ·` before the tab title (`HomeEnvironmentMarker`). It comes from the server per request, never from the build.
- **First visit:** open the pairing link `pnpm dev` prints, or `http://localhost:42241/#token=<localToken from ~/ri-dev/.config/config.json>`.
- **It never opens production.** `pnpm dev` refuses a database, config or work folder inside `~/ri`, and `--dev` on any command means the dev home even when `RI_ROOT` names production (`resolveDevAppRoot`).
- **`ri` aimed at the dev home finds the dev server.** `pnpm dev` publishes the home's runtime record once the server answers, as `ri start` does, so `RI_ROOT=~/ri-dev` alone is enough. Before, server-calling actions fell through to port 4224.

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

Dates are relative to when you reseed, so it always looks current. The seed goes through `queries.ts` so the mirror, links and attachments are kept the way the app keeps them, and transcripts go through the runner's own `parseStreamEvent`. Source: `scripts/seed-dev/` (`seed.ts` is the runner, the content is in `areas.ts`, `tasks.ts`, `notes.ts`, `stream.ts`, `executions.ts`, `conversations.ts`, `decks.ts`, `automations.ts`).

Reseeding keeps your token and paired devices, moves the old home to `~/ri-dev.previous` (one reseed is always undoable), and refuses while anything has the dev home open. The seed itself refuses a production path and a home that already has data.

**A dev server costs nothing on its own.** Every clock-driven trigger is seeded paused: the morning deck refresh, the heartbeat, the morning and weekly stream triage, and the seeded schedules. What still runs AI: a message you send, a capture (the triage debounce), and the first look at the deck on a new day, which generates one.

## Releasing

```sh
pnpm release              # build main's tip as the next release
pnpm release <commit>     # or a particular commit
```

Run it from the checkout, by hand or from any session. It never touches the running production:

1. Resolves the commit. Only committed work ships, never the checkout's working tree.
2. Checks it out as its own detached worktree, `~/ri-release/builds/<sha>`, or reuses a finished build of it.
3. Installs from the lockfile and builds the CLI and Next. The build runs against a throwaway home, so nothing at build time can open the production database.
4. Points `~/ri-release/next` at it, installs `ri-prod`, and prints the commits since the live release and any database migrations it adds.

Then, where production runs:

```sh
# Ctrl-C the running production, then:
ri-prod start
```

`ri-prod start` switches `current` to the ready release (the old one becomes `previous`), and when the release adds migrations it first makes a consistent copy of the database in `~/ri-backups/data-<time>-before-<sha>.db`. Then it starts production from the release. Migrations apply as the server boots, as they always have.

### Rolling back

```sh
# Ctrl-C the running production, then:
ri-prod rollback
```

This switches back to `previous` and starts it. A release with migrations can't simply be rolled back: the older code refuses a database that's ahead of it, without changing anything. To go back past a migration, stop production, move `~/ri/data.db` aside (keep it), copy the backup `ri-prod` made into its place, and run `ri-prod rollback`. Anything written since the backup is only in the database you moved aside.

`ri-prod log` shows the history of what went live, and when.

### The first switch

Production today runs from the checkout. To move it onto a release:

1. Commit what should ship on `main`.
2. `pnpm release`.
3. In production's terminal: Ctrl-C, then `ri-prod start`.

This also installs the production `ri` in `~/.local/bin`, which comes first on your PATH, ahead of the pnpm link to the checkout.

## How sessions stay in their own home

Every harness gets an allowlisted environment from agentex, so a server's `RI_ROOT` never reaches its sessions. Each home's server writes a launcher, `<work dir>/bin/ri`, and gives every session it runs that folder first on its PATH and its path in `RI_SESSION_CLI` (`src/lib/executor/session-cli.ts`). The launcher pins the home and the server's own checkout (code and migrations), so `ri` in a dev session acts on the dev home and `ri` in a production session runs the release, wherever the shell's working folder is.

Codex runs commands in a login shell, which rebuilds PATH with the system folders first, where macOS's own `/usr/bin/ri` (Ruby's documentation tool) lives. There, the production `ri` in `~/.local/bin` comes first and hands off to `RI_SESSION_CLI`. Codex's sandbox also refuses writes outside its folder, including the home's database, so a Codex session's own `ri agent` writes still fail until its sandbox allows the home.

Sessions on a connected device reach the home over HTTP and keep that device's own `ri`.

## Related

- docs/desktop.md: the desktop app, the headless runtime and its update flow
- docs/homes-model.md: one home, devices that connect to it
- docs/homes-cutover.md: the homes cutover, which this follows
