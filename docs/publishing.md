# Publishing Ri

How releases get from this repository to computers (docs/always-on-spec.md sections 5, 7 and 7.7). CI builds every platform and signs one feed. Installed copies check that feed, verify the signature, and update themselves by the rule in section 7.2.

## What gets published

Each version is a GitHub Release tagged `vX.Y.Z`, holding the files people and updaters download:

| File | For |
| --- | --- |
| `ri-runtime-<version>-<platform>-<arch>.tar.gz` | The install script and automatic updates |
| `Ri-<version>-arm64.dmg`, `Ri-<version>.dmg` | People installing the Mac app |
| `Ri-<version>-*-mac.zip`, `*.AppImage` and `*.yml` | The desktop app updating itself |

One more release, tagged `feed`, holds the signed metadata. Its files are replaced as new versions ship, at stable addresses:

| File | What it says |
| --- | --- |
| `stable-<platform>-<arch>.json`, `latest-<platform>-<arch>.json` | The newest release on that channel |
| `<version>-<platform>-<arch>.json` | That version, which a connected computer asks for by number |
| `index-<platform>-<arch>.json` | Every version kept and what each can talk to, for finding a bridge release |
| `install.sh` | The install script, with this feed and public key written in |

Metadata expires after 30 days, so a frozen feed can't hold anyone back. A workflow signs everything again each week.

## Setting it up, once

1. **Make the signing key.** `pnpm release:keygen` writes it to `~/.config/ri-release` and prints two commands that add it to the repository. Keep a copy of the private key somewhere safe. Losing it means no more updates for anyone who already installed Ri, because every copy trusts this one key.
2. **Decide the address.** The workflow uses this repository's Releases, `https://github.com/<owner>/<repo>/releases/download/feed/`. That address is written into every installation, so moving it later means moving them all. A domain of your own in front of it can be set by changing `RI_RELEASE_FEED` in `.github/workflows/release.yml` before the first release.
3. **Optional, a Developer ID.** Without one, the Mac app is ad-hoc signed. macOS warns on first open, it can't update itself and it can't show notifications. The server and pages it runs still update, because those come from the signed feed. To sign it, get a Developer ID ($99 a year from Apple), then add the variable `CSC_NAME` and the secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

GitHub Releases are free for a public repository, and so are its Actions minutes.

The Linux builds run on the oldest Ubuntu GitHub still offers, since native modules only work on systems at least as new as the one that built them. When GitHub retires `ubuntu-22.04`, move to the next one and note which servers that leaves behind.

## Publishing a version

```sh
npm version 0.2.0 --no-git-tag-version
git commit -am "chore: release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

CI builds all four platforms, then publishes to `latest`. The notes come from the `feat:` and `fix:` commit subjects since the previous tag. Everyone on `latest` updates at their next quiet moment.

When it has proven itself, run the **Publish a release** workflow by hand with `promote` and the version, which moves `stable` to it. Everyone starts on `stable`, and the install script needs one, so promote the very first release once it's up.

To pull a bad release, run it with `withdraw` and the version. Nothing moves to it again, and publishing a newer one gets everyone off it.

A version can only be published once. To fix a mistake, publish the next one.

## Installing

```sh
curl -fsSL https://github.com/<owner>/<repo>/releases/download/feed/install.sh | sh
ri start
```

Or download the dmg from the newest release.

## A dmg by hand, today

`pnpm desktop:dmg` makes an ad-hoc signed dmg at `release/desktop/`, with no key and no account needed. Someone opening it for the first time has to allow it in System Settings under Privacy & Security, and it has no feed, so it never updates by itself. Installing a published copy of the app later, or running the install script, connects that computer to the feed, and its Ri starts updating. Build it on the same kind of Mac as the person it's for (Apple silicon or Intel).

## Working from a checkout

`ri update --from <checkout>` builds your own releases instead, with no feed involved (spec section 8). `ri update --from published` goes back.

## Trying it without publishing

`desktop/publish-release.mjs` only writes a folder, so a full run can be tried against a local HTTPS server. `personal/always-on-acceptance/` has one.
