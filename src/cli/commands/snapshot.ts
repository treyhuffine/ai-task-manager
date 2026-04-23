/**
 * `<app> snapshot [--out <path>]`
 *
 * Writes a local, dated, point-in-time artifact: DB dump + mirror markdown.
 * Default location: `<app-root>/snapshots/<app>-snapshot-<ISO-timestamp>/`.
 *
 * Runs `reconcileAll()` first so the captured markdown is current. Restore
 * instructions live in the snapshot folder's README.md.
 *
 * For cloud/remote backup (dated DB + synced brain), see `scripts/backup.ts`.
 */

import pc from 'picocolors';
import { Command } from 'commander';
import { reconcileAll } from '@/lib/export/mirror';
import { createSnapshot } from '@/lib/export/snapshot';

export function registerSnapshotCommand(program: Command) {
  program
    .command('snapshot')
    .description('Write a local, dated snapshot (DB + markdown) to <app-root>/snapshots/')
    .option('-o, --out <path>', 'custom output directory (bypasses dated-folder convention)')
    .action(async (opts: { out?: string }) => {
      const reconcile = await reconcileAll();
      if (reconcile.synced > 0) {
        console.log(pc.dim(`Flushed mirror: ${reconcile.synced} synced, ${reconcile.skipped} skipped.`));
      }

      const result = await createSnapshot({ outDir: opts.out });
      console.log(pc.green('Snapshot complete.'));
      console.log(pc.dim(`  ${result.dir}`));
      console.log(`  db: ${formatBytes(result.dbBytes)}`);
      console.log(`  mirror: ${result.mirrorFileCount} markdown files`);
    });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
