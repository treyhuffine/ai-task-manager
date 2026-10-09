/**
 * When the collapsed rail's Agents flyout is open, and why.
 *
 * The collapsed rail shows one Agents button instead of every execution. The
 * flyout it opens floats the wide rail's list over the page (no width taken,
 * nothing pushed), in one of two ways:
 *
 *   - `peek`: the pointer rested on the button. It closes when the pointer
 *     leaves the button and the flyout, so a glance costs nothing.
 *   - `held`: the button was clicked, or the pointer pressed inside a peek
 *     (opening a row's menu, dragging, starting a select). It stays until
 *     Esc, a click outside, a second click on the button, or navigating.
 *
 * Pure so the rules are testable apart from timers and the DOM. The component
 * owns the intent delays and feeds the result in here.
 */

export type FlyoutMode = 'peek' | 'held';

export type FlyoutState = {
  mode: FlyoutMode;
  /** Opened from the keyboard: focus moves into the flyout and back after. */
  keyboard: boolean;
} | null;

export type FlyoutEvent =
  /** The pointer rested on the button past the intent delay. */
  | { type: 'hover' }
  /** The pointer left the button and the flyout past the grace delay. */
  | { type: 'leave' }
  /** The button was clicked (or pressed with Enter or Space). */
  | { type: 'click'; keyboard: boolean }
  /** Right arrow enters the flyout without changing the trigger's click destination. */
  | { type: 'keyboard' }
  /** The pointer pressed somewhere inside the flyout. */
  | { type: 'press' }
  /** Esc, a click outside, or the view changed. */
  | { type: 'dismiss' };

export function nextFlyoutState(state: FlyoutState, event: FlyoutEvent): FlyoutState {
  switch (event.type) {
    case 'hover':
      return state ?? { mode: 'peek', keyboard: false };
    case 'leave':
      return state?.mode === 'peek' ? null : state;
    case 'click':
      if (!state) return { mode: 'held', keyboard: event.keyboard };
      // Clicking a peek keeps it, the way pressing inside one does.
      return state.mode === 'peek' ? { mode: 'held', keyboard: state.keyboard || event.keyboard } : null;
    case 'keyboard':
      return { mode: 'held', keyboard: true };
    case 'press':
      return state?.mode === 'peek' ? { ...state, mode: 'held' } : state;
    case 'dismiss':
      return null;
  }
}
