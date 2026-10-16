"use client";

import { MessageSquare, Search, Zap, X } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useLatestExecutionId } from '@/hooks/use-latest-execution';
import { HOTKEYS } from '@/constants/commands';
import { CreateMenu } from './create-menu';
import { RailStatusPills } from './rail-status-pills';
import { BudgetWarningPill } from './budget-warning-pill';
import { RateLimitsPill } from './rate-limits-pill';
import { HudDayButton } from '@/components/calendar/hud-day-button';
import { WorkHudPill } from '@/components/calendar/work/work-hud-pill';
import { DesktopNavButtons } from '@/components/desktop/desktop-nav-buttons';
import { Tip } from '@/components/ui/tip';
import { Kbd } from '@/components/ui/kbd';

// What's happening, from every view: work by status, the way out of (or
// back into) an execution, today's work in human time, the next calendar
// event, the budget. Places (Board, Calendar, Schedules and Triggers) and
// Settings live in the left rail (docs/rail.md). Create (tasks, notes, quick
// capture) and ⌘K search stay here for now, beside the rail's own Create and
// Search.

export function TopHud() {
  const { activeView, goHome, openExecution, setQuickCaptureOpen } = useDashboard();
  // The agent, execution, skill and app views all close back to Home.
  const closeLabel =
    activeView.kind === 'execution'
      ? 'Close chat'
      : activeView.kind === 'agent'
        ? 'Close agent'
        : activeView.kind === 'skill'
          ? 'Close skill'
          : activeView.kind === 'apps'
            ? activeView.route === '' || activeView.route === 'new'
              ? 'Close apps'
              : activeView.route.startsWith('drafts/')
                ? 'Close builder'
                : 'Close app'
            : null;
  const latestExecutionId = useLatestExecutionId();

  return (
    <header data-desktop-titlebar className="flex-shrink-0 h-10 border-b border-border flex items-center px-4 gap-2 bg-background z-50">
      {/* Desktop app only, right after the window controls. */}
      <DesktopNavButtons className="-ml-1 shrink-0" />

      {/* Query the space left after native chrome and history navigation,
          rather than the screen width. The phone has its own header. */}
      <div className="top-hud-content min-w-0 flex-1">
        <div className="top-hud-row flex h-full items-center gap-4 whitespace-nowrap [&_svg]:shrink-0">
          <div className="flex shrink-0 items-center gap-1">
            <RailStatusPills />
            <RateLimitsPill />
          </div>

          {closeLabel ? (
            <Tip label={closeLabel} shortcut={HOTKEYS.closeView.label} onlyWhenTextHidden>
              <button
                type="button"
                onClick={goHome}
                className="flex shrink-0 items-center gap-1.5 h-7 px-1.5 rounded-lg border border-border bg-secondary text-foreground hover:bg-accent transition-colors"
                aria-label={closeLabel}
              >
                <X size={12} />
                <span className="hud-view-label text-[11px] font-medium">{closeLabel}</span>
                <Kbd aria-hidden className="hud-shortcut ml-0.5 bg-background/60">
                  {HOTKEYS.closeView.label}
                </Kbd>
              </button>
            </Tip>
          ) : latestExecutionId ? (
            <Tip label="Open latest chat" shortcut={HOTKEYS.closeView.label} onlyWhenTextHidden>
              <button
                type="button"
                onClick={() => openExecution(latestExecutionId)}
                className="flex shrink-0 items-center gap-1.5 h-7 px-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Open latest chat"
              >
                <MessageSquare size={12} />
                <span className="hud-view-label text-[11px] font-medium">Open latest chat</span>
                <Kbd aria-hidden className="hud-shortcut">
                  {HOTKEYS.closeView.label}
                </Kbd>
              </button>
            </Tip>
          ) : null}

          <div className="min-w-4 flex-1" aria-hidden />

          <div className="shrink-0">
            <WorkHudPill />
          </div>

          <div className="hud-calendar min-w-0">
            <HudDayButton />
          </div>

          <BudgetWarningPill />

          <div className="flex shrink-0 items-center gap-2">
            <Tip label="Search tasks, notes and commands" shortcut={HOTKEYS.search.label}>
              <button
                type="button"
                onClick={() => document.dispatchEvent(new CustomEvent('open-search'))}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Search"
              >
                <Search size={14} />
              </button>
            </Tip>
            <Tip label="Quick capture">
              <button
                type="button"
                onClick={() => setQuickCaptureOpen(true)}
                className="hud-quick-capture p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Quick capture"
              >
                <Zap size={14} />
              </button>
            </Tip>
            <CreateMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
