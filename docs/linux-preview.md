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

The Linux preview is ready for recipient testing:
[download the artifact ZIP](https://github.com/treyhuffine/ai-task-manager/actions/runs/42713656426/artifacts/13717756781).
It was built and tested from `6cd9a2f3` on Ubuntu 22.04 x64. The ZIP contains
both installers and expires on November 23, 2026.

| Installer | Bytes | SHA256 |
| --- | ---: | --- |
| `ri-desktop_0.1.0_amd64.deb` | 424,892,100, about 405 MiB | `603e92bb3408f441e063d5e105b8cf766425333170337e2a494d63c39628109e` |
| `Ri-0.1.0.AppImage` | 657,117,333, about 627 MiB | `0ba6f9f9ee86f251002bdbfe09d1ce59c47b6971ee35d322081d5cfd53e36c6d` |

[The qualification report and screenshot](https://github.com/treyhuffine/ai-task-manager/actions/runs/42713656426/artifacts/13717094625)
record eleven passing checks on these exact bytes. Both native launches keep
Chromium sandboxing enabled. The report inventories 89,419 runtime files and
finds no private Home, environment, Git files or configured update feed.
The local read-only Debian archive audit finds 85,602 regular files occupying
2,371,954,497 bytes, about 2.2 GiB, and no suspect private paths. Both local
installer checksums match the runner's report.

The first Linux install exposed root-owned runtime metadata that only its owner
could read. The qualified build publishes the version and file-hash metadata
with mode `0644`, so normal desktop users can read it. Home credentials retain
their private mode. The archive audit confirms root ownership and the corrected
mode on both metadata files.

- [x] Native Ubuntu 22.04 x64 build produces both installers
- [x] Debian package installs and bundles working native dependencies
- [x] First-run Home choice starts the user service and opens Ri with Chromium sandboxing
- [x] In-app Codex installation offers sign-in
- [x] Task completion and note title/body editing persist
- [x] Chat dispatch streams a stand-in harness reply
- [x] Quit, reinstall and reopen preserve the Home and its authored data
- [x] AppImage extract-and-run opens the same Home with Chromium sandboxing
- [x] Debian uninstall preserves the Home
- [x] Artifact contents and checksums are recorded
- [ ] Recipient signs into a real provider and chats on their Linux desktop

The native supervisor smoke refuses local and self-hosted accounts. On the
opted-in GitHub-hosted runner, it installs and removes only its own Home's
systemd unit. Its Home, runtime store and app profile stay in temporary folders.
The disposable account's real home is used to make its user service discoverable.
Real provider account authentication, recipient hardware, other distributions
and AppImage FUSE mounting remain unverified. The AppImage currently uses
Electron's default launcher icon.

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
