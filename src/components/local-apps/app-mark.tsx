'use client';

import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'size-4 rounded text-[9px]',
  sm: 'size-5 rounded-md text-[10px]',
  md: 'size-7 rounded-md text-[12px]',
  lg: 'size-9 rounded-lg text-[14px]',
} as const;

/**
 * An app's mark: its initial on a tinted tile. Packages carry no icon, and a
 * letter tells Finances from a tracker at a glance, in the rail's strip and
 * in a list of tiles alike. The same tint as the skill tile, since both are
 * things you add to Ri.
 */
export function AppMark({
  name,
  size = 'sm',
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center bg-primary/10 font-semibold leading-none text-primary',
        SIZES[size],
        className,
      )}
    >
      {letter}
    </span>
  );
}
