import { timestampEpoch } from './timestamps';

/**
 * Shared session "hotness" key used to sort rail lists. A session's
 * hotness is the most recent timestamp across:
 *
 *   - `lastActivityAt`  — anything happened here, human or agent. The real
 *                            signal. What bumps it is policy, and the policy
 *                            lives in `src/lib/sessions/activity.ts`.
 *   - `unreadMarkerAt`  — user explicitly flagged unread. Redundant now
 *                            (`markSessionUnread` bumps activity too), kept
 *                            as free insurance for any path that writes the
 *                            marker without going through it. Can only ever
 *                            agree with or exceed `lastActivityAt`, never
 *                            contradict it.
 *   - `startedAt`       — session creation. Floor for rows created before
 *                            `lastActivityAt` existed and never touched since.
 *
 * Creation is a FLOOR, never a ceiling: an execution opened a month ago that
 * ran today ranks as today. That is the whole point of the key.
 *
 * Formats: `lastActivityAt` is ISO-only by construction (`bumpSessionActivity`
 * is the sole writer). `startedAt` can still be SQLite space-format on legacy
 * rows, and the two do NOT sort consistently as raw strings (' ' < 'T'), so
 * we compare via {@link timestampEpoch}, which normalizes both to UTC epoch
 * ms. Comparing the strings directly is what made a brand-new session sink
 * below the day's active ones instead of rising to the top.
 */

interface SortableSession {
  lastActivityAt?: string | null;
  unreadMarkerAt: string | null;
  startedAt: string;
}

/** UTC epoch ms of the session's most recent activity. */
export function sessionHotnessKey(s: SortableSession): number {
  return Math.max(
    timestampEpoch(s.startedAt),
    timestampEpoch(s.lastActivityAt),
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

interface PinnableSession {
  id: string;
  status: string;
  execution: { pinnedAt: string | null } | null;
}

/**
 * The rail's "Pinned" group, derived from any session list (the shared rail
 * query already carries `execution.pinnedAt`, so no dedicated fetch is
 * needed). Keeps only *active* pinned executions — archiving clears the pin,
 * but a stale cache could momentarily show an archived+pinned row, so the
 * status guard makes the group self-coherent regardless.
 *
 * Ordered by pin time, most-recent first, so a fresh pin lands on top and the
 * group stays stable as agents work underneath it (activity never reshuffles
 * a pin). `pinnedAt` is an ISO string, so a string compare is chronological;
 * id is the stable tie-break. Returns a new array — the input is untouched.
 */
export function selectPinnedSessions<T extends PinnableSession>(sessions: readonly T[]): T[] {
  return sessions
    .filter((s) => s.status === 'active' && !!s.execution?.pinnedAt)
    .sort((a, b) => {
      const cmp = (b.execution?.pinnedAt ?? '').localeCompare(a.execution?.pinnedAt ?? '');
      return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
    });
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
