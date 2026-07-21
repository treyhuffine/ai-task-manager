/**
 * The calendar invitation, shared by every surface that shows it (HUD
 * button, deck strip). It stays visible until the user connects a calendar
 * or explicitly asks not to see it — and dismissing it anywhere is asking
 * not to see it, so one permanent flag backs all surfaces, with a window
 * event keeping mounted ones in sync.
 */

export const INVITE_DISMISSED_KEY = 'flow.calendar.inviteDismissed';
const DISMISS_EVENT = 'flow:calendar-invite-dismissed';

export function readInviteDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(INVITE_DISMISSED_KEY) === 'true';
  } catch {
    return true;
  }
}

export function dismissCalendarInvite(): void {
  try {
    window.localStorage.setItem(INVITE_DISMISSED_KEY, 'true');
  } catch {
    // storage unavailable — surfaces still hide for this session via the event
  }
  window.dispatchEvent(new CustomEvent(DISMISS_EVENT));
}

export function subscribeInviteDismissed(onDismiss: () => void): () => void {
  window.addEventListener(DISMISS_EVENT, onDismiss);
  return () => window.removeEventListener(DISMISS_EVENT, onDismiss);
}
