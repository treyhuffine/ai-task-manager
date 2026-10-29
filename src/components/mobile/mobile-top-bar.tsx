"use client";

import { Search } from 'lucide-react';
import { SpaceSelector } from '@/components/spaces/space-selector';
import { ScratchpadButton } from '@/components/scratchpad/scratchpad-host';

export function MobileTopBar({ onSearch = () => document.dispatchEvent(new CustomEvent('open-search')), onOpenSettings }: { onSearch?: () => void; onOpenSettings?: () => void }) {
  return (
    // pt: respect the safe-area on devices that report one (notch/island),
    // floor at 0.75rem so non-PWA browsers — which evaluate env() to 0 —
    // don't render the bar flush against the viewport edge.
    <header
      className="flex-shrink-0 px-3 pb-2 bg-background flex items-center gap-2"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
    >
      {/* My Ri and its teams, once one is connected (docs/homes-spec.md §3.2). */}
      <SpaceSelector variant="phone" onOpenSettings={onOpenSettings} />
      <button
        onClick={onSearch}
        className="min-w-0 flex-1 h-10 flex items-center gap-2.5 px-3.5 rounded-lg border border-border text-muted-foreground active:bg-muted/60 transition-colors"
        aria-label="Search"
      >
        <Search size={15} className="flex-shrink-0" />
        <span className="truncate text-sm text-muted-foreground/70">Search tasks, notes, areas…</span>
      </button>
      <ScratchpadButton variant="phone" />
    </header>
  );
}
