'use client';

import { navigation } from './history-actions';
export { goBack, goForward, navigationKeyBlocked, installHistoryNavigation } from './history-actions';
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
