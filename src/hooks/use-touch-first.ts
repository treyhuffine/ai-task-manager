import { useSyncExternalStore } from 'react';

/**
 * Whether this device is touch first: its main pointer is a finger, which
 * can't hover, so text comes from the on-screen keyboard. A phone or a
 * tablet on its own is. A tablet with a trackpad or mouse connected reports
 * a fine pointer that hovers, so it counts as a computer, and so does a
 * laptop with a touchscreen, whose main pointer is its trackpad.
 *
 * It follows the input device, not the width. A phone held sideways or a
 * tablet is still touch first, and a narrow desktop window isn't. Chat
 * composers read it for Enter: a new line here, send on a computer
 * (`HOTKEYS.sendMessage`).
 *
 * False while rendering on the server and hydrating, where the device isn't
 * known, then live: connecting a trackpad to a tablet changes it.
 */
export const TOUCH_FIRST_QUERY = '(hover: none) and (pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(TOUCH_FIRST_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(TOUCH_FIRST_QUERY).matches;
}

export function useTouchFirst(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
