/**
 * `<app> export` — manage the live DB-to-markdown mirror.
 *
 * The mirror runs automatically; this command is for manual control:
 *
 *   <app> export             force a full sync right now (the reconciler)
 *   <app> export status      show file counts per type
 *   <app> export path        print the brain directory
 *
 * Distinct from `<app> backup`, which writes a timestamped one-shot snapshot.
 */

import pc from 'picocolors';
import fs from 'node:fs/promises';
import { Command } from 'commander';
import { isMirrorEnabled, MIRROR_DISABLED_ENV } from '@/lib/export/mirror/config';
import { reconcileAll } from '@/lib/export/mirror/reconcile';
import { getBrainDir } from '@/lib/config/paths';

export function registerExportCommand(program: Command) {
  const exportCmd = program
    .command('export')
    .description('Force a full sync of the live markdown mirror')
    .action(async () => {
      if (!isMirrorEnabled()) {
        console.error(pc.yellow(`Export mirror is disabled (${MIRROR_DISABLED_ENV}=1)`));
        process.exit(1);
      }
      console.log(pc.dim(`Syncing mirror at ${getBrainDir()}…`));
      const stats = await reconcileAll();
      console.log(pc.green('Sync complete.'));
      console.log(`  synced:   ${stats.synced}`);
      console.log(`  skipped:  ${stats.skipped}`);
      if (stats.orphaned > 0) {
        console.log(pc.yellow(`  orphaned: ${stats.orphaned}  (files on disk with no DB row)`));
      }
      console.log(pc.dim(`  elapsed:  ${stats.elapsedMs}ms`));
    });

  exportCmd
    .command('path')
    .description('Print the brain directory')
    .action(() => {
      console.log(getBrainDir());
    });

  exportCmd
    .command('status')
    .description('Show mirror file counts per type')
    .action(async () => {
      const root = getBrainDir();
      console.log(pc.dim(`Brain: ${root}`));
      console.log(pc.dim(`Enabled: ${isMirrorEnabled() ? 'yes' : 'no'}`));
      for (const type of ['tasks', 'notes', 'areas', 'stream'] as const) {
        const count = await countMdFiles(`${root}/${type}`);
        console.log(`  ${type.padEnd(8)} ${count}`);
      }
    });
}

async function countMdFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => !e.startsWith('.') && e.endsWith('.md')).length;
  } catch {
    return 0;
  }
}
