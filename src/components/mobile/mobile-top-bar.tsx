"use client";

import { Search } from 'lucide-react';

export function MobileTopBar() {
  return (
    <header className="flex-shrink-0 px-3 pt-[env(safe-area-inset-top)] pb-2 bg-background">
      <button
        onClick={() => document.dispatchEvent(new CustomEvent('open-search'))}
        className="w-full h-11 flex items-center gap-2.5 px-3.5 rounded-xl bg-muted/60 border border-border text-muted-foreground active:scale-[0.99] active:bg-muted transition-all"
        aria-label="Search"
      >
        <Search size={16} className="flex-shrink-0" />
        <span className="text-sm text-muted-foreground/80">Search tasks, notes, areas…</span>
      </button>
    </header>
  );
}
