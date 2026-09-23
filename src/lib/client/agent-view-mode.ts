'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * What clicking an agent's name in the rail does (docs/agents-view-spec.md
 * Phase 7, decision 11: the agent view ships as a trial with one click back).
 *
 *   - `view` (default) — opens the agent's view: its main chat and tools.
 *   - `fold`  — folds or unfolds its execution list, as before the trial.
 *
 * The chevron always folds, and the gear always opens the agent's Setup tab,
 * whichever this is set to.
 *
 * Per-browser in localStorage, like `entity-view-mode.ts`, so the trial owns
 * no schema and is trivially reversible (delete the module, delete the key).
 * If it sticks, promote it to a nullable `user_state` column.
 *
 * Read through `useSyncExternalStore` so server render and hydration see the
 * default and the client snapshot takes over without an effect or a mismatch.
 */

export type AgentViewMode = 'view' | 'fold';

export const AGENT_VIEW_MODE_KEY = 'ri.client.agentViewMode';
export const DEFAULT_AGENT_VIEW_MODE: AgentViewMode = 'view';

const CHANGE_EVENT = 'ri:agent-view-mode-changed';

/** Narrow an unknown stored value to a mode, defaulting anything else. */
export function parseAgentViewMode(raw: unknown): AgentViewMode {
  return raw === 'view' || raw === 'fold' ? raw : DEFAULT_AGENT_VIEW_MODE;
}

function read(): AgentViewMode {
  if (typeof window === 'undefined') return DEFAULT_AGENT_VIEW_MODE;
  try {
    return parseAgentViewMode(window.localStorage.getItem(AGENT_VIEW_MODE_KEY));
  } catch {
    return DEFAULT_AGENT_VIEW_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === AGENT_VIEW_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): AgentViewMode {
  return DEFAULT_AGENT_VIEW_MODE;
}

export function setAgentViewMode(next: AgentViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AGENT_VIEW_MODE_KEY, next);
  } catch {
    /* localStorage can throw in private mode — non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useAgentViewMode(): {
  mode: AgentViewMode;
  setMode: (next: AgentViewMode) => void;
  /** True when clicking an agent's name opens its view. */
  opensView: boolean;
} {
  const mode = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setMode = useCallback((next: AgentViewMode) => setAgentViewMode(next), []);
  return { mode, setMode, opensView: mode === 'view' };
}
