'use client';

import { useEffect, useState } from 'react';

/**
 * Whether a panel that just opened may move to its open position.
 *
 * It turns true two frames after `open` does, so the panel first paints at its
 * closed position and its CSS transition has somewhere to run from. One frame
 * isn't enough: the browser can batch the first paint with the class change and
 * the panel appears in place. It turns false when `open` does, ready for the
 * next opening, and a close before those frames arrive cancels them.
 */
export function useEnterTransition(open: boolean): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!open) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      setEntered(false);
    };
  }, [open]);
  return entered;
}
