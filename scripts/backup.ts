/**
 * Backup orchestrator — remote push. Run with `tsx scripts/backup.ts` (or
 * from cron).
 *
 * Steps:
 *   1. Flush the live markdown mirror so it's fully current on disk.
 *   2. Dump the DB to `<app-root>/tmp/data.db` (consistent online backup).
 *   3. Push to the cloud using a per-type strategy (commented — wire in
 *      your provider below):
 *        - DB          → copy to `s3:.../db/flow-backup-<ts>.db` (keeps
 *                        history, one file per run).
 *        - brain/      → sync (overwrite, incremental), excluding `data.db*`.
 *                        Markdown and attachments update in place; rely on
 *                        S3 versioning for attachment point-in-time.
 *   4. Remove the temp DB dump.
 *
 * For a LOCAL dated artifact (no cloud), use `<app> snapshot` instead.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { reconcileAll } from '@/lib/export/mirror';
import { backupDb } from '@/lib/backup';
import { ensureTmpDir } from '@/lib/config/paths';

async function main() {
  const reconcile = await reconcileAll();
  console.log(
    `[backup] mirror flushed: synced=${reconcile.synced} skipped=${reconcile.skipped} orphaned=${reconcile.orphaned}`,
  );

  const tmpDir = ensureTmpDir();
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+/, '');
  const dbDump = path.join(tmpDir, `flow-backup-${stamp}.db`);
  await backupDb(dbDump);
  console.log(`[backup] db dumped: ${dbDump}`);

  // ── Cloud upload ──────────────────────────────────────────
  // Uncomment and edit for your provider. Two calls, per data type:
  //
  //   1. DB    — `copy`: one new file per run, remote keeps all versions.
  //              Use S3 lifecycle rules (e.g. 30 daily + 12 monthly) for retention.
  //   2. Brain — `sync`: overwrites remote with current local state, excluding
  //              the live `data.db*` files (torn-copy risk). Markdown and
  //              attachments are incremental; S3 versioning provides PITR for
  //              attachments if you need it.
  //
  //   import { execFileSync } from 'node:child_process';
  //   import { getBrainDir } from '@/lib/config/paths';
  //   execFileSync('rclone', ['copy', dbDump,        's3:flow-backups/db/'],                            { stdio: 'inherit' });
  //   execFileSync('rclone', ['sync', getBrainDir(), 's3:flow-backups/brain/', '--exclude', 'data.db*'], { stdio: 'inherit' });

  await fsp.rm(dbDump, { force: true });
  console.log('[backup] temp db removed');
}

main().catch((err) => {
  console.error('[backup] failed', err);
  process.exit(1);
});
