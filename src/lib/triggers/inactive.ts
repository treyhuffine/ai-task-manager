import type { TriggerRecord } from '@/db/types';

/**
 * Whether a trigger is done running on its own: paused, or a one-time trigger
 * that already fired (it keeps `enabled` and loses `nextRunAt`). The triggers
 * list folds these below the ones that will still run, so a schedule that
 * finished weeks ago doesn't read as live. Nothing is changed or removed:
 * resuming or re-arming one brings it back.
 *
 * Manual and webhook triggers never have a next run, so they count as active
 * while they're on. They run when asked.
 */
export function isTriggerInactive(trigger: Pick<TriggerRecord, 'enabled' | 'kind' | 'nextRunAt'>): boolean {
  if (!trigger.enabled) return true;
  return trigger.kind === 'at' && !trigger.nextRunAt;
}
