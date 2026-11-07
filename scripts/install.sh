#!/bin/sh
# Install Ri on a Mac or Linux computer: curl -fsSL <this file's address> | sh
#
# Installs software only, and asks no questions, since a piped script has no usable
# input on an SSH session. It checks the download against the release's signature and
# every file against its manifest. Run `ri start` afterwards. Options: --channel latest
set -eu

FEED="${RI_INSTALL_FEED:-__RI_FEED__}"
PUBLIC_KEY_BASE64="${RI_INSTALL_PUBLIC_KEY_BASE64:-__RI_PUBLIC_KEY_BASE64__}"
CHANNEL=stable
while [ $# -gt 0 ]; do
  case "$1" in
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --channel=*) CHANNEL="${1#--channel=}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$CHANNEL" in stable|latest) ;; *) echo "Choose --channel stable or latest." >&2; exit 2 ;; esac

fail() { echo "Ri wasn't installed: $1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "this script needs $1."; }
need curl; need tar; need base64; need sed
case "$(uname -s)" in
  Darwin) PLATFORM=darwin ;;
  Linux) PLATFORM=linux ;;
  *) fail "this script installs Ri on macOS and Linux." ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) fail "there's no Ri for $(uname -m) yet." ;;
esac
if command -v sha256sum >/dev/null 2>&1; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else fail "this script needs sha256sum or shasum."; fi

# In the home folder: /tmp is often too small to unpack a release into.
WORK="$(mktemp -d "$HOME/.ri-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM
FEED="${FEED%/}"
echo "Finding the newest Ri on the $CHANNEL channel for $PLATFORM-$ARCH..."
curl -fsSL --proto '=https' --tlsv1.2 -o "$WORK/release.json" "$FEED/$CHANNEL-$PLATFORM-$ARCH.json" || fail "no release found at $FEED."
PAYLOAD="$(sed -n 's/.*"payload":"\([^"]*\)".*/\1/p' "$WORK/release.json")"
[ -n "$PAYLOAD" ] || fail "the release feed answered with something unexpected."
printf '%s' "$PAYLOAD" | base64 --decode > "$WORK/payload.json" 2>/dev/null || printf '%s' "$PAYLOAD" | base64 -D > "$WORK/payload.json" || fail "the release feed answered with something unexpected."
RUNTIME="$(sed -n 's/.*"runtime":{\([^}]*\)}.*/\1/p' "$WORK/payload.json")"
URL="$(printf '%s' "$RUNTIME" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
SHA256="$(printf '%s' "$RUNTIME" | sed -n 's/.*"sha256":"\([^"]*\)".*/\1/p')"
VERSION="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$WORK/payload.json")"
[ -n "$URL" ] && [ -n "$SHA256" ] || fail "the release feed answered with something unexpected."
echo "Downloading Ri $VERSION..."
curl -fL --proto '=https' --tlsv1.2 --progress-bar -o "$WORK/runtime.tar.gz" "$URL" || fail "the download didn't finish. Check your connection and try again."
[ "$(sha256 "$WORK/runtime.tar.gz")" = "$SHA256" ] || fail "the download doesn't match its checksum."
mkdir "$WORK/release"
tar -xzf "$WORK/runtime.tar.gz" -C "$WORK/release" || fail "the download couldn't be unpacked."
printf '%s' "$PUBLIC_KEY_BASE64" | base64 --decode > "$WORK/public.pem" 2>/dev/null || printf '%s' "$PUBLIC_KEY_BASE64" | base64 -D > "$WORK/public.pem"
echo "Checking the signature and every file..."
RI_RUNTIME_REPO="$WORK/release/server" "$WORK/release/node/bin/node" "$WORK/release/server/dist/cli/index.mjs" service install-release "$WORK/release" --envelope "$WORK/release.json" --public-key "$WORK/public.pem" --channel "$CHANNEL" || fail "the release didn't pass its checks."
BIN="${RI_COMMAND_DIR:-$HOME/.local/bin}"
RUN=ri
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    # A profile only takes effect in a new shell, so this one needs the full path.
    RUN="$BIN/ri"
    case "$(basename "${SHELL:-sh}")" in
      zsh) PROFILE="$HOME/.zprofile" ;;
      bash) if [ "$PLATFORM" = darwin ]; then PROFILE="$HOME/.bash_profile"; else PROFILE="$HOME/.profile"; fi ;;
      *) PROFILE="$HOME/.profile" ;;
    esac
    if ! grep -qs '.local/bin' "$PROFILE"; then
      printf '\n# Added by Ri\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$PROFILE"
      echo "Added $BIN to the PATH in $PROFILE. Open a new terminal to use it."
    fi
    ;;
esac
echo
echo "Ri $VERSION is installed."
echo "Run: $RUN start"
