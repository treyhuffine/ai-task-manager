import { describe, expect, it } from 'vitest';
import { nextFlyoutState, type FlyoutState } from './rail-flyout';

const PEEK: FlyoutState = { mode: 'peek', keyboard: false };
const HELD: FlyoutState = { mode: 'held', keyboard: false };

describe('nextFlyoutState', () => {
  it('peeks on hover and closes when the pointer leaves', () => {
    const peek = nextFlyoutState(null, { type: 'hover' });
    expect(peek).toEqual(PEEK);
    expect(nextFlyoutState(peek, { type: 'leave' })).toBeNull();
  });

  it('holds a peek once the pointer presses inside it', () => {
    const held = nextFlyoutState(PEEK, { type: 'press' });
    expect(held).toEqual(HELD);
    // Leaving no longer closes it: a row menu or dialog may be open.
    expect(nextFlyoutState(held, { type: 'leave' })).toEqual(HELD);
  });

  it('opens held on click and closes on a second click', () => {
    const held = nextFlyoutState(null, { type: 'click', keyboard: false });
    expect(held).toEqual(HELD);
    expect(nextFlyoutState(held, { type: 'click', keyboard: false })).toBeNull();
  });

  it('keeps a peek open when its button is clicked, instead of closing it', () => {
    expect(nextFlyoutState(PEEK, { type: 'click', keyboard: false })).toEqual(HELD);
  });

  it('remembers a keyboard open so focus can move in and back', () => {
    expect(nextFlyoutState(null, { type: 'click', keyboard: true })).toEqual({ mode: 'held', keyboard: true });
  });

  it('does not reopen or change a held flyout on hover', () => {
    expect(nextFlyoutState(HELD, { type: 'hover' })).toBe(HELD);
  });

  it('ignores a press or leave while closed', () => {
    expect(nextFlyoutState(null, { type: 'press' })).toBeNull();
    expect(nextFlyoutState(null, { type: 'leave' })).toBeNull();
  });

  it('closes from any state on dismiss', () => {
    expect(nextFlyoutState(PEEK, { type: 'dismiss' })).toBeNull();
    expect(nextFlyoutState(HELD, { type: 'dismiss' })).toBeNull();
  });
});
