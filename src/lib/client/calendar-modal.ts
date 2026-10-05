'use client';

import { useSyncExternalStore } from 'react';

/**
 * Open/close store for the full-screen calendar (`CalendarModal`). Module-level
 * like the task board: it opens from the rail, the header's next-event peek,
 * the deck's day strip, the calendar panel and ⌘K, which share no parent short
 * of the dashboard.
 *
 * Each open says what to show first: a view and a date in it. Unsaid, the view
 * is the one last used (week to start) and the date is today. `openId` changes
 * on every open so the modal starts from the request, not from where it was
 * left the last time.
 */

export type CalendarView = 'day' | 'week';

export interface CalendarModalState {
  open: boolean;
  openId: number;
  view: CalendarView | null;
  date: string | null;
}

const CLOSED: CalendarModalState = { open: false, openId: 0, view: null, date: null };

let state: CalendarModalState = CLOSED;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openCalendarModal(request: { view?: CalendarView; date?: string } = {}): void {
  state = { open: true, openId: state.openId + 1, view: request.view ?? null, date: request.date ?? null };
  emit();
}

export function closeCalendarModal(): void {
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

export function getCalendarModalState(): CalendarModalState {
  return state;
}

export function useCalendarModal(): CalendarModalState {
  return useSyncExternalStore(subscribe, getCalendarModalState, () => CLOSED);
}

// ─── The view last used ─────────────────────────────────────────

export const CALENDAR_VIEW_KEY = 'ri.calendar.view';
export const DEFAULT_CALENDAR_VIEW: CalendarView = 'week';

export function parseCalendarView(raw: unknown): CalendarView {
  return raw === 'day' || raw === 'week' ? raw : DEFAULT_CALENDAR_VIEW;
}

export function readCalendarView(): CalendarView {
  if (typeof window === 'undefined') return DEFAULT_CALENDAR_VIEW;
  try {
    return parseCalendarView(window.localStorage.getItem(CALENDAR_VIEW_KEY));
  } catch {
    return DEFAULT_CALENDAR_VIEW;
  }
}

export function rememberCalendarView(view: CalendarView): void {
  try {
    window.localStorage.setItem(CALENDAR_VIEW_KEY, view);
  } catch {
    /* storage unavailable: the choice holds for this open only */
  }
}
