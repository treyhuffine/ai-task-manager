'use client';

import { useEffect, useRef } from 'react';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';

/** Text fields keep Escape for themselves (closing menus, cancelling edits). */
function isEditableTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface WorkbenchHotkeys {
  /** Listen only while this copy of the view is the one on screen. */
  enabled: boolean;
  /** ⌃`. Left out where there's no terminal (a phone or tablet). */
  toggleTerminal?: () => void;
  /** ⌃. */
  toggleTools: () => void;
  /** ⌘P: show Files. The tree's search then takes focus. */
  goToFile?: () => void;
  /** Where to look for the tree's search. The whole page by default. */
  treeSearchRoot?: () => ParentNode | null;
  /** Escape: restore an expanded panel, else close it. False when there was nothing to do. */
  escape: () => boolean;
}

/**
 * The workbench's keys, the same on the execution view and the agent view
 * (docs/execution-view-spec.md, "Hotkeys"):
 *
 *   ⌃`   shows or hides the terminal drawer
 *   ⌃.   shows or hides the tools panel
 *   ⌘P   opens Files and focuses the tree's search
 *   Esc  restores an expanded panel first, then closes it
 *
 * The toggles listen in the capture phase, so a focused terminal can't
 * swallow them. Escape listens in the bubble phase, so dialogs, menus,
 * editors and the terminal get it first and can claim it, and it never
 * leaves a text field, a menu or a dialog.
 */
export function useWorkbenchHotkeys(keys: WorkbenchHotkeys) {
  const keysRef = useRef(keys);
  useEffect(() => {
    keysRef.current = keys;
  });

  useEffect(() => {
    const focusTreeSearch = () => {
      let tries = 0;
      const tick = () => {
        const root = keysRef.current.treeSearchRoot?.() ?? document;
        const input = root.querySelector<HTMLInputElement>('[data-tree-search]');
        if (input && input.offsetParent !== null) {
          input.focus();
          input.select();
        } else if (tries++ < 20) {
          window.setTimeout(tick, 50);
        }
      };
      tick();
    };
    const onKeyCapture = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (!k.enabled) return;
      if (k.toggleTerminal && matchesHotkey(e, HOTKEYS.toggleTerminal)) {
        e.preventDefault();
        e.stopPropagation();
        k.toggleTerminal();
      } else if (matchesHotkey(e, HOTKEYS.toggleTools)) {
        e.preventDefault();
        e.stopPropagation();
        k.toggleTools();
      } else if (k.goToFile && matchesHotkey(e, HOTKEYS.goToFile)) {
        e.preventDefault();
        e.stopPropagation();
        k.goToFile();
        focusTreeSearch();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (!k.enabled || !matchesHotkey(e, HOTKEYS.slideoutBack)) return;
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.closest('.xterm') || isEditableTarget(target) || target.closest('[role="dialog"],[role="menu"]'))) return;
      if (k.escape()) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
