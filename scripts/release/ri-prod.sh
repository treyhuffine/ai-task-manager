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
#   ri-prod rollback --restore-db [args]
#                             the same past a database migration: set the
#                             current database aside and restore the backup
#                             taken before the newer release
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
  [ -f "$PROD_ROOT/data.db" ] || { printf '0'; return; }
  # A plain open: -readonly can't open a WAL database whose -shm is missing
  # (a freshly restored copy). A SELECT writes nothing either way.
  sqlite3 "$PROD_ROOT/data.db" 'select count(*) from __drizzle_migrations' 2>/dev/null || die "couldn't read the migrations applied in $PROD_ROOT/data.db."
}

# The pid listening on the production port, if any.
running_pid() { lsof -nP -iTCP:"$PROD_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true; }

link() {
  # Replace a release link in one step: a new link renamed over the old.
  # Plain `mv` would follow the old link into its folder (-h on macOS and
  # -T on Linux rename onto the link itself).
  tmp="$RELEASE_DIR/.$1.tmp.$$"
  ln -s "$2" "$tmp"
  mv -fh "$tmp" "$RELEASE_DIR/$1" 2>/dev/null || mv -fT "$tmp" "$RELEASE_DIR/$1"
  [ "$(cd "$RELEASE_DIR/$1" && pwd -P)" = "$(cd "$2" && pwd -P)" ] || die "couldn't point $1 at $2"
}

log() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$LOG"; }

# The production `ri` in ~/.local/bin, first on PATH in every shell. Only a
# file this tool installed is ever replaced. (`pnpm release` links ri-prod
# there itself, so it always runs the newest release's copy.)
install_cli() {
  dest="$BIN/ri"
  src="$RELEASE_DIR/bin/ri"
  [ -f "$src" ] || src="$1/scripts/release/ri.sh"
  [ -f "$src" ] || return 0
  mkdir -p "$BIN"
  if [ -e "$dest" ] && ! grep -q "ri-managed: release-cli" "$dest" 2>/dev/null; then
    say "Left $dest alone: it isn't one this tool installed. Remove it to use the production ri."
    return 0
  fi
  cp "$src" "$dest.tmp.$$" && chmod 755 "$dest.tmp.$$" && mv -f "$dest.tmp.$$" "$dest"
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
      release_real=$(cd "$RELEASE_DIR" 2>/dev/null && pwd -P || printf '%s' "$RELEASE_DIR")
      case "$cwd" in
        "$release_real"/builds/*) ;;
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
    restore=no
    if [ "${1:-}" = "--restore-db" ]; then restore=yes; shift; fi
    previous_dir=$(target previous)
    [ -n "$previous_dir" ] || die "there is no previous release to go back to."
    current_dir=$(target current)
    pid=$(running_pid)
    [ -z "$pid" ] || die "production is running (pid $pid on port $PROD_PORT). Stop it first (Ctrl-C in its terminal), then run this again."
    # Checked before anything moves: the older release refuses a database
    # that's ahead of it, so going back past a migration needs the backup.
    knows=$(release_migrations "$previous_dir")
    applied=$(applied_migrations)
    if [ "$knows" -lt "$applied" ]; then
      backup=$(ls -t "$BACKUP_DIR"/data-*-before-"$(field "$current_dir" short)".db 2>/dev/null | head -n 1 || true)
      if [ "$restore" != yes ]; then
        say "The previous release ($(field "$previous_dir" short)) knows $knows migration(s), but the database has $applied."
        say "It would refuse to open it. Going back means restoring the backup from before the newer release:"
        say "  ${backup:-(none found in $BACKUP_DIR)}"
        say "Anything written since then is only in the current database, which is kept, not deleted."
        [ -n "$backup" ] && say "To do it: ri-prod rollback --restore-db"
        exit 1
      fi
      [ -n "$backup" ] || die "no backup from before $(field "$current_dir" short) in $BACKUP_DIR."
      aside="$BACKUP_DIR/data-$(date -u +%Y%m%dT%H%M%SZ)-rolled-back-from-$(field "$current_dir" short)"
      mkdir -p "$aside"
      for suffix in "" -wal -shm; do
        [ -e "$PROD_ROOT/data.db$suffix" ] && mv "$PROD_ROOT/data.db$suffix" "$aside/"
      done
      cp "$backup" "$PROD_ROOT/data.db"
      chmod 600 "$PROD_ROOT/data.db"
      log restore "$backup (current database kept in $aside)"
      say "Restored $backup"
      say "The database you rolled back from is kept in $aside"
    fi
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
