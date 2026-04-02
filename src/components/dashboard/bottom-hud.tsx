"use client";

import { useDashboard } from '@/contexts/dashboard-context';

export function BottomHud() {
  const { tasks } = useDashboard();

  return (
    <footer className="flex-shrink-0 h-7 border-t border-border bg-[--surface-hud] flex items-center px-4 justify-between select-none">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[8.5px] font-bold font-mono text-muted-foreground tracking-[0.05em]">SYNCING CONTEXT_V4.2</span>
        </div>
        <div className="h-3 w-px bg-border" />
        <span className="text-[8.5px] font-bold font-mono text-muted-foreground uppercase tracking-[0.1em]">
          {tasks.length} OBJECTIVES TRACKED
        </span>
      </div>

      <div className="flex items-center gap-4 text-[8.5px] text-muted-foreground">
        <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">{"\u2318"}K</kbd> search</span>
        <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">{"\u2318"}J</kbd> voice</span>
        <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">{"\u2318"}E</kbd> execute</span>
      </div>
    </footer>
  );
}
