"use client";

import { useEffect } from 'react';
import { DashboardProvider, useDashboard } from '@/contexts/dashboard-context';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { TopHud } from './top-hud';
import { PowerRail } from './power-rail';
import { PanelLayout } from './panel-layout';
import { BottomHud } from './bottom-hud';
import { FocusView } from './focus-view';
import { SearchOverlay } from '@/components/shared/search-overlay';
import { NoteSlideout } from '@/components/notes/note-slideout';
import { TaskSlideout } from '@/components/tasks/task-slideout';
import { AreaSlideout } from '@/components/dashboard/area-slideout';
import { AreasSheet } from '@/components/dashboard/areas-sheet';
import { QuickCaptureModal } from '@/components/dashboard/quick-capture-modal';
import { MobileLayout } from '@/components/mobile/mobile-layout';
import { TabletLayout } from '@/components/mobile/tablet-layout';
import { cn } from '@/lib/utils';

function DashboardShell() {
  const {
    theme,
    openNoteId, openTaskId, openAreaId, areasListOpen,
    popSlideout, closeAllSlideouts, slideoutStack,
    triggerVoiceChat,
    quickCaptureOpen, setQuickCaptureOpen, toggleQuickCapture,
  } = useDashboard();

  // Global hotkeys: voice chat (⌘J) and quick capture (⌘⇧K)
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
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [triggerVoiceChat, toggleQuickCapture]);

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
          <PowerRail />
          <PanelLayout />
        </div>

        {/* BottomHud — hidden on mobile */}
        <div className="hidden md:block">
          <BottomHud />
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
      </div>
    </div>
  );
}

export function Dashboard() {
  return (
    <DashboardProvider>
      <DashboardShell />
    </DashboardProvider>
  );
}
