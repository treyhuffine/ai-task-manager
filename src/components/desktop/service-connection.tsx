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
import { SERVICE_STATUS_KEY } from '@/hooks/use-service-status';

/** At most this often, a window says a person is using it (docs/always-on-spec.md 7.2). */
const USE_EVERY_MS = 30_000;

/** Browser, phone and remote Electron all serve the Home's UI. Installation
 * identity comes from that Home, independently of the local shell/worker. */
export function ServiceConnection() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  /** A new version is serving. A tab being looked at offers a refresh instead of
   * reloading under whoever is reading it (section 4.3). */
  const [refresh, setRefresh] = useState<'' | 'updated' | 'required'>('');
  const [reloading, setReloading] = useState(false);
  const [headsUp, setHeadsUp] = useState(false);
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let knownBuild: string | undefined;
    let updated = false;
    const showIssue = () => {
      const issue = getApiCompatibilityIssue();
      if (!issue || disposed) return false;
      setMessage(issue.message);
      setRefresh(issue.update === 'client' ? 'required' : '');
      setHeadsUp(false);
      return true;
    };
    /** A tab in the background saves its drafts and reloads by itself. If it
     * can't yet, the next check tries again. */
    const reloadIfHidden = async () => {
      if (!updated || disposed || document.visibilityState !== 'hidden') return;
      try { await reloadVersion(() => countUnsavedMutations(queryClient), false, () => { if (!disposed) window.location.reload(); }); }
      catch { /* Active input or a save in flight. Tried again at the next check. */ }
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
          updated = true;
          setMessage('Ri was updated.');
          setRefresh('updated');
          setHeadsUp(false);
          // The new server answers for the rail and Settings, not the old one's last word.
          void queryClient.invalidateQueries({ queryKey: SERVICE_STATUS_KEY });
          await reloadIfHidden();
          return;
        }
        const status = await trpcClient.service.list.query({}, rpcOptions({ timeoutMs: 3000 }));
        // One poll per window: the rail's update row and Settings read this answer.
        queryClient.setQueryData(SERVICE_STATUS_KEY, status);
        const update = 'update' in status ? status.update : undefined;
        setHeadsUp(!!update?.headsUpAt && status.canUseUpdates);
        if (update?.phase === 'draining') {
          setMessage('Preparing an update. Saving your changes.');
          await documentSaves.flushAll();
        } else { setMessage(status.phase === 'updating' ? 'Updating Ri. Your drafts are retained on this device.' : ''); setRefresh(''); }
      } catch {
        // Connection loss has one shared, delayed notice. A slow version or
        // service request alone must not interrupt an otherwise usable app.
        if (!showIssue() && !disposed) void reportNetworkFailure();
      } finally { checking = false; }
    };
    const timer = setInterval(() => void check(), 5000);
    const unsubscribe = subscribeApiCompatibility(() => { showIssue(); });
    void check();
    const onVisibility = () => void reloadIfHidden();
    // Typing and clicking are what keep an update away. Polling never does.
    let lastUse = 0;
    const onUse = () => {
      const now = Date.now();
      if (now - lastUse < USE_EVERY_MS) return;
      lastUse = now;
      void trpcClient.service.touchPost.mutate({}, rpcOptions({ timeoutMs: 3000 })).catch(() => {});
    };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', onUse, { capture: true, passive: true });
    window.addEventListener('keydown', onUse, { capture: true, passive: true });
    return () => {
      disposed = true; clearInterval(timer); unsubscribe();
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', onUse, { capture: true });
      window.removeEventListener('keydown', onUse, { capture: true });
    };
  }, [queryClient]);
  const reload = async () => {
    setReloading(true);
    try { await reloadVersion(() => countUnsavedMutations(queryClient), true); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Keep this view open until your drafts can be saved.'); setReloading(false); }
  };
  const answer = async (action: 'apply' | 'later') => {
    setAnswering(true);
    try {
      if (action === 'apply') await documentSaves.flushAll();
      await trpcClient.service.updatePost.mutate({ body: { action } });
      setHeadsUp(false);
    } catch { /* The next check shows where things stand. */ }
    finally { setAnswering(false); }
  };
  const box = 'fixed bottom-4 left-1/2 z-[100] max-w-[90vw] -translate-x-1/2 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg';
  if (message) {
    return <div role="status" className={box}>
      {message}{refresh && <button type="button" disabled={reloading} className="ml-3 underline" onClick={() => void reload()}>Refresh</button>}
    </div>;
  }
  if (!headsUp) return null;
  return <div role="status" className={box}>
    Ri will update in 1 minute.
    <button type="button" disabled={answering} className="ml-3 underline" onClick={() => void answer('later')}>Not now</button>
    <button type="button" disabled={answering} className="ml-3 underline" onClick={() => void answer('apply')}>Update now</button>
  </div>;
}
