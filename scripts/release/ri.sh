#!/bin/sh
# ri: the production Ri command. Installed by `ri-prod` into ~/.local/bin
# (scripts/release/ri.sh in the checkout). See docs/environments.md.
#
# 1. Inside a harness session, hand off to the session's own launcher
#    (RI_SESSION_CLI), which acts on the home that started the session. A
#    login shell (Codex runs `zsh -lc`) rebuilds PATH so this file is found
#    before the launcher folder, and macOS's own /usr/bin/ri is not Ri.
# 2. Otherwise run the CLI of the release production runs
#    (~/ri-release/current), against the production home.
#
# Development uses `pnpm ri:dev` in the checkout instead.
# ri-managed: release-cli

if [ -n "${RI_SESSION_CLI:-}" ] && [ -x "$RI_SESSION_CLI" ]; then
  exec "$RI_SESSION_CLI" "$@"
fi

release="${RI_RELEASE_DIR:-$HOME/ri-release}/current"
repo=$(cd "$release" 2>/dev/null && pwd -P) || {
  echo "ri: no production release at $release. Run \`pnpm release\` in the checkout, then \`ri-prod start\`." >&2
  exit 1
}
RI_RUNTIME_REPO="${RI_RUNTIME_REPO:-$repo}"
export RI_RUNTIME_REPO
exec node "$repo/dist/cli/index.mjs" "$@"
