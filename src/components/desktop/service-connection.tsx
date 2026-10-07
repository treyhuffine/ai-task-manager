'use client';
import { api } from '@/lib/api/client';
import { reportNetworkFailure } from '@/lib/api/connectivity';
import { getApiCompatibilityIssue, reportApiCompatibility, subscribeApiCompatibility } from '@/lib/client/api-compatibility';
import { documentSaves } from '@/lib/client/document-saves';
import { reloadVersion } from '@/lib/client/version-reload';
import { countUnsavedMutations } from '@/lib/query/mutation-meta';
import { API_PROTOCOL, apiCompatibilityIssue } from '@/lib/releases/api-contract';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions } from '@/lib/trpc/request-options';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** Browser, phone and remote Electron all serve the Home's UI. Installation
 * identity comes from that Home, independently of the local shell/worker. */
export function ServiceConnection() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [canReload, setCanReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let knownBuild: string | undefined;
    const showIssue = () => {
      const issue = getApiCompatibilityIssue();
      if (!issue || disposed) return false;
      setMessage(issue.message);
      setCanReload(issue.update === 'client');
      return true;
    };
    const check = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const version = await api.get<{ release: { build: string }; apiProtocols: number[] }>('/version', { timeoutMs: 3000 });
        const mismatch = apiCompatibilityIssue(String(API_PROTOCOL), version.apiProtocols);
        reportApiCompatibility(mismatch);
        if (showIssue()) return;
        // Unlike /service, this works for source and unmanaged Homes too.
        const build = version.release.build;
        if (knownBuild === undefined) knownBuild = build;
        if (knownBuild !== build) {
          setMessage('Ri was updated. Saving your changes before reloading.');
          setCanReload(true);
          try {
            await reloadVersion(() => countUnsavedMutations(queryClient), false, () => { if (!disposed) window.location.reload(); });
          } catch { if (!disposed) setMessage('Ri was updated. Finish active input or reload with your drafts saved on this device.'); }
          return;
        }
        const status = await trpcClient.service.list.query({}, rpcOptions({ timeoutMs: 3000 }));
        if ('update' in status && status.update?.phase === 'draining') {
          setMessage('Preparing an update. Saving your changes.');
          await documentSaves.flushAll();
        } else { setMessage(status.phase === 'updating' ? 'Updating Ri. Your drafts are retained on this device.' : ''); setCanReload(false); }
      } catch {
        // Connection loss has one shared, delayed notice. A slow version or
        // service request alone must not interrupt an otherwise usable app.
        if (!showIssue() && !disposed) void reportNetworkFailure();
      } finally { checking = false; }
    };
    const timer = setInterval(() => void check(), 5000);
    const unsubscribe = subscribeApiCompatibility(() => { showIssue(); });
    void check();
    window.addEventListener('online', check);
    return () => { disposed = true; clearInterval(timer); unsubscribe(); window.removeEventListener('online', check); };
  }, [queryClient]);
  const reload = async () => {
    setReloading(true);
    try { await reloadVersion(() => countUnsavedMutations(queryClient), true); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Keep this view open until your drafts can be saved.'); setReloading(false); }
  };
  if (!message) return null;
  return <div role="status" className="fixed bottom-4 left-1/2 z-[100] max-w-[90vw] -translate-x-1/2 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg">
    {message}{canReload && <button type="button" disabled={reloading} className="ml-3 underline" onClick={() => void reload()}>Reload with saved drafts</button>}
  </div>;
}
