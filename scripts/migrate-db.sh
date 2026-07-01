#!/bin/sh
# One-time: migrate an existing DB onto the clean/squashed schema, preserving data.
# Run from anywhere with the app STOPPED. Backs up, rebuilds, swaps.
#
#   Usage: scripts/migrate-db.sh [dbPath]      (default: $HOME/flow/data.db  = prod)
#
# Reverting is a one-liner:  mv <dbPath>.bak-clean-schema <dbPath>
set -e
cd "$(dirname "$0")/.."   # repo root (so node resolves node_modules + src/ + drizzle/)
DB="${1:-$HOME/flow/data.db}"

[ -f "$DB" ] || { echo "No DB at $DB"; exit 1; }
if lsof "$DB" 2>/dev/null | grep -q .; then
  echo "ERROR: $DB is open — stop the app first, then re-run."
  lsof "$DB" 2>/dev/null | awk 'NR==1 || /node|next|tsx/' | head -5
  exit 1
fi

echo "Backing up -> $DB.bak-clean-schema"
cp "$DB" "$DB.bak-clean-schema"

echo "Rebuilding onto clean schema..."
node scripts/clean-schema-rebuild.cjs "$DB" "$DB.new"

rm -f "$DB-wal" "$DB-shm"
mv "$DB" "$DB.preswap-old"
mv "$DB.new" "$DB"
[ -f "$DB.new-wal" ] && mv "$DB.new-wal" "$DB-wal" || true
[ -f "$DB.new-shm" ] && mv "$DB.new-shm" "$DB-shm" || true

echo "Done. $DB is on the clean schema. Backup: $DB.bak-clean-schema. Start the app."
