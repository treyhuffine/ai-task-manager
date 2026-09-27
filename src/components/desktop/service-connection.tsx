'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { hasActiveInput } from '@/lib/client/active-input';
import { hasPendingCapture } from '@/lib/client/capture-draft';
import { documentSaves } from '@/lib/client/document-saves';

/** Every viewer retains its own drafts. A changed service build reloads only
 * after outstanding edits finish, including on a browser or phone. */
export function ServiceConnection() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let knownBuild: string | undefined;
    let managed = false;
    const check = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const status = await api.get<{ phase: string; repo?: string; version?: string; update?: { phase: string; committedAt?: string } }>('/service', { timeoutMs: 3000 });
        if (status.phase === 'unmanaged') { clearInterval(timer); return; }
        managed = true;
        const build = JSON.stringify([status.repo, status.version]);
        if (knownBuild === undefined) knownBuild = build;
        if (status.update?.phase === 'draining') {
          setMessage('Preparing an update. Saving your changes…');
          await documentSaves.flushAll();
        } else if (status.phase === 'running' && knownBuild !== build) {
          setMessage(hasPendingCapture()
            ? 'Ri was updated. Finish or close Quick Capture before reloading.'
            : 'Ri was updated. Saving changes before reloading…');
          await documentSaves.flushAll();
          if (!queryClient.isMutating() && !documentSaves.has() && !hasActiveInput() && !hasPendingCapture() && !disposed) window.location.reload();
        } else setMessage(status.phase === 'updating' ? 'Updating Ri. Your drafts are retained on this device.' : '');
      } catch { if (managed && !disposed) setMessage('Reconnecting to Ri. Your drafts are retained on this device.'); }
      finally { checking = false; }
    };
    const timer = setInterval(() => void check(), 2000);
    void check();
    window.addEventListener('online', check);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('online', check); };
  }, [queryClient]);
  if (!message) return null;
  return <div role="status" className="fixed bottom-4 left-1/2 z-[100] max-w-[90vw] -translate-x-1/2 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg">{message}</div>;
}
