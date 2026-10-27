'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Where a chat opened from an agent's view goes (docs/agents-view-spec.md,
 * "Chats beside the agent"). A link to a chat in the main chat, a row in
 * Overview or a chat chip used to leave the agent for the full execution
 * view. Now it opens in the tools panel, beside the main chat.
 *
 *   - `beside` (default): in the tools panel, as one more tab, with the
 *     full view one click away.
 *   - `full`: the full execution view, as before the trial.
 *
 * Per-browser in localStorage, like `agent-view-mode.ts`, so the trial owns
 * no schema and is trivially reversible (delete the module, delete the key).
 * One-pane layouts (a phone, a narrow window) always open the full view.
 */

export type AgentChatPlace = 'beside' | 'full';

export const AGENT_CHAT_PLACE_KEY = 'ri.client.agentChatPlace';
export const DEFAULT_AGENT_CHAT_PLACE: AgentChatPlace = 'beside';

const CHANGE_EVENT = 'ri:agent-chat-place-changed';

/** Narrow an unknown stored value to a place, defaulting anything else. */
export function parseAgentChatPlace(raw: unknown): AgentChatPlace {
  return raw === 'beside' || raw === 'full' ? raw : DEFAULT_AGENT_CHAT_PLACE;
}

function read(): AgentChatPlace {
  if (typeof window === 'undefined') return DEFAULT_AGENT_CHAT_PLACE;
  try {
    return parseAgentChatPlace(window.localStorage.getItem(AGENT_CHAT_PLACE_KEY));
  } catch {
    return DEFAULT_AGENT_CHAT_PLACE;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === AGENT_CHAT_PLACE_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getServerSnapshot(): AgentChatPlace {
  return DEFAULT_AGENT_CHAT_PLACE;
}

export function setAgentChatPlace(next: AgentChatPlace): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AGENT_CHAT_PLACE_KEY, next);
  } catch {
    /* localStorage can throw in private mode, non-fatal */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useAgentChatPlace(): { place: AgentChatPlace; setPlace: (next: AgentChatPlace) => void } {
  const place = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const setPlace = useCallback((next: AgentChatPlace) => setAgentChatPlace(next), []);
  return { place, setPlace };
}
