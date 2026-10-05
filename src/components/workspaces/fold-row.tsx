'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The toggle at the foot of a folded list: what's tucked away on the left
 * ("4 inactive hidden"), and Show or Hide on the right. The rows it controls
 * open above it, so it stays the foot. One per list, for its inactive
 * executions (`InactiveFold`).
 *
 * `accessory` sits after the toggle, e.g. the inactive timer.
 */
export function FoldRow({
  label,
  shown,
  onToggle,
  accessory,
  touch = false,
  className,
  rowClassName,
}: {
  /** What's folded, without the verb: "4 inactive". */
  label: string;
  shown: boolean;
  onToggle: () => void;
  accessory?: ReactNode;
  /** Phone sizing: a taller, larger row. */
  touch?: boolean;
  /** On the wrapper, e.g. the indent that lines the text up with the rows above. */
  className?: string;
  /** On the toggle itself, e.g. a height that matches the rows it folds. */
  rowClassName?: string;
}) {
  return (
    <div className={cn('group/fold flex items-center gap-0.5', className)}>
      <button
        type="button"
        onClick={onToggle}
        onPointerDown={(e) => e.stopPropagation()}
        aria-expanded={shown}
        className={cn(
          'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md text-left transition-colors hover:bg-muted/40',
          touch ? 'py-2 px-2 text-[12px] active:bg-muted/40' : 'py-1 px-1.5 text-[10px]',
          rowClassName,
        )}
      >
        <span className="truncate text-muted-foreground/60">
          {label} {shown ? 'shown' : 'hidden'}
        </span>
        <span className="flex-shrink-0 font-medium text-muted-foreground/80 transition-colors group-hover/fold:text-foreground">
          {shown ? 'Hide' : 'Show'}
        </span>
      </button>
      {accessory}
    </div>
  );
}
