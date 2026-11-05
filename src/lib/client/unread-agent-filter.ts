'use client';

import { useSyncExternalStore } from 'react';

/**
 * The agent the rail's Unread is narrowed to, if any.
 *
 * Outside the row because opening a chat collapses the rail (docs/rail.md),
 * which remounts the row, and working through one agent's chats means opening
 * them in turn. In memory, not localStorage like the rail's tab: a narrowed
 * list hides chats that want you, so it doesn't wait for you across a reload.
 */

let agentId: string | null = null;
const listeners = new Set<() => void>();

export function setUnreadAgentFilter(next: string | null): void {
  if (next === agentId) return;
  agentId = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUnreadAgentFilter(): string | null {
  return useSyncExternalStore(subscribe, () => agentId, () => null);
}
