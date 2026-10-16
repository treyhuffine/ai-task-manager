import { cn } from '@/lib/utils';

/** What a rail count means: work in flight (blue) or something waiting on you (amber). */
export type RailTone = 'live' | 'attention';

const PILL = {
  live: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  attention: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
} as const;

const DOT = {
  live: 'bg-blue-500',
  attention: 'bg-amber-500',
} as const;

/** A live count beside a label in the wide rail. */
export function RailCount({ count, tone, className }: { count: number; tone: RailTone; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] tabular-nums', PILL[tone], className)}
      aria-label={tone === 'attention' ? `${count} waiting on you` : `${count} active`}
    >
      <span className={cn('size-1.5 rounded-full', DOT[tone])} aria-hidden />
      {count}
    </span>
  );
}

/** The same count as a dot on an icon in the collapsed strip. */
export function RailDot({ tone }: { tone: RailTone }) {
  return <span className={cn('absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background', DOT[tone])} aria-hidden />;
}
