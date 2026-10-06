import { formatDuration, formatHours, formatSpan } from '@/lib/work/equivalents';
import type { WorkStats } from '@/lib/work/types';
import { cn } from '@/lib/utils';

/**
 * A day's worth in one line, the chain's grammar small (docs/work-view.md,
 * "The numbers"): "30h agents → 676 person-hours". Under each date in the
 * week, the list and the report. Hover for the commits.
 */
export function WorkWorth({ stats, className }: { stats: WorkStats | undefined; className?: string }) {
  if (!stats || stats.agentMinutes < 1) return null;
  const person = stats.personHours >= 0.5;
  const title = [
    `Agents ran ${formatDuration(stats.agentMinutes)}.`,
    person && `A person would need about ${formatHours(stats.personHours)} hours.`,
    stats.commits > 0 && `${stats.commits} ${stats.commits === 1 ? 'commit' : 'commits'}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cn('text-muted-foreground', className)} title={title}>
      <span className="font-medium text-foreground/90">{formatSpan(stats.agentMinutes)}</span> agents
      {person && (
        <>
          {' → '}
          <span className="font-medium text-foreground/90">{formatHours(stats.personHours)}</span> person-hours
        </>
      )}
    </span>
  );
}
