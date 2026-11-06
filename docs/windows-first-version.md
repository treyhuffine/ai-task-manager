# First Windows version

Native Windows x64 preview, built on GitHub Actions. No public release or
download is published. The installer is unsigned and installs for the current
user. Ri runs while its desktop app is open.

The pinned Electron 44.4.5 and Node 26.5.0 list Windows 10 as their minimum.
Use Windows 10 version 1809 or newer, which also covers the terminal and
Claude Code requirements. A 64-bit Windows 11 installation qualifies too.
Windows 7/8, 32-bit Windows and Windows ARM are outside this preview.
Sources: [Electron](https://github.com/electron/electron/blob/v44.4.5/README.md#platform-support),
[Node](https://github.com/nodejs/node/blob/v26.5.0/BUILDING.md#platform-list).
[Claude Code requirements](https://code.claude.com/docs/en/setup#system-requirements).

## Completion checklist

- [ ] Actions produces an unsigned x64 `.exe` artifact
- [ ] Installer installs without a developer environment
- [ ] First launch creates a Home and finishes setup
- [ ] Windows process ownership, control transport and shutdown work
- [ ] Claude Code and Codex discovery, installation, authentication and chat work
- [ ] Tasks and notes work
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

## Verification

Implementation and runner evidence will be recorded here as each step passes.

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
current account and SYSTEM before secrets are written. POSIX permission bits
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
`agentex-windows-first-version` worktree, commit `09495b2`. Ri carries those
fixes in its existing pnpm patch until an approved library release includes
them. No agentex version was published.

## Runner checks

Dispatch Desktop and headless runtime with **Build only the Windows preview**.
The Windows job uploads only the `.exe` and small qualification reports. It
never creates a release or an update feed. Native SQLite, sqlite-vec and PTY
probes run under the bundled Node before packaging.

`desktop/windows-smoke.ts` installs the NSIS output on a disposable hosted
Windows account, chooses a fresh Home, tests a real Codex installation and a
stand-in Claude protocol, writes tasks and notes, edits a note in the app,
quits, reopens, reinstalls, upgrades and uninstalls. The higher-version upgrade
candidate uses the same server commit, so it isolates installer replacement
and data preservation. The first-run path applies the real database migrations.
No provider credentials are supplied and no real billed model request runs.

macOS checks so far: desktop suite 571 passed with one existing skip, focused
core checks passed, typecheck and desktop compilation passed. The broader
repository suite has existing failures, including ten message-route tests
reproduced unchanged at the starting commit. A new IPC shutdown listener also
conflicted with Vitest worker messages. It is now restricted to app-owned
servers and uses a Ri-specific message, and the HTTP-server checks pass.
