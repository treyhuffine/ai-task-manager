'use client';

import { useSyncExternalStore } from 'react';
import { setRailTab } from '@/lib/client/rail-tab';

/**
 * Which agents the rail's Recent list is narrowed to (its agent pills).
 * Module-level, like the New agent dialog's store, so an agent row can open
 * Recent on its own chats: the agents-only rail's Show chats does, in place
 * of the hover chooser it doesn't have. Empty means every agent. Lasts for
 * the page, not across reloads.
 */
let selected: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setRecentAgents(next: ReadonlySet<string>): void {
  selected = next;
  emit();
}

/** Recent, narrowed to one agent's chats. */
export function showAgentInRecent(workspaceId: string): void {
  setRecentAgents(new Set([workspaceId]));
  setRailTab('history');
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: ReadonlySet<string> = new Set();

export function useRecentAgents(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => selected, () => EMPTY);
}
