'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * How "add a task from the Deck" presents. A reversible UI trial (see
 * docs/deck-quick-add.md). The classic inline field was styled to match a deck
 * card (transparent, faded placeholder), so people clicked it without realising
 * they were in a typing mode. These variants make the composer unmistakably an
 * input.
 *
 *   - `classic`    (default) — the original faded inline card at the bottom of
 *     the stack, opened by the day-bar "Add task" pill. Untouched by the trial.
 *   - `persistent` — an always-visible composer pinned at the top of the stack
 *     that plainly reads as an input and lights up when focused. Nothing to
 *     discover.
 *   - `trigger`    — a prominent day-bar "Add a task" button that opens that
 *     same redesigned composer at the top of the stack.
 *
 * Per-browser in localStorage, like `entity-view-mode.ts` and
 * `transcript-density.ts`. Client-only on purpose so the trial is trivially
 * reversible (delete the module, delete the key); it owns no schema. When a
 * variant wins, fold it in as the one real design and retire the switch.
 *
 * Read through `useSyncExternalStore` so server render and hydration see the
 * default and the client snapshot takes over without an effect or a mismatch.
 */

export type DeckQuickAddMode = 'classic' | 'persistent' | 'trigger';

export const DECK_QUICK_ADD_MODE_KEY = 'ri.client.deckQuickAddMode';
export const DEFAULT_DECK_QUICK_ADD_MODE: DeckQuickAddMode = 'classic';

const CHANGE_EVENT = 'ri:deck-quick-add-mode-changed';

/** Narrow an unknown stored value to a mode, defaulting anything else. */
export function parseDeckQuickAddMode(raw: unknown): DeckQuickAddMode {
  return raw === 'persistent' || raw === 'trigger' || raw === 'classic'
    ? raw
    : DEFAULT_DECK_QUICK_ADD_MODE;
}

function read(): DeckQuickAddMode {
  if (typeof window === 'undefined') return DEFAULT_DECK_QUICK_ADD_MODE;
  try {
    return parseDeckQuickAddMode(window.localStorage.getItem(DECK_QUICK_ADD_MODE_KEY));
  } catch {
    return DEFAULT_DECK_QUICK_ADD_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === DECK_QUICK_ADD_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): DeckQuickAddMode {
  return DEFAULT_DECK_QUICK_ADD_MODE;
}

export function setDeckQuickAddMode(next: DeckQuickAddMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DECK_QUICK_ADD_MODE_KEY, next);
  } catch {
    /* localStorage can throw in private mode — non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useDeckQuickAddMode(): {
  mode: DeckQuickAddMode;
  setMode: (next: DeckQuickAddMode) => void;
} {
  const mode = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setMode = useCallback((next: DeckQuickAddMode) => setDeckQuickAddMode(next), []);
  return { mode, setMode };
}
