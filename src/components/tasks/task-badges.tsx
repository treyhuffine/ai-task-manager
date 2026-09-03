'use client';

import { Ban, AlertTriangle, Eye, Loader2 } from 'lucide-react';
import type { TaskAttentionSignals } from '@/db/types';
import { cn } from '@/lib/utils';

// Priority order (highest human-attention first), per the attention contract:
// Blocked, then Update, then Stalled, then Working. ("Needs input" is omitted —
// pending agent input is not durably tracked, so we do not fabricate it.)
// The review signal reads as "Update" because it is an execution-level
// workstream checkpoint, not proof this exact task needs task-scoped review.
const BADGES = [
  { key: 'blocked', label: 'Blocked', title: 'Blocked by an unresolved dependency', icon: Ban, cls: 'text-red-600 dark:text-red-400 bg-red-500/10' },
  { key: 'stalled', label: 'Stalled', title: 'The agent workstream stalled', icon: AlertTriangle, cls: 'text-orange-600 dark:text-orange-400 bg-orange-500/10' },
  { key: 'review', label: 'Update', title: 'Workstream update. The agent posted output to review', icon: Eye, cls: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
  { key: 'working', label: 'Working', title: 'An agent is actively working this', icon: Loader2, cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
] as const;

/**
 * Derived attention badges for a task in Current Work (and on In-progress rows).
 * Truthful and quiet: renders nothing when there's nothing to flag. Multiple
 * badges can coexist (e.g. Blocked + Working).
 */
export function TaskBadges({
  signals,
  className,
  size = 'sm',
}: {
  signals?: TaskAttentionSignals | null;
  className?: string;
  size?: 'sm' | 'xs';
}) {
  if (!signals) return null;
  const active = BADGES.filter((b) => signals[b.key]);
  if (active.length === 0) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {active.map((b) => (
        <span
          key={b.key}
          className={cn(
            'inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-semibold uppercase tracking-wide',
            size === 'xs' ? 'text-[8.5px]' : 'text-[9.5px]',
            b.cls,
          )}
          title={b.title}
        >
          <b.icon
            size={size === 'xs' ? 9 : 10}
            className={b.key === 'working' ? 'animate-spin [animation-duration:2.5s] motion-reduce:animate-none' : ''}
            aria-hidden
          />
          {b.label}
        </span>
      ))}
    </span>
  );
}
