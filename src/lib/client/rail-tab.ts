'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Which list the rail shows under its tabs.
 *
 *   - `workspace` (Agents, the default): the agent tree, each agent with its
 *     executions.
 *   - `history` (Recent): every execution, active and archived, newest first
 *     in date groups. The only list that shows archived work.
 *
 * Per-browser in localStorage, shared by the wide rail and the collapsed
 * rail's Agents flyout so both open on the list you left. A `status` value
 * from before the Status tab was removed (its buckets live on as the header's
 * pills) reads as the default.
 *
 * Read through `useSyncExternalStore` so server render and hydration see the
 * default and the client snapshot takes over without an effect or a mismatch.
 */

export type RailTab = 'workspace' | 'history';

export const RAIL_TAB_KEY = 'ri.rail.tab';
export const DEFAULT_RAIL_TAB: RailTab = 'workspace';

const CHANGE_EVENT = 'ri:rail-tab-changed';

/** Narrow an unknown stored value to a tab, defaulting anything else. */
export function parseRailTab(raw: unknown): RailTab {
  return raw === 'workspace' || raw === 'history' ? raw : DEFAULT_RAIL_TAB;
}

function read(): RailTab {
  if (typeof window === 'undefined') return DEFAULT_RAIL_TAB;
  try {
    return parseRailTab(window.localStorage.getItem(RAIL_TAB_KEY));
  } catch {
    return DEFAULT_RAIL_TAB;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === RAIL_TAB_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): RailTab {
  return DEFAULT_RAIL_TAB;
}

export function setRailTab(next: RailTab): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RAIL_TAB_KEY, next);
  } catch {
    /* localStorage can throw in private mode, non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRailTab(): { tab: RailTab; setTab: (next: RailTab) => void } {
  const tab = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setTab = useCallback((next: RailTab) => setRailTab(next), []);
  return { tab, setTab };
}
