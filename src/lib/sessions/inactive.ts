import { sessionHotnessKey } from '@/lib/utils/session-sort';

/**
 * Inactive executions: work nobody has touched for a while folds out of the
 * rail's way without being archived.
 *
 * An execution is inactive when its most recent activity (the rail's hotness
 * key: last activity, an unread marker, or its start) is older than the
 * threshold. What counts as activity is the existing policy in
 * `activity.ts`: agent output, messages, tool calls, git, terminal input.
 * Viewing never counts, so opening an old execution doesn't revive it, while
 * sending it a message does.
 *
 * Every state can go inactive: unread, awaiting input, pinned. The one
 * exception is work that is literally running (a live turn or background
 * task), which callers pass as `live`. Pinned rows stay in the Pinned section
 * and are marked instead of folded.
 *
 * The threshold is one global preference, `user_state.executionInactiveAfterDays`:
 * null is the product default, 0 turns folding off.
 */

export const DEFAULT_INACTIVE_AFTER_DAYS = 7;
export const MAX_INACTIVE_AFTER_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The choices the pickers offer. Any whole number of days is valid through the API. */
export const INACTIVE_AFTER_PRESETS: readonly number[] = [1, 3, 7, 14, 30];

/** The effective threshold in days, or null when folding is off. */
export function resolveInactiveAfterDays(stored: number | null | undefined): number | null {
  if (stored == null) return DEFAULT_INACTIVE_AFTER_DAYS;
  return stored > 0 ? stored : null;
}

/** A value the setting may store: null (default), 0 (off), or whole days up to the cap. */
export function isValidInactiveAfterDays(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_INACTIVE_AFTER_DAYS);
}

/** "1 day", "2 weeks", "30 days": how the pickers and fold rows name a threshold. */
export function formatInactiveAfter(days: number): string {
  if (days % 7 === 0 && days <= 28) {
    const weeks = days / 7;
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }
  return days === 1 ? '1 day' : `${days} days`;
}

interface ActivityStamped {
  lastActivityAt?: string | null;
  unreadMarkerAt: string | null;
  startedAt: string;
}

/** Whether `session` has been idle longer than `afterDays` as of `now`. */
export function isSessionInactive(
  session: ActivityStamped,
  afterDays: number | null,
  now: number,
  live = false,
): boolean {
  if (afterDays == null || live) return false;
  return now - sessionHotnessKey(session) > afterDays * DAY_MS;
}

/** Split a list, keeping each half in its original order. */
export function partitionInactive<T>(items: readonly T[], isInactive: (item: T) => boolean): { active: T[]; inactive: T[] } {
  const active: T[] = [];
  const inactive: T[] = [];
  for (const item of items) (isInactive(item) ? inactive : active).push(item);
  return { active, inactive };
}
