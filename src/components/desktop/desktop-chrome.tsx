'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { hasActiveInput } from '@/lib/client/active-input';
import { flushCaptureDrafts } from '@/lib/client/capture-draft';
import { UNLOAD_BLOCKER_MESSAGES, viewerUnloadBlocker } from '@/lib/client/version-reload';
import { flushChatDrafts } from '@/lib/client/chat-drafts';
import { documentSaves } from '@/lib/client/document-saves';
import { countUnsavedMutations } from '@/lib/query/mutation-meta';
import '@/lib/client/desktop';
import { ServiceConnection } from './service-connection';

export function DesktopChrome() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (window.riDesktop) document.documentElement.dataset.riDesktop = window.riDesktop.platform;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const blocker = viewerUnloadBlocker(() => countUnsavedMutations(queryClient));
      if (!blocker) return;
      void documentSaves.flushAll().catch(() => {});
      // Shown once the person stays. The leave prompt itself can't say why.
      toast.warning(UNLOAD_BLOCKER_MESSAGES[blocker], { id: 'unload-guard', description: 'That is why this page asked before leaving.' });
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    // Window close now hides the live desktop renderer. Flush pending document
    // edits without freezing it or interrupting recordings/background work.
    // Failed writes keep their existing synchronous durable drafts for retry.
    const visibility = () => {
      if (window.riDesktop && document.visibilityState === 'hidden') void documentSaves.flushAll().catch(() => {});
    };
    document.addEventListener('visibilitychange', visibility);
    // A hidden microphone loses its visible recording controls. Keep this
    // window open until voice capture/transcription is finished or cancelled.
    const background = window.riDesktop?.onPrepareBackground?.(() => !hasActiveInput());
    const unsubscribe = window.riDesktop?.onPrepareClose?.(async () => {
      if (hasActiveInput()) return false;
      document.body.inert = true;
      try {
        await documentSaves.flushAll();
        await flushCaptureDrafts();
        flushChatDrafts();
        const deadline = Date.now() + 10_000;
        while (countUnsavedMutations(queryClient) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        const ready = countUnsavedMutations(queryClient) === 0 && !documentSaves.has();
        if (!ready) document.body.inert = false;
        return ready;
      } catch { document.body.inert = false; return false; }
    });
    const resume = window.riDesktop?.onResume?.(() => { document.body.inert = false; });
    return () => { resume?.(); background?.(); document.body.inert = false; window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', visibility); unsubscribe?.(); };
  }, [queryClient]);
  return <><div className="desktop-drag-fallback" aria-hidden="true" /><ServiceConnection /></>;
}
