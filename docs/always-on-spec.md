# Always on, always current: installing, running and updating Ri

**Status:** proposed build spec, written 2026-10-27 and revised the same day with the owner's decisions (section 13). Nothing here is built yet. Section 11 lists what changes in the current code, and section 12 the order to build it in.

**Promise:** once Ri is installed and a Home is created, it is running whenever its computer is on. It updates itself, along with everything it installs (its skills included), and a person never has to restart, babysit or rebuild it. This holds for the desktop app and the CLI, on a laptop, a Mac Mini in a closet, or a Linux server reached only over SSH. The standard case takes no flags.

This spec covers the software on a computer (install, releases, updates, the things Ri writes outside its folders) and the processes that keep each Home alive (supervision). It does not change what a Home is or how devices connect to one ([homes-spec.md](homes-spec.md), [homes-model.md](homes-model.md)). Where it differs from [desktop.md](desktop.md) (the service, runtime staging and update sections) or [environments.md](environments.md) (production on the Mac Mini), this spec wins once it is built.

## 1. Why

In the week of 2026-10-20, both Homes on the owner's Mac Mini went down for hours, and nothing brought them back:

| When (MDT) | What happened | Down for | Evidence |
| --- | --- | --- | --- |
| Sat Oct 24, 11:33 | The personal Home stalled. Requests that ran a 4 ms query waited up to 2.5 s, the perf log went silent at 11:34, and nothing restarted it until someone did by hand at 20:20. | 8.8 h | `~/ri/.work/perf.1.jsonl` stall and start records |
| Sun Oct 25, 12:53 | The Mini restarted. The personal Home was started again by hand within 7 minutes, but the team Home stayed down. | 22.8 h | `last reboot`, `~/ri-team-huffine/.work/perf.jsonl` |
| Oct 21 to 23 | The dev Home's server ran out of JavaScript heap (Node's 4 GB limit) after 50 hours. A second Ri server did the same after 55 hours. | n/a | `~/Library/Logs/DiagnosticReports/node-*.ips` |

The Mini was not the problem. FileVault is off, it logs in automatically, it restarts after a power cut and it never sleeps. What was missing is on Ri's side:

- The personal Home runs as `pnpm cli:dev start` in a terminal window. When the server exits, nothing restarts it, and after a reboot nothing starts it.
- The team Home runs as `ri service start`: in the background, but unsupervised. When its server dies, the controller exits on purpose so the OS can restart it, but no OS job exists.
- `ri service install`, which does write a launchd or systemd job, refuses to run anything but a packaged release (`src/lib/service/install.ts`), so neither Home could use it.
- Nothing notices a server that is still alive but no longer answering, which is what Saturday looked like.
- Updating means `stop`, `git pull`, `pnpm i`, `pnpm build`, `start`. Prod is down for the whole build, and stays down if the build fails.

The build itself was also a resource hazard until 2026-10-27: a full-checkout `next build` could pass 150 GB and freeze the computer. That is fixed (`scripts/next-build.mjs` stops a runaway build, and cd1b09fc removed the paths that caused it). It matters here because this spec builds releases on the same computer that runs the Homes.

## 2. What a person can count on

1. **It runs whenever the computer is on.** After a crash, a hang, running out of memory, a reboot or a power cut, the Home comes back by itself. The only exceptions are ones the OS imposes (section 6.5), and Ri says when one applies.
2. **It stays current by itself.** New versions download in the background and take effect at a moment that doesn't interrupt anyone (section 7.2), the way Claude Code updates itself. Updating now is one command or one click.
3. **An update costs seconds, never a broken Home.** The old version keeps serving until the new one has been fetched or built and has passed its checks. A new version that won't run is replaced by the one before it.
4. **Nothing else on the computer changes what a Home runs.** Editing a checkout, `pnpm i`, `pnpm build`, or an agent committing to main changes nothing until an update switches over.
5. **One command or one click, and no flags.** Creating a Home also keeps it running. There is no separate "start at login" or "install service" step. Flags exist only for the unusual case: another folder, a second Home, building from source (section 4.1).
6. **Everything Ri installs stays current with it.** Its skills, the `ri` command and the connections it sets up for other agents are refreshed by each update, never left behind (section 9).
7. **One place to look.** The desktop app, the CLI and the browser show the same status: running or not, which version (this computer's and its Home's), when it last restarted and why, and what an update is waiting for.

## 3. The model

### 3.1 Terms

| Term | Meaning |
| --- | --- |
| **Installation** | Ri's software for one person on one computer: its releases, the `ri` command, the skills it installs for other agents, and the update settings. The desktop app, the install script and a source checkout all produce the same installation, so a computer has one per OS user. |
| **Release** | One version of Ri, complete and unchanging: Node, the server, the CLI, the migrations and the shipped skills, with a manifest of every file (today's runtime: `node/`, `server/`, `runtime-manifest.json`). |
| **Origin** | Where the installation gets releases. Normally **published** releases, on the `stable` channel (or `latest`). For contributors, **a checkout** that Ri builds when asked (section 8). |
| **Home** | A folder Ri runs from. What it is (a personal Home, a team Home, or a connected device) is recorded inside the folder, not given on the command line (section 3.3). Most installations run one, and some run several. |
| **Controller** | One small long-lived process per Home (`src/service/main.ts`). The OS keeps it running. It holds the Home's owner lock and control socket and runs updates. |
| **Server** | The Home's web server (`dist/service/http-server.cjs`), run and watched by the controller. It serves the Home's pages, so every window showing a Home runs that Home's version of the interface. Agent chats run as its children. |

### 3.2 Software belongs to the computer, data belongs to the folder

The usual case for sharing is the desktop app and the CLI on one computer. They are two ways into the same software, so they should never hold two copies, update on two schedules, or disagree about versions. A second Home on the same computer, like the owner's team Home, is the rarer case, and it falls out of the same design.

Today each Home keeps its own copy of the software under `Application Support/Ri/runtime/<home id>/` (`getRuntimeInstallDir` in `src/lib/service/paths.ts`), about 3.3 GB per release. The desktop app's terminal command is a separate `ri-desktop`, and a CLI installed some other way would be a third thing.

In this design:

- An installation has **one release store**: `~/Library/Application Support/Ri/releases/<id>/` on macOS, `~/.local/share/ri/releases/<id>/` on Linux. The desktop app's bundled release, the install script's download and a checkout build all land there.
- It keeps **one record per Home** it runs: the folder, the release the Home runs, the release before that, whether it is supervised, and whether its owner stopped it.
- An update **fetches or builds once, then switches each Home** at its own moment (section 7.2).
- The **`ri` command** is a launcher at `~/.local/bin/ri`, like Claude Code's `~/.local/bin/claude` pointing into its versions folder. Commands about the installation (`ri update`, `ri doctor`, `ri start` on a new folder) run the newest release. Commands about a Home (`ri agent`, `ri status`, `ri logs`) run the release that Home is running. That way the CLI never meets a database newer or older than it expects, which is the migration mismatch `ri agent` hits today when the CLI and the server differ. A chat's own `ri` (`RI_SESSION_CLI`) already pins its server's release, and keeps doing so.

### 3.3 The folder says what it is

When a Home starts, it already decides from the folder alone whether it is a Home, a fresh folder, a connected device, or a Home that was retired (`resolveServiceRole` in `src/lib/service/role.ts`). Whether a Home is personal or a team is recorded in the folder too: `ri team create` writes a team mark, and once the database exists the home row's `kind` holds it (`src/lib/home/authority.ts`). So keeping a Home running needs only the folder, and never a "personal" or "team" flag.

### 3.4 Which Home a command means

Because the installation keeps a record of its Homes, a command doesn't need to be told where the Home is:

- With one Home, every command acts on it, wherever its folder is.
- With no Home, `ri start` creates one in `~/ri`.
- With several Homes, commands about one Home act on the personal Home, `ri status` and `ri update` cover all of them, and `--root` picks another.

`--root` is therefore needed only to create a Home somewhere other than `~/ri`, or to point a command at a second Home. Today every command assumes `~/ri` unless `RI_ROOT` or `--root` says otherwise (`getAppRoot` in `src/lib/config/paths.ts`).

## 4. Commands and desktop surfaces

### 4.1 CLI

Everyday commands take no flags:

| Command | What it does |
| --- | --- |
| `ri start` | Makes sure the Home is running and stays running. With no Home yet, it creates a personal Home in `~/ri`. If the Home exists but isn't supervised (a foreground run, an older unsupervised service, or a Home made before this design), the same command takes it over. Prints the address and, for a new Home, the pairing link. |
| `ri team create` | Creates a team Home and keeps it running. Prints the setup link (unchanged otherwise). |
| `ri connect <link>` | Connects this computer to a Home elsewhere (unchanged). If it is enrolled to run agents, its worker is kept running the same way. |
| `ri status` | Running or stopped, this computer's version and each Home's, running since, the last restart and its reason, supervision, and the update state. |
| `ri update` | Updates now. It fetches the newest release and switches each Home immediately if it's idle. If a Home is busy, it says what is running and switches it when that finishes. |
| `ri restart` | Restarts at the next idle moment, and says so if something is running. |
| `ri stop` | Stops the Home and keeps it stopped, across restarts too, until `ri start` (section 6.4). |
| `ri logs` | The Home's service log. |
| `ri doctor` | Checks the installation, the OS settings that decide whether Homes come back (section 6.5), and everything Ri installed outside its folders (section 9). |

Flags exist only for the unusual case:

| Flag | When |
| --- | --- |
| `--root DIR` on any command | Create a Home somewhere other than `~/ri`, or point a command at a second Home (section 3.4). |
| `ri update --now`, `ri restart --now` | Don't wait for running chats. |
| `ri update --rollback` | Go back one release (section 7.6). |
| `ri update --from <checkout>` and `--from published` | Contributors only: build releases from a checkout, or go back to published ones (section 8). Remembered. |
| `ri update --channel latest\|stable`, `ri update --auto off\|on` | The same settings the desktop app shows. Remembered. |
| `ri start --foreground` | Today's `ri start`, for debugging. It refuses a Home that is supervised. |

The `ri service ...` commands stay as the detailed form (`status` as JSON, `awake`, `configure`, `worker stop|resume`, `install`, `uninstall`), so existing scripts keep working. `ri service install` becomes the takeover step that `ri start` runs, and `ri service uninstall` removes supervision while keeping the data, as it does today.

### 4.2 Desktop app

- **First run.** "Use this computer as your Home" creates the Home and keeps it running in one step. "Connect to your Home" pairs, as today. Advanced lets someone choose the folder or create a team. Nobody has to find a separate "Start at Login" choice.
- **Update ready.** When a new version has downloaded, a quiet notice offers **Restart now**, **When idle** and **Later**. **When idle** is what happens if nobody chooses, so the standard case needs no click. **Later** waits until the app next starts. Restarting replaces both the window and the Home's software: the window relaunches in a second or two, and the Home switches as in section 7.4.
- **Settings, This computer.** Shows the same status as `ri status`, including "This app 0.4.2, your Home 0.4.2". A "Keep Ri running on this computer" switch is on for every Home, and turning it off removes supervision. "Add `ri` to Terminal" writes the launcher, adds `~/.local/bin` to the shell's PATH if needed, and says what it changed.
- **Settings, Updates** (`src/components/settings/sections/updates-section.tsx`). Shows "Up to date", or the update-ready notice with its three choices, plus the automatic updates switch and, under Advanced, the channel.
- **App menu.** "Check for Updates…", the Mac convention.
- **Opening the window at login** is a separate, optional preference. It's for convenience and has nothing to do with whether the Home is up.
- **Removed:** Tools > Start at Login… / Disable Start at Login… (replaced by the switch) and Tools > Install terminal command, which today writes `~/.local/bin/ri-desktop` (replaced by "Add `ri` to Terminal", which installs the same `ri` the install script does).

### 4.3 Browser

A browser tab shows a Home's pages, so it runs whatever version that Home served when the tab loaded. When the Home moves to a new version:

- A tab you're looking at shows **"Ri was updated. Refresh"**, and doesn't reload by itself, so nothing you're reading or typing is interrupted. Refreshing first saves drafts the way a reload does today (`reloadVersion` in `src/lib/client/version-reload.ts`).
- A tab in the background saves its drafts and reloads by itself, so it is current when you come back to it.
- A tab whose version can no longer talk to the Home (the API protocol check, `apiCompatibilityIssue`) can't keep working. It shows the same notice, which can't be dismissed.

Today every open viewer saves its drafts and reloads by itself as soon as the build changes (`ServiceConnection` in `src/components/desktop/service-connection.tsx`, mounted in `src/app/layout.tsx`). The desktop window shows a Home's pages too, so it follows the same rule, and updating its shell is section 4.2.

## 5. Installing

There are three ways in, all producing the same installation:

1. **The desktop app** carries a release inside it. On first launch it moves that release into the installation's store, unless the store already holds a newer one, because an app never downgrades an installation.
2. **The install script**, for Mac and Linux: `curl -fsSL <install url> | sh`. It detects the platform and downloads the newest published release on the `stable` channel (or the channel passed to it). It checks the release's signature and every file's checksum, stores it, writes `~/.local/bin/ri`, and adds that folder to the PATH if needed. It installs software only and ends with "Run `ri start`". It never asks questions, since `curl | sh` has no usable input on an SSH session.
3. **A source checkout**, for contributors: `pnpm cli:dev update --from .` builds a release from the checkout (section 8) and installs it. From then on, plain `ri`.

A computer with both the desktop app and the script ends up with one installation, not two.

## 6. Keeping a Home running

### 6.1 Two levels of supervision

The OS supervises the controller, and the controller supervises the server.

- **Only the OS** survives a reboot, a power cut and the death of every Ri process. It starts the controller at boot or login and restarts it if it exits with an error.
- **Only the controller** knows whether an exit was planned, whether the server is answering, how much memory it is using, and whether a crash came right after an update. So it restarts the server itself instead of exiting. Today it exits so the OS can restart it (`child.once('exit')` in `src/service/main.ts`). Restarting in the controller is faster, keeps the control socket up so status is visible during a restart, and works on Windows, where Task Scheduler can't see a crashed child (section 6.6).

### 6.2 When the controller restarts the server

| Trigger | What happens |
| --- | --- |
| The server exits without being asked to | Restart after 1 s, then 5 s, 15 s and 60 s, then every 5 minutes. The delay resets after 10 healthy minutes. |
| The server stops answering | The controller probes `/__ri_ready` every 15 s with a 10 s timeout. After 3 minutes without a successful probe it kills the server's process group and restarts it. The probe runs on the server's event loop, so a frozen loop fails it while an ordinary 2 s stall doesn't. Startup has its own deadline (three minutes today) instead, extended while migrations are running. |
| The server's JavaScript heap passes 75% of its limit | Restart at the next idle moment. |
| The heap passes 90% of its limit | Drain for 15 s, then restart, even if chats are running, because a crash at the limit is worse. The reason is recorded. |
| 5 unexpected exits within 15 minutes | Stop restarting. The controller stays up with its diagnostics, `ri status` and the desktop app say why, and an update rollback may apply (section 7.6). |

The ready probe reports the heap in use, the heap limit and the resident memory. The perf log's minute rollups record the same three numbers, so `ri perf` shows memory over days and the heap limit seen in section 1 can be told apart from a leak.

### 6.3 Running work

Agent chats run as children of the server. This spec was written in a chat running under the production server. A restart ends them. So planned restarts (updates, the 75% memory restart, `ri restart`) wait until the Home is idle, and only crashes, hangs and the 90% memory limit interrupt work.

Recovery after an interrupting restart stays as it is today:
- At startup, the server catches each chat up from its transcript on disk. A message that never got a reply is sent again, at most once every 3 minutes per chat (`reconcileAllSessions` from `instrumentation.ts`, with the redispatch throttle in `src/lib/executor/health.ts`).
- A chat whose previous harness hasn't confirmed it stopped asks to be restarted.

Phase B adds one requirement: every chat that was interrupted and not sent again shows as needing the person (unread), so nothing is dropped silently. Phase B's acceptance checks this against a real interrupted chat, because the unread state hasn't been confirmed for every case. Moving agent work out of the server, so restarts never interrupt it, is future work (section 13).

### 6.4 Stopping

`ri stop`, "Stop" in the desktop app, and turning off "Keep Ri running" are the only ways a Home stays down:

- **Stop** records that the owner stopped it. At the next boot or login the controller sees the record and exits successfully, so the OS doesn't restart it. `ri start` clears the record. A person who stopped their Home had a reason, and having it come back after a restart would surprise them. Status shows "Stopped by you at …" so a forgotten stop is visible.
- **Turning off supervision** removes the OS job and keeps every file.

### 6.5 What the OS decides, and what Ri checks

| OS | Supervisor | Starts after a reboot | Ri checks and says |
| --- | --- | --- | --- |
| macOS | Per-user LaunchAgent `app.ri.service.<id>`, as today | When the user logs in | If automatic login is off: after a restart or power cut, the Home waits until someone logs in. If FileVault is on: after an unplanned restart nothing starts until someone unlocks the disk, and planned restarts can use `sudo fdesetup authrestart`. Whether the Mac restarts after a power failure (`pmset autorestart`), and whether it sleeps (keep-awake already exists: `ri service awake`). |
| Linux | systemd user unit, as today | At boot only with lingering on | If linger is off, prints the one command to fix it (`sudo loginctl enable-linger $USER`), since Ri can't run `sudo` quietly. |
| Windows | Task Scheduler (section 6.6) | At boot and at logon | n/a until built |

Both `ri doctor` and Settings also warn when free disk space drops below the larger of 20 GiB or the database's size, because a full disk takes a Home down whatever supervises it.

A Mac that must serve before anyone logs in would need a system LaunchDaemon. That process couldn't reach the user's login keychain, where harnesses keep their sign-ins. It isn't planned (section 13).

### 6.6 Windows (later)

Windows uses a Scheduled Task running as the user, triggered at boot and at logon, that runs the controller. This is OpenClaw's approach. Because the controller restarts the server itself, the task only has to keep the controller alive, which avoids Hermes's gap where a crashed gateway stays down on Windows. It also needs Windows release builds (`node-pty`, `better-sqlite3`), which the packager doesn't produce yet.

## 7. Updating

### 7.1 Automatic by default

Automatic updates are on for every installation, with an off switch (Settings, or `ri update --auto off`):

- The installation checks for a new published release when a controller starts and every 6 hours after that, as the updater does today.
- A new release downloads in the background, along with the desktop app's new shell if the app is installed. Today a downloaded update waits for someone to approve it (`approve` and `tick` in `src/lib/service/update.ts`), and the shell updater doesn't download on its own (`autoDownload = false` in `desktop/shell-update.ts`).
- When the new release takes effect depends on what is running (section 7.2).
- If a Home hasn't been able to switch for 24 hours, `ri status` and Settings say what it is waiting for ("2 chats running") and offer to update now.
- The CLI prints one line when an update is ready but waiting, and one line after a Home has moved ("Updated ~/ri to 0.4.2"), like Claude Code's update notices. It stays quiet otherwise.

Automatic updates apply to published releases only. A checkout builds only when asked (section 8).

### 7.2 When a downloaded release takes effect

| What | When it moves to the new release |
| --- | --- |
| The `ri` command | At its next run. The launcher points at the newest release, the same as Claude Code taking effect at its next start. |
| A Home with the desktop app on its computer | When the person picks on the update-ready notice: Restart now, When idle (what happens if nobody chooses) or Later (section 4.2). |
| A Home run from the CLI, usually a server nobody sits at | At the server's next start (a reboot, `ri restart`, or a memory or crash restart), or in its first idle moment between 3 and 5 a.m. Home time, whichever comes first. A supervised Home can run for weeks without restarting, so waiting only for a start could leave it on an old version indefinitely, security fixes included. |
| A browser tab | When its person refreshes, or on its own if it's in the background (section 4.3). |
| A connected computer | When its Home moves (section 7.7). |

"Idle" means what it means to the coordinator today (`UpdateCoordinator.apply` in `src/lib/service/update.ts`): no chats running, no permission waiting on someone, no terminals or previews the server owns, no requests in flight. An optional maintenance window still narrows when that can happen (`ri update when-idle --hour`).

### 7.3 Channels

Published releases come on two channels, matching Claude Code's names, which are the ones people already know:

- **`stable`** is the default.
- **`latest`** gets every release as it ships.

The existing preference allows `stable` and `beta` (`src/lib/service/update-settings.ts`). `beta` is renamed `latest` while nothing is published.

### 7.4 Switching a Home to a new release

The steps are those of `UpdateCoordinator.apply` today, with the checkpoint made proportional:

1. Wait until the Home is idle, then drain new work and in-flight requests (existing).
2. Stop the server (existing).
3. **Snapshot only what the release can change.**
   - The config folder is always copied. It's small, and a release may write a newer config format.
   - The database is snapshotted only when the release has migrations this database hasn't applied, found by comparing the release's migration journal with `__drizzle_migrations`. On macOS that's an instant APFS clone of the stopped database file (`clonefile`). Elsewhere it's SQLite's backup API.
   - Attachments and the work folder are never copied, because no release migrates them.
   - Today's checkpoint copies every file under the root, config and work folders, plus the database, on every update (`createCheckpoint` in `src/lib/service/checkpoint.ts`). For the owner's Home that is a 19.6 GiB database plus everything else, on a disk with 24 GiB free.
4. Boot the new release in validation mode and check the database (existing).
5. **Commit, point the Home at the new release, and start it** (existing). The controller itself belongs to the release, so it hands over by exiting with code 75. The launcher runs the controller in a loop that starts the next release's controller at once on that code. That way launchd's 30-second relaunch throttle (`ThrottleInterval`) never adds to the downtime.
6. **Refresh what the release installs** (section 9).
7. **Watch the first 10 minutes.** If the new release crash-loops (section 6.2), section 7.6 applies.

A typical update without migrations is a drain, a stop and a start: seconds of downtime, and no copies.

### 7.5 Keeping releases

The store keeps every release a Home is on or would roll back to, plus the newest one. It deletes the rest after each switch, as Claude Code keeps the two newest versions plus any in use.

Releases never change after staging, so staging hard-links every file whose checksum matches a file already in the store. A release that changes only code then costs only its changed files, not another 3.3 GB.

### 7.6 Rollback

- **A release without migrations** that crash-loops in its first 10 minutes is rolled back automatically. The Home's pointer goes back to the previous release, with no data at risk.
- **A release with migrations** that crash-loops is not rolled back automatically. Restoring the snapshot would throw away whatever the Home wrote since the switch. Instead the Home stops in a failed state that explains this, and `ri update --rollback` restores it after listing what would be lost (chats, tasks and notes changed since the switch).
- `ri update --rollback` on a healthy Home goes back one release, with the same rule.

### 7.7 Keeping versions aligned

Several things have a version, and this design keeps them in step:

| Pair | How they stay aligned |
| --- | --- |
| A Home and the pages it shows | Always the same, because the Home's server serves them. A tab loaded before an update is handled by section 4.3. |
| The desktop app and a Home on the same computer | The same installation, so one update covers both, and the update-ready notice restarts both together. |
| The `ri` command and a Home | Commands about a Home run that Home's release (section 3.2). |
| A connected computer and its Home elsewhere (a laptop and the Mini) | The connected computer follows its Home. When the Home moves to a new version, the computer's installation fetches that same version from the published releases and switches (with the desktop app's update-ready notice, if it has one). It doesn't move ahead of its Home on its own schedule. |

The exception is a Home on a version that isn't published, such as one built from a checkout. A connected computer can't fetch that version, so it keeps its own. The existing compatibility contract (`src/lib/releases/compatibility.ts`) then decides whether the two still work together, and keeps a Home from switching to a release its connected computers can't speak to. Both versions show in `ri status` and Settings, and so does which one needs updating.

The pieces exist today: `/api/version` returns the Home's release and API protocols, and connected workers negotiate their protocol (`negotiateWorker`). A Home could also hand its own release to its connected computers. That would align source-built setups too, and is future work.

## 8. Building from a checkout

This origin is for contributors and the owner's own Homes. It produces the same kind of release as a published one, made with the same packaging script, so the owner's Home exercises the path every user gets. It is manual only: `ri update` builds when the owner runs it, and nothing builds on a schedule.

- `ri update --from ~/ai-task-manager` sets the origin, and `ri update --from published` returns to published releases. With a checkout origin, `ri update` builds and then switches as in section 7.4.
- **Which commit.** Ri fetches `origin`. Of the checkout's `main` and `origin/main`, it builds whichever contains the other, which is the newest committed `main`, pushed or not. If they have diverged, it stops and says so. Uncommitted changes are never built.
- **The checkout is never touched.** Not its working tree, its index or its branch. Ri builds in a separate worktree at that commit (`git worktree add --detach`) inside the installation's own build folder. A clean worktree builds with a 15.6 GB peak against 30.7 GB in the full checkout, measured for cd1b09fc.
- **How it builds.**
  - `pnpm install --frozen-lockfile` runs in the worktree. pnpm's store links packages instead of copying them.
  - Packaging uses `desktop/package.mjs --headless`, which runs `next build` through `scripts/next-build.mjs`.
  - The build runs at background priority (`taskpolicy -b` on macOS, `nice` and `ionice` on Linux), so the Homes keep their share of CPU and disk while it runs. A build that needs more memory just takes longer.
  - It is not stopped at a fraction of memory. `scripts/next-build.mjs`'s guard stays at its default (this computer's memory), so it only stops a true runaway like the 150 GB build in section 1.
- **The result.** The release is stored (section 7.5), the worktree is removed, and each Home switches as in section 7.4. The release records its commit, with `source: 'source'` in its identity (`ReleaseIdentitySchema` already has the field), so status reads "main a8eb6398".
- **If the build fails,** the Homes keep running the current release. `ri update` prints the step that failed and the path to its log.

## 9. What Ri installs outside its folders

Ri writes several things outside its own folders, and every one of them must keep working across updates. The rule: **nothing Ri writes outside its folders points into a release folder or a checkout.** Each one points at the `ri` launcher or at a Home's address, and is refreshed when a Home switches releases.

| What | Belongs to | Today | In this design |
| --- | --- | --- | --- |
| **Ri's own skills**, used by every chat a Home runs (`<app-root>/skills`, rendered into `<work>/skills`) | The Home, from its release | Refreshed by the foreground `ri start` (`src/cli/commands/start.ts`), onboarding, `ri skills` and Settings (`installAppRootSkills` in `src/lib/agent-skills/shipped.ts`). The background service never refreshes them, so a desktop or supervised Home keeps its old skills after an update. | Refreshed on every server start, which includes every update. The write is idempotent (it already skips unchanged files), so the cost is near zero. |
| **Global skills**, for every agent on the computer, if the person opted in (each harness's user folder: `~/.claude/skills`, `~/.agents/skills` and the rest, from `globalSkillFolders`) | The installation | Written from one Home's folder and marked with that Home's path, and skipped entirely under the desktop app and the service (the `RI_DESKTOP` check in `src/cli/commands/start.ts`) | Written by the installation from the newest release any of its Homes runs, after that Home switches, so a skill never describes a command the running Home doesn't have yet. The skills call `ri`, which finds the Home itself (section 3.4). |
| **"Connect your agent" entries** (MCP servers in Claude Code, Codex and the other harnesses' user configs, `src/lib/external-ai/local-setup.ts`) | The Home | They point at the Home's local address with its token | Unchanged, because neither the address nor the token changes in an update. `ri doctor` reports an entry that no longer answers. |
| **The `ri` launcher** (`~/.local/bin/ri`) | The installation | The desktop app's `ri-desktop`, or the checkout's own `ri` linked in `~/Library/pnpm/bin` | One launcher, rewritten only when its own format changes |
| **OS jobs** (`app.ri.service.<id>`, `app.ri.home-backup`) | The installation | Point at a per-Home runtime launcher | Point at the installation's launcher (section 10.1) |

## 10. Moving existing installations

### 10.1 Today's per-Home runtime folders

The first controller on the new code moves each `runtime/<home id>/releases/<id>` into the shared store (APFS clone, then delete), keeps that Home's current release as its pointer, and rewrites its LaunchAgent or unit to start through the installation's launcher. The installer already knows how to replace exactly one previous job template (`previousDefinition` in `src/lib/service/install.ts`).

### 10.2 The owner's Mac Mini

Both Homes move once phases A and B (section 12) are on main:

1. In the checkout, run `pnpm cli:dev update --from ~/ai-task-manager`. This builds `main` into a release and installs `ri`. Both Homes keep running as they are.
2. Run `ri start --root ~/ri-team-huffine`. The team's unsupervised controller hands off to a supervised one on the new release, using the handoff `installService` already performs. From now on the installation knows this Home.
3. Stop the personal Home in its terminal window with Ctrl-C, then run `ri start`. This ends every chat running under that server, including any agent chat, so it's for the owner to run, not an agent. No migrations are pending, since the release is built from the same `main`.
4. Remove the checkout's own `ri` link in `~/Library/pnpm/bin`, so `ri` is the launcher.
5. Run `ri status`, then restart the Mini once and confirm both Homes come back without anyone logging in. This is the qualification test for section 2.1.

After that, picking up `main` is `ri update`, which builds once and switches both Homes. The nightly backup job (`pnpm backup install`, `app.ri.home-backup`) keeps working, because it reads the Home's files directly. [environments.md](environments.md) "Production on the Mac Mini" is rewritten when this ships.

## 11. What changes in the code

| Today | Change |
| --- | --- |
| Each Home has its own runtime folder, launcher and update record (`getRuntimeInstallDir` in `src/lib/service/paths.ts`, `src/lib/service/runtime.ts`) | One store per installation, a record per Home, and one `~/.local/bin/ri` launcher (sections 3.2 and 7.5) |
| Every command assumes `~/ri` unless told otherwise (`getAppRoot`) | Commands find the Home from the installation's records (section 3.4) |
| `ri service install` refuses anything but a staged runtime (`definition()` in `src/lib/service/install.ts`) | Supervision runs the installation's launcher for any Home. A checkout becomes an origin, not something a Home runs from |
| Creating a Home doesn't supervise it: `ri team create` calls `startBackgroundService` (`src/cli/commands/team.ts`), `ri start` runs in the foreground (`src/cli/commands/start.ts`), and the desktop app's "Use this device as Home" leaves Start at Login separate (`desktop/main.ts`) | Creating supervises, and `ri start` takes over an unsupervised Home (section 4) |
| The controller exits when the server dies and doesn't probe it (`src/service/main.ts`) | Restarts, hang probe, memory limits and crash-loop handling in the controller (section 6.2). The perf rollups gain memory fields |
| The runtime launcher starts the controller once, and the OS throttles relaunches to one per 30 s | The launcher loops on exit code 75 so a release handover is immediate (section 7.4) |
| A downloaded update waits for approval, and the shell updater doesn't download (`src/lib/service/update.ts`, `desktop/shell-update.ts`) | Automatic download and the timing in section 7.2 |
| Every viewer reloads by itself when the build changes (`ServiceConnection`) | A prompt in a visible tab, a reload in a hidden one (section 4.3) |
| The checkpoint copies the whole Home on every update (`src/lib/service/checkpoint.ts`) | Config always, the database only when migrations are pending (section 7.4) |
| Releases come only from the signed feed (`checkRelease` in `src/lib/service/release.ts`), and no feed is published | A checkout origin, built on request (section 8). Publishing the feed is phase E |
| A connected computer updates on its own schedule | It follows its Home's version (section 7.7) |
| Staging never moves an existing Home to a new release (`stageRuntime`) | Only the coordinator switches a Home, always |
| Releases are never deleted | Retention and hard-linked duplicates (section 7.5) |
| Ri's own skills refresh only on the foreground `ri start`, and global skills are skipped under the service and the desktop app | Refreshed on every server start and after every switch (section 9) |
| The desktop's terminal command is `ri-desktop`, and the user fixes PATH (`desktop/main.ts`) | One `ri` launcher, with the Home's own release for Home commands (section 3.2) |
| Channels are `stable` and `beta` (`src/lib/service/update-settings.ts`) | `stable` and `latest` |
| `ri stop` has no lasting meaning under supervision | A recorded stop that survives restarts (section 6.4) |
| `ri doctor` doesn't check the OS settings that decide restarts (`src/cli/commands/doctor.ts`) | The checks in section 6.5 and section 9 |
| Installing supervision throws on anything but macOS and Linux | Task Scheduler adapter, phase E |

## 12. Build order

Each phase lands on main with its tests. The owner's Homes move after phase B. Phases A and B need nothing published.

**A. Installation and releases.** The shared store, the per-Home records and finding a Home without `--root`, moving today's layout (section 10.1), the launcher and its release choice, retention and hard links, the checkout origin, `ri update` (including `--now` and `--rollback`), the proportional checkpoint, and section 9's skill refresh.
Tests:
- Commit selection against a fixture repository (ahead, behind, diverged, uncommitted changes).
- Retention and hard links.
- Snapshot only with pending migrations.
- The launcher's release for Home and installation commands, and Home lookup with zero, one and several Homes.
- Rollback with and without migrations.
- Skills refreshed after a switch, with global skills from the newest running release.

Acceptance: build `main`, switch two Homes, roll one back, account for the disk used, and confirm the skills in `<app-root>/skills` and `~/.claude/skills` match the release.

**B. Supervision.**
- Creating a Home supervises it.
- `ri start`, `stop`, `restart`, `status` and `logs` as in section 4.1.
- The controller's restart policy, hang probe, memory limits, crash-loop handling and handover loop.
- The recorded stop, memory in the perf log, and the `ri doctor` checks.

Tests: the restart policy with fake timers, plus `desktop/service-lifecycle-smoke.ts` extended to cover each trigger.

Acceptance:
- `kill -9` on the server: back within 10 s.
- `kill -STOP` on the server: restarted within 4 minutes.
- A server forced past 90% of its heap: restarted with the reason recorded.
- An interrupted chat after a restart: sent again, or shown as unread (section 6.3).
- Restart the Mini: both Homes back without a login.
- A Linux VM with linger on: back after a reboot without a login.

**C. Automatic updates and alignment.**
- Automatic download and the timing in section 7.2, including the night window for CLI Homes.
- The 24-hour waiting notice, `stable` and `latest`, and the shell updater following the setting.
- The CLI's one-line notices, the browser's refresh prompt (section 4.3), and connected computers following their Home (section 7.7).

Acceptance, against a test feed:
- An idle CLI Home updates in its night window.
- A desktop Home follows Restart now, When idle and Later.
- A busy Home waits and says why.
- A connected computer follows its Home.
- A release that crash-loops without migrations rolls itself back.

**D. Desktop surfaces.** First run that creates and supervises, the update-ready notice, Settings This computer and Updates, "Add `ri` to Terminal", "Check for Updates…", and removing the old Tools items.

Acceptance: a fresh Mac account goes from first launch to a supervised Home in one click, survives a restart, and updates from the notice.

**E. Distribution.** The install script, a published feed with signing and the CI release matrix (macOS arm64 and x64, Linux arm64 and x64, already declared in CI), and the Windows Scheduled Task adapter with Windows release builds.

Acceptance: an SSH-only Linux server goes from `curl … | sh` and `ri start` to a paired Home that updates itself.

## 13. Decisions and open questions

**Decided:**

- The OS supervises the controller, and the controller supervises the server. No other daemon.
- Supervision is part of being a Home, never a separate step, with an off switch.
- The standard case takes no flags. Commands find the Home themselves, and flags are for another folder, a second Home, source builds and rare settings.
- One installation per computer, shared by the desktop app and the CLI. Releases belong to it, Homes point at them, and the folder says what kind of Home it is.
- Everything Ri installs outside its folders (skills, the launcher, agent connections, OS jobs) belongs to the installation or the Home and is refreshed by updates (section 9).
- A Home runs an unchanging release and moves only through the update switch, including for the owner.
- Published releases update automatically:
  - the `ri` command at its next run
  - a desktop Home when its person chooses (When idle if nobody does)
  - a CLI Home at its next start, or overnight when idle
  - browser tabs when refreshed, prompted by a notice
- A connected computer follows its Home's version.
- Source builds happen only when the owner runs `ri update`. They run at background priority, and are never stopped at a fraction of memory, only on a true runaway.
- Snapshots match the change: config always, the database only with migrations.
- Automatic rollback only when no data could be lost.
- Interrupted chats are recovered as they are today: replayed from their transcript or sent again. Any that aren't show as unread for the person to restart.
- Channels are `stable` and `latest`.
- The command is `ri`. The installer puts `~/.local/bin` before `/usr/bin` (where macOS ships Ruby's `ri`), and `ri doctor` warns when `ri` resolves elsewhere.
- A stop survives restarts.

**Open, or future work:**

1. **Agent work outside the server.** Chats are children of the server, so every server restart ends them. Moving the agent runners into the controller, or into their own supervised process, would let updates and memory restarts happen without waiting for idle or interrupting anything. This is future work, after this spec.
2. **Publishing.** The owner will choose the hosting. Nothing in phases A or B depends on it. What does depend on it:
   - Before phase C: a download address to keep. The feed's address is written into every installation (`release-policy.json`), so changing it later means migrating every installation. Also a release signing key: the format already expects an Ed25519 key.
   - Before the desktop app goes to anyone else: a Developer ID. macOS opens an unsigned downloaded app only after a warning, and the desktop updater can't apply an update to an unsigned Mac app. This is the same Developer ID decision already open for notifications.
3. **The night window for CLI Homes** (section 7.2). Is 3 to 5 a.m. Home time the right default, and is it wanted at all? The alternative is waiting only for the next start.
4. **A Home handing its release to its connected computers,** so source-built setups stay aligned too (section 7.7).
5. **Windows.** Native first, or WSL first, as OpenClaw supports both?
6. **Before-login Macs.** A system LaunchDaemon for Macs that must serve before anyone logs in. Not planned, and it can't reach the login keychain.
7. **Backups.** The nightly backup is an owner-only launchd job (`pnpm backup install`). Whether every Home should get one, kept by the same controller, is a separate decision.

## 14. Prior art

- **OpenClaw:**
  - `openclaw onboard --install-daemon` and `openclaw gateway install` set up a LaunchAgent (`ai.openclaw.gateway`), a systemd user unit with lingering, or a Windows Scheduled Task with boot and logon triggers.
  - Its Mac app doesn't run the gateway. It connects to it or enables the launchd job.
  - `openclaw update --channel dev` builds a git checkout of main and restarts the gateway, but needs a clean worktree, and the docs warn against running main in production.
  - Docs: [Windows](https://docs.openclaw.ai/platforms/windows.md), [macOS app](https://docs.openclaw.ai/platforms/mac/child-process), [updating](https://docs.openclaw.ai/install/updating.md), [development channels](https://docs.openclaw.ai/install/development-channels).
- **Hermes Agent:**
  - `hermes gateway install` sets up a launchd agent with `RunAtLoad` and `KeepAlive`, a systemd user unit with lingering, or `--system` for servers.
  - On Windows it uses a logon task that doesn't restart a crashed gateway.
  - A built-in watchdog exits with code 75 when the event loop stops, so the supervisor restarts it.
  - `hermes update` pulls and restarts through the service manager, and `hermes gateway restart` drains running turns first.
  - Docs: [messaging gateway](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/), [updating](https://hermes-agent.nousresearch.com/docs/getting-started/updating).
- **Claude Code:**
  - The native installer's `~/.local/bin/claude` is a symlink into `~/.local/share/claude/versions/`.
  - It checks for updates at startup and periodically, installs them in the background, and they take effect at the next start.
  - `claude update` updates now, `autoUpdatesChannel` picks `latest` or `stable`, and `DISABLE_AUTOUPDATER` turns the background check off.
  - It keeps the two newest versions plus any in use, and publishes a signed manifest of checksums.
  - Docs: [setup and updates](https://code.claude.com/docs/en/setup).
- **Codex CLI:** `codex update` finds how Codex was installed and runs the matching upgrade, and the terminal UI shows a banner when a newer version exists ([community write-up](https://codex.danielvaughan.com/2026/05/08/codex-cli-codex-update-self-update-command/)).
