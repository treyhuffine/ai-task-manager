'use client';

import { useSyncExternalStore } from 'react';

/**
 * Imperative open/close store for the execution launcher.
 *
 * Module-level for the same reason settings is (see `settings-store.ts`):
 * the launcher is reachable from the workspace row, the by-status rail, the
 * history feed, and a session's row menu. Threading `onOpenLauncher` down
 * four component chains to reach three separate mount sites is exactly the
 * prop-drilling the settings store was written to kill.
 *
 * `workspaceId` is a *seed*, not a constraint. The modal renders it as a
 * changeable chip, so opening from a row prefills that workspace while
 * still allowing a launch into a different one.
 */
interface LauncherState {
  open: boolean;
  workspaceId: string | null;
  /** Bumped on every open so the modal can reset its draft without an effect. */
  nonce: number;
}

let state: LauncherState = { open: false, workspaceId: null, nonce: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Open the launcher, optionally seeded with a workspace. */
export function openLauncher(workspaceId?: string | null): void {
  state = {
    open: true,
    workspaceId: workspaceId ?? state.workspaceId,
    nonce: state.nonce + 1,
  };
  emit();
}

export function closeLauncher(): void {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LauncherState {
  return state;
}

export function useLauncherStore(): LauncherState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
