'use client';

import { useEffect } from 'react';
import '@/lib/client/desktop';

export function DesktopChrome() {
  useEffect(() => {
    if (window.riDesktop) document.documentElement.dataset.riDesktop = window.riDesktop.platform;
  }, []);
  return <div className="desktop-drag-fallback" aria-hidden="true" />;
}
