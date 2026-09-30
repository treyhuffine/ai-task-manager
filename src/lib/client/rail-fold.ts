'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether one fold in a list is open: a section's inactive executions (see
 * `src/lib/sessions/inactive.ts`), or the quiet threads an agent keeps behind
 * "N more hidden" in the agents-first rail. Each fold remembers its own
 * choice, so opening one agent's leaves the others shut.
 *
 * Per-browser in localStorage, like the Status tab's bucket collapse
 * (`ri.rail.bucket.<id>`): how a list is folded on this screen is a view
 * choice, not data. Shut is the default.
 *
 * Read through `useSyncExternalStore` so server render and hydration agree
 * (shut) and a toggle in one place updates every mounted copy of that fold
 * (the rail and the agent view can show the same agent).
 */

const KEY_PREFIX = 'ri.rail.fold.';
const CHANGE_EVENT = 'ri:rail-fold-changed';

export function railFoldKey(foldId: string): string {
  return `${KEY_PREFIX}${foldId}`;
}

function read(foldId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(railFoldKey(foldId)) === '1';
  } catch {
    return false;
  }
}

export function setFoldShown(foldId: string, shown: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (shown) window.localStorage.setItem(railFoldKey(foldId), '1');
    else window.localStorage.removeItem(railFoldKey(foldId));
  } catch {
    /* localStorage can throw in private mode, non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(KEY_PREFIX)) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** `[shown, setShown]` for one fold, e.g. `inactive:agent:<id>` or `more:agent:<id>`. */
export function useFoldShown(foldId: string): [boolean, (shown: boolean) => void] {
  const shown = useSyncExternalStore(
    subscribe,
    () => read(foldId),
    () => false,
  );
  const setShown = useCallback((next: boolean) => setFoldShown(foldId, next), [foldId]);
  return [shown, setShown];
}
