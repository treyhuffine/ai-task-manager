/**
 * `<app> commit`
 *
 * Git-commits the current state of the markdown mirror (`<brain>/`). Creates
 * the git repo and `.gitignore` on first run if needed, excluding `data.db*`
 * and `attachments/` so only markdown ends up in history.
 *
 * Does not push. Configure a remote manually with:
 *   git -C <brain> remote add origin <url>
 *
 * Useful in a cron: pair with `scripts/backup.ts` for free markdown version
 * control alongside cloud backups.
 */

import pc from 'picocolors';
import { Command } from 'commander';
import { reconcileAll } from '@/lib/export/mirror';
import { commitBrain } from '@/lib/git/commit';

export function registerCommitCommand(program: Command) {
  program
    .command('commit')
    .description('Flush the mirror and git-commit the brain dir (init git if needed)')
    .action(async () => {
      const reconcile = await reconcileAll();
      if (reconcile.synced > 0) {
        console.log(pc.dim(`Flushed mirror: ${reconcile.synced} synced, ${reconcile.skipped} skipped.`));
      }

      const result = commitBrain();
      if (!result.committed) {
        console.log(pc.dim('No changes since last commit.'));
        return;
      }
      console.log(pc.green('Committed.'));
      console.log(pc.dim(`  ${result.sha}  ${result.message}`));
      console.log(pc.dim(`  in ${result.dir}`));
    });
}
