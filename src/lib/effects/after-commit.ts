/**
 * Work that must wait until a transaction commits (docs/homes-build.md,
 * P2.3): sending the notifications it queued, realtime publishes, and waking
 * anything waiting on it. Collected while the transaction runs, done after,
 * so a rollback leaves nothing sent and a crash after commit loses nothing
 * that was queued: the notification rows are already in the database.
 */

import { getDb } from '@/lib/db';
import { deliverNotification, type QueuedNotification } from '@/lib/notifications/notify';

export interface AfterCommit {
  notifications: QueuedNotification[];
  tasks: Array<() => void>;
}

export function afterCommit(): AfterCommit {
  return { notifications: [], tasks: [] };
}

/** Do what a committed transaction collected. Never throws. */
export function flushAfterCommit(after: AfterCommit): void {
  for (const queued of after.notifications) void deliverNotification(queued);
  for (const task of after.tasks) {
    try {
      task();
    } catch (err) {
      console.error('[after-commit] task failed:', err);
    }
  }
}

/** Run `fn` in one immediate transaction, then do what it collected. */
export function inTransaction<T>(fn: (after: AfterCommit) => T): T {
  const after = afterCommit();
  const result = getDb().transaction(() => fn(after), { behavior: 'immediate' });
  flushAfterCommit(after);
  return result;
}
