# First Windows version

Native Windows x64 preview, built on GitHub Actions. No public release or
download is published. The installer is unsigned and installs for the current
user. Ri runs while its desktop app is open.

The pinned Electron 44.4.5 and Node 26.5.0 list Windows 10 as their minimum.
Use Windows 10 version 1809 or newer, which also covers the terminal and
Claude Code requirements. A 64-bit Intel/AMD Windows 11 installation qualifies too.
Windows 7/8, 32-bit Windows and Windows ARM are outside this preview.
Sources: [Electron](https://github.com/electron/electron/blob/v44.4.5/README.md#platform-support),
[Node](https://github.com/nodejs/node/blob/v26.5.0/BUILDING.md#platform-list).
[Claude Code requirements](https://code.claude.com/docs/en/setup#system-requirements).
Codex recommends Windows 11 and supports recent, fully updated Windows 10 on a
best-effort basis. Its Windows sandbox also needs testing with a real account
on the PC. See [OpenAI's Windows guidance](https://learn.chatgpt.com/docs/windows/windows-sandbox#windows-version-matrix).

## Completion checklist

- [x] Actions produces an unsigned x64 `.exe` artifact
- [x] Installer installs on the hosted Windows runner
- [x] First launch creates a Home and finishes setup
- [x] Windows process ownership, control transport and shutdown work
- [ ] Claude Code and Codex discovery, installation, authentication and chat work
- [x] Tasks and notes work
- [ ] Closing and reopening preserves data
- [ ] Installing a newer installer over the old one preserves data
- [ ] Uninstall removes software and preserves authored data
- [ ] Unsupported features are hidden or explained
- [ ] Native dependencies and artifact contents are checked
- [ ] Relevant checks pass on macOS and Windows
- [ ] Trey receives an artifact link and a short PC checklist

## Boundaries

No Scheduled Task or auto-start, self-updates or update feed, bundled speech
helper, signing, ARM build, or Mac menu bar features. The existing macOS/Linux
service behavior stays supported. Windows uses native harnesses and PowerShell,
without WSL. User data must remain outside the installation folder.
Hosting a team on Windows is also unavailable, since that requires a separate
background service. Personal Homes are the qualified path for this preview.

## Verification

The hosted Windows runner has created a fresh Home, applied the real database
migrations, opened the HTTPS app, created and completed a task, and edited and
autosaved a note. A real harness dispatch through Windows npm shim discovery
and the agentex parser produced and persisted a stand-in Claude reply. The
browser's WebSocket terminal accepted PowerShell input and ran its pinned
session CLI. The current runtime qualification reuses an extracted installer
with the current desktop shell. It does not qualify the final installer.

The retained installer is about 319 MiB compressed and 3 GiB installed. Actual
NSIS installation passed on the hosted runner in about 10.5 minutes. An older
PC can take longer. The final candidate must repeat installation, runtime,
upgrade and uninstall checks from the same newly built artifact.

## Implementation

The Windows desktop app starts the existing ordinary Node controller with an
IPC channel. The controller keeps the existing SQLite ownership lock and
supervises the Next server. Closing the last desktop window quits the app,
ends that controller and closes its harnesses and terminals. IPC disconnect
also ends the controller if the desktop helper exits unexpectedly. Forced
shutdown uses Windows process-tree termination.

Windows runs the resources installed beside `Ri.exe` directly. It does not
copy a release into the shared runtime store or install a launcher or OS job.
Reinstalling replaces software in the installation folder. The Home lives
under `%APPDATA%\Ri\home` and is kept across installs and uninstalls. Desktop
selection and profile state also live under the user's AppData folder.

Local control uses a named pipe keyed by the canonical Home identity. Runtime
metadata uses LocalAppData. Data directories get explicit NTFS access for the
current account and SYSTEM before secrets are written. Local administrators
remain trusted Windows principals. The new Home excludes other ordinary accounts.
POSIX permission bits
are checked only on platforms where they describe real access.

The installer includes portable Node and npm. First-run setup offers fixed
Install and Sign in actions for Claude Code and Codex through the trusted local
desktop bridge. Installation uses the current user's npm prefix. Sign-in runs
the tool's own browser flow. No arbitrary page-supplied command runs in a shell.
PowerShell is the in-app terminal. Each harness gets a `ri.cmd` launcher pinned
to its own server and Home. Session instructions use PowerShell CLI syntax on
Windows. Global shipped skills are copies and skill mirrors use junctions.

The owned agentex library needs Windows npm shim parsing and skill junction
fixes. Source is on local branch `ri/windows-first-version` in the separate
`agentex-windows-first-version` worktree, commits `09495b2` and `0c0a78b`. Ri carries those
fixes in its existing pnpm patch until an approved library release includes
them. No agentex version was published.

## Runner checks

Dispatch Desktop and headless runtime with **Build only the Windows preview**.
The Windows job uploads only the `.exe` and small qualification reports. It
never creates a release or an update feed. Native SQLite, sqlite-vec and PTY
probes run under the bundled Node before packaging.

`desktop/windows-smoke.ts` installs the NSIS output on a disposable hosted
Windows account, chooses a fresh Home without a Unix HOME variable, tests real
Codex and Claude Code installations and a stand-in Claude protocol, writes tasks
and notes, edits a note in the app,
quits, reopens, upgrades over the existing installation and uninstalls. The higher-version upgrade
candidate uses the same server commit, so it isolates installer replacement
and data preservation. The first-run path applies the real database migrations.
No provider credentials are supplied and no real billed model request runs.

macOS checks so far: desktop suite 578 passed with three skips, including the
Windows-only OEM code-page and fixed sign-in command tests. Focused
core checks passed, typecheck and desktop compilation passed. The broader
repository suite has existing failures, including ten message-route tests
reproduced unchanged at the starting commit. A new IPC shutdown listener also
conflicted with Vitest worker messages. It is now restricted to app-owned
servers and uses a Ri-specific message, and the HTTP-server checks pass.

A clean macOS worktree also passed the production Next build and trace guard.
A real Electron session created a fresh Home, created and completed a task,
edited and autosaved a note, quit, reopened and retained both records. Its
service stayed running after quitting, as macOS requires. A real dispatch also
produced and persisted a reply through the same stand-in Claude protocol used
by Windows qualification. No real provider account or billed request was used.
The wider companion
smoke reaches three first-run checks and then stops on an existing renamed
pairing-field selector. The desktop initializes its covered viewer before
presenting local setup. A viewer that has never loaded a document prevents
Playwright from attaching to packaged startup. The ordinary launch path now
passes without an injected test loader. The Mac task, note, chat and reopen
checks also passed after this fix.

The Windows production web build and trace guard now pass. SQLite/vector,
canvas, sharp, and native terminal output/exit passed the Windows preflight.
The pinned node-pty beta kept a pipe worker after natural shell exit. Ri now
calls its cleanup API at exit, and the packaging probe has a short timeout.
Windows packaging omits dependency JavaScript, CSS and declaration source maps
to reduce extraction cost. Ri's own build maps, declarations and licenses stay.
The deployed Next copy of sqlite-vec keeps its native extension beside the
JavaScript package, and both CommonJS and ESM loads are probed. Windows session
launchers select UTF-8 before reading paths, including paths with non-ASCII
characters. Slow controller probes stay within the existing startup deadline.
The current Claude Code npm package uses a native executable. Shim discovery
handles that executable as well as JS entry points. Sign-in uses fixed commands
through Windows command discovery, supporting npm shims, native installs and
WinGet. The agentex source suite passed 1,771 tests
with six skips, and its typecheck passed.

## PC checklist

1. In Windows Settings, open System, then About. Confirm an x64-based processor
   and 64-bit Windows 10 version 1809 or newer, or Windows 11.
2. Open the supplied Actions run while signed into GitHub. Under Artifacts,
   download `ri-windows-x64-preview`. Extract the ZIP and open `Ri-Setup-…-x64.exe`.
3. If Windows says it protected your PC, choose **More info**, then **Run anyway**.
   The preview is unsigned. Install for your account and open Ri.
   Installation can take 10 minutes or longer. Let it finish.
4. Choose **Start a new Ri**. Use **Install Claude Code** or **Install Codex**,
   then **Sign in**. Complete the browser sign-in and send a short chat message.
   Try the other tool too if your account supports it.
5. Create a task, complete it, and write a note. Close Ri, reopen it and check
   that both records remain. Install the supplied newer test installer only
   when asked, then check the same records again.
6. Report the Windows version, which coding tool you tried, and the first step
   that did not work. A photo of an error is enough. No terminal commands needed.
