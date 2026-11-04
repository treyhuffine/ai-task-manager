import type { TriggerRecord } from '@/db/types';
import { formatSpanSeconds } from '@/lib/executions/duration';

/** A job normally starts within a tick or two of its time. Past this, it's late. */
const LATE_AFTER_MS = 5 * 60_000;

/** How late `at` is for a job due at `due`, like "3h 39m". Null if it isn't late. */
export function lateBy(due: string | null | undefined, at: Date | string = new Date()): string | null {
  if (!due) return null;
  const lateMs = new Date(at).getTime() - new Date(due).getTime();
  if (!(lateMs >= LATE_AFTER_MS)) return null;
  return formatSpanSeconds(Math.floor(lateMs / 60_000) * 60);
}

/**
 * What to say about a job past its time that still hasn't started. This reads
 * the row, not the scheduler, so it's true whatever went wrong: a stopped
 * scheduler or a bug nobody has thought of looks the same here. A one-time job
 * for a chat is usually waiting for that chat (`oneTimeFireMustWait`).
 */
export function overdueLabel(
  trigger: Pick<TriggerRecord, 'enabled' | 'kind' | 'targetKind' | 'nextRunAt'>,
  now: Date = new Date(),
): string | null {
  const late = trigger.enabled ? lateBy(trigger.nextRunAt, now) : null;
  if (!late) return null;
  return isWaitingForChat(trigger) ? `Waiting for its chat, ${late} late` : `Hasn't started, ${late} late`;
}

export function isWaitingForChat(trigger: Pick<TriggerRecord, 'kind' | 'targetKind'>): boolean {
  return trigger.kind === 'at' && trigger.targetKind === 'session';
}
