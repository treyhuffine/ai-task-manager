"use client";

import { DashboardProvider, useDashboard } from '@/contexts/dashboard-context';
import { TopHud } from './top-hud';
import { PowerRail } from './power-rail';
import { PanelLayout } from './panel-layout';
import { BottomHud } from './bottom-hud';
import { FocusView } from './focus-view';
import { SearchOverlay } from '@/components/shared/search-overlay';
import { NoteSlideout } from '@/components/notes/note-slideout';
import { TaskSlideout } from '@/components/tasks/task-slideout';
import { cn } from '@/lib/utils';

function DashboardShell() {
  const { theme, openNoteId, closeNote, openTaskId, closeTask } = useDashboard();

  return (
    <div className={cn(
      theme === 'dark' ? 'dark' : '',
    )}>
      <div className="flex flex-col h-screen bg-background text-foreground font-sans overflow-hidden antialiased transition-colors duration-300">
        <TopHud />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <PowerRail />
          <PanelLayout />
        </div>

        <BottomHud />
        <FocusView />
        <SearchOverlay />
        <NoteSlideout noteId={openNoteId} onClose={closeNote} />
        <TaskSlideout taskId={openTaskId} onClose={closeTask} />
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
