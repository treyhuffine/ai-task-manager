'use client';

import { useSyncExternalStore } from 'react';
import '@/lib/client/desktop';

const noop = () => () => {};

/**
 * True inside the desktop app (its preload exposes `window.riDesktop`), false
 * in a browser and during server render. The bridge is set before any page
 * script runs and never changes, so there's nothing to subscribe to.
 */
export function useDesktopApp(): boolean {
  return useSyncExternalStore(noop, () => !!window.riDesktop, () => false);
}
