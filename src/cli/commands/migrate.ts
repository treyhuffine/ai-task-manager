/**
 * `<app> migrate` — one-shot data-dir layout migration.
 *
 * Moves an existing home off an older layout (flat, or the `brain/` subfolder)
 * into the current shape: content at the home root, `.config/` (token +
 * settings), `.work/` (scratch). Idempotent — safe to re-run; fresh installs
 * need nothing. Worktrees/clones are left in place (DB-referenced by absolute
 * path); only new ones land in `.work`.
 *
 * Available both here (so it runs wherever the CLI is installed) and as
 * `pnpm migrate:layout` in the repo — both call `runLayoutMigration`.
 */

import pc from 'picocolors';
// Type-only: the registrar takes the caller's `program`; this module needs no
// commander at runtime, so `scripts/migrate-layout.ts` can import the runner
// without pulling commander in.
import type { Command } from 'commander';
import { migrateLayout, getAppRoot } from '@/lib/config/paths';

/** Run the migration (or preview it) and print a human summary. Shared by the
 *  `migrate` CLI command and the `pnpm migrate:layout` script. */
export function runLayoutMigration(opts: { dryRun: boolean }): void {
  const { dryRun } = opts;
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

export function registerMigrateCommand(program: Command) {
  program
    .command('migrate')
    .description('Migrate the data dir to the current layout (home root + .config + .work)')
    .option('-n, --dry-run', 'preview the moves without touching disk')
    .action((opts: { dryRun?: boolean }) => {
      runLayoutMigration({ dryRun: opts.dryRun ?? false });
    });
}
