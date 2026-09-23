"use client";

import { Suspense, useEffect, useRef } from 'react';
import { DashboardProvider, useDashboard } from '@/contexts/dashboard-context';
import { useLatestExecutionId } from '@/hooks/use-latest-execution';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { TopHud } from './top-hud';
import { PowerRail } from './power-rail';
import { PanelLayout } from './panel-layout';
import { ExecutionView } from '@/components/executions/execution-view';
import { AgentView } from '@/components/agents/agent-view';
import { FocusView } from './focus-view';
import { SearchOverlay } from '@/components/shared/search-overlay';
import { NoteSlideout } from '@/components/notes/note-slideout';
import { TaskSlideout } from '@/components/tasks/task-slideout';
import { AreaSlideout } from '@/components/dashboard/area-slideout';
import { AreasSheet } from '@/components/dashboard/areas-sheet';
import { QuickCaptureModal } from '@/components/dashboard/quick-capture-modal';
import { SettingsModal } from '@/components/settings/settings-modal';
import { LaunchModal } from '@/components/workspaces/launcher/launch-modal';
import { MobileLayout } from '@/components/mobile/mobile-layout';
import { TabletLayout } from '@/components/mobile/tablet-layout';
import { AuthRecoveryCard } from '@/components/auth/auth-recovery-card';
import { useRailContextHydrate } from '@/hooks/use-rail-context-hydrate';
import { useGlobalSessionStream } from '@/hooks/use-global-session-stream';
import { cn } from '@/lib/utils';

function DashboardShell() {
  const {
    theme,
    activeView,
    goHome,
    openExecution,
    openNoteId, openTaskId, openAreaId, areasListOpen,
    popSlideout, closeAllSlideouts, slideoutStack,
    triggerVoiceChat,
    quickCaptureOpen, setQuickCaptureOpen, toggleQuickCapture,
    toggleRailCollapsed,
    toggleExecutionRailOpen,
  } = useDashboard();

  // Home, an agent's view, or an execution (see `ActiveView`). A missing or
  // archived id renders "not found" inside its view and offers a way back.
  // Only the execution view collapses the rail: Home and the agent view keep
  // whatever the user set, which is part of what makes the execution view
  // read as a separate workbench.
  const isExecutionView = activeView.kind === 'execution';
  const isHome = activeView.kind === 'home';

  // Sync the rail GET's pending/running snapshots into the dashboard
  // context so the by-status bucketizer and by-workspace status pips
  // both reflect cross-session state. The global lifecycle stream refreshes
  // background sessions, with the rail poll as a safety net.
  useRailContextHydrate();
  useGlobalSessionStream();

  // Keep a ref so the keyboard handler can read `isExecutionView`
  // without re-binding on every navigation.
  const isExecutionViewRef = useRef(isExecutionView);
  isExecutionViewRef.current = isExecutionView;

  // Latest validated execution id — drives ⌘E "reopen" from the
  // dashboard. Kept in a ref so the global keydown handler can read
  // the current value without re-subscribing as the rail data changes.
  const latestExecutionId = useLatestExecutionId();
  const latestExecutionIdRef = useRef(latestExecutionId);
  latestExecutionIdRef.current = latestExecutionId;

  // Global hotkeys: voice chat (⌘J), quick capture (⌘⇧K), rail toggle (⌘\)
  // ⌘\ targets `executionRailOpen` when on an execution surface and
  // `railCollapsed` elsewhere, so each context's rail state is
  // independently persisted.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesHotkey(e, HOTKEYS.voiceChat)) {
        e.preventDefault();
        triggerVoiceChat();
        return;
      }
      if (matchesHotkey(e, HOTKEYS.quickCapture)) {
        e.preventDefault();
        toggleQuickCapture();
        return;
      }
      if (matchesHotkey(e, HOTKEYS.toggleRail)) {
        e.preventDefault();
        if (isExecutionViewRef.current) {
          toggleExecutionRailOpen();
        } else {
          toggleRailCollapsed();
        }
        return;
      }
      if (matchesHotkey(e, HOTKEYS.closeView)) {
        // Close whichever view is open. From Home, reopen the latest execution.
        if (!isHome) {
          e.preventDefault();
          goHome();
          return;
        }
        const latest = latestExecutionIdRef.current;
        if (latest) {
          e.preventDefault();
          openExecution(latest);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [triggerVoiceChat, toggleQuickCapture, toggleRailCollapsed, toggleExecutionRailOpen, goHome, openExecution, isHome]);

  const hasHistory = slideoutStack.length > 1;

  return (
    <div className={cn(
      theme === 'dark' ? 'dark' : '',
    )}>
      <div className="flex flex-col h-dvh bg-background text-foreground font-sans overflow-hidden antialiased transition-colors duration-300">
        {/* TopHud — hidden on mobile */}
        <div className="hidden md:block">
          <TopHud />
        </div>

        {/* Mobile layout: <md */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden md:hidden">
          <MobileLayout />
        </div>

        {/* Tablet layout: md–lg */}
        <div className="hidden md:flex lg:hidden flex-1 min-h-0 overflow-hidden">
          <TabletLayout />
        </div>

        {/* Desktop layout: ≥lg */}
        <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden">
          <PowerRail compact={isExecutionView} />
          {activeView.kind === 'execution' ? (
            <ExecutionView sessionId={activeView.id} />
          ) : activeView.kind === 'agent' ? (
            <AgentView workspaceId={activeView.id} tab={activeView.tab} />
          ) : (
            <PanelLayout />
          )}
        </div>

        <FocusView />
        <SearchOverlay />
        <NoteSlideout
          noteId={openNoteId}
          onClose={popSlideout}
          onCloseAll={closeAllSlideouts}
          hasHistory={hasHistory}
        />
        <TaskSlideout
          taskId={openTaskId}
          onClose={popSlideout}
          onCloseAll={closeAllSlideouts}
          hasHistory={hasHistory}
        />
        <AreaSlideout
          areaId={openAreaId}
          onClose={popSlideout}
          onCloseAll={closeAllSlideouts}
          hasHistory={hasHistory}
        />
        <AreasSheet
          open={areasListOpen}
          onOpenChange={(open) => { if (!open) closeAllSlideouts() }}
        />
        <QuickCaptureModal open={quickCaptureOpen} onOpenChange={setQuickCaptureOpen} />
        <SettingsModal />
        <LaunchModal />
        <AuthRecoveryCard />
      </div>
    </div>
  );
}

export function Dashboard() {
  // Suspense boundary is required because DashboardProvider reads the URL via
  // useSearchParams (the source of truth for `activeView`).
  return (
    <Suspense fallback={null}>
      <DashboardProvider>
        <DashboardShell />
      </DashboardProvider>
    </Suspense>
  );
}
