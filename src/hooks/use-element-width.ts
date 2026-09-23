import { useCallback, useState } from 'react';

/**
 * The current width of an element, for layout decisions CSS container
 * queries can't make, such as rendering one panel instead of two. Returns a
 * callback ref plus the width (null until measured, so the first render can
 * pick a default without a flash of the wrong layout).
 */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: T | null) => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    // React 19 runs a callback ref's returned cleanup when the node detaches.
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
