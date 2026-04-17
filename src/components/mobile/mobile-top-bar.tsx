"use client";

import { useState } from 'react';
import { Search, Inbox, Zap } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { InboxComingSoonSheet } from '@/components/shared/inbox-coming-soon-sheet';

// Flip to false to hide (not yet launched)
const SHOW_INBOX = true;

export function MobileTopBar() {
  const { setQuickCaptureOpen } = useDashboard();
  const [inboxOpen, setInboxOpen] = useState(false);

  return (
    <header className="flex-shrink-0 px-3 pt-[env(safe-area-inset-top)] pb-2 bg-background flex items-center gap-2">
      <button
        onClick={() => document.dispatchEvent(new CustomEvent('open-search'))}
        className="flex-1 h-10 flex items-center gap-2.5 px-3.5 rounded-lg border border-border text-muted-foreground active:bg-muted/60 transition-colors"
        aria-label="Search"
      >
        <Search size={15} className="flex-shrink-0" />
        <span className="text-sm text-muted-foreground/70">Search tasks, notes, areas…</span>
      </button>

      <button
        onClick={() => setQuickCaptureOpen(true)}
        className="h-10 w-10 flex items-center justify-center rounded-lg border border-border text-muted-foreground active:bg-muted/60 transition-colors"
        aria-label="Quick capture"
      >
        <Zap size={16} />
      </button>

      {SHOW_INBOX && (
        <>
          <button
            onClick={() => setInboxOpen(true)}
            className="h-10 w-10 flex items-center justify-center rounded-lg border border-border text-muted-foreground active:bg-muted/60 transition-colors"
            aria-label="Inbox"
          >
            <Inbox size={16} />
          </button>
          <InboxComingSoonSheet open={inboxOpen} onOpenChange={setInboxOpen} />
        </>
      )}
    </header>
  );
}
