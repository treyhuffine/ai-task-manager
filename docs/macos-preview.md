# Mac preview DMGs

Build from `ai-task-manager/macos-preview-dmg`, based on local main `0a1e96b8`.
The Windows preview branch and its qualified installer stay separate.

Run **Desktop and headless runtime** on this branch with `macos_preview` enabled
and `macos_architecture` set to `both` (or just `arm64` or `x64`). Its reusable
**Mac preview DMG** workflow builds on native Apple silicon and Intel runners,
using `pnpm desktop:dmg`. It uploads the DMG and small qualification reports.
If disk image creation fails, it also preserves the signed app for two days so
packaging can be repaired without recompiling. It never publishes a release,
a tag or an update feed.
Artifacts expire after 14 days. This repository is public, so any signed-in
GitHub user can download them.

To repeat qualification of unchanged installer bytes, set `macos_installer_run`
to the earlier Actions run ID and select its architecture. The workflow downloads
that run's DMG, skips the production build and packaging, and runs the installer
checks again. The report records the DMG's SHA256.

The app uses a free ad-hoc signature, with no Apple Developer ID or notarization.
After the first attempt to open Ri, use System Settings, Privacy & Security,
Open Anyway. Do not disable Gatekeeper globally or use terminal workarounds.
This is the [Apple-documented exception](https://support.apple.com/en-us/102445)
for a trusted app from an unidentified developer.

Use the arm64 artifact for M1 or newer Apple silicon. Use x64 for Intel.
The bundled [Node 26.5 requires macOS 13.5 or newer](https://github.com/nodejs/node/blob/v26.5.0/BUILDING.md#platform-list).
Node and npm are bundled, and Install and Sign in buttons are available for
Claude Code and Codex. There is no configured update feed in this preview.
Native Mac notifications are unavailable without an Apple-issued signature,
and Ri explains this in notification settings.

## Qualification

The Apple silicon DMG is ready for recipient testing:
[download the artifact ZIP](https://github.com/treyhuffine/ai-task-manager/actions/runs/42707373918/artifacts/13714132891).
It contains `Ri-0.1.0-arm64.dmg`, built from `5b71a8fb`. The installer is
817,960,665 bytes (about 780 MiB), and the installed files occupy about 2.6 GiB.
SHA256: `55721765537528564b1df32481f6f56ac1b16d889a3ec4503111ec25dc86d4e9`.

[The qualification report and screenshot](https://github.com/treyhuffine/ai-task-manager/actions/runs/42707373918/artifacts/13716130176)
record nine passing checks on the exact DMG bytes, using the smoke at
`fdbbd809`. The first attempt with a custom `TMPDIR` failed service startup.
Retesting the same DMG with the runner's normal temporary directory passed
without changing the product. Native supervisor tests must use the OS account's
normal environment.

The local read-only audit also verified the signature, minimum macOS version,
checksum and 100,135 regular payload files, with no suspect private paths.
The test Home and provider account credentials are not in the installer or reports.

The Intel DMG is also ready for recipient testing:
[download the Intel artifact ZIP](https://github.com/treyhuffine/ai-task-manager/actions/runs/42712199756/artifacts/13717620106).
It contains `Ri-0.1.0.dmg`, built from `14d27ffd`, with 784,682,030 installer
bytes (about 748 MiB) and about 2.6 GiB of installed files.
SHA256: `9755bf8bfc141ec6119674568b0cb584f65b0bad506b892413b347606a154ca0`.
[Its report and screenshot](https://github.com/treyhuffine/ai-task-manager/actions/runs/42712199756/artifacts/13718175760)
record the same nine passing checks using the smoke at `cce5c5a2`. The initial
copy exceeded the test's three-minute limit. The unchanged DMG passed with a
ten-minute copy limit. The local read-only audit verified its signature,
minimum OS, checksum and 100,136 regular payload files, with no suspect private
paths.

The completed checks below apply to both processor versions.

- [x] Both native DMGs build in Actions
- [x] Mount DMG, copy Ri.app and verify its signature and native dependencies
- [x] First-run Home choice and service start
- [x] Install a real coding CLI through Settings
- [x] Task completion and note title/body editing
- [x] Streamed chat through a stand-in CLI
- [x] Quit/reopen and replace Ri.app while keeping data
- [x] Check archive contents for personal data and record the exact artifact
- [ ] Download and first-open approval on the recipient Mac
- [ ] Real provider account sign-in and chat on the recipient Mac

The automated smoke runs only on an opted-in disposable GitHub-hosted account.
It installs and removes only its own Home's launchd job and uses a temporary
Home, runtime store and profile. It never restarts the owner's Ri.

## Recipient checklist

1. Download the artifact for the Mac's processor while signed into GitHub.
2. Extract the ZIP, open the DMG, and drag Ri into Applications.
3. Open Ri once, then approve Open Anyway in Privacy & Security if macOS blocks it.
4. Start a new Ri, install Claude Code or Codex and complete browser sign-in.
5. Ask it to create a task and note, edit the note, quit and reopen, and check
   that the records remain. A photo of the first error is enough.

On Mac, the Home runs independently of the viewer. Closing or quitting the
viewer does not stop it. Local speech is not bundled in this preview.
