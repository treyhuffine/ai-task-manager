'use client';

import { useSyncExternalStore } from 'react';

/**
 * Imperative open/close store for the execution launcher.
 *
 * Module-level for the same reason settings is (see `settings-store.ts`):
 * the launcher is reachable from the workspace row, the rail's Create, the
 * Recent feed, and a session's row menu. Threading `onOpenLauncher` down
 * four component chains to reach three separate mount sites is exactly the
 * prop-drilling the settings store was written to kill.
 *
 * `workspaceId` is a *seed*, not a constraint. The modal renders it as a
 * changeable chip, so opening from a row prefills that workspace while
 * still allowing a launch into a different one. An explicit `null` opens it
 * with no agent picked (the rail's Create): the person writes the prompt and
 * picks where it runs, in either order.
 */
/** Optional seed for "Start with agent": the task this execution will own,
 * plus its title/body which the modal turns into a context chip. */
export interface LauncherSeed {
  workspaceId?: string | null;
  taskId?: string | null;
  contextTitle?: string | null;
  contextBody?: string | null;
}

interface LauncherState {
  open: boolean;
  workspaceId: string | null;
  seed: LauncherSeed | null;
  /** Opened with no agent picked (`workspaceId: null`). The modal must not fill one in. */
  pickAgent: boolean;
  /** Bumped on every open so the modal can reset its draft without an effect. */
  nonce: number;
}

let state: LauncherState = { open: false, workspaceId: null, seed: null, pickAgent: false, nonce: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Open the launcher. Pass a workspace id (a seed, not a constraint), a full
 * seed object for "Start with agent", or `{ workspaceId: null }` to open with
 * no agent picked. A seed that leaves the workspace out reopens on the last
 * agent the launcher was seeded with. */
export function openLauncher(arg?: string | LauncherSeed | null): void {
  const seed: LauncherSeed | null =
    typeof arg === 'string' ? { workspaceId: arg } : arg ?? null;
  const pickAgent = seed?.workspaceId === null;
  state = {
    open: true,
    // Remembered across an agent-less open, so the next seeded one still
    // falls back to the agent it fell back to before.
    workspaceId: seed?.workspaceId ?? state.workspaceId,
    seed,
    pickAgent,
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

/** The launcher's current state, outside React. */
export function getLauncherState(): LauncherState {
  return state;
}

export function useLauncherStore(): LauncherState {
  return useSyncExternalStore(subscribe, getLauncherState, getLauncherState);
}
