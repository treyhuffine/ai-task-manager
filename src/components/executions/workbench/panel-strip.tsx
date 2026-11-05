'use client';

import { Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

/**
 * The parts of a tools panel's strip that the execution view's panel
 * (`workbench-panel.tsx`) and the agent view's tools (`agents/agent-tools.tsx`)
 * share, so both strips look and behave the same. Kept apart from the panel
 * itself, which brings every execution view with it.
 */

/** A tab in a tools panel's strip, the execution view's and the agent view's: underlined while it's in front. */
export function panelTabClass(on: boolean): string {
  return cn(
    '-mb-px whitespace-nowrap border-b-2 px-2.5 text-[12.5px] font-medium transition-colors',
    on ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
  );
}

/**
 * The right end of a tools panel's strip: expand to the whole view (the
 * chat folds to a strip) or bring the chat back, and close the panel.
 * Escape does the same, restoring first.
 */
export function PanelWindowControls({
  maximized,
  onToggleMaximize,
  onClose,
}: {
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <Tip
        label={maximized ? 'Bring the chat back' : 'Expand to the whole view (or double-click a tab)'}
        shortcut={maximized ? 'Esc' : undefined}
      >
        <button
          type="button"
          onClick={onToggleMaximize}
          aria-label={maximized ? 'Restore the chat' : 'Expand the panel'}
          className="my-1 inline-flex w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </Tip>
      <Tip label="Close the panel" shortcut="Esc">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the panel"
          className="my-1 inline-flex w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <X size={14} />
        </button>
      </Tip>
    </>
  );
}
