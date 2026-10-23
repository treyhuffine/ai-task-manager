import { useSyncExternalStore } from 'react';

/**
 * The bottom edge of what's on screen, in layout-viewport pixels: the visual
 * viewport's offset plus its height.
 *
 * A phone's on-screen keyboard shrinks the visual viewport and leaves the
 * layout viewport alone, so `vh` and `dvh` and `position: fixed` all keep
 * reaching under the keyboard. A fixed panel that caps its height with this
 * keeps its last row (a Start button) above the keyboard and scrolls its
 * middle instead.
 *
 * Null on the server and in a browser without `visualViewport`.
 */
export function useVisualViewportBottom(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

function subscribe(onChange: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener('resize', onChange);
  viewport.addEventListener('scroll', onChange);
  return () => {
    viewport.removeEventListener('resize', onChange);
    viewport.removeEventListener('scroll', onChange);
  };
}

function getSnapshot(): number | null {
  const viewport = window.visualViewport;
  return viewport ? Math.round(viewport.offsetTop + viewport.height) : null;
}
