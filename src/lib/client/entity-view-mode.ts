'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * How a note or task opens: the classic editor, or the agent-first trial.
 *
 *   - `editor` (default) — the existing document surface: title + rich body
 *     editor with the focused chat in a side panel. Untouched by the trial.
 *   - `agent`  — the agent-first surface: an AI-written brief of the
 *     document, then a full-width conversation with the focused agent as the
 *     way to read, add, change, and remove. The editor is one click away.
 *
 * Per-browser in localStorage, like `transcript-density.ts`. Kept client-side
 * on purpose: this is a UI trial that must be trivially reversible (delete
 * the module, delete the key), so it owns no schema. If the trial sticks,
 * promote it to a nullable `user_state` column the way `voiceAutoSend` is
 * stored.
 *
 * Read through `useSyncExternalStore` so server render and hydration see the
 * default and the client snapshot takes over without an effect or a mismatch.
 */

export type EntityViewMode = 'editor' | 'agent';

export const ENTITY_VIEW_MODE_KEY = 'ri.client.entityViewMode';
export const DEFAULT_ENTITY_VIEW_MODE: EntityViewMode = 'editor';

const CHANGE_EVENT = 'ri:entity-view-mode-changed';

/** Narrow an unknown stored value to a mode, defaulting anything else. */
export function parseEntityViewMode(raw: unknown): EntityViewMode {
  return raw === 'agent' || raw === 'editor' ? raw : DEFAULT_ENTITY_VIEW_MODE;
}

function read(): EntityViewMode {
  if (typeof window === 'undefined') return DEFAULT_ENTITY_VIEW_MODE;
  try {
    return parseEntityViewMode(window.localStorage.getItem(ENTITY_VIEW_MODE_KEY));
  } catch {
    return DEFAULT_ENTITY_VIEW_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ENTITY_VIEW_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): EntityViewMode {
  return DEFAULT_ENTITY_VIEW_MODE;
}

export function setEntityViewMode(next: EntityViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ENTITY_VIEW_MODE_KEY, next);
  } catch {
    /* localStorage can throw in private mode — non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useEntityViewMode(): {
  mode: EntityViewMode;
  setMode: (next: EntityViewMode) => void;
  /** True when the agent-first trial is the default way entities open. */
  agentFirst: boolean;
} {
  const mode = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setMode = useCallback((next: EntityViewMode) => setEntityViewMode(next), []);
  return { mode, setMode, agentFirst: mode === 'agent' };
}

/**
 * The view for one open entity: the preference decides the starting view,
 * and the header toggle overrides it for that entity only. Keyed by id so the
 * override resets naturally when a different entity opens, with no effect.
 */
export function resolveEntityView(
  agentFirst: boolean,
  override: { id: string; view: EntityViewMode } | null,
  entityId: string | null,
): EntityViewMode {
  if (override && entityId && override.id === entityId) return override.view;
  return agentFirst ? 'agent' : 'editor';
}
