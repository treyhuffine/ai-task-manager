'use client';

import { cn } from '@/lib/utils';
import { initials } from './use-team';

/** A member's initials, for who a task is assigned to and who changed it. */
export function MemberAvatar({ name, size = 'sm', className }: { name: string; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary',
        size === 'xs' && 'size-4 text-[8px]',
        size === 'sm' && 'size-5 text-[9px]',
        size === 'md' && 'size-7 text-[11px]',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
