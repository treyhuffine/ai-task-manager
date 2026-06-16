#!/usr/bin/env tsx
/**
 * One-shot data-dir layout migration. Moves an existing home off an older
 * layout (flat, or the `brain/` subfolder) into the current shape: content at
 * the home root, `.config/` (token + settings), `.work/` (scratch). Idempotent
 * — safe to re-run; fresh installs need nothing. Worktrees/clones are left in
 * place (DB-referenced by absolute path); only new ones land in `.work`.
 *
 * Usage:
 *   pnpm migrate:layout --dry-run          # preview (prod home ~/<app>)
 *   pnpm migrate:layout                    # move (prod home)
 *   FLOW_ROOT=~/flow-dev pnpm migrate:layout --dry-run
 *   FLOW_ROOT=~/flow-dev pnpm migrate:layout
 */

import pc from 'picocolors';
import { migrateLayout, getAppRoot } from '../src/lib/config/paths';

function main() {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');
  const home = getAppRoot();

  console.log(pc.bold(`Layout migration${dryRun ? pc.yellow(' (dry run)') : ''}`));
  console.log(pc.dim(`  home: ${home}`));

  if (!dryRun) {
    // The DB + its WAL/SHM sidecars get renamed. Moving them out from under a
    // live connection corrupts state — stop the server before applying.
    console.log(pc.yellow('  ⚠ stop the app first (it moves data.db while running = corruption).'));
  }

  const { migrated, moved } = migrateLayout({ dryRun });

  if (!migrated) {
    console.log(pc.green('  nothing to migrate — already in the current layout (or a fresh install).'));
    return;
  }

  console.log(pc.dim(`  ${dryRun ? 'would move' : 'moved'} ${moved.length}:`));
  for (const m of moved) console.log(`    ${m}`);

  if (dryRun) {
    console.log(pc.yellow('\n  dry run — nothing was moved. Re-run without --dry-run to apply.'));
  } else {
    console.log(pc.green('\n  done. Restart the app so it picks up the new paths.'));
  }
}

main();
