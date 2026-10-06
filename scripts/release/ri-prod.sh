#!/bin/sh
# ri-prod: run, promote and roll back the production Ri on this computer.
# Installed by `pnpm release` into ~/ri-release/bin and linked from
# ~/.local/bin (scripts/release/ri-prod.sh in the checkout). See
# docs/environments.md.
#
#   ri-prod status            what's live, what's ready, what's running
#   ri-prod start [args]      go live with the newest ready release (or the
#                             current one), then run `ri start [args]`
#   ri-prod rollback [args]   go back to the release before, then start it
#   ri-prod log               the release history
#
# Production must be stopped first (Ctrl-C in its terminal). This never
# stops it for you: sessions running under production would die mid-turn.
# ri-managed: release-prod
set -eu

RELEASE_DIR="${RI_RELEASE_DIR:-$HOME/ri-release}"
PROD_ROOT="${RI_PROD_ROOT:-$HOME/ri}"
PROD_PORT="${RI_PROD_PORT:-4224}"
BACKUP_DIR="${RI_BACKUP_DIR:-$HOME/ri-backups}"
LOG="$RELEASE_DIR/releases.log"
BIN="${RI_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
die() { printf 'ri-prod: %s\n' "$*" >&2; exit 1; }

# The real folder a release link points at, or nothing.
target() { [ -L "$RELEASE_DIR/$1" ] && (cd "$RELEASE_DIR/$1" 2>/dev/null && pwd -P) || true; }

# One field of a release's .ri-release.json.
field() {
  [ -f "$1/.ri-release.json" ] || { printf '?'; return; }
  node -e 'const r=require(process.argv[1]); process.stdout.write(String(r[process.argv[2]] ?? "?"))' "$1/.ri-release.json" "$2"
}

describe() {
  if [ -z "$1" ]; then printf 'none'; return; fi
  printf '%s  %s  (built %s)' "$(field "$1" short)" "$(field "$1" subject)" "$(field "$1" builtAt)"
}

# Migrations a release carries, and how many production has applied.
release_migrations() { node -e 'const j=require(process.argv[1]); process.stdout.write(String(j.entries.length))' "$1/drizzle/meta/_journal.json"; }
applied_migrations() {
  if [ -f "$PROD_ROOT/data.db" ]; then sqlite3 -readonly "$PROD_ROOT/data.db" 'select count(*) from __drizzle_migrations' 2>/dev/null || printf '0'; else printf '0'; fi
}

# The pid listening on the production port, if any.
running_pid() { lsof -nP -iTCP:"$PROD_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true; }

link() {
  # Replace a release link in one step: a new link renamed over the old.
  ln -s "$2" "$RELEASE_DIR/.$1.tmp.$$"
  mv -f "$RELEASE_DIR/.$1.tmp.$$" "$RELEASE_DIR/$1"
}

log() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$LOG"; }

# The production `ri` in ~/.local/bin, first on PATH in every shell. Only a
# file this tool installed is ever replaced.
install_cli() {
  live="$1"
  mkdir -p "$BIN"
  for pair in "ri:ri.sh:release-cli" "ri-prod:ri-prod.sh:release-prod"; do
    name=${pair%%:*}; rest=${pair#*:}; src=${rest%%:*}; mark=${rest#*:}
    dest="$BIN/$name"
    if [ -e "$dest" ] && ! grep -q "ri-managed: $mark" "$dest" 2>/dev/null; then
      say "Left $dest alone: it isn't one this tool installed. Remove it to use the production $name."
      continue
    fi
    cp "$live/scripts/release/$src" "$dest.tmp.$$" && chmod 755 "$dest.tmp.$$" && mv -f "$dest.tmp.$$" "$dest"
  done
}

start_release() {
  next_dir="$1"; shift
  pid=$(running_pid)
  [ -z "$pid" ] || die "production is running (pid $pid on port $PROD_PORT). Stop it first (Ctrl-C in its terminal), then run this again."
  current_dir=$(target current)

  if [ "$next_dir" != "$current_dir" ]; then
    carried=$(release_migrations "$next_dir")
    applied=$(applied_migrations)
    if [ "$carried" -gt "$applied" ]; then
      # The new release changes the database. Keep a consistent copy of it
      # from before, the only way back once the migration has run.
      mkdir -p "$BACKUP_DIR"
      backup="$BACKUP_DIR/data-$(date -u +%Y%m%dT%H%M%SZ)-before-$(field "$next_dir" short).db"
      say "This release adds $((carried - applied)) database migration(s). Backing up the database first:"
      say "  $backup"
      sqlite3 "$PROD_ROOT/data.db" ".backup '$backup'"
      chmod 600 "$backup"
      log backup "$backup"
    elif [ "$carried" -lt "$applied" ]; then
      say "Warning: this release knows $carried migration(s) but the database has $applied. It will refuse to open"
      say "the database. To use it, restore the backup taken before the newer release (docs/environments.md)."
    fi
    [ -n "$current_dir" ] && link previous "$current_dir"
    link current "$next_dir"
    log live "$(field "$next_dir" sha) $(field "$next_dir" subject)"
    say "Live: $(describe "$next_dir")"
  fi
  rm -f "$RELEASE_DIR/next"

  live=$(target current)
  install_cli "$live"
  cd "$live"
  say "Starting production from $live"
  # A shell inside a harness session carries that session's identity. The
  # server mints its own.
  unset RI_SESSION_CREDENTIAL RI_SESSION_CLI
  RI_RUNTIME_REPO="$live"
  export RI_RUNTIME_REPO
  if [ "$PROD_ROOT" != "$HOME/ri" ]; then RI_ROOT="$PROD_ROOT"; export RI_ROOT; fi
  exec node dist/cli/index.mjs start "$@"
}

cmd="${1:-status}"
[ $# -gt 0 ] && shift
case "$cmd" in
  status)
    pid=$(running_pid)
    say "Live:     $(describe "$(target current)")"
    say "Ready:    $(describe "$(target next)")"
    say "Previous: $(describe "$(target previous)")"
    if [ -n "$pid" ]; then
      cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
      say "Running:  pid $pid on port $PROD_PORT, from ${cwd:-unknown}"
      case "$cwd" in
        "$RELEASE_DIR"/builds/*) ;;
        *) say "          (not a release: production still runs from a checkout. Stop it and run ri-prod start.)" ;;
      esac
    else
      say "Running:  no (start it with ri-prod start)"
    fi
    say "Database: $(applied_migrations) migration(s) applied in $PROD_ROOT"
    ;;
  start)
    next_dir=$(target next)
    [ -n "$next_dir" ] || next_dir=$(target current)
    [ -n "$next_dir" ] || die "no release yet. Run \`pnpm release\` in the checkout first."
    start_release "$next_dir" "$@"
    ;;
  rollback)
    previous_dir=$(target previous)
    [ -n "$previous_dir" ] || die "there is no previous release to go back to."
    current_dir=$(target current)
    rm -f "$RELEASE_DIR/next"
    start_release "$previous_dir" "$@"
    ;;
  log)
    [ -f "$LOG" ] && tail -n 30 "$LOG" || say "No releases yet."
    ;;
  -h|--help|help)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    die "unknown command $cmd. Try ri-prod help."
    ;;
esac
