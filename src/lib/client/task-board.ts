'use client';

import { useSyncExternalStore } from 'react';

/**
 * Open/close store for the task board modal. Module-level like quick capture
 * and chat search: it opens from the top HUD and from the ⌘K palette, which
 * share no parent short of the dashboard.
 */

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openTaskBoard(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeTaskBoard(): void {
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

export function useTaskBoardOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
