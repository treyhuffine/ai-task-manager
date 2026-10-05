import { AlertCircle, Circle, Clock, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BucketId } from '@/lib/sessions/classification';
export { bucketSessions, classifySession, executionActivity, type BucketId } from '@/lib/sessions/classification';

// Bucket identity for the header's status pills (rail-status-pills.tsx), the
// one place work is shown by status. Counted through `bucketSessions`, which
// the collapsed rail's Agents badge reads too, so the two always agree.

// Left-to-right order of the header pills. Reorder by editing this array.
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
  /** Faint tint behind the pill popover's header for the "hot" buckets.
   *  Passive buckets leave this undefined. */
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
