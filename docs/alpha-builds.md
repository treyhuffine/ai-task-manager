# Alpha installers

Run **Alpha desktop builds** (`.github/workflows/alpha.yml`) manually from the
branch to share. `target: all` builds native installers for all five targets:

| Target | Runner | Artifact | Installer |
| --- | --- | --- | --- |
| macos-arm64 | macos-15 | ri-alpha-darwin-arm64 | DMG |
| macos-x64 | macos-15-intel | ri-alpha-darwin-x64 | DMG |
| linux-x64 | ubuntu-22.04 | ri-alpha-linux-x64 | Debian package and AppImage |
| linux-arm64 | ubuntu-22.04-arm | ri-alpha-linux-arm64 | Debian package and AppImage |
| windows-x64 | windows-2025 | ri-alpha-win32-x64 | NSIS .exe |

Each artifact also contains its runtime tarball. On Windows, this is the packaged
runtime payload, not an always-on headless installation. End users open the
installer under `desktop/`. GitHub requires sign-in to download Actions artifacts,
even from a public repository. Artifacts expire after 14 days.

Alpha always uses `--share`: free ad-hoc signing on macOS, unsigned Linux and
Windows installers, no update feed, and no release or tag publication. It never
packages the optional speech helper. The artifact-bound speech review process
in `desktop/speech/RELEASE.md` remains a separate publisher responsibility.

## Installer qualification

Enable `installer_checks` to test the actual installed bytes. It is off by
default, and these jobs never run because someone opens a pull request.
The native probes and desktop contracts run before packaging. Installer
artifacts are uploaded before the longer GUI checks, and a matching
`-qualification` artifact records reports and screenshots.

Windows checks install, first-run setup, ACLs, real tool installation, a test
harness chat, terminal and signed CLI use, task and note editing, process cleanup,
reopen, higher-version upgrade, and uninstall while preserving the Home.
The extra higher-version installer is a separate `-upgrade-fixture` artifact,
not an end-user download.

Mac and Linux checks install the real DMG or Debian package, verify native
dependencies and runtime contents, choose a Home, install Codex, chat through a
test harness, edit tasks and notes, and quit, reinstall and reopen with data
preserved. Linux also checks AppImage extract-and-run with Chromium sandboxing
and Debian removal while keeping the Home. Native supervisor checks require an
explicit disposable GitHub-hosted account opt-in. Never run these installer
scripts on the production computer.

To repeat checks without rebuilding unchanged installers, choose their `target`,
enable `installer_checks`, and set `installer_run` to the original alpha run ID.
The source run must include its Windows upgrade fixture for Windows lifecycle
checks. Retests download those exact bytes and upload only new qualification
reports. They do not republish the installer archives.

## Platform limits

Mac requires macOS 13.5 or newer. After opening Ri once, use System Settings,
Privacy & Security, Open Anyway if macOS blocks it. Native Mac notifications
need an Apple-issued signing identity and are unavailable in these builds.

Linux builds use Ubuntu 22.04 as the baseline. FUSE mounting, other distributions
and actual recipient hardware need separate checks.

Windows currently targets Intel and AMD x64. Its Home runs while Ri is open.
Scheduled Task startup, background operation after app exit, self-updates and
speech are unavailable. Close Ri before replacing it with a newer installer.
The installer and uninstaller keep the Home. Windows ARM and real provider
account sign-in/chat need separate qualification.

## Consolidation notes

The Windows port keeps the newer main settings, updates, local loopback and
packaging behavior on Mac and Linux. Windows Install and Sign in use the shared
desktop harness helper rather than a second UI and IPC implementation. The
agentex 0.0.50 patch preserves main's OpenCode isolation fix and adds the reviewed
Windows npm-shim and skill-junction fixes. The source branch is pushed to
agentex's own origin without publishing a library version.

The separate Mac/Linux preview workflows and Windows job in `desktop.yml` are
retired in favor of alpha. Old qualification records remain in
`macos-preview.md`, `linux-preview.md`, and `windows-first-version.md` as evidence
of the earlier bytes. Windows edits to the removed in-repository app kit and
included-app staging scripts are left behind because personal apps now live in
their own repositories. The public runtime metadata permission fix is retained,
while Home credentials remain private.
