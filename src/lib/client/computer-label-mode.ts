'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * When an execution names its computer. A reversible UI trial: the standard
 * case goes unsaid, and only the exception is shown.
 *
 *   - `away`   (default) — only when the work runs away from the home
 *     ("MacBook"). Work on the home is unlabeled, which is what a plain +
 *     does unless the agent's default says otherwise. Its computer is still
 *     in the execution's details, and moving it is in its … menu.
 *   - `always` — every execution names its computer once there's more than
 *     one, the home included ("Mac Mini"), as before.
 *
 * Per-browser in localStorage, like `deck-quick-add-mode.ts`. When the trial
 * settles, fold the winner in and retire the switch.
 */

export type ComputerLabelMode = 'away' | 'always';

export const COMPUTER_LABEL_MODE_KEY = 'ri.client.computerLabelMode';
export const DEFAULT_COMPUTER_LABEL_MODE: ComputerLabelMode = 'away';

const CHANGE_EVENT = 'ri:computer-label-mode-changed';

export function parseComputerLabelMode(raw: unknown): ComputerLabelMode {
  return raw === 'always' || raw === 'away' ? raw : DEFAULT_COMPUTER_LABEL_MODE;
}

function read(): ComputerLabelMode {
  if (typeof window === 'undefined') return DEFAULT_COMPUTER_LABEL_MODE;
  try {
    return parseComputerLabelMode(window.localStorage.getItem(COMPUTER_LABEL_MODE_KEY));
  } catch {
    return DEFAULT_COMPUTER_LABEL_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === COMPUTER_LABEL_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): ComputerLabelMode {
  return DEFAULT_COMPUTER_LABEL_MODE;
}

export function setComputerLabelMode(next: ComputerLabelMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COMPUTER_LABEL_MODE_KEY, next);
  } catch {
    /* localStorage can throw in private mode — non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useComputerLabelMode(): { mode: ComputerLabelMode; setMode: (next: ComputerLabelMode) => void } {
  const mode = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setMode = useCallback((next: ComputerLabelMode) => setComputerLabelMode(next), []);
  return { mode, setMode };
}
