'use client';

import { useSyncExternalStore } from 'react';

/**
 * Open/close store for the Schedules window (`TriggersModal`). Module-level
 * like the calendar: it opens from the rail and from a chat's Schedule
 * button, which share no parent short of the dashboard, where it mounts.
 *
 * An open can name a schedule to show first. `openId` changes on every open
 * so the window starts from the request, not from where it was left.
 */

export interface SchedulesWindowState {
  open: boolean;
  openId: number;
  /** The schedule to open on, or null for the list. */
  triggerId: string | null;
}

const CLOSED: SchedulesWindowState = { open: false, openId: 0, triggerId: null };

let state: SchedulesWindowState = CLOSED;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openSchedulesWindow(request: { triggerId?: string } = {}): void {
  state = { open: true, openId: state.openId + 1, triggerId: request.triggerId ?? null };
  emit();
}

export function closeSchedulesWindow(): void {
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

export function getSchedulesWindowState(): SchedulesWindowState {
  return state;
}

export function useSchedulesWindow(): SchedulesWindowState {
  return useSyncExternalStore(subscribe, getSchedulesWindowState, () => CLOSED);
}
