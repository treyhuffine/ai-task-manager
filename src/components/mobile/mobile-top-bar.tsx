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
    // pt: respect the safe-area on devices that report one (notch/island),
    // floor at 0.75rem so non-PWA browsers — which evaluate env() to 0 —
    // don't render the bar flush against the viewport edge.
    <header
      className="flex-shrink-0 px-3 pb-2 bg-background flex items-center gap-2"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
    >
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
