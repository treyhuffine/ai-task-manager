# Mac preview DMGs

Build from `ai-task-manager/macos-preview-dmg`, based on local main `0a1e96b8`.
The Windows preview branch and its qualified installer stay separate.

Run **Desktop and headless runtime** on this branch with `macos_preview` enabled
and `macos_architecture` set to `both` (or just `arm64` or `x64`). Its reusable
**Mac preview DMG** workflow builds on native Apple silicon and Intel runners,
using `pnpm desktop:dmg`. It uploads only the DMG and small
qualification reports. It never publishes a release, a tag or an update feed.
Artifacts expire after 14 days. This repository is public, so any signed-in
GitHub user can download them.

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

- [ ] Both native DMGs build in Actions
- [ ] Mount DMG, copy Ri.app and verify its signature and native dependencies
- [ ] First-run Home choice and service start
- [ ] Install a real coding CLI through Settings
- [ ] Task completion and note title/body editing
- [ ] Streamed chat through a stand-in CLI
- [ ] Quit/reopen and replace Ri.app while keeping data
- [ ] Check archive contents for personal data and record the exact artifact
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
