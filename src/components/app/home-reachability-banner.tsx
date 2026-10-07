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

const HOME_CACHE_KEY = `${APP_SHORT_ID}.home`;
const RETRY_EVERY_MS = 5000;
const NOTICE_AFTER_MS = 10_000;

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
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const checkInFlight = useRef(false);
  const [warningSince, setWarningSince] = useState<number | null>(null);

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
      } else if (!outage.reachable && getConnectivity() === outage && outage.since !== null && Date.now() - outage.since >= NOTICE_AFTER_MS) {
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

  if (connectivity.reachable || warningSince !== connectivity.since) return null;

  const where = known?.host?.name ? `${APP_NAME} on ${known.host.name}` : APP_NAME;
  return (
    <div
      role="status"
      className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-50 max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-background px-3 py-2 shadow-sm md:bottom-4"
    >
      <div className="flex items-center gap-3">
        <WifiOff size={13} className="flex-shrink-0 text-amber-400" />
        <p className="min-w-0 flex-1 text-[11px] text-foreground/90">
          <span className="font-medium">Reconnecting to {where}…</span>
          <span className="block text-muted-foreground">Trying again automatically.</span>
        </p>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-foreground/90 transition-colors hover:bg-foreground/5 disabled:opacity-50"
        >
          {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Retry
        </button>
      </div>
    </div>
  );
}
