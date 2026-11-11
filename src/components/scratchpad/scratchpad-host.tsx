'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { NotebookPen } from 'lucide-react';
import { EntitySheet } from '@/components/entities/entity-sheet';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tip } from '@/components/ui/tip';
import { useHomeStorageScope, useOptionalHomeContext } from '@/components/home/home-context';
import { composerTarget } from '@/components/chat/editor/composer-focus';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { useViewportTier } from '@/hooks/use-viewport-tier';
import { useDragResize } from '@/hooks/use-drag-resize';
import { homeStorageIdentity } from '@/lib/home/document-scope';
import {
  isScratchpadColumnOpen, isScratchpadSheetOpen, nextScratchpadAction, requestScratchpadFocus,
  setScratchpadColumnOpen, setScratchpadSheetOpen, useScratchpadColumnOpen, useScratchpadSheetOpen,
} from '@/lib/client/scratchpad-open';
import { cn } from '@/lib/utils';
import { ScratchpadPad } from './scratchpad-pad';

/**
 * Where the scratchpad shows (docs/scratchpad.md): a column at the right of
 * every screen on a wide window, a sheet over the page on a phone or tablet.
 * It's private planning, so a team's Home has none.
 */

export function useScratchpadAvailable(): boolean {
  const home = useOptionalHomeContext();
  return !!home && home.capabilities.privatePlanning !== false;
}

/** Where focus was when the shortcut took it into the pad, to go back to. */
let returnTo: HTMLElement | null = null;

function padHasFocus(): boolean {
  return !!document.activeElement?.closest('[data-scratchpad]');
}

function rememberFocus() {
  const active = document.activeElement;
  returnTo = active instanceof HTMLElement && active !== document.body && !active.closest('[data-scratchpad]') ? active : null;
}

/** Back to where you were before the pad: that element, else the chat on screen. */
function goBack() {
  const to = returnTo;
  returnTo = null;
  if (to?.isConnected) { to.focus(); return; }
  const composer = composerTarget();
  if (composer) { composer.focus(); return; }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function openScratchpad(wide: boolean) {
  rememberFocus();
  if (wide) setScratchpadColumnOpen(true);
  else setScratchpadSheetOpen(true);
  requestScratchpadFocus();
}

export function closeScratchpad(wide: boolean) {
  const inside = padHasFocus();
  if (wide) setScratchpadColumnOpen(false);
  else setScratchpadSheetOpen(false);
  if (inside) goBack();
}

/** ⌘⇧J: to the pad's caret, and back (`nextScratchpadAction`). */
export function runScratchpadShortcut(wide: boolean) {
  const open = wide ? isScratchpadColumnOpen() : isScratchpadSheetOpen();
  const action = nextScratchpadAction(open, padHasFocus(), wide);
  if (action === 'open') openScratchpad(wide);
  else if (action === 'focus') { rememberFocus(); requestScratchpadFocus(); }
  else if (action === 'return') goBack();
  else closeScratchpad(wide);
}

/** Mounted once on the dashboard. */
export function ScratchpadShortcut() {
  const available = useScratchpadAvailable();
  const tier = useViewportTier();
  useEffect(() => {
    if (!available) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matchesHotkey(e, HOTKEYS.scratchpad)) return;
      e.preventDefault();
      runScratchpadShortcut(tier === 'desktop');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [available, tier]);
  return null;
}

/** The pad beside every screen on a wide window. It stays open across navigation and reloads. */
export function ScratchpadColumn() {
  const available = useScratchpadAvailable();
  const open = useScratchpadColumnOpen();
  return available && open ? <OpenScratchpadColumn /> : null;
}

function OpenScratchpadColumn() {
  const [expanded, setExpanded] = useState(false);
  const editor = useRef<Editor | null>(null);
  const focusChat = useRef(false);
  const storageScope = useHomeStorageScope();
  const { size: width, isResizing, handleResizeStart } = useDragResize({
    edge: 'left', min: 420, max: 1400, defaultSize: 960,
    storageKey: homeStorageIdentity('ri.scratchpad-slideout.width', storageScope),
  });
  // This component opens only after hydration. Keep one portal target and
  // move it between the column and the sheet, so the editor never remounts.
  const [padContainer] = useState(() => {
    const element = document.createElement('div');
    element.className = 'flex h-full min-h-0 min-w-0 flex-1 flex-col';
    return element;
  });
  const mountPad = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    element.appendChild(padContainer);
    queueMicrotask(() => {
      if (!focusChat.current) editor.current?.commands.focus();
    });
  }, [padContainer]);
  const collapse = () => setExpanded(false);
  return (
    <>
      <aside aria-label="Scratchpad" ref={expanded ? undefined : mountPad}
        className="flex min-h-0 w-[340px] shrink-0 flex-col border-l border-border" />
      <EntitySheet open={expanded} label="Scratchpad" width={width} resizing={isResizing}
        onClose={collapse} showCloseButton={false}
        onOpenAutoFocus={(e) => { e.preventDefault(); editor.current?.commands.focus(); }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (focusChat.current) { focusChat.current = false; composerTarget()?.focus(); }
          else editor.current?.commands.focus();
        }}>
        <div role="separator" aria-label="Resize the scratchpad" aria-orientation="vertical"
          className={cn('relative hidden w-1.5 shrink-0 cursor-col-resize bg-background transition-colors hover:bg-primary/20 md:block', isResizing && 'bg-primary/30')}
          onPointerDown={handleResizeStart} style={{ touchAction: 'none' }}>
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
        <div ref={expanded ? mountPad : undefined} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" />
      </EntitySheet>
      {createPortal(
        <div className="flex h-full min-h-0 flex-col"
          onKeyDown={(e) => {
            if (expanded) {
              if (matchesHotkey(e.nativeEvent, HOTKEYS.scratchpad)) { e.preventDefault(); collapse(); }
              return;
            }
            if (!matchesHotkey(e.nativeEvent, HOTKEYS.scratchpadClose)) return;
            if (e.target instanceof Element && e.target.closest('[data-cancel-on-escape]')) return;
            e.preventDefault();
            closeScratchpad(true);
          }}>
          <ScratchpadPad expanded={expanded} onEditor={(value) => { editor.current = value; }}
            onExpand={expanded ? undefined : () => setExpanded(true)}
            onClose={expanded ? collapse : () => closeScratchpad(true)} closeShortcut={HOTKEYS.scratchpadClose.label}
            onSendToChat={expanded ? () => { focusChat.current = true; collapse(); } : undefined} />
        </div>, padContainer,
      )}
    </>
  );
}

/** The pad over the page on a phone or tablet. */
export function ScratchpadSheet() {
  const available = useScratchpadAvailable();
  const open = useScratchpadSheetOpen();
  const tier = useViewportTier();
  if (!available) return null;
  return (
    <Sheet open={open && tier !== null && tier !== 'desktop'} onOpenChange={(next) => { if (!next) setScratchpadSheetOpen(false); }}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        // The pad's editor takes the caret itself once its text has loaded.
        onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetTitle className="sr-only">Scratchpad</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <ScratchpadPad onClose={() => setScratchpadSheetOpen(false)} closeShortcut={HOTKEYS.scratchpadClose.label} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Opens or closes the pad: in the top bar on a wide window or tablet, beside search on a phone. */
export function ScratchpadButton({ variant = 'hud' }: { variant?: 'hud' | 'phone' }) {
  const available = useScratchpadAvailable();
  const tier = useViewportTier();
  const columnOpen = useScratchpadColumnOpen();
  const sheetOpen = useScratchpadSheetOpen();
  const wide = tier === 'desktop';
  const open = wide ? columnOpen : sheetOpen;
  if (!available) return null;
  const button = (
    <button
      type="button"
      aria-label="Scratchpad"
      aria-pressed={open}
      onClick={() => (open ? closeScratchpad(wide) : openScratchpad(wide))}
      className={cn(
        'flex items-center justify-center border border-border text-muted-foreground transition-colors hover:text-foreground',
        variant === 'phone' ? 'h-10 w-10 shrink-0 rounded-lg active:bg-muted/60' : 'rounded-lg p-1.5',
        open && 'bg-muted/60 text-foreground',
      )}
    >
      <NotebookPen size={variant === 'phone' ? 16 : 14} />
    </button>
  );
  if (variant === 'phone') return button;
  return <Tip label="Scratchpad" shortcut={HOTKEYS.scratchpad.label}>{button}</Tip>;
}
