'use client';

import { useEffect, useRef } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { SquareKanban, X } from 'lucide-react';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { useDashboard } from '@/contexts/dashboard-context';
import { viewKey } from '@/lib/client/active-view';
import { closeCalendarModal } from '@/lib/client/calendar-modal';
import { closeTaskBoard, openBoard, syncBoardFromUrl, useBoardState } from '@/lib/client/task-board';
import { AgentActivityBoard } from '@/components/board/agent-activity-board';
import { SegmentedTabs } from '@/components/shared/list-toolbar';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { TaskKanban } from './task-kanban';
import { Tip } from '@/components/ui/tip';

/** One spacious Board over the current view. Task slideouts can stack above it.
 * The HUD stays above its desktop edge so window dragging cannot swallow controls. */
export function TaskBoardModal() {
  const { open, view, focusBucket } = useBoardState();
  const params = useSearchParams();
  const { activeView, closeAllSlideouts, openExecution } = useDashboard();
  // Whatever had focus when the board opened (the rail's Board button). Radix
  // hands focus back to a `Dialog.Trigger`, and this board has none.
  const openerRef = useRef<HTMLElement | null>(null);

  // Handle initial bookmarks, query navigation and browser back/forward.
  const search = params.toString();
  useEffect(() => { syncBoardFromUrl(); }, [search]);
  useEffect(() => {
    window.addEventListener('popstate', syncBoardFromUrl);
    return () => window.removeEventListener('popstate', syncBoardFromUrl);
  }, []);

  // Going somewhere else closes the board, so "Start with agent" from a task
  // opened here lands on the new execution instead of under the board.
  const key = viewKey(activeView);
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    closeTaskBoard();
  }, [key]);

  // A slideout already open (the board opened from ⌘K over a task) would sit
  // under the board, still visible but no longer clickable, since dialogs
  // stack in the order they open. Start the board from a clean stack, the
  // full-screen calendar included: one full-screen surface at a time.
  useEffect(() => {
    if (!open) return;
    closeCalendarModal();
    closeAllSlideouts();
  }, [open, closeAllSlideouts]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openBoard() : closeTaskBoard())}>
      <DialogPortal>
        <DialogOverlay className="z-40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-2 top-2 bottom-2 z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none',
            'md:inset-x-4 md:top-12 md:bottom-4',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          )}
          onOpenAutoFocus={(e) => {
            // Focus the board, not its first control, so Filter doesn't open
            // looking selected. Tab still reaches the toolbar first.
            e.preventDefault();
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus();
            openerRef.current = null;
          }}
          onEscapeKeyDown={(e) => {
            // Esc in a text field (a column's add-task input) belongs to the
            // field. The next Esc closes the board.
            const target = e.target;
            if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogDescription className="sr-only">
            Switch between live agent activity and tasks. Choose which columns to show.
          </DialogDescription>
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-2">
            <DialogTitle className="mr-1 flex items-center gap-1.5 text-sm font-semibold">
              <SquareKanban className="size-4 text-muted-foreground" />Board
            </DialogTitle>
            <SegmentedTabs ariaLabel="Board view" value={view} onChange={(next) => openBoard({ view: next })}
              options={[{ value: 'activity', label: 'Agent Activity' }, { value: 'tasks', label: 'Tasks' }]} grow={false} />
            <Tip label="Close Board" shortcut="Esc">
              <DialogPrimitive.Close className="ml-auto flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close Board">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </Tip>
          </div>
          {view === 'activity' ? <AgentActivityBoard focusBucket={focusBucket} /> : <div className="min-h-0 flex-1">
            <TaskKanban leading={<span className="text-xs text-muted-foreground">Tasks by lifecycle</span>}
              onOpenAgent={(sessionId) => { closeTaskBoard(); openExecution(sessionId); }} />
          </div>}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
