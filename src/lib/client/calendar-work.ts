'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether Ri shows work (docs/work-view.md): in the calendar, when you and
 * your agents worked and what it adds up to, and in the header, today's
 * person-hours. On to start, one click off in the calendar, remembered per
 * browser. Off hides both, for anyone who'd rather not see the count.
 */

export const CALENDAR_WORK_KEY = 'ri.calendar.work';
const CHANGE_EVENT = 'ri:calendar-work-changed';

/** Anything but an explicit "0" is on. */
export function parseCalendarWork(raw: unknown): boolean {
  return raw !== '0';
}

function read(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return parseCalendarWork(window.localStorage.getItem(CALENDAR_WORK_KEY));
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === CALENDAR_WORK_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function setCalendarWork(on: boolean): void {
  try {
    window.localStorage.setItem(CALENDAR_WORK_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: holds for this page */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useCalendarWork(): { on: boolean; setOn: (on: boolean) => void } {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const setOn = useCallback((next: boolean) => setCalendarWork(next), []);
  return { on, setOn };
}
