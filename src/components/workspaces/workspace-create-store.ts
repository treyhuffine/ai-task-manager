'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the New agent dialog is open. Module-level, like the launcher's
 * store: the dialog is asked for from the list header's button and from the
 * empty list's link, and drawn once, by the header.
 */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setWorkspaceCreateOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function openWorkspaceCreate(): void {
  setWorkspaceCreateOpen(true);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaceCreateOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
