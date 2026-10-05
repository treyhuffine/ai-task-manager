import type { ChatSessionRecord } from '@/db/types';
import { isSessionUnread, sortSessionsHotnessDesc, type SortableSession } from '@/lib/utils/session-sort';

export type BucketId = 'needsApproval' | 'unread' | 'waiting' | 'working';

type ClassifiableSession = Pick<ChatSessionRecord, 'id' | 'status' | 'surfaceKind' | 'lastOutcomeEventAt' | 'unreadMarkerAt' | 'lastViewedAt'>;

// Each session lives in exactly one bucket. Priority order (resolves
// overlaps) is encoded here, NOT in BUCKET_ORDER — visual order and
// classification priority are independent concerns. The user can
// reshuffle the rail without changing which bucket a session falls in.
export function classifySession(
  session: ClassifiableSession,
  pending: ReadonlySet<string>,
  streaming: ReadonlySet<string>,
): BucketId | null {
  if (pending.has(session.id)) return 'needsApproval';
  if (streaming.has(session.id)) return 'working';

  // Unread = later of (lastOutcomeEventAt, unreadMarkerAt) > lastViewedAt,
  // via the shared rule. pending/streaming already returned above.
  if (isSessionUnread(session)) {
    return 'unread';
  }

  // An imported provider transcript that has nothing new is not live work, and
  // this is the only bucket it could otherwise fall into. "Waiting response"
  // means something is pending on you; a Codex chat you finished in March is
  // pending nothing. Importing is also a bulk action — onboarding's fourth step
  // is the import panel, which offers per-project select-all up to
  // MAX_IMPORT_SELECTION (1,000) — so left in `waiting` a single import could
  // put hundreds of finished transcripts under a clock icon and bury the two
  // rows that actually needed the user.
  //
  // Returning null rather than filtering at the query keeps this reversible on
  // its own terms: the checks above still run first, so the moment an import
  // becomes live work it appears. A sync that pulls in new messages makes it
  // `unread`; continuing the chat makes it `working` or `needsApproval`. It
  // stays in the workspace tree throughout, which reads
  // `listWorkspaceExecutions` and doesn't care about buckets — so it's always
  // findable, just not always claiming your attention.
  if (session.surfaceKind === 'imported_agent') return null;

  return 'waiting';
}

/**
 * Active sessions sorted into their buckets, hottest first in each. Inactive
 * work is left out (src/lib/sessions/inactive.ts), and so is anything that
 * classifies to null, so every reader counts the same rows: the header's
 * pills and the collapsed rail's Agents badge.
 */
export function bucketSessions<T extends ClassifiableSession & SortableSession>(
  sessions: readonly T[],
  pending: ReadonlySet<string>,
  streaming: ReadonlySet<string>,
  isInactive: (session: T) => boolean,
): Record<BucketId, T[]> {
  const buckets: Record<BucketId, T[]> = { needsApproval: [], unread: [], waiting: [], working: [] };
  for (const s of sessions) {
    if (s.status !== 'active' || isInactive(s)) continue;
    const id = classifySession(s, pending, streaming);
    if (id) buckets[id].push(s);
  }
  for (const id of Object.keys(buckets) as BucketId[]) {
    buckets[id] = sortSessionsHotnessDesc(buckets[id]);
  }
  return buckets;
}

/**
 * How many executions wait on the user and how many are working, for the
 * phone's Agents tab. Counted over the rail's sessions, as the desktop pills
 * are, so only executions count: a turn in the main chat, or an agent's main
 * chat, shows where it happens and never reads as an agent at work. One
 * waiting on the user counts once, as waiting.
 */
export function executionActivity(
  sessions: readonly ClassifiableSession[],
  pending: ReadonlySet<string>,
  streaming: ReadonlySet<string>,
): { pending: number; working: number } {
  let waitingOnUser = 0;
  let working = 0;
  for (const s of sessions) {
    if (s.status !== 'active') continue;
    const bucket = classifySession(s, pending, streaming);
    if (bucket === 'needsApproval') waitingOnUser += 1;
    else if (bucket === 'working') working += 1;
  }
  return { pending: waitingOnUser, working };
}
