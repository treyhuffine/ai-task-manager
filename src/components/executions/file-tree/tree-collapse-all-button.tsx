'use client';

import { ListChevronsDownUp, ListChevronsUpDown } from 'lucide-react';
import { Tip } from '@/components/ui/tip';

interface TreeCollapseAllButtonProps {
  /** Whether the tree shows any folder open: the button collapses them all, else expands every folder. */
  anyOpen: boolean;
  onClick: () => void;
  /** Why there's nothing to fold (the flat Changes list, a tree without folders). Disables the button. */
  disabledReason?: string;
}

/**
 * One button beside the tree's search that folds the whole tree: Collapse
 * all while any folder shows open, Expand all once none does. It stays in
 * place when there's nothing to fold, disabled and saying why, so the
 * search field never shifts as the All / Changes switch flips.
 */
export function TreeCollapseAllButton({ anyOpen, onClick, disabledReason }: TreeCollapseAllButtonProps) {
  const action = anyOpen ? 'Collapse all folders' : 'Expand all folders';
  return (
    <Tip label={disabledReason ?? action}>
      <button
        type="button"
        onClick={onClick}
        disabled={!!disabledReason}
        aria-label={action}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        {anyOpen ? <ListChevronsDownUp size={14} /> : <ListChevronsUpDown size={14} />}
      </button>
    </Tip>
  );
}
