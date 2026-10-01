'use client';

import { orchestratorInitial } from '@/lib/orchestrator/name';
import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'size-4 rounded text-[9px]',
  sm: 'size-5 rounded-md text-[11px]',
  md: 'size-7 rounded-lg text-[13px]',
} as const;

/**
 * The orchestrator drawn as its initial, wherever there's no room for its
 * name (the skinny rail, the tablet rail) or the name wants a face beside it
 * (the rail's home row, the main chat's header). It follows a rename, so it
 * always matches what the user calls it. Decorative: the name or a label
 * always travels with it.
 */
export function OrchestratorMark({
  name,
  size = 'sm',
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex flex-shrink-0 select-none items-center justify-center bg-primary font-bold leading-none text-primary-foreground',
        SIZES[size],
        className,
      )}
    >
      {orchestratorInitial(name)}
    </span>
  );
}
