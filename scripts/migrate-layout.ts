#!/usr/bin/env tsx
/**
 * Repo entry point for the data-dir layout migration. Thin wrapper over the
 * shared runner in `src/cli/commands/migrate.ts` — the same logic backs the
 * installed `<cli> migrate` command, so output + behavior stay identical.
 *
 * Usage:
 *   pnpm migrate:layout --dry-run          # preview (prod home ~/<app>)
 *   pnpm migrate:layout                    # move (prod home)
 *   FLOW_ROOT=~/flow-dev pnpm migrate:layout --dry-run
 *   FLOW_ROOT=~/flow-dev pnpm migrate:layout
 *
 * Idempotent — safe to re-run. Fresh installs need nothing. Worktrees/clones
 * are left in place; only new ones land in .work.
 */

import { runLayoutMigration } from '../src/cli/commands/migrate';

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');
runLayoutMigration({ dryRun });
