'use client';

import { useSyncExternalStore } from 'react';

/**
 * Open/close store for the chat search modal. Module-level like the launcher
 * (`launcher/launcher-store.ts`): it opens from the rail's Search chats row
 * and from the ⌘K palette, which share no parent short of the dashboard.
 */

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openChatSearch(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeChatSearch(): void {
  if (!open) return;
  open = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return open;
}

export function useChatSearchOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
