# Linux preview installers

Build Linux x64 on Ubuntu 22.04 from `ai-task-manager/macos-preview-dmg`.
Run **Desktop and headless runtime** with `linux_preview` enabled. It can run
alongside `macos_preview` without starting the full runtime qualification matrix.

The `ri-linux-x64-preview` artifact contains a Debian package and an AppImage.
The Debian package is the recommended choice on Ubuntu and Debian. AppImages
can require a separate FUSE library. The portable test uses the AppImage's
[documented extract-and-run mode](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

This first Linux preview targets Intel and AMD x64, with Ubuntu 22.04 as the
build and test baseline. Other distributions and Linux ARM are unqualified.
Node, npm and native dependencies are bundled. Claude Code and Codex have
in-app Install and Sign in buttons. No speech helper or update feed is included.
There is no paid signing certificate, public release or tag.

Artifacts expire after 14 days. Any signed-in GitHub user can download artifacts
from this public repository. Only installers and synthetic qualification reports
are uploaded, never the test Home or private account data.

## Qualification

- [ ] Native Ubuntu 22.04 x64 build produces both installers
- [ ] Debian package installs and bundles working native dependencies
- [ ] First-run Home choice starts the user service and opens Ri with Chromium sandboxing
- [ ] In-app Codex installation offers sign-in
- [ ] Task completion and note title/body editing persist
- [ ] Chat dispatch streams a stand-in harness reply
- [ ] Quit, reinstall and reopen preserve the Home and its authored data
- [ ] AppImage extract-and-run opens the same Home with Chromium sandboxing
- [ ] Debian uninstall preserves the Home
- [ ] Artifact contents and checksums are recorded
- [ ] Recipient signs into a real provider and chats on their Linux desktop

The native supervisor smoke refuses local and self-hosted accounts. On the
opted-in GitHub-hosted runner, it installs and removes only its own Home's
systemd unit. Its Home, runtime store and app profile stay in temporary folders.
The disposable account's real home is used to make its user service discoverable.

## Recipient checklist

1. Sign into GitHub, download `ri-linux-x64-preview` and extract the ZIP.
2. On Ubuntu or Debian, open the `.deb` in the package installer and install Ri.
3. Open Ri from the applications menu and start a new Ri.
4. Install Claude Code or Codex in Ri and finish browser sign-in.
5. Ask it to create a task and note. Edit the note, quit and reopen, and check
   that the records remain. A screenshot of the first error is enough.

For an AppImage, first enable **Allow executing file as program** in its file
properties. FUSE setup and desktop sandbox policies vary by distribution.
The Home runs independently of the viewer, as it does in the Mac preview.
