'use client';

import { useSyncExternalStore } from 'react';

/**
 * Back and Forward for the desktop app, whose window has no browser chrome.
 * Every in-app move already writes history (`setActiveView` pushes a
 * `?session=` / `?agent=` entry, and Back/Forward reconcile the view from the
 * URL), so this only has to step through it and know when it can.
 *
 * "Can" comes from the Navigation API, which Chromium (and so Electron) ships.
 * It counts only this origin's entries, which is what keeps Back from ever
 * landing on the desktop shell's "Starting Ri" page that loads first. Where
 * it's missing, both directions read as available and `history` does the rest.
 */

/** The slice of the Navigation API used here. TypeScript's DOM lib doesn't carry it yet. */
interface NavigationLike extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

function navigation(): NavigationLike | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { navigation?: NavigationLike }).navigation ?? null;
}

/** Two flags as one string, so the snapshot is stable between changes. */
function readFlags(): string {
  const nav = navigation();
  if (!nav) return '11';
  return `${nav.canGoBack ? 1 : 0}${nav.canGoForward ? 1 : 0}`;
}

function subscribe(onChange: () => void): () => void {
  const nav = navigation();
  // pushState and replaceState change the current entry without a popstate,
  // so the Navigation API's event is the one that sees in-app moves.
  nav?.addEventListener('currententrychange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    nav?.removeEventListener('currententrychange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

export interface HistoryNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export function useHistoryNavigation(): HistoryNavigationState {
  const flags = useSyncExternalStore(subscribe, readFlags, () => '00');
  return { canGoBack: flags[0] === '1', canGoForward: flags[1] === '1' };
}

export function goBack(): void {
  if (navigation()?.canGoBack === false) return;
  window.history.back();
}

export function goForward(): void {
  if (navigation()?.canGoForward === false) return;
  window.history.forward();
}

/**
 * Whether a Back or Forward key press belongs to something else. As in a
 * browser, ⌘[ and ⌘] work from a text field or the chat composer (Home
 * focuses it, so anything stricter would never fire there). They stay out
 * of the places the keys mean something:
 *
 *   - a handler already took the key (`defaultPrevented`),
 *   - the terminal, where ⌃[ is Escape,
 *   - a code editor, where ⌘[ and ⌘] outdent and indent,
 *   - ⌃[ on a Mac, which is Escape to anyone with vim habits. `matchesHotkey`
 *     treats Ctrl as Cmd, so the Mac check asks for the real ⌘.
 */
export function navigationKeyBlocked(event: KeyboardEvent, platform: string): boolean {
  if (event.defaultPrevented) return true;
  if (platform === 'darwin' && !event.metaKey) return true;
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('.xterm, .cm-editor');
}
