'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * How the Deck lays out. A reversible UI trial (see docs/deck-quick-add.md and
 * docs/deck-focused-layout.md). The dense layout grew into a command center
 * that surveys everything at once (deadlines, in-progress, triage, changes,
 * the ranked stack), which reads well for orientation but buries "what do I do
 * now" and stops feeling like a focused place to work.
 *
 *   - `classic`  (default) — today's dense command-center layout. Untouched.
 *   - `focused`  — one hero (the top next action) above the fold, urgent hard
 *     deadlines as a thin persistent strip, and everything else (in-progress,
 *     triage, changes, the rest of the stack) folded into a compact ribbon that
 *     expands on demand. Command center is one tap away; the hero is singular.
 *
 * Per-browser in localStorage, like `deck-quick-add-mode.ts`. Client-only so
 * the trial is trivially reversible (delete the module, delete the key); it
 * owns no schema. When it wins, make it the layout and retire the switch.
 *
 * Read through `useSyncExternalStore` so server render and hydration see the
 * default and the client snapshot takes over without an effect or a mismatch.
 */

export type DeckLayoutMode = 'classic' | 'focused';

export const DECK_LAYOUT_MODE_KEY = 'ri.client.deckLayoutMode';
export const DEFAULT_DECK_LAYOUT_MODE: DeckLayoutMode = 'classic';

const CHANGE_EVENT = 'ri:deck-layout-mode-changed';

/** Narrow an unknown stored value to a mode, defaulting anything else. */
export function parseDeckLayoutMode(raw: unknown): DeckLayoutMode {
  return raw === 'focused' || raw === 'classic' ? raw : DEFAULT_DECK_LAYOUT_MODE;
}

function read(): DeckLayoutMode {
  if (typeof window === 'undefined') return DEFAULT_DECK_LAYOUT_MODE;
  try {
    return parseDeckLayoutMode(window.localStorage.getItem(DECK_LAYOUT_MODE_KEY));
  } catch {
    return DEFAULT_DECK_LAYOUT_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === DECK_LAYOUT_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): DeckLayoutMode {
  return DEFAULT_DECK_LAYOUT_MODE;
}

export function setDeckLayoutMode(next: DeckLayoutMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DECK_LAYOUT_MODE_KEY, next);
  } catch {
    /* localStorage can throw in private mode — non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useDeckLayoutMode(): {
  mode: DeckLayoutMode;
  setMode: (next: DeckLayoutMode) => void;
} {
  const mode = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setMode = useCallback((next: DeckLayoutMode) => setDeckLayoutMode(next), []);
  return { mode, setMode };
}
