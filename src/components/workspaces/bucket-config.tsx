import { AlertCircle, Circle, Clock, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RailSession } from '@/lib/api/sessions';

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
  'waiting',
  'working',
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
    headerBgClass: 'bg-emerald-500/[0.06] dark:bg-emerald-400/[0.08]',
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
): BucketId {
  if (pending.has(session.id)) return 'needsApproval';
  if (streaming.has(session.id)) return 'working';

  // Unread = max(lastOutcomeEventAt, unreadMarkerAt) > lastViewedAt.
  // Sentinel '1970-01-01' lets nulls compare lexicographically as
  // "earliest possible time" without explicit null handling.
  const outcomes = [
    session.lastOutcomeEventAt ?? '1970-01-01',
    session.unreadMarkerAt ?? '1970-01-01',
  ];
  const lastActivity = outcomes[0]! > outcomes[1]! ? outcomes[0]! : outcomes[1]!;
  const lastViewed = session.lastViewedAt ?? '1970-01-01';
  if (lastActivity > lastViewed && lastActivity !== '1970-01-01') {
    return 'unread';
  }

  return 'waiting';
}
