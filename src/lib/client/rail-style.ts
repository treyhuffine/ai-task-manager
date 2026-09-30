'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * How the rail's Agents list looks. A reversible UI trial
 * (docs/rail-agents-first.md).
 *
 *   - `agents` (default) — agents first: each agent is a two-line row with
 *     its icon, what its main chat is doing, and a one-line summary of its
 *     work. Its executions hang off it as one-line threads, the live ones
 *     always, a few recent quiet ones, and the rest one click away in the
 *     agent's view.
 *   - `classic` — one-line agent rows over two-line execution rows, every
 *     active execution listed, as before the trial.
 *
 * Per-browser in localStorage, like `agent-view-mode.ts`. Client-only so the
 * trial is trivially reversible (delete the module, delete the key). It owns
 * no schema. When it wins, make it the rail and retire the switch.
 *
 * Read through `useSyncExternalStore` so server render and hydration see the
 * default and the client snapshot takes over without an effect or a mismatch.
 */

export type RailStyle = 'agents' | 'classic';

export const RAIL_STYLE_KEY = 'ri.client.railStyle';
export const DEFAULT_RAIL_STYLE: RailStyle = 'agents';

const CHANGE_EVENT = 'ri:rail-style-changed';

/** Narrow an unknown stored value to a style, defaulting anything else. */
export function parseRailStyle(raw: unknown): RailStyle {
  return raw === 'agents' || raw === 'classic' ? raw : DEFAULT_RAIL_STYLE;
}

function read(): RailStyle {
  if (typeof window === 'undefined') return DEFAULT_RAIL_STYLE;
  try {
    return parseRailStyle(window.localStorage.getItem(RAIL_STYLE_KEY));
  } catch {
    return DEFAULT_RAIL_STYLE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === RAIL_STYLE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): RailStyle {
  return DEFAULT_RAIL_STYLE;
}

export function setRailStyle(next: RailStyle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RAIL_STYLE_KEY, next);
  } catch {
    /* localStorage can throw in private mode, non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRailStyle(): { style: RailStyle; setStyle: (next: RailStyle) => void } {
  const style = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setStyle = useCallback((next: RailStyle) => setRailStyle(next), []);
  return { style, setStyle };
}
