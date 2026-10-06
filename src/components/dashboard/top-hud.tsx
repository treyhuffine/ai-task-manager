"use client";

import { Search, Zap, X } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useLatestExecutionId } from '@/hooks/use-latest-execution';
import { HOTKEYS } from '@/constants/commands';
import { CreateMenu } from './create-menu';
import { RailStatusPills } from './rail-status-pills';
import { BudgetWarningPill } from './budget-warning-pill';
import { HudDayButton } from '@/components/calendar/hud-day-button';
import { WorkHudPill } from '@/components/calendar/work/work-hud-pill';
import { DesktopNavButtons } from '@/components/desktop/desktop-nav-buttons';
import { Tip } from '@/components/ui/tip';

// What's happening, from every view: work by status, the way out of (or
// back into) an execution, today's work in person-hours, the next calendar
// event, the budget. Places (Board, Calendar, Schedules and Triggers) and
// Settings live in the left rail (docs/rail.md). Create (tasks, notes, quick
// capture) and ⌘K search stay here for now, beside the rail's own Create and
// Search.

export function TopHud() {
  const { activeView, goHome, openExecution, setQuickCaptureOpen } = useDashboard();
  // The agent view and the execution view both close back to Home.
  const closeLabel =
    activeView.kind === 'execution'
      ? 'Close execution'
      : activeView.kind === 'agent'
        ? 'Close agent'
        : activeView.kind === 'skill'
          ? 'Close skill'
          : null;
  const latestExecutionId = useLatestExecutionId();

  return (
    <header data-desktop-titlebar className="flex-shrink-0 h-10 border-b border-border flex items-center px-4 gap-4 bg-background z-50">
      {/* Desktop app only, right after the window controls. */}
      <DesktopNavButtons className="-mx-1" />

      <RailStatusPills />

      {closeLabel ? (
        <Tip label={closeLabel}>
          <button
            onClick={goHome}
            className="flex items-center gap-1.5 h-7 pl-1.5 pr-1.5 rounded-lg border border-border bg-secondary text-foreground hover:bg-accent transition-all"
            aria-label={closeLabel}
          >
            <X size={12} />
            <span className="text-[11px] font-medium">{closeLabel}</span>
            <kbd className="ml-0.5 px-1 py-0.5 bg-background/60 rounded text-[9px] font-mono leading-none text-muted-foreground">
              {HOTKEYS.closeView.label}
            </kbd>
          </button>
        </Tip>
      ) : latestExecutionId ? (
        <Tip label="Open latest execution">
          <button
            onClick={() => openExecution(latestExecutionId)}
            className="flex items-center gap-1.5 h-7 px-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Open latest execution"
          >
            <span className="text-[11px] font-medium">Open latest execution</span>
            <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono leading-none">
              {HOTKEYS.closeView.label}
            </kbd>
          </button>
        </Tip>
      ) : null}

      <div className="flex-1" />

      <div className="hidden md:block">
        <WorkHudPill />
      </div>

      <div className="hidden md:block">
        <HudDayButton />
      </div>

      <BudgetWarningPill />

      <div className="flex items-center gap-2">
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('open-search'))}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
          aria-label="Search"
        >
          <Search size={14} />
        </button>
        <Tip label="Quick capture">
          <button
            onClick={() => setQuickCaptureOpen(true)}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
            aria-label="Quick capture"
          >
            <Zap size={14} />
          </button>
        </Tip>
        <CreateMenu />
      </div>
    </header>
  );
}
