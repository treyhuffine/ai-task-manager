import { formatDuration, formatHours, formatSpan } from '@/lib/work/equivalents';
import type { WorkStats } from '@/lib/work/types';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

/**
 * A day's worth in one line, the chain's words small (docs/work-view.md,
 * "The numbers"): "30h agent time → 676h human time". Under each date in the
 * week, the list and the report. Hover for it in a sentence, with commits.
 */
export function WorkWorth({ stats, className }: { stats: WorkStats | undefined; className?: string }) {
  if (!stats || stats.agentMinutes < 1) return null;
  const person = stats.personHours >= 0.5;
  const title = [
    `Your agents worked ${formatDuration(stats.agentMinutes)}.`,
    person && `Doing the same by hand would take a person about ${formatHours(stats.personHours)} hours.`,
    stats.commits > 0 && `${stats.commits} ${stats.commits === 1 ? 'commit' : 'commits'}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tip label={title}>
      <span className={cn('text-muted-foreground', className)}>
        <span className="font-medium text-foreground/90">{formatSpan(stats.agentMinutes)}</span> agent time
        {person && (
          <>
            {' → '}
            <span className="font-medium text-foreground/90">{formatHours(stats.personHours)}h</span> human time
          </>
        )}
      </span>
    </Tip>
  );
}
