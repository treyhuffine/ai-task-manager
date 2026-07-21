/**
 * Tiny cross-surface store for "open the calendar at this date". The panel's
 * anchor is local state, but global surfaces (the HUD week overlay) need to
 * jump it — same pattern as `openSettings()`. The date parks here in case
 * the panel isn't mounted yet when the request fires.
 */

export const CALENDAR_GOTO_EVENT = 'flow:calendar-goto';

let pendingDate: string | null = null;

/** Ask the calendar panel (mounted or not) to show this local date. */
export function requestCalendarDate(date: string): void {
  pendingDate = date;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CALENDAR_GOTO_EVENT));
  }
}

/** Panel-side: claim the requested date, if any. */
export function consumePendingCalendarDate(): string | null {
  const date = pendingDate;
  pendingDate = null;
  return date;
}
