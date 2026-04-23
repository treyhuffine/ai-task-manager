/**
 * Startup entry point. Called from instrumentation.ts on server boot.
 *
 * - Ensures mirror directories exist
 * - Writes the README if missing
 * - Kicks off a background reconcile (non-blocking)
 * - Starts the 15-minute reconcile timer
 */

import { ensureDirs } from './fs';
import { ensureReadme } from './readme';
import { reconcileAll } from './reconcile';
import { startMirrorTimer } from './timer';
import { isMirrorEnabled, MIRROR_DISABLED_ENV } from './config';
import { getBrainDir } from '@/lib/config/paths';

let initialized = false;

export async function initMirror(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!isMirrorEnabled()) {
    console.log(`[mirror] disabled (via ${MIRROR_DISABLED_ENV})`);
    return;
  }

  try {
    ensureDirs();
    await ensureReadme();
  } catch (err) {
    console.warn('[mirror] init failed, skipping', err);
    return;
  }

  console.log(`[mirror] brain: ${getBrainDir()}`);

  // Background reconcile — don't block startup.
  reconcileAll()
    .then((stats) => {
      console.log(
        `[mirror] startup reconcile: synced=${stats.synced} skipped=${stats.skipped} orphaned=${stats.orphaned} attachments=${stats.attachments.onDisk}/${stats.attachments.referenced} archived=${stats.attachments.archived} (${stats.elapsedMs}ms)`,
      );
    })
    .catch((err) => {
      console.warn('[mirror] startup reconcile failed', err);
    });

  startMirrorTimer();
}
