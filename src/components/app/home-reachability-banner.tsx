'use client';
import { trpcClient } from '@/lib/trpc/client';

/**
 * "Cannot reach your Ri on Mac Mini" (docs/homes-spec.md §3.5).
 *
 * Brief interruptions recover silently. A sustained outage gets a compact
 * notice after another failed health check, without covering the title bar
 * or disabling the app. Drafts and individual write errors keep their normal
 * behavior, and cached data refreshes when the home answers again.
 */

import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { getAuthToken } from '@/lib/api/client';
import { getConnectivity, probeHome, reportReachable, subscribeConnectivity } from '@/lib/api/connectivity';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDesktopConnection } from '@/hooks/use-desktop-connection';
import { CONNECTION_NOTICE_DELAY_MS, type DesktopConnectionAction } from '@/lib/connection/desktop-contract';

const HOME_CACHE_KEY = `${APP_SHORT_ID}.home`;
const RETRY_EVERY_MS = 5000;

interface HomeInfo {
  id: string;
  name: string;
  host: { name: string };
}

function cachedHome(): HomeInfo | null {
  try {
    const raw = window.localStorage.getItem(HOME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as HomeInfo) : null;
  } catch {
    return null;
  }
}

export function useHomeReachability() {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}

export function HomeReachabilityBanner() {
  const connectivity = useHomeReachability();
  const desktop = useDesktopConnection();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const checkInFlight = useRef(false);
  const [warningSince, setWarningSince] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');

  // Which device the home runs on, remembered so an offline screen can say it.
  const { data: home } = useQuery({
    queryKey: ['home'],
    queryFn: async () => {
      const info = await trpcClient.home.info.query({});
      try {
        window.localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(info));
      } catch {
        /* storage full or blocked: the banner falls back to a generic name */
      }
      return info;
    },
    staleTime: Infinity,
    retry: false,
    // Before this screen is paired there is nothing to ask for.
    enabled: typeof window !== 'undefined' && Boolean(getAuthToken()),
  });
  const known = home ?? (typeof window !== 'undefined' ? cachedHome() : null);

  const check = useCallback(async () => {
    if (checkInFlight.current) return;
    const outage = getConnectivity();
    checkInFlight.current = true;
    setChecking(true);
    try {
      const ok = await probeHome();
      if (ok) {
        reportReachable();
      } else if (!outage.reachable && getConnectivity() === outage && outage.since !== null && Date.now() - outage.since >= CONNECTION_NOTICE_DELAY_MS) {
        // A timer alone is not evidence of an outage. Confirm it again after
        // the grace period, and ignore a probe overtaken by a healthy request.
        setWarningSince(outage.since);
      }
    } finally {
      checkInFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Recovery can come from any API response, not just this notice's probe.
    let reachable = getConnectivity().reachable;
    return subscribeConnectivity(() => {
      const next = getConnectivity().reachable;
      if (next && !reachable) void queryClient.invalidateQueries();
      reachable = next;
    });
  }, [queryClient]);

  useEffect(() => {
    if (connectivity.reachable) return;
    const timer = setInterval(() => void check(), RETRY_EVERY_MS);
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('focus', check);
    };
  }, [connectivity.reachable, check]);

  const nativeNotice = desktop?.showNotice && desktop.phase !== 'connected';
  const issue = nativeNotice ? desktop.issue : null;
  if (!nativeNotice && (connectivity.reachable || warningSince !== connectivity.since)) return null;

  const nativeAction = async (action: DesktopConnectionAction) => {
    setChecking(true);
    setActionError('');
    try { await window.riDesktop?.connection?.(action); }
    catch { setActionError('Could not complete that action. Try again or open Desktop Settings from the Ri menu.'); }
    finally { setChecking(false); }
  };

  const where = known?.host?.name ? `${APP_NAME} on ${known.host.name}` : APP_NAME;
  return (
    <div
      role="status"
      className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-50 max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-background px-3 py-2 shadow-sm md:bottom-4"
    >
      <div className="flex items-center gap-3">
        <WifiOff size={13} className="flex-shrink-0 text-amber-400" />
        <p className="min-w-0 flex-1 text-[11px] text-foreground/90">
          <span className="font-medium">{issue?.message ?? `Reconnecting to ${where}…`}</span>
          <span className="block text-muted-foreground">{issue && !issue.retryable ? 'Your current view and drafts are kept.' : 'Trying again automatically.'}</span>
        </p>
        <button
          type="button"
          onClick={() => void (nativeNotice ? nativeAction('retry') : check())}
          disabled={checking}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-foreground/90 transition-colors hover:bg-foreground/5 disabled:opacity-50"
        >
          {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Retry
        </button>
      </div>
      {issue && !issue.retryable && <button type="button" disabled={checking}
        onClick={() => void nativeAction(issue.kind === 'sign_in' ? 'connect' : 'settings')}
        className="mt-2 text-[11px] underline disabled:opacity-50">
        {issue.kind === 'sign_in' ? 'Sign in again' : 'Connection settings'}
      </button>}
      <details className="mt-1 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Connection details</summary>
        <p className="mt-1 break-words">{issue?.detail ?? 'This view cannot reach your Ri. Its service may be restarting, or the network may be unavailable.'}</p>
      </details>
      {actionError && <p role="alert" className="mt-1 text-[11px] text-destructive">{actionError}</p>}
    </div>
  );
}
