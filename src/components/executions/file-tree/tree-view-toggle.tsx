'use client';

import { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';

export type TreeViewMode = 'changed' | 'all';

/** Counts past 99 read as "99+": the exact number stops mattering, and thousands crowd the switch. */
export function formatChangedCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

interface TreeViewToggleProps {
  mode: TreeViewMode;
  onChange: (next: TreeViewMode) => void;
  changedCount: number;
}

/**
 * One filter: off shows all files, on shows changes. The small switch
 * leaves room for a padded count badge. Only the visible word "only"
 * folds away in narrow tree columns, keeping the accessible name stable.
 */
export function TreeViewToggle({
  mode,
  onChange,
  changedCount,
}: TreeViewToggleProps) {
  const id = useId();

  return (
    <div className="@container/tree-filter w-full">
      <label htmlFor={id} className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-1 text-[11px] font-medium">
        <Switch
          id={id}
          size="sm"
          aria-label="Changes only"
          checked={mode === 'changed'}
          onCheckedChange={(checked) => onChange(checked ? 'changed' : 'all')}
        />
        <span
          className={cn(
            'whitespace-nowrap',
            mode === 'changed' ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          Changes<span className="hidden @[11rem]/tree-filter:inline"> only</span>
        </span>
        <Tip label={changedCount > 99 ? `${changedCount.toLocaleString()} changed files` : undefined}>
          <span className="ml-auto min-w-8 shrink-0 rounded-full bg-muted px-1.5 text-center text-[10px] tabular-nums text-muted-foreground">
            {formatChangedCount(changedCount)}
          </span>
        </Tip>
      </label>
    </div>
  );
}
