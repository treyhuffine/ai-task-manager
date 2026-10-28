# Always on, always current: installing, running and updating Ri

**Status:** decided 2026-10-27, revised 2026-10-28 after an independent review (section 13.3 lists what changed). Nothing here is built yet. Every choice phases A and B need is settled, and what stays open belongs to later phases or future work. Section 11 lists what changes in the current code, and section 12 the order to build it in.

**Promise:** once Ri is installed and a Home is created, it is running whenever its computer is on. It updates itself, along with everything it installs (its skills included), and a person never has to restart, babysit or rebuild it. A bad update undoes itself without losing work. This holds for the desktop app and the CLI, on a laptop, a Mac Mini in a closet, or a Linux server reached only over SSH. The standard case takes no flags.

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

The build itself was also a resource hazard until 2026-10-27: a full-checkout `next build` could pass 150 GB and freeze the computer. That is fixed. cd1b09fc removed the paths that caused it, and `scripts/next-build.mjs` now stops a runaway build (past 64 GB by default, `RI_BUILD_MEMORY_LIMIT_GB`). It matters here because this spec builds releases on the same computer that runs the Homes.

## 2. What a person can count on

1. **It runs whenever the computer is on.** After a crash, a hang, running out of memory, a reboot or a power cut, the Home comes back by itself. A Home that keeps crashing keeps retrying, more slowly, and says why (section 6.2). The only things that keep it down are the OS (section 6.5) and a stop its owner asked for (section 6.4).
2. **It stays current by itself.** New versions download in the background and take effect at a moment that doesn't interrupt anyone (section 7.2), the way Claude Code updates itself. Updating now is one command or one click.
3. **An update costs seconds, and a bad one undoes itself.** The old version keeps serving until the new one has been fetched or built. A new version that won't start is replaced by the one before it, with the Home exactly as it was before the update (section 7.6).
4. **Nothing else on the computer changes what a Home runs.** Editing a checkout, `pnpm i`, `pnpm build`, or an agent committing to main changes nothing until an update switches over.
5. **One command or one click, and no flags.** Creating a Home also keeps it running. There is no separate "start at login" or "install service" step. Flags exist only for the unusual case: another folder, a second Home, building from source (section 4.1).
6. **A Home keeps its address.** Taking over a running Home, restarting it and updating it never change the address that browsers, phones, the tunnel and connected agents use (section 10.3).
7. **Everything Ri installs stays current with it.** Its skills, the `ri` command and the connections it sets up for other agents are refreshed by each update, never left behind (section 9).
8. **One place to look.** The desktop app, the CLI and the browser show the same status: running or not, which version (this computer's and its Home's), when it last restarted and why, and what an update is waiting for.

## 3. The model

### 3.1 Terms

| Term | Meaning |
| --- | --- |
| **Installation** | Ri's software for one person on one computer: its releases, the `ri` command, the skills it installs for other agents, and the update settings. The desktop app, the install script and a source checkout all produce the same installation, so a computer has one per OS user. |
| **Release** | One version of Ri, complete and unchanging: Node, the server, the CLI, the migrations and the shipped skills, with a manifest of every file (today's runtime: `node/`, `server/`, `runtime-manifest.json`). |
| **Origin** | Where the installation gets releases. Normally **published** releases, on the `stable` channel (or `latest`). For contributors, **a checkout** that Ri builds when asked (section 8). |
| **Home** | A folder Ri runs from. What it is (a personal Home, a team Home, or a connected device) is recorded inside the folder, not given on the command line (section 3.3). Most installations run one, and some run several. |
| **Launcher** | A small shell script that never changes between releases. The OS starts it, and it starts the right release's controller, and puts the previous one back if a new one won't start (section 7.4). |
| **Controller** | One long-lived process per Home (`src/service/main.ts`), started by the launcher. It holds the Home's owner lock, control socket and its own update journal, and runs updates. |
| **Server** | The Home's web server (`dist/service/http-server.cjs`), run and watched by the controller. It serves the Home's pages, so every window showing a Home runs that Home's version of the interface. Agent chats run as its children. |

### 3.2 Software belongs to the computer, data belongs to the folder

The usual case for sharing is the desktop app and the CLI on one computer. They are two ways into the same software, so they should never hold two copies, update on two schedules, or disagree about versions. A second Home on the same computer, like the owner's team Home, is the rarer case, and it falls out of the same design.

Today each Home keeps its own copy of the software under `Application Support/Ri/runtime/<home id>/` (`getRuntimeInstallDir` in `src/lib/service/paths.ts`), about 3.3 GB per release. The desktop app's terminal command is a separate `ri-desktop`, and a CLI installed some other way would be a third thing.

In this design:

- An installation has **one release store**: `~/Library/Application Support/Ri/releases/<id>/` on macOS, `~/.local/share/ri/releases/<id>/` on Linux. The desktop app's bundled release, the install script's download and a checkout build all land there. Only the unchanging release files are shared. Writable caches (Next's cache, today linked from inside the release) live with each Home.
- It keeps **one record per Home** it runs: the folder, the release the Home runs, the release before that, a release waiting to activate, whether it is supervised, and whether its owner stopped it.
- **Each Home keeps its own controller and its own update journal** (today's `update.json`), as today. Homes update independently. They share only the store, under one lock (section 7.5).
- An update **fetches or builds once, then switches each Home** at its own moment (section 7.2).
- The **`ri` command** is a launcher at `~/.local/bin/ri`, like Claude Code's `~/.local/bin/claude` pointing into its versions folder. Commands about the installation (`ri update`, `ri doctor`, `ri start` on a new folder) run the newest release. Commands about a Home (`ri agent`, `ri status`, `ri logs`) run the release that Home is running. That way the CLI never meets a database newer or older than it expects, which is the migration mismatch `ri agent` hits today when the CLI and the server differ. A chat's own `ri` (`RI_SESSION_CLI`) already pins its server's release, and keeps doing so.

### 3.3 The folder says what it is

When a Home starts, it already decides from the folder alone whether it is a Home, a fresh folder, a connected device, or a Home that was retired (`resolveServiceRole` in `src/lib/service/role.ts`). Whether a Home is personal or a team is recorded in the folder too: `ri team create` writes a team mark, and once the database exists the home row's `kind` holds it (`src/lib/home/authority.ts`). So keeping a Home running needs only the folder, and never a "personal" or "team" flag.

### 3.4 Which Home a command means

- **`ri start` and `ri team create` act on a folder:** `~/ri` unless `--root` names another, as today. `ri start` creates a Home there or takes over the one there, so it never picks a different Home than the folder it names.
- **Every other command about one Home** (`ri status`, `ri logs`, `ri stop`, `ri restart`, `ri agent`) finds it from the installation's records. With one Home, it acts on that Home wherever its folder is. With several, it acts on the personal Home, and `--root` picks another.
- **`ri status` and `ri update`** cover every Home the installation runs.

`--root` is therefore needed only to create or take over a Home somewhere other than `~/ri`, or to point a command at a second Home. Today every command assumes `~/ri` unless `RI_ROOT` or `--root` says otherwise (`getAppRoot` in `src/lib/config/paths.ts`).

## 4. Commands and desktop surfaces

### 4.1 CLI

Everyday commands take no flags:

| Command | What it does |
| --- | --- |
| `ri start` | Makes sure the Home in `~/ri` is running and stays running. With no Home there yet, it creates a personal Home. If one exists but isn't supervised (an older unsupervised service, or a Home made before this design), the same command takes it over and keeps its address (section 10.3). A Home running in a terminal is stopped there first, with Ctrl-C, as today. Prints the address and, for a new Home, the pairing link. |
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
| `--root DIR` | Create or take over a Home somewhere other than `~/ri`, or point a command at a second Home (section 3.4). |
| `ri update --now`, `ri restart --now` | Don't wait for running chats. |
| `ri update --rollback` | Go back one release (section 7.6). |
| `ri update --from <checkout>` and `--from published` | Contributors only: build releases from a checkout, or go back to published ones (section 8). Remembered. |
| `ri update --channel latest\|stable`, `ri update --auto off\|on` | The same settings as Settings > Updates. Remembered. |
| `ri start --foreground` | Today's `ri start`, for debugging. It refuses a Home that is supervised. |

The `ri service ...` commands stay as the detailed form (`status` as JSON, `awake`, `configure`, `worker stop|resume`, `install`, `uninstall`), so existing scripts keep working. `ri service install` becomes the takeover step that `ri start` runs, and `ri service uninstall` removes supervision while keeping the data, as it does today.

### 4.2 Desktop app

- **First run.** "Use this computer as your Home" creates the Home and keeps it running in one step. "Connect to your Home" pairs, as today. Advanced lets someone choose the folder or create a team. Nobody has to find a separate "Start at Login" choice.
- **Updates.** A Home on this computer updates by the rule in section 7.2, the same rule as everywhere else: the heads-up shows in the app's window, with **Not now** and **Update now**. A Ri update usually changes only pages and server code, and those reach the window through the Home with no app download. The app's own part (its three screens, menus, Quick Capture, notifications and the bridge between the pages and the Mac) downloads only when its own files changed.
  - **The Home is on this computer.** A changed app part comes with the Home's update, and the window relaunches as part of that same restart. If the Home's pages need a native bridge version the app doesn't have, the window says "Update the Ri desktop app to keep using this Ri", with **Restart now** (the check `assertLocalBridge` in `desktop/viewer-trust.ts` already makes).
  - **The Home is elsewhere.** A changed app part downloads in the background and takes effect the next time the app starts, the way Claude Code does. A remote Home's pages get no native bridge at all (`desktop/backend.ts` returns the remote session before the bridge check), so there is no bridge version to keep in step.
  - The app updating itself on macOS needs a signed app (section 13.2, open question 2). Until then a locally built app is rebuilt by hand, as today.
- **Settings, This computer.** Shows the same status as `ri status`, including "This app 0.4.2, your Home 0.4.2". A "Keep Ri running on this computer" switch is on for every Home, and turning it off removes supervision. "Add `ri` to Terminal" writes the launcher, adds `~/.local/bin` to the shell's PATH if needed, and says what it changed.
- **Settings, Updates** (`src/components/settings/sections/updates-section.tsx`). Shows "Up to date", or what a downloaded update is waiting for ("Waiting for 2 chats to finish"), with **Update now**. Also holds the automatic updates switch and, under Advanced, the channel.
  - This section belongs to the Home's own Settings, not to the desktop app. Like every page, it comes from the Home, so it shows the same in a browser, on a phone or in the app.
  - Who can change it is section 7.1.
- **App menu.** "Check for Updates…", the Mac convention.
- **Opening the window at login** is a separate, optional preference. It's for convenience and has nothing to do with whether the Home is up.
- **Removed:** Tools > Start at Login… / Disable Start at Login… (replaced by the switch) and Tools > Install terminal command, which today writes `~/.local/bin/ri-desktop` (replaced by "Add `ri` to Terminal", which installs the same `ri` the install script does).

### 4.3 Browser

A browser tab shows a Home's pages, so it runs whatever version that Home served when the tab loaded. When the Home moves to a new version:

- A tab you're looking at shows **"Ri was updated. Refresh"**, and doesn't reload by itself, so nothing you're reading or typing is interrupted. Refreshing first saves drafts the way a reload does today (`reloadVersion` in `src/lib/client/version-reload.ts`).
- A tab in the background saves its drafts and reloads by itself, so it is current when you come back to it.
- A tab whose version can no longer talk to the Home (the API protocol check, `apiCompatibilityIssue`) can't keep working. It shows the same notice, which can't be dismissed.

Today every open viewer saves its drafts and reloads by itself as soon as the build changes (`ServiceConnection` in `src/components/desktop/service-connection.tsx`, mounted in `src/app/layout.tsx`).

The desktop app's window follows the same rule, because it is essentially a browser for a Home's pages:

- **The app carries the whole Ri server.** That's Node, the built web app (`.next-desktop`) and the CLI (`desktop/package.mjs` copies them into the app's resources). The pages are bundled, but as a server, not as files the window opens.
- **When this computer is the Home,** the app starts that server as the local service. The window then loads the service's address on localhost with a local certificate (`local.origin` from the service's `/session`, in `desktop/backend.ts`), the same pages a browser on this computer would get.
- **When the app is connected to a Home elsewhere,** the window loads that Home's own address instead (`remoteViewerOrigin(connected.homeUrl)`). The bundled server then runs only if this computer runs agents for that Home.
- **What the app draws itself** is limited to three screens (`desktop/local-window.ts`): `companion` for first run, connecting and "Ri on this device", `maintenance`, and `loading`. Beyond those come the native parts: menus, Quick Capture and notifications.

One set of pages therefore serves the browser, the phone and the desktop window. That is why closing the window never stops the Home, and why an update to the Home updates what every window shows.

## 5. Installing

There are three ways in, all producing the same installation:

1. **The desktop app** carries a release inside it. On first launch it copies that release into the installation's store, unless the store already holds a newer one, because an app never downgrades an installation.
2. **The install script**, for Mac and Linux: `curl -fsSL <install url> | sh`. It detects the platform and downloads the newest published release on the `stable` channel (or the channel passed to it). It checks the release's signature and every file's checksum, stores it, writes `~/.local/bin/ri`, and adds that folder to the PATH if needed. It installs software only and ends with "Run `ri start`". It never asks questions, since `curl | sh` has no usable input on an SSH session.
3. **A source checkout**, for contributors: `pnpm cli:dev update --from .` builds a release from the checkout (section 8) and installs it. From then on, plain `ri`.

A computer with both the desktop app and the script ends up with one installation, not two.

## 6. Keeping a Home running

### 6.1 Three layers

The OS supervises the launcher, the launcher starts the controller, and the controller supervises the server.

- **Only the OS** survives a reboot, a power cut and the death of every Ri process. It starts the launcher at boot or login and restarts it if it exits with an error.
- **The launcher never changes between releases,** so it can rescue a release whose own controller won't start (section 7.4). It is a few lines of shell, with no Node and no Ri code.
- **The controller** knows whether an exit was planned, whether the server is answering, how much memory it is using, and whether a crash came right after an update. So it restarts the server itself instead of exiting. Today it exits so the OS can restart it (`child.once('exit')` in `src/service/main.ts`). Restarting in the controller is faster, keeps the control socket up so status is visible during a restart, and works on Windows, where Task Scheduler can't see a crashed child (section 6.6).

### 6.2 When the controller restarts the server

| Trigger | What happens |
| --- | --- |
| The server exits without being asked to | Restart after 1 s, then 5 s, 15 s and 60 s, then every 5 minutes. The delay resets after 10 healthy minutes. |
| The server stops answering | The controller probes `/__ri_ready` every 15 s with a 10 s timeout. After 3 minutes without a successful probe it kills the server's process group and restarts it. The probe runs on the server's event loop, so a frozen loop fails it while an ordinary 2 s stall doesn't. Startup has its own deadline (three minutes today) instead, extended while migrations are running. |
| The server's JavaScript heap passes 75% of its limit | Restart at the next idle moment. |
| The heap passes 90% of its limit | Drain for 15 s, then restart, even if chats are running, because a crash at the limit is worse. The reason is recorded. |
| 5 unexpected exits within 15 minutes | Slow down to one attempt every 15 minutes, and keep trying indefinitely. The controller stays up, so `ri status` and Settings show that the Home is crash-looping and the last error. If the loop began right after an update, section 7.6 applies first. |

Every restart of the server runs the existing startup cleanup of harness processes whose server is gone (`stopOrphanedHarnesses` in `src/lib/runner/harness-processes.ts`), because killing the server doesn't prove every harness stopped.

The ready probe reports the heap in use, the heap limit and the resident memory. The perf log's minute rollups record the same three numbers, so `ri perf` shows memory over days and the heap limit seen in section 1 can be told apart from a leak.

### 6.3 Running work

Agent chats run as children of the server. This spec was written in a chat running under the production server. A restart ends them. So planned restarts (updates, the 75% memory restart, `ri restart`) wait until the Home is idle, and only crashes, hangs and the 90% memory limit interrupt work.

Recovery after an interrupting restart stays as it is today:
- At startup, the server catches each chat up from its transcript on disk. A message that never got a reply is sent again (`reconcileAllSessions` from `instrumentation.ts`, with the redispatch in `src/lib/executor/health.ts`).
- A chat whose previous harness hasn't confirmed it stopped asks to be restarted.

The "at most once every 3 minutes per chat" limit on re-sending lives in memory (`redispatchThrottle` in `health.ts`), so it resets on every restart. In a crash loop, the slowed retries in section 6.2 are what bound how often a message is sent again: a few times in the first minutes, then once every 15 minutes. Whether to go further and start without re-sending after repeated crashes is open (section 13.2).

Phase B adds one requirement: every chat that was interrupted and not sent again shows as needing the person (unread), so nothing is dropped silently. Phase B's acceptance checks this against a real interrupted chat, because the unread state hasn't been confirmed for every case. Moving agent work out of the server, so restarts never interrupt it, is future work (section 13.2).

### 6.4 Stopping

`ri stop`, "Stop" in the desktop app, and turning off "Keep Ri running" are the only ways a Home stays down. A crash loop is not one of them: it keeps retrying (section 6.2).

- **Stop** records that the owner stopped it. At the next boot or login the controller sees the record and exits successfully, so the OS doesn't restart it. `ri start` clears the record. A person who stopped their Home had a reason, and having it come back after a restart would surprise them. Status shows "Stopped by you at …" so a forgotten stop is visible.
- **Turning off supervision** removes the OS job and keeps every file.

### 6.5 What the OS decides, and what Ri checks

| OS | Supervisor | Starts after a reboot | Ri checks and says |
| --- | --- | --- | --- |
| macOS | Per-user LaunchAgent `app.ri.service.<id>`, as today, in the GUI login domain (`gui/<uid>`) | When the user's session starts, so on an unattended Mac only with automatic login | If automatic login is off: after a restart or power cut, the Home waits until someone logs in. If FileVault is on: after an unplanned restart nothing starts until someone unlocks the disk, and planned restarts can use `sudo fdesetup authrestart`. Whether the Mac restarts after a power failure (`pmset autorestart`), and whether it sleeps (keep-awake already exists: `ri service awake`). |
| Linux | systemd user unit, as today | At boot only with lingering on | If linger is off, prints the one command to fix it (`sudo loginctl enable-linger $USER`), since Ri can't run `sudo` quietly. |
| Windows | Task Scheduler (section 6.6) | At boot and at logon | n/a until built |

Both `ri doctor` and Settings also warn when free disk space drops below the larger of 20 GiB or the database's size, because a full disk takes a Home down whatever supervises it, and an update's snapshot needs room (section 7.4).

A Mac that must serve before anyone logs in would need a system LaunchDaemon. That process couldn't reach the user's login keychain, where harnesses keep their sign-ins. It isn't planned (section 13.2).

### 6.6 Windows (later)

Windows uses a Scheduled Task running as the user, triggered at boot and at logon, that runs the launcher. This is OpenClaw's approach. Because the controller restarts the server itself, the task only has to keep the launcher alive, which avoids Hermes's gap where a crashed gateway stays down on Windows. It also needs Windows release builds (`node-pty`, `better-sqlite3`) and a Windows launcher, which the packager doesn't produce yet.

## 7. Updating

### 7.1 Automatic by default, and who can change it

Automatic updates are on for every installation, with an off switch, in two places:

- **Settings > Updates**, in any window showing the Home: browser, phone or desktop app.
- **`ri update --auto off`** (and `--auto on`) in the CLI.

The switch applies to the whole installation, so every Home on that computer follows it.

**Who can change update settings.** Today only this computer's own pairing key can (`isInstallationOwner` in `src/lib/service/owner-auth.ts`). Paired devices and team credentials are excluded on purpose, because those settings decide what software the computer runs. This design keeps that rule and widens it by exactly one step:

- **This computer's own pairing key** (the CLI and the desktop app on the computer itself) can change everything: the switch, Update now, the channel, the origin, rollback and uninstalling.
- **The owner of the personal Home on this computer**, from any of their paired devices, can also turn automatic updates on or off and press Update now. Both only ever move to a release the installation already trusts, so neither can install anything new. That is how the Mini's updates are switched from a laptop.
- **A team Home's Settings shows the update state** but changes nothing when the computer also runs a personal Home, because the switch belongs to the computer, and the computer's owner is the personal Home's owner. On a computer whose only Home is a team (a team server), the team's owner gets the same two rights from their devices.
- **Team members** never change update settings.

A connected computer has no separate switch of its own, because it follows its Home's version (section 7.7).

Setup never asks about automatic updates. Most people can't judge the choice before they've used Ri, and a question at setup turns a default into a decision. Instead, `ri start` ends its output with one line, "Ri updates itself when it's quiet. To turn that off: ri update --auto off", and Settings > Updates shows the switch to anyone who looks. Someone scripting a server's setup runs `ri update --auto off` before `ri start`.

Once automatic updates are on:

- The installation checks for a new published release when a controller starts and every 6 hours after that, as the updater does today.
- A new release downloads in the background, along with the desktop app's own part when that changed (section 4.2). Today a downloaded update waits for someone to approve it (`approve` and `tick` in `src/lib/service/update.ts`), and the shell updater doesn't download on its own (`autoDownload = false` in `desktop/shell-update.ts`).
- When the new release takes effect depends on what is running (section 7.2).
- If a Home hasn't been able to switch for 24 hours, `ri status` and Settings say what it is waiting for ("2 chats running") and offer to update now.
- The CLI prints one line when an update is ready but waiting, and one line after a Home has moved ("Updated ~/ri to 0.4.2"), like Claude Code's update notices. It stays quiet otherwise.

Automatic updates apply to published releases only. A checkout builds only when asked (section 8).

### 7.2 When a downloaded release takes effect

Every Home follows one rule, whether it was set up from the desktop app or the CLI, and whether it sits on a laptop or a server nobody watches:

1. **Wait for 10 quiet minutes.** Quiet means all of these:
   - **Nothing is running that an update would cut off:** no chat turn, no agent background task, no permission waiting on someone, no request in flight, and no terminal or preview a window has open.
   - **Nobody has used Ri for the whole 10 minutes:** no typing or clicking in any window, and no calls from agents connected over MCP ("Connect your agent").
2. **Give a 1-minute heads-up** in every window showing the Home (browser, desktop app, phone): "Ri will update in 1 minute", with **Not now** and **Update now**.
   - If no window is open, as on a server used only through MCP, there is no one to tell and the minute simply passes.
   - Any new activity during the minute (a chat starts, a background task begins) cancels it, and the wait starts over.
3. **Update.** The restart takes seconds (section 7.4).
   - Open windows then show the refresh notice (section 4.3).
   - An agent whose MCP call lands in those seconds gets an error and retries, as it would after any dropped connection.

**Idle processes don't count as work.** Today's activity check (`activity()` in `src/service/main.ts`) counts every process the server owns. That includes agent processes left open for up to 30 minutes after a chat goes quiet (`IDLE_CLOSE_MS` in `src/lib/runner/local-runner.ts`), which resume from their session id when the chat continues. Counting them would stretch 10 quiet minutes to about 40, and a helper process that never exits would block updates for good. So the quiet check counts only the work listed in step 1, and the drain closes idle agent processes the way it does today (`closeIdleHarnessesForMaintenance`, called through `prepareIdle` in `src/lib/service/validation-boot.ts`).

Around that rule:

- **Not now** holds the update for an hour. After that, the next quiet stretch brings the heads-up back. It asks again, and never gives up or goes ahead silently.
- **Update now** (in the heads-up, in Settings, or `ri update`) skips the wait. If chats are running, it says which and offers to wait for them or stop them.
- **Automatic updates never stop running work.** A Home that is never quiet for 10 minutes keeps its version, and after 24 hours `ri status` and Settings say what it is waiting for.
- **At most one automatic update every 12 hours,** so a Home on `latest` doesn't restart for every release. A release that arrives in between is picked up at the next one.
- **Only people who can change update settings (section 7.1) see the heads-up's buttons.** Everyone else sees the refresh notice afterwards.
- **A maintenance window** (`ri update when-idle --hour`) still narrows when step 1 can happen.

For everything else:

| What | When it moves to the new release |
| --- | --- |
| The `ri` command | At its next run. The launcher points at the newest release, the same as Claude Code taking effect at its next start. |
| A browser tab or desktop window | When its person refreshes, or on its own if it's in the background (section 4.3). |
| A connected computer | Its server part when its Home moves, or first when the Home's next release needs it to (section 7.7). Its desktop app part at the app's next start (section 4.2). |

This sits between the tools before it. Hermes never updates itself: it shows a banner, waits for `hermes update`, and then drains running work for up to 30 minutes. OpenClaw leaves automatic updates off for its server by default. Turned on, they wait for running work, give a one-minute countdown, allow one hour's hold, and go ahead anyway after 15 minutes even if work remains. Its connected machines update by default, only when idle, at most every 12 hours. Ri is on by default like Claude Code and OpenClaw's machines, and borrows OpenClaw's countdown, hold and spacing, but drops its forced deadline, because a Home's running work is a person's agents mid-task.

### 7.3 Channels

Published releases come on two channels, matching Claude Code's names, which are the ones people already know:

- **`stable`** is the default.
- **`latest`** gets every release as it ships.

The existing preference allows `stable` and `beta` (`src/lib/service/update-settings.ts`). `beta` is renamed `latest` while nothing is published.

### 7.4 Switching a Home to a new release

The steps build on `UpdateCoordinator.apply` today. Each Home's own controller runs them for that Home, with its own journal.

1. **Wait and drain.** Wait for the quiet stretch and the heads-up (section 7.2), which Update now and `ri update` skip. Then drain new work and in-flight requests, and close idle agent processes (existing).
2. **Stop the server** (existing).
3. **Snapshot the config folder and the database, every time.**
   - **Why every time.** A release changes stored data at startup even without migrations: `initDatabase` rebuilds search tables and triggers and runs backfills (`src/lib/db/index.ts`), and `migrateIntegrationStorage` converts the connector settings folder (`src/lib/integrations/storage.ts`). So "no new migrations" doesn't mean the old release can read what the new one leaves behind, and only a snapshot makes going back exact.
   - **The database copy must include writes still in its log.** Ri runs SQLite in WAL mode (`journal_mode = WAL` in `src/lib/db/index.ts`), and a stop can end in `SIGKILL` (`src/service/main.ts`), so committed writes can still sit in `data.db-wal`. With the server stopped and the exclusive access lease held, the controller runs `PRAGMA wal_checkpoint(TRUNCATE)` and confirms the WAL is empty, then clones the file: `clonefile` on macOS, or a reflink on Linux filesystems that support it. Both are instant and take no extra space until the database changes. If the checkpoint can't finish or the filesystem can't clone, it falls back to SQLite's backup API, today's path (`createCheckpoint` in `src/lib/service/checkpoint.ts`), which reads the log correctly.
   - **Space.** A full copy is checked against free disk first (`requireDiskSpace`, existing). One that doesn't fit makes the update wait and say so.
   - **Not copied:** attachments and the work folder, because no release changes them.
   - **Today** the checkpoint copies every file under the root, config and work folders, plus the database, on every update. For the owner's Home that is a 19.6 GiB database plus everything else, on a disk with 24 GiB free.
4. **Boot the new release in validation mode and check the database** (existing), but only when the release has migrations. A release without migrations skips this boot. If it fails to start, step 5 puts the previous release back and restores the snapshot, so the check boot would only double the downtime.
5. **Activate through the launcher.** The controller writes an activation record next to the Home's record (the candidate release, the previous one, the time), points the Home at the candidate, and exits with code 75. The launcher, which never changes, then:
   - starts the candidate's controller, which must report ready (a ready file the launcher can read) within the startup deadline.
   - if the candidate exits before it is ready, or misses the deadline, twice, points the Home back at the previous release, marks the snapshot to be restored, and starts the previous release's controller. That controller restores the snapshot before anything opens the database, and reports the failed update.
   - on a ready report, clears the activation record.

   This doesn't depend on the candidate's own code working at all, which a crash in its controller's startup would otherwise defeat. Because the launcher starts the next controller itself on code 75, launchd's 30-second relaunch throttle (`ThrottleInterval`) never adds to the downtime.
6. **Refresh what the release installs** (section 9).
7. **Watch the first 10 minutes.** If the new release crash-loops (section 6.2), section 7.6 applies.

A typical update without migrations is a drain, a stop, a WAL checkpoint, a clone and one start: seconds of downtime. Phase A measures the real figure on the owner's Home, from the request to stop to the first page served.

### 7.5 Keeping releases

**One lock for the whole installation** (a lock file in the store) covers staging a release, switching any Home's pointer and deleting a release. Today's staging lock is per Home's runtime folder (`stageRuntime` in `src/lib/service/runtime.ts`) and the updater's busy flag lives in one controller's memory (`src/lib/service/update.ts`), so neither covers two Homes sharing a store.

**A release is kept while anything uses it:**
- any Home's record names it (running, previous, or waiting to activate)
- an activation record or a snapshot restore names it
- any running process runs from it, which one process-table check before deleting finds. A chat's own `ri` pins absolute paths into its server's release (`src/lib/executor/session-cli.ts`), so a release can still be in use after its Home has moved on
- it is the newest release

Everything else is deleted after a switch, as Claude Code keeps the two newest versions plus any in use.

Releases never change after staging, so staging hard-links every file whose checksum matches a file already in the store. A release that changes only code then costs only its changed files, not another 3.3 GB.

### 7.6 Rollback

- **A release that never served is rolled back automatically.** It failed to start, its controller never reported ready (section 7.4 step 5), or it crash-looped before its first successful health check. Then it hasn't written anything except during its own startup, and the snapshot from step 3 undoes that. The Home returns to exactly its state before the update, and status says the update failed and why.
- **A release that has served is rolled back only on request.** Once it has served, chats, tasks and notes may have been written in its format, and restoring the snapshot would lose them. If such a release crash-loops, it slows to retries (section 6.2) and status says rollback is available. `ri update --rollback` (or Settings, with this computer's own key) restores the snapshot after listing what would be lost: chats, tasks and notes changed since the switch.
- `ri update --rollback` on a healthy Home works the same way.

### 7.7 Keeping versions aligned

Several things have a version, and this design keeps them in step:

| Pair | How they stay aligned |
| --- | --- |
| A Home and the pages it shows | Always the same, because the Home's server serves them. A tab loaded before an update is handled by section 4.3. |
| The desktop app and a Home on the same computer | The same installation, so one update covers both. When the app's own part changed, the window relaunches as part of the Home's update (section 4.2). |
| The `ri` command and a Home | Commands about a Home run that Home's release (section 3.2). |
| A connected computer and its Home elsewhere (a laptop and the Mini) | See below. |

A connected computer has three parts, and each follows its Home differently:

- **What it shows** needs nothing. The pages come from the Home, so the Home's update is already the window's update, after a refresh (section 4.3).
- **Its own server part** runs only if the computer runs chats for its Home (the "Run agents on this device" option). It never runs a release its Home can't talk to, and it moves:
  - **after its Home, normally.** When the Home moves, it fetches the Home's version from the published releases and switches right away, or after the chats it is running finish.
  - **before its Home, when the Home's next release needs that.** Today a Home refuses to update while an enrolled computer couldn't talk to the new release, and asks for "a compatible bridge first" (`homeCompatibilityReasons` in `src/lib/workers/update-compatibility.ts`). Waiting for the Home there would deadlock. So when the Home's update is waiting on it, the connected computer moves to the newest published release that both its current Home and the Home's next release can talk to (a bridge release), and then the Home moves. Publishing keeps bridge releases available for exactly this.
- **The desktop app's own part** downloads only when the app's files changed, and takes effect at the app's next start (section 4.2).

A Home on a version that isn't published, such as one built from a checkout, is the exception. A connected computer can't fetch that version, so it keeps its own, and the compatibility contract (`src/lib/releases/compatibility.ts`) decides whether the two still work together. Both versions show in `ri status` and Settings, and so does which one needs updating.

The pieces exist today: `/api/version` returns the Home's release and API protocols, and connected workers negotiate their protocol (`negotiateWorker`). A Home could also hand its own release to its connected computers. That would align source-built setups too, and is future work.

## 8. Building from a checkout

This origin is for contributors and the owner's own Homes. It produces the same kind of release as a published one, made with the same packaging script, so the owner's Home exercises the path every user gets. It is manual only: `ri update` builds when the owner runs it, and nothing builds on a schedule.

- `ri update --from ~/ai-task-manager` sets the origin, and `ri update --from published` returns to published releases. With a checkout origin, `ri update` builds and then switches as in section 7.4.
- **Which commit.** Ri fetches `origin`. Of the checkout's `main` and `origin/main`, it builds whichever contains the other, which is the newest committed `main`, pushed or not. If they have diverged, it stops and says so. Uncommitted changes are never built.
- **The checkout is never touched.** Not its working tree, its index or its branch. Ri builds in a separate worktree at that commit (`git worktree add --detach`) inside the installation's own build folder. A clean worktree builds with a 15.6 GB peak against 30.7 GB in the full checkout, measured for cd1b09fc.
- **How it builds.**
  - `pnpm install --frozen-lockfile` runs in the worktree. pnpm's store links packages instead of copying them.
  - Packaging uses `desktop/package.mjs --headless`, which runs `next build` through `scripts/next-build.mjs`.
  - The build runs at background priority (`taskpolicy -b` on macOS, `nice` and `ionice` on Linux), so the Homes keep their share of CPU and disk while it runs.
- **Memory.** Lower priority doesn't reserve memory. A build competes with the Homes for it, and when memory runs short macOS compresses and swaps, which slows everything, the Homes included. A clean-worktree build's 15.6 GB peak is half the Mini's 32 GB, so the Homes stay up but slower for the few minutes it runs. `scripts/next-build.mjs` stops only a runaway (64 GB by default). The owner chose this over stopping builds at a fixed share of memory (section 13.1). The owner decides when to pay the cost by running `ri update`, and phase A measures it with both Homes serving real traffic.
- **The result.** The release is stored (section 7.5), the worktree is removed, and each Home switches as in section 7.4. The release records its commit, with `source: 'source'` in its identity (`ReleaseIdentitySchema` already has the field), so status reads "main a8eb6398".
- **If the build fails,** the Homes keep running the current release. `ri update` prints the step that failed and the path to its log.

## 9. What Ri installs outside its folders

Ri writes several things outside its own folders, and every one of them must keep working across updates. The rule: **nothing Ri writes outside its folders points into a release folder or a checkout.** Each one points at the `ri` launcher or at a Home's address, and is refreshed when a Home switches releases.

| What | Belongs to | Today | In this design |
| --- | --- | --- | --- |
| **Ri's own skills**, used by every chat a Home runs (`<app-root>/skills`, rendered into `<work>/skills`) | The Home, from its release | Refreshed by the foreground `ri start` (`src/cli/commands/start.ts`), onboarding, `ri skills` and Settings (`installAppRootSkills` in `src/lib/agent-skills/shipped.ts`). The background service never refreshes them, so a desktop or supervised Home keeps its old skills after an update. | Refreshed on every server start, which includes every update. The write is idempotent (it already skips unchanged files), so the cost is near zero. |
| **Global skills**, for every agent on the computer, if the person opted in (each harness's user folder: `~/.claude/skills`, `~/.agents/skills` and the rest, from `globalSkillFolders`) | The installation | Written from one Home's folder and marked with that Home's path (the copy marker in `shipped.ts`), and skipped entirely under the desktop app and the service (the `RI_DESKTOP` check in `src/cli/commands/start.ts`) | Written by the installation from the release of the Home that `ri agent` reaches without `--root` (section 3.4), after that Home switches. A skill then describes exactly the commands the Home it reaches has. The first write takes the copies over from the Home that marked them. Skills don't say bare `ri`. Codex runs commands in a login shell that puts `/usr/bin` first, where macOS's own `ri` lives, so `ri agent` from the orchestrator skill (`skills/orchestrator/SKILL.md`) can reach Ruby's documentation tool instead. Every skill template writes `"${RI_SESSION_CLI:-$HOME/.local/bin/ri}"`. Inside a Ri chat that is the chat's own pinned `ri`, and anywhere else it is the launcher. The text is identical on every computer and in every release, because the launcher's path is fixed by convention (as Claude Code's `~/.local/bin/claude` is), so nothing is filled in per computer and nothing can drift. If Ri is removed, an agent gets "no such file" instead of quietly running another program. |
| **"Connect your agent" entries** (MCP servers in Claude Code, Codex and the other harnesses' user configs, `src/lib/external-ai/local-setup.ts`) | The Home | They hold the Home's local MCP address (`localMcpUrl`, from `getLocalBaseUrl`) and its token | Unchanged, because a Home keeps its address through takeover, restarts and updates (section 10.3). `ri doctor` reports an entry that no longer answers. |
| **The `ri` launcher** (`~/.local/bin/ri`) | The installation | The desktop app's `ri-desktop`, or the checkout's own `ri` linked in `~/Library/pnpm/bin` | One launcher, rewritten only when its own format changes |
| **The Home's OS job** (`app.ri.service.<id>`) | The installation | Points at a per-Home runtime launcher | Points at the installation's launcher (section 10.1) |

The owner's nightly backup job (`app.ri.home-backup`, from `pnpm backup install`) is an exception. It runs the checkout's own `tsx` and `scripts/backup-home.ts` (`dailyBackupPlist` in `src/lib/home/daily-backup.ts`), so it keeps needing the checkout. It isn't a product feature, so it stays that way. Making backups part of every Home is open question 6.

## 10. Moving existing installations

### 10.1 Today's per-Home runtime folders

Existing per-Home runtime folders (`runtime/<home id>/`, from a packaged desktop app) are left where they are, because a running controller and chats' `ri` launchers point into them. New releases go into the shared store. A Home moves to the store at its first update, and its old folder is deleted by the rules in section 7.5 once nothing uses it.

Rewriting a Home's LaunchAgent or unit to start the installation's launcher needs a new entry in the installer's list of earlier templates it may replace. Today it recognizes exactly one earlier template, which differs only in its stop timeout (`previousDefinition` in `src/lib/service/install.ts`), so the launcher change adds a second.

No such folders exist on the owner's Mini. A packaged desktop app on another computer, such as the owner's MacBook, may have one.

### 10.2 The owner's Mac Mini

Both Homes move once phases A and B (section 12) are on main. Every step names its folder, so nothing depends on which Home the installation already knows:

1. **Install from the checkout.** Run `pnpm cli:dev update --from ~/ai-task-manager`. This builds `main` into a release and installs `ri`. Both Homes keep running as they are.
2. **Move the team Home first, as a rehearsal.** Run `ri start --root ~/ri-team-huffine`. Its unsupervised controller hands off to a supervised one on the new release, using the handoff `installService` already performs, and keeps `https://localhost:42242`.
3. **Move the personal Home.** Stop it in its terminal window with Ctrl-C, then run `ri start --root ~/ri`. It keeps `http://localhost:4224` (section 10.3). This ends every chat running under that server, including any agent chat, so it's for the owner to run, not an agent. No migrations are pending, since the release is built from the same `main`.
4. **Clean up.** Remove the checkout's own `ri` link in `~/Library/pnpm/bin`, so `ri` is the launcher.
5. **Check, then restart once.**
   - `ri status` shows both Homes supervised.
   - A browser tab opened before the move still works after refreshing.
   - A Claude Code and a Codex MCP call to the personal Home succeed.
   - The Beamd address answers.
   - Restart the Mini and confirm both Homes come back through automatic login, with nobody touching it. This is the qualification test for section 2.1.

After that, picking up `main` is `ri update`, which builds once and switches both Homes. [environments.md](environments.md) "Production on the Mac Mini" is rewritten when this ships.

### 10.3 Keeping a Home's address

Today the two ways of running a Home serve different addresses:
- A Home started in the foreground serves `http://localhost:4224` (`DEFAULT_PORT`, chosen in `src/cli/commands/start.ts`).
- The background service picks `https://localhost:42242` or the next free port, with a generated certificate (`startHome` in `src/service/main.ts`), and saves it in `local-service.json`.

A takeover that moved the personal Home to the service's address would break everything that holds the old one:
- "Connect your agent" entries in Claude Code and Codex (section 9)
- open tabs and bookmarks
- pairing links
- the tunnel, whose health check compares its port with the running port (`src/lib/auth/auto-tunnel.ts`)

So a takeover keeps the address:
- **Before the service first starts a Home it is taking over,** it records the Home's current port and scheme (from the Home's running port, as `getRunningPort` reads it) in that Home's `local-service.json`.
- **The service then serves that address.** For a Home that ran on plain HTTP, that means the service serves plain HTTP on that port, which `startHome` doesn't do today.
- **If the port is held by something else at takeover,** the takeover stops and says what holds it. It doesn't pick a new one.
- **A Home created by the service** keeps whatever address it got the first time, as today.

## 11. What changes in the code

| Today | Change |
| --- | --- |
| Each Home has its own runtime folder, launcher and update record (`getRuntimeInstallDir` in `src/lib/service/paths.ts`, `src/lib/service/runtime.ts`) | One store per installation under one lock, a record per Home, and one `~/.local/bin/ri` launcher. Each Home keeps its own controller and update journal (sections 3.2 and 7.5). Existing per-Home folders stay until nothing uses them (section 10.1) |
| Every command assumes `~/ri` unless told otherwise (`getAppRoot`) | `ri start` and `ri team create` still name a folder. Other Home commands find the Home from the installation's records (section 3.4) |
| `ri service install` refuses anything but a staged runtime (`definition()` in `src/lib/service/install.ts`), and recognizes one earlier job template | Supervision runs the installation's launcher for any Home, with a second earlier template it may replace. A checkout becomes an origin, not something a Home runs from |
| Creating a Home doesn't supervise it: `ri team create` calls `startBackgroundService` (`src/cli/commands/team.ts`), `ri start` runs in the foreground (`src/cli/commands/start.ts`), and the desktop app's "Use this device as Home" leaves Start at Login separate (`desktop/main.ts`) | Creating supervises, and `ri start` takes over an unsupervised Home (section 4) |
| The service always picks its own HTTPS port (`startHome`) | A takeover keeps the Home's port and scheme, including plain HTTP (section 10.3) |
| The controller exits when the server dies and doesn't probe it (`src/service/main.ts`) | Restarts, hang probe, memory limits, and slowed retries that never give up (section 6.2). The perf rollups gain memory fields |
| The runtime launcher starts the controller once, and the OS throttles relaunches to one per 30 s | The launcher keeps an activation record, puts the previous release back when a candidate's controller won't start, and loops on exit code 75 (section 7.4) |
| A downloaded update waits for approval, and the shell updater doesn't download (`src/lib/service/update.ts`, `desktop/shell-update.ts`) | Automatic download and the timing in section 7.2 |
| The activity check counts every process the server owns, idle agent processes included (`activity()`) | The quiet check counts only work in progress (section 7.2) |
| Only this computer's own pairing key can change update settings (`isInstallationOwner`) | The personal Home owner's paired devices may also switch automatic updates and press Update now (section 7.1) |
| Every viewer reloads by itself when the build changes (`ServiceConnection`) | A prompt in a visible tab, a reload in a hidden one (section 4.3) |
| The checkpoint copies the whole Home on every update (`src/lib/service/checkpoint.ts`) | The config folder and a WAL-checkpointed clone of the database, every time (section 7.4) |
| A Home whose update an enrolled computer can't follow waits for a bridge (`homeCompatibilityReasons`), with nothing to move that computer | The connected computer moves first to a bridge release (section 7.7) |
| Releases come only from the signed feed (`checkRelease` in `src/lib/service/release.ts`), and no feed is published | A checkout origin, built on request (section 8). Publishing the feed is phase E |
| A connected computer updates on its own schedule | It follows its Home's version (section 7.7) |
| Staging never moves an existing Home to a new release (`stageRuntime`) | Only the coordinator switches a Home, always |
| Releases are never deleted | Deleted only when nothing uses them, with hard-linked duplicates (section 7.5) |
| Ri's own skills refresh only on the foreground `ri start`, and global skills are skipped under the service and the desktop app | Refreshed on every server start and after every switch, from the release of the Home they reach (section 9) |
| The desktop's terminal command is `ri-desktop`, and the user fixes PATH (`desktop/main.ts`) | One `ri` launcher, with the Home's own release for Home commands (section 3.2) |
| Channels are `stable` and `beta` (`src/lib/service/update-settings.ts`) | `stable` and `latest` |
| `ri stop` has no lasting meaning under supervision | A recorded stop that survives restarts (section 6.4) |
| `ri doctor` doesn't check the OS settings that decide restarts (`src/cli/commands/doctor.ts`) | The checks in section 6.5 and section 9 |
| Installing supervision throws on anything but macOS and Linux | Task Scheduler adapter, phase E |

## 12. Build order

Each phase lands on main with its tests. The owner's Homes move after phase B, and from then on update with `ri update`. So everything that makes switching safe is in phases A and B. Phases A and B need nothing published.

**A. Installation, releases and safe switching.**
- The shared store, its lock, the per-Home records, and finding a Home without `--root`.
- Leaving today's per-Home folders in place (section 10.1).
- The launcher, with its activation record and its release choice for Home and installation commands.
- Retention by use, and hard links.
- The checkout origin, `ri update` (including `--now` and `--rollback`), the snapshot (section 7.4 step 3), automatic rollback of a release that never served (section 7.6), and the single boot for releases without migrations.
- Section 9's skill refresh.

Tests:
- Commit selection against a fixture repository (ahead, behind, diverged, uncommitted changes).
- A snapshot taken with committed writes still in the WAL and the writer killed, then restored: every committed write is there.
- A candidate whose controller fails to import, and one whose server never gets ready: the launcher puts the previous release back and the database is exactly as before.
- Two Homes on one store: one waits to activate a release while the other switches and prunes, and nothing either uses is deleted. A running chat's `ri` keeps working after its Home moves.
- Retention, hard links, and the launcher's release choice with zero, one and several Homes.
- Skills refreshed after a switch, with global skills from the release of the Home `ri agent` reaches.

Acceptance:
- Build `main` and switch two Homes.
- Roll one back.
- Account for the disk used.
- Confirm the skills in `<app-root>/skills` and `~/.claude/skills` match the release.
- Measure the downtime of a switch.
- Measure a build while both Homes serve real traffic: the stalls in the perf log, and the memory and swap used.

**B. Supervision and takeover.**
- Creating a Home supervises it.
- `ri start` takes over an unsupervised or foreground Home and keeps its address (section 10.3).
- `stop`, `restart`, `status` and `logs` as in section 4.1.
- The controller's restart policy, hang probe and memory limits, slowed retries that never give up, and the handover loop.
- The recorded stop, memory in the perf log, and the `ri doctor` checks.

Tests: the restart policy with fake timers, plus `desktop/service-lifecycle-smoke.ts` extended to cover each trigger.

Acceptance:
- `kill -9` on the server: back within 10 s.
- `kill -STOP` on the server: restarted within 4 minutes.
- A server forced past 90% of its heap: restarted with the reason recorded.
- A server that crashes on every start: retries slow to once every 15 minutes and never stop, status shows the error, and an interrupted chat's message is sent again only at those retries.
- An interrupted chat after a restart: sent again, or shown as unread (section 6.3).
- A takeover of a foreground Home on `http://localhost:4224`: a tab opened before it works after refreshing, MCP calls from Claude Code and Codex succeed, and the tunnel answers.
- A takeover when port 4224 is held by something else: it stops and says what holds it.
- Restart the Mini: both Homes back through automatic login, with nobody touching it.
- A Linux VM with linger on: back after a reboot with nobody logging in.

**C. Automatic updates and alignment.**
- Automatic download and the rule in section 7.2: the quiet stretch, counting only work in progress, the heads-up, Not now and Update now, and the 12-hour spacing.
- Who can change update settings (section 7.1).
- The 24-hour waiting notice, `stable` and `latest`, and the shell updater following the setting.
- The CLI's one-line notices, and the refresh notice in browsers and the desktop window (section 4.3).
- Connected computers following their Home, including moving first to a bridge release (section 7.7).

Acceptance, against a test feed:
- A Home with no window open, used only over MCP, with idle agent processes left from a chat, updates after 10 quiet minutes (not 40), and an MCP call during the restart succeeds on retry.
- A Home with a window open shows the heads-up. Not now brings it back after an hour. A chat or background task starting during the minute cancels it.
- A busy Home never updates by itself and says why after 24 hours.
- From a paired laptop, the personal Home's owner switches automatic updates off and presses Update now. A team member can't, and neither can the laptop change the channel.
- A connected computer switches right after its Home, waits when it is running chats for it, and moves first to a bridge release when the Home's update needs it.

**D. Desktop surfaces.**
- First run that creates and supervises.
- The heads-up and refresh notice in the app's window.
- Settings This computer and Updates, "Add `ri` to Terminal" and "Check for Updates…".
- Removing the old Tools items.

Acceptance: a fresh Mac account goes from first launch to a supervised Home in one click, survives a restart, and updates through the heads-up. The app updating its own part needs the signed app from open question 2, so that check runs once one exists.

**E. Distribution.** The install script, a published feed with signing, bridge releases kept available, and the CI release matrix (macOS arm64 and x64, Linux arm64 and x64, already declared in CI). Also the Windows Scheduled Task adapter, with a Windows launcher and Windows release builds.

Acceptance: an SSH-only Linux server goes from `curl … | sh` and `ri start` to a paired Home that updates itself.

## 13. Decisions, open questions and review

### 13.1 Decided

- **Supervision.**
  - The OS supervises an unchanging launcher, the launcher starts the controller, and the controller supervises the server. No other daemon.
  - Supervision is part of being a Home, never a separate step, with an off switch.
- **Commands.** The standard case takes no flags. `ri start` and `ri team create` name a folder (`~/ri` by default). Other commands find the Home themselves, and flags are for another folder, a second Home, source builds and rare settings.
- **Installation.**
  - One installation per computer, shared by the desktop app and the CLI. Releases belong to it, and Homes point at them.
  - Each Home keeps its own controller and update journal.
  - The folder says what kind of Home it is.
  - A Home runs an unchanging release and moves only through the update switch, including for the owner.
- **Addresses.** A Home keeps its address through takeover, restarts and updates.
- **Things outside Ri's folders.** Everything Ri installs outside its folders (skills, the launcher, agent connections, the Home's OS job) belongs to the installation or the Home and is refreshed by updates. Global skills follow the Home `ri agent` reaches. The owner's backup job stays checkout-dependent.
- **When updates happen.** Published releases update automatically, by one rule for every Home:
  - after 10 quiet minutes, where chats, background tasks, MCP calls, open terminals and previews, and people all count, and idle agent processes don't
  - after a 1-minute heads-up. Not now holds it an hour and then asks again
  - never stopping running work, and at most every 12 hours
  - the `ri` command picks up a new release at its next run, and windows and tabs through a refresh notice
- **Update settings.**
  - One switch for the whole installation, and setup never asks about it. `ri start` names the switch in one line of its output.
  - This computer's own key changes everything. The personal Home owner's paired devices may also switch automatic updates and press Update now. Team members never change them.
- **Switching versions.**
  - Every update snapshots the config folder and a WAL-checkpointed database clone.
  - The launcher puts the previous release back when a candidate won't start, without relying on the candidate's code.
  - A release without migrations starts once, with no check boot.
  - Rollback is automatic only for a release that never served. After it has served, rollback is on request, listing what it would lose.
- **Connected computers.** A connected computer follows its Home's version, and moves first to a bridge release when the Home's next release needs that.
- **Source builds.** They happen only when the owner runs `ri update`, at background priority. They are stopped only on a true runaway (64 GB), not at a fixed share of memory, accepting that a build slows the Homes while it runs.
- **Crashes.** A crash loop slows its retries to once every 15 minutes and never gives up.
- **Interrupted chats.** They are recovered as they are today: replayed from their transcript or sent again. Any that aren't show as unread for the person to restart.
- **Channels.** `stable` and `latest`.
- **The command name.** The command is `ri`. The installer puts `~/.local/bin` before `/usr/bin` (where macOS ships Ruby's `ri`), and `ri doctor` warns when `ri` resolves elsewhere. That covers people typing `ri`. Agents can't rely on PATH, so everything Ri writes for agents names `"${RI_SESSION_CLI:-$HOME/.local/bin/ri}"`, the same fixed text everywhere (section 9).
- **Stopping.** A stop survives restarts.

### 13.2 Open, or future work

1. **Agent work outside the server.** Chats are children of the server, so every server restart ends them. Moving the agent runners into the controller, or into their own supervised process, would let updates and memory restarts happen without waiting for idle or interrupting anything. This is future work, after this spec.
2. **Publishing.** The owner will choose the hosting. Nothing in phases A or B depends on it. What does depend on it:
   - Before phase C: a download address to keep. The feed's address is written into every installation (`release-policy.json`), so changing it later means migrating every installation. Also a release signing key: the format already expects an Ed25519 key.
   - Before the desktop app goes to anyone else: a Developer ID. macOS opens an unsigned downloaded app only after a warning, and the desktop updater can't apply an update to an unsigned Mac app. This is the same Developer ID decision already open for notifications.
3. **Starting in a safe mode after repeated crashes.**
   - **Failure:** a message whose reply crashes the server is sent again at each retry, so the Home keeps crashing and spends a harness's usage each time.
   - **Likelihood:** low. Nothing like it has been seen, and the slowed retries already limit it to a few sends, then one every 15 minutes.
   - **Cost:** one flag the controller passes after the crash-loop threshold, telling the server to start without re-sending and to report which chats it held back.
   - It needs the owner's OK before it is built.
4. **A Home handing its release to its connected computers,** so source-built setups stay aligned too (section 7.7).
5. **Windows.** Native first, or WSL first, as OpenClaw supports both?
6. **Backups.** The nightly backup is an owner-only launchd job (`pnpm backup install`). Whether every Home should get one, kept by the same controller, is a separate decision.
7. **Before-login Macs.** A system LaunchDaemon for Macs that must serve before anyone logs in. Not planned, and it can't reach the login keychain.

### 13.3 Review, 2026-10-28

An independent review of the 2026-10-27 version checked its claims against the code. What it changed:

| Finding | Change |
| --- | --- |
| Startup changes stored data even without migrations (`initDatabase`, `migrateIntegrationStorage`), so skipping the database snapshot made rollback unsafe | Every update snapshots the database, and automatic rollback is limited to a release that never served (sections 7.4 and 7.6) |
| Cloning only `data.db` can miss committed writes in the WAL after a killed stop | WAL checkpoint before the clone, with the backup API as the fallback (section 7.4) |
| A candidate controller that can't start can't rescue itself | The launcher keeps an activation record and puts the previous release back (sections 6.1 and 7.4) |
| Moving and deleting today's runtime folders could break running Homes and chats, and the installer didn't already handle the template change | Old folders stay until nothing uses them, and the installer gets a second earlier template (section 10.1) |
| The Mini steps would have started the team Home twice and left the personal Home down | `ri start` names a folder, and every step names its root (sections 3.4 and 10.2) |
| A takeover would move the personal Home from `http://localhost:4224` to the service's HTTPS port, breaking agent connections and tabs | A takeover keeps the address (section 10.3) |
| A shared store needs one lock and must keep releases waiting to activate or still running | One installation lock, and retention by use (section 7.5) |
| The Settings gate is this computer's own key, not a remote owner check | Who can change update settings is now defined (section 7.1) |
| The quiet check would count idle agent processes and wait about 40 minutes | Only work in progress counts (section 7.2) |
| Stopping after 5 crashes broke the promise, and the re-send limit resets on restart | Slowed retries that never give up, which also bound re-sends. Safe mode is open question 3 (sections 6.2 and 6.3) |
| Connected computers waiting for their Home could deadlock with a Home waiting for a bridge, and remote windows have no bridge check | Connected computers move first to a bridge release, and the bridge check is stated as local only (sections 4.2 and 7.7) |
| Background priority doesn't reserve memory | The memory cost is stated plainly and measured in phase A, keeping the owner's choice not to stop builds at a fixed share (section 8) |
| Global skills from the newest Home could describe commands the reached Home lacks | They follow the Home `ri agent` reaches, and take over the old copy markers (section 9) |
| The backup job depends on the checkout | Stated as an owner-only exception (section 9) |
| Safety needed for the Mini's move sat in phase C, and "without a login" was imprecise | Snapshot, activation, rollback and single boot moved to phase A. "Through automatic login" (section 12) |

## 14. Prior art

- **OpenClaw:**
  - `openclaw onboard --install-daemon` and `openclaw gateway install` set up a LaunchAgent (`ai.openclaw.gateway`), a systemd user unit with lingering, or a Windows Scheduled Task with boot and logon triggers.
  - Its Mac app doesn't run the gateway. It connects to it or enables the launchd job.
  - `openclaw update --channel dev` builds a git checkout of main and restarts the gateway, but needs a clean worktree, and the docs warn against running main in production.
  - Docs: [Windows](https://docs.openclaw.ai/platforms/windows.md), [macOS app](https://docs.openclaw.ai/platforms/mac/child-process), [updating](https://docs.openclaw.ai/install/updating.md), [automatic updates](https://docs.openclaw.ai/install/updating/automatic-updates.md), [development channels](https://docs.openclaw.ai/install/development-channels).
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
- **SQLite:** a database in WAL mode keeps committed writes in its `-wal` file until a checkpoint copies them into the main file ([write-ahead logging](https://sqlite.org/wal.html)).
