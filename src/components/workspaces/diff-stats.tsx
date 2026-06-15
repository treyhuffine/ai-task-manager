import { cn } from '@/lib/utils';
import { formatCompactCount } from '@/lib/utils/compact-number';
import type { DiffStats } from '@/lib/api/sessions';

/**
 * +/− diff pair for rail rows. Encodes the two rules every surface
 * must agree on:
 *
 *   1. 0/0 renders nothing. The stats answer "is there work product
 *      on this branch?" — zero is the absence of the signal, not a
 *      small value. Null/undefined (still loading, or worktree
 *      missing) get the same treatment: nothing to act on, nothing
 *      shown.
 *   2. Counts are compact ("+1.2k") so a runaway diff can't eat the
 *      space next to it.
 *
 * The data is async, so callers must place this where its appearance
 * cannot displace existing content — appended after static siblings
 * or anchored into empty space. The fade-in softens arrival; layout
 * stability is the caller's placement, not the animation.
 */
export function DiffStatsPair({
  stats,
  className,
}: {
  stats: DiffStats | null | undefined;
  className?: string;
}) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null;
  return (
    <span
      className={cn(
        'flex items-center gap-1 font-mono leading-none animate-in fade-in duration-300',
        className,
      )}
    >
      <span className="text-emerald-500/80">+{formatCompactCount(stats.additions)}</span>
      <span className="text-rose-500/80">-{formatCompactCount(stats.deletions)}</span>
    </span>
  );
}
