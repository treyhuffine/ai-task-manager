"use client";

import { useState } from 'react';
import { Search, Inbox, Zap } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { InboxComingSoonSheet } from '@/components/shared/inbox-coming-soon-sheet';
import { CreateMenu } from './create-menu';
import { UserProfileSheet } from './user-profile-sheet';
import { DevicesSheet } from './devices-sheet';

// Flip to false to hide (not yet launched)
const SHOW_INBOX = true;

export function TopHud() {
  const { agents, setQuickCaptureOpen } = useDashboard();
  const activeAgentCount = agents.filter(a => a.status === 'active').length;
  const [inboxOpen, setInboxOpen] = useState(false);

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
        <button
          onClick={() => setQuickCaptureOpen(true)}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
          aria-label="Quick capture"
          title="Quick capture"
        >
          <Zap size={14} />
        </button>
        {SHOW_INBOX && (
          <>
            <button
              onClick={() => setInboxOpen(true)}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
              aria-label="Inbox"
              title="Inbox"
            >
              <Inbox size={14} />
            </button>
            <InboxComingSoonSheet open={inboxOpen} onOpenChange={setInboxOpen} />
          </>
        )}
        <CreateMenu />
      </div>
    </header>
  );
}
