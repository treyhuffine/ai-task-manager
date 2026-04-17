"use client";

import { Search } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { CreateMenu } from './create-menu';
import { UserProfileSheet } from './user-profile-sheet';
import { DevicesSheet } from './devices-sheet';

export function TopHud() {
  const { agents } = useDashboard();
  const activeAgentCount = agents.filter(a => a.status === 'active').length;

  return (
    <header className="flex-shrink-0 h-10 border-b border-border flex items-center px-4 gap-4 bg-background z-50">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-slow" />
        <span className="text-[9px] font-bold tracking-[0.1em] text-muted-foreground">SYSTEM NOMINAL</span>
      </div>

      <div className="h-3 w-px bg-border" />

      <div className="flex items-center gap-3">
        <span className="text-[9px] font-bold tracking-[0.1em] text-muted-foreground">
          {activeAgentCount} AGENT{activeAgentCount !== 1 ? 'S' : ''} ACTIVE
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <DevicesSheet />
        <UserProfileSheet />
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('open-search'))}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
          aria-label="Search"
        >
          <Search size={14} />
        </button>
        <CreateMenu />
      </div>
    </header>
  );
}
