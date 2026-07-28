"use client";

import { Suspense, useEffect, useRef } from 'react';
import { DashboardProvider, useDashboard } from '@/contexts/dashboard-context';
import { useLatestExecutionId } from '@/hooks/use-latest-execution';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { TopHud } from './top-hud';
import { PowerRail } from './power-rail';
import { PanelLayout } from './panel-layout';
import { ExecutionView } from '@/components/executions/execution-view';
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
    setActiveView,
    openNoteId, openTaskId, openAreaId, areasListOpen,
    popSlideout, closeAllSlideouts, slideoutStack,
    triggerVoiceChat,
    quickCaptureOpen, setQuickCaptureOpen, toggleQuickCapture,
    toggleRailCollapsed,
    toggleExecutionRailOpen,
  } = useDashboard();

  // activeView is 'command' for the default dashboard, or a chat_session
  // id when an execution row is selected. Anything non-'command' is
  // treated as a session id; a missing/archived id renders "not found"
  // inside ExecutionView and offers a Back button.
  const isExecutionView = activeView !== 'command';

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
      if (matchesHotkey(e, HOTKEYS.closeExecution)) {
        if (isExecutionViewRef.current) {
          e.preventDefault();
          setActiveView('command');
          return;
        }
        const latest = latestExecutionIdRef.current;
        if (latest) {
          e.preventDefault();
          setActiveView(latest);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [triggerVoiceChat, toggleQuickCapture, toggleRailCollapsed, toggleExecutionRailOpen, setActiveView]);

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
          {isExecutionView ? (
            <ExecutionView sessionId={activeView} />
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
