import { AlertCircle, Circle, Clock, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RailSession } from '@/lib/api/sessions';
import { isSessionUnread } from '@/lib/utils/session-sort';

// Bucket identity for the rail's "by status" view. Shared by:
//   - status-view.tsx (the rail body)
//   - rail-status-pills.tsx (the top-HUD remote-control surface)
// Both reads use the same classify() so the count in the HUD always
// matches the rows in the rail.

export type BucketId = 'needsApproval' | 'unread' | 'waiting' | 'working';

// Top-to-bottom render order in the rail body. Reorder by editing this
// array — both the rail and the HUD pills follow it.
export const BUCKET_ORDER: readonly BucketId[] = [
  'needsApproval',
  'unread',
  'working',
  'waiting',
] as const;

export interface BucketConfig {
  id: BucketId;
  label: string;
  accentClass: string;
  countBgClass: string;
  /** Faint at-rest tint that anchors "hot" sections (working,
   *  needs-approval). Passive buckets leave this undefined so the rail
   *  doesn't read as colored stripes. */
  headerBgClass?: string;
  icon: ReactNode;
}

export const BUCKET_CONFIG: Record<BucketId, BucketConfig> = {
  needsApproval: {
    id: 'needsApproval',
    label: 'Needs approval',
    accentClass: 'text-amber-600 dark:text-amber-400',
    countBgClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    headerBgClass: 'bg-amber-500/[0.06] dark:bg-amber-400/[0.08]',
    icon: <AlertCircle size={13} className="text-amber-500" />,
  },
  unread: {
    id: 'unread',
    label: 'Unread',
    accentClass: 'text-amber-600 dark:text-amber-400',
    countBgClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    icon: <Circle size={11} className="fill-amber-500 text-amber-500" />,
  },
  waiting: {
    id: 'waiting',
    label: 'Waiting response',
    accentClass: 'text-foreground',
    countBgClass: 'bg-muted text-muted-foreground',
    icon: <Clock size={13} className="text-foreground" />,
  },
  working: {
    id: 'working',
    label: 'Working',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
    countBgClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    icon: <Zap size={13} className="text-emerald-500" />,
  },
};

// Each session lives in exactly one bucket. Priority order (resolves
// overlaps) is encoded here, NOT in BUCKET_ORDER — visual order and
// classification priority are independent concerns. The user can
// reshuffle the rail without changing which bucket a session falls in.
export function classifySession(
  session: RailSession,
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
