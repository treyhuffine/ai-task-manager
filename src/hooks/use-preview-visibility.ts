'use client';

import { useCallback, useState } from 'react';

/** Start near the viewport, release preview DOM when scrolled away. */
export function usePreviewVisibility() {
  const [visible, setVisible] = useState(false);
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '160px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}
