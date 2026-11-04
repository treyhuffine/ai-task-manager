import fs from 'node:fs';
import { getAppRoot } from '@/lib/config/paths';
import { notify, type NotifyDeps } from '@/lib/notifications/notify';
import { getNotifierUserId } from '@/lib/notifications/user';

/** Early enough to clear space before writes start failing. */
const WARN_BELOW_BYTES = 10 * 1024 ** 3;

/**
 * Warn when the home's disk is nearly full. Once it is full, schedules, chats
 * and saves all start failing, and on 2026-11-02 that went unnoticed until the
 * next morning. The dedupe key keeps it to one warning a day, including across
 * restarts, and retries a channel that failed, so this holds no state.
 */
export async function warnIfDiskLow(now: Date = new Date(), deps: NotifyDeps = {}): Promise<void> {
  const stat = fs.statfsSync(/* turbopackIgnore: true */ getAppRoot());
  const free = Number(stat.bavail) * Number(stat.bsize);
  if (free >= WARN_BELOW_BYTES) return;
  await notify(
    {
      type: 'system.disk_low',
      userId: getNotifierUserId(),
      dedupeKey: `system.disk_low:${now.toISOString().slice(0, 10)}`,
      title: 'Disk almost full',
      body: `${(free / 1024 ** 3).toFixed(1)} GiB left on this computer. Schedules, chats and saves can start failing when it runs out, so free up some space.`,
      url: '',
    },
    {},
    deps,
  );
}
