'use client';

import { Sun, Moon } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { HOTKEYS } from '@/constants/commands';

// Thin strip at the bottom of the expanded rail. Carries the global
// hotkey hints that used to live in the BottomHud (⌘K search, ⌘J voice)
// plus the theme toggle. Hidden entirely in skinny mode — the hints
// don't fit and aren't load-bearing once the keys are memorized.

export function RailFooter() {
  const { theme, toggleTheme } = useDashboard();
  const isDark = theme === 'dark';

  return (
    <footer className="flex-shrink-0 h-7 px-2 border-t border-border/40 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5 text-[9px] text-muted-foreground/80">
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-muted rounded text-[8px] font-mono">{HOTKEYS.search.label}</kbd>
          search
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-muted rounded text-[8px] font-mono">{HOTKEYS.voiceChat.label}</kbd>
          voice
        </span>
      </div>

      <button
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="p-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors"
      >
        {isDark ? <Sun size={11} /> : <Moon size={11} />}
      </button>
    </footer>
  );
}
