# First Windows version

Native Windows x64 preview, built on GitHub Actions. No public release or
download is published. The installer is unsigned and installs for the current
user. Ri runs while its desktop app is open.

The pinned Electron 44.4.5 and Node 26.5.0 list Windows 10 as their minimum.
Windows 7/8, 32-bit Windows and Windows ARM are outside this preview.
Sources: [Electron](https://github.com/electron/electron/blob/v44.4.5/README.md#platform-support),
[Node](https://github.com/nodejs/node/blob/v26.5.0/BUILDING.md#platform-list).

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
