'use client';

import { useEffect, useRef } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { SquareKanban, X } from 'lucide-react';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { useDashboard } from '@/contexts/dashboard-context';
import { viewKey } from '@/lib/client/active-view';
import { closeCalendarModal } from '@/lib/client/calendar-modal';
import { closeTaskBoard, openTaskBoard, useTaskBoardOpen } from '@/lib/client/task-board';
import { cn } from '@/lib/utils';
import { TaskKanban } from './task-kanban';
import { Tip } from '@/components/ui/tip';

/** `?board=1` keeps the board open across a reload and makes it linkable. */
const BOARD_PARAM = 'board';

/**
 * The task board, nearly full screen, over whatever is on screen. Opened from
 * the rail's Board or "Open board" in ⌘K, and closed with Esc, the X
 * or a click outside, which leaves you exactly where you were (often an
 * execution you were watching). Same board as the Tasks panel's Board view,
 * just with the width to read it.
 *
 * Layering: the board sits at z-40, the task slideout's own layer, so a card
 * opens its task on top with the board dimmed behind it. On desktop it starts
 * below the HUD, which the desktop app makes a window drag region that would
 * otherwise swallow clicks on the board's toolbar.
 */
export function TaskBoardModal() {
  const open = useTaskBoardOpen();
  const { activeView, closeAllSlideouts, openExecution } = useDashboard();
  // Whatever had focus when the board opened (the HUD's Board button). Radix
  // hands focus back to a `Dialog.Trigger`, and this board has none.
  const openerRef = useRef<HTMLElement | null>(null);

  // Open from a `?board` link on first mount.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has(BOARD_PARAM)) openTaskBoard();
  }, []);

  // Reflect the open state in the URL without a router round-trip. A null
  // state lets Next's router take the new URL as its own. Passing its current
  // state skips that, and a navigation in flight (Open on a card) would then
  // write `?board=1` back.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (open === params.has(BOARD_PARAM)) return;
    if (open) params.set(BOARD_PARAM, '1');
    else params.delete(BOARD_PARAM);
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', url);
  }, [open]);

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
    <Dialog open={open} onOpenChange={(next) => (next ? openTaskBoard() : closeTaskBoard())}>
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
            Every task by lane. Drag a card to move it, or click it to open the task.
          </DialogDescription>
          <TaskKanban
            // Close explicitly: the agent's chat may already be the view
            // underneath, so the view-change close above wouldn't fire.
            onOpenAgent={(sessionId) => {
              closeTaskBoard();
              openExecution(sessionId);
            }}
            leading={
              <DialogTitle className="flex items-center gap-1.5 px-1 text-sm font-semibold">
                <SquareKanban className="size-4 text-muted-foreground" />
                Board
              </DialogTitle>
            }
            trailing={
              <Tip label="Close board" shortcut="Esc">
                <DialogPrimitive.Close
                  className="ml-1 flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Close board"
                >
                  <X className="size-4" />
                </DialogPrimitive.Close>
              </Tip>
            }
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
