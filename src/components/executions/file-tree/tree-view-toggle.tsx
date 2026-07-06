'use client';

import { cn } from '@/lib/utils';

export type TreeViewMode = 'changed' | 'all';

interface TreeViewToggleProps {
  mode: TreeViewMode;
  onChange: (next: TreeViewMode) => void;
  changedCount: number;
}

/**
 * Segmented control `[All] [Changes (N)]` for switching the file tree
 * between "everything in the tree" and "just what the agent touched".
 * Renders full-width with 50/50 tabs so it can claim its own row in
 * the tree header — narrow tree columns can't fit it inline alongside
 * the title and create button. Always rendered, including when the
 * count is zero — the static `(0)` is preferable to a layout shift the
 * moment the first edit lands.
 */
export function TreeViewToggle({
  mode,
  onChange,
  changedCount,
}: TreeViewToggleProps) {
  return (
    <div className="grid w-full grid-cols-2 items-center rounded-md border border-border bg-muted/40 p-0.5 text-[11px] font-medium">
      <button
        type="button"
        onClick={() => onChange('all')}
        className={cn(
          'px-2 py-0.5 rounded transition-colors text-center',
          mode === 'all'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        All
      </button>
      <button
        type="button"
        onClick={() => onChange('changed')}
        className={cn(
          'px-2 py-0.5 rounded transition-colors text-center',
          mode === 'changed'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Changes{' '}
        <span className="tabular-nums text-muted-foreground/70">
          ({changedCount})
        </span>
      </button>
    </div>
  );
}
