"use client";

import { useState } from 'react';
import { Search, Inbox, Zap, X, Settings } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useLatestExecutionId } from '@/hooks/use-latest-execution';
import { HOTKEYS } from '@/constants/commands';
import { InboxComingSoonSheet } from '@/components/shared/inbox-coming-soon-sheet';
import { openSettings } from '@/components/settings/settings-store';
import { CreateMenu } from './create-menu';
import { RailStatusPills } from './rail-status-pills';
import { BudgetWarningPill } from './budget-warning-pill';

// Flip to false to hide (not yet launched)
const SHOW_INBOX = true;

export function TopHud() {
  const { activeView, setActiveView, setQuickCaptureOpen } = useDashboard();
  const [inboxOpen, setInboxOpen] = useState(false);
  const isExecutionView = activeView !== 'command';
  const latestExecutionId = useLatestExecutionId();

  return (
    <header className="flex-shrink-0 h-10 border-b border-border flex items-center px-4 gap-4 bg-background z-50">
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

      <RailStatusPills />

      {isExecutionView ? (
        <button
          onClick={() => setActiveView('command')}
          className="flex items-center gap-1.5 h-7 pl-1.5 pr-1.5 rounded-lg border border-border bg-secondary text-foreground hover:bg-accent transition-all"
          aria-label="Close execution"
          title="Close execution"
        >
          <X size={12} />
          <span className="text-[11px] font-medium">Close execution</span>
          <kbd className="ml-0.5 px-1 py-0.5 bg-background/60 rounded text-[9px] font-mono leading-none text-muted-foreground">
            {HOTKEYS.closeExecution.label}
          </kbd>
        </button>
      ) : latestExecutionId ? (
        <button
          onClick={() => setActiveView(latestExecutionId)}
          className="flex items-center gap-1.5 h-7 px-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Open latest execution"
          title="Open latest execution"
        >
          <span className="text-[11px] font-medium">Open latest execution</span>
          <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono leading-none">
            {HOTKEYS.closeExecution.label}
          </kbd>
        </button>
      ) : null}

      <div className="flex-1" />

      <BudgetWarningPill />

      <div className="flex items-center gap-2">
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('open-search'))}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
          aria-label="Search"
        >
          <Search size={14} />
        </button>
        <button
          onClick={() => openSettings()}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={14} />
        </button>
        <button
          onClick={() => setQuickCaptureOpen(true)}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
          aria-label="Quick capture"
          title="Quick capture"
        >
          <Zap size={14} />
        </button>
        <CreateMenu />
      </div>
    </header>
  );
}
