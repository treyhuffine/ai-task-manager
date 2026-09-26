'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { hasActiveInput } from '@/lib/client/active-input';
import { documentSaves } from '@/lib/client/document-saves';
import '@/lib/client/desktop';
import { ServiceConnection } from './service-connection';

export function DesktopChrome() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (window.riDesktop) document.documentElement.dataset.riDesktop = window.riDesktop.platform;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (documentSaves.has() || queryClient.isMutating() || hasActiveInput()) {
        void documentSaves.flushAll().catch(() => {});
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    const unsubscribe = window.riDesktop?.onPrepareClose?.(async () => {
      if (hasActiveInput()) return false;
      document.body.inert = true;
      try {
        await documentSaves.flushAll();
        const deadline = Date.now() + 10_000;
        while (queryClient.isMutating() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        const ready = queryClient.isMutating() === 0 && !documentSaves.has();
        if (!ready) document.body.inert = false;
        return ready;
      } catch { document.body.inert = false; return false; }
    });
    const resume = window.riDesktop?.onResume?.(() => { document.body.inert = false; });
    return () => { resume?.(); document.body.inert = false; window.removeEventListener('beforeunload', beforeUnload); unsubscribe?.(); };
  }, [queryClient]);
  return <><div className="desktop-drag-fallback" aria-hidden="true" /><ServiceConnection /></>;
}
