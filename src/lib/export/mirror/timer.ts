/**
 * 15-minute reconcile timer. Runs in the app process for now; will move to
 * a daemon later.
 */

import { reconcileAll } from './reconcile';
import { isMirrorEnabled } from './config';

const INTERVAL_MS = 15 * 60 * 1000;

let handle: NodeJS.Timeout | null = null;

export function startMirrorTimer(): void {
  if (handle) return;
  if (!isMirrorEnabled()) return;

  handle = setInterval(() => {
    reconcileAll()
      .then((stats) => {
        if (stats.synced > 0 || stats.orphaned > 0) {
          console.log(
            `[mirror] reconcile: synced=${stats.synced} skipped=${stats.skipped} orphaned=${stats.orphaned} (${stats.elapsedMs}ms)`,
          );
        }
      })
      .catch((err) => {
        console.warn('[mirror] timed reconcile failed', err);
      });
  }, INTERVAL_MS);

  // Don't keep the process alive just for the timer.
  handle.unref?.();
}

export function stopMirrorTimer(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
