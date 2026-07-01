import { timestampEpoch } from './timestamps';

/**
 * Shared session "hotness" key used to sort rail lists. A session's
 * hotness is the most recent timestamp across:
 *
 *   - `lastOutcomeEventAt` — last agent/result event landed
 *   - `unreadMarkerAt`      — user explicitly flagged unread
 *   - `startedAt`            — session creation (floor for brand-new
 *                                sessions with no events yet)
 *
 * `startedAt` is a SQLite space-format timestamp while the other two are
 * ISO (`toISOString`). Those formats do NOT sort consistently as raw
 * strings (' ' < 'T'), so we compare via {@link timestampEpoch}, which
 * normalizes both to UTC epoch ms. Comparing the strings directly is what
 * made a brand-new session sink below the day's active ones instead of
 * rising to the top.
 */

interface SortableSession {
  lastOutcomeEventAt: string | null;
  unreadMarkerAt: string | null;
  startedAt: string;
}

/** UTC epoch ms of the session's most recent activity. */
export function sessionHotnessKey(s: SortableSession): number {
  return Math.max(
    timestampEpoch(s.startedAt),
    timestampEpoch(s.lastOutcomeEventAt),
    timestampEpoch(s.unreadMarkerAt),
  );
}

/**
 * Returns a new array sorted by hotness descending — most recent
 * activity first. The original array is untouched so React Query
 * cache entries stay referentially stable.
 */
export function sortSessionsHotnessDesc<T extends SortableSession>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => sessionHotnessKey(b) - sessionHotnessKey(a));
}

interface UnreadableSession {
  lastOutcomeEventAt: string | null;
  unreadMarkerAt: string | null;
  lastViewedAt: string | null;
}

/**
 * Most recent "something happened that the user should see" timestamp:
 * the later of an agent outcome event and an explicit unread marker.
 * Null when neither has ever fired.
 */
export function latestActivityAt(
  s: { lastOutcomeEventAt: string | null; unreadMarkerAt: string | null },
): string | null {
  const outcome = s.lastOutcomeEventAt;
  const marker = s.unreadMarkerAt;
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
  const lastViewed = s.lastViewedAt ?? '1970-01-01';
  return activity > lastViewed;
}
