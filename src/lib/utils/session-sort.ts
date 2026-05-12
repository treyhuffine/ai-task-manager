/**
 * Shared session "hotness" key used to sort rail lists. A session's
 * hotness is the most recent timestamp across:
 *
 *   - `last_outcome_event_at` — last agent/result event landed
 *   - `unread_marker_at`      — user explicitly flagged unread
 *   - `started_at`            — session creation (floor for brand-new
 *                                sessions with no events yet)
 *
 * ISO 8601 strings sort lexicographically, so we compare strings
 * directly without parsing — cheaper and avoids timezone surprises.
 */

interface SortableSession {
  last_outcome_event_at: string | null;
  unread_marker_at: string | null;
  started_at: string;
}

export function sessionHotnessKey(s: SortableSession): string {
  let max = s.started_at;
  if (s.last_outcome_event_at && s.last_outcome_event_at > max) max = s.last_outcome_event_at;
  if (s.unread_marker_at && s.unread_marker_at > max) max = s.unread_marker_at;
  return max;
}

/**
 * Returns a new array sorted by hotness descending — most recent
 * activity first. The original array is untouched so React Query
 * cache entries stay referentially stable.
 */
export function sortSessionsHotnessDesc<T extends SortableSession>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => {
    const ka = sessionHotnessKey(a);
    const kb = sessionHotnessKey(b);
    if (ka === kb) return 0;
    return kb < ka ? -1 : 1;
  });
}

interface UnreadableSession {
  last_outcome_event_at: string | null;
  unread_marker_at: string | null;
  last_viewed_at: string | null;
}

/**
 * Most recent "something happened that the user should see" timestamp:
 * the later of an agent outcome event and an explicit unread marker.
 * Null when neither has ever fired.
 */
export function latestActivityAt(
  s: { last_outcome_event_at: string | null; unread_marker_at: string | null },
): string | null {
  const outcome = s.last_outcome_event_at;
  const marker = s.unread_marker_at;
  if (outcome && marker) return outcome > marker ? outcome : marker;
  return outcome ?? marker ?? null;
}

/**
 * True when the session has activity (agent outcome OR explicit unread
 * marker) newer than the user's last view. Mirrors the rail's "unread"
 * bucket classification, minus the pending/streaming overlays that
 * bucket priority handles separately.
 */
export function isSessionUnread(s: UnreadableSession): boolean {
  const activity = latestActivityAt(s);
  if (!activity) return false;
  const lastViewed = s.last_viewed_at ?? '1970-01-01';
  return activity > lastViewed;
}
