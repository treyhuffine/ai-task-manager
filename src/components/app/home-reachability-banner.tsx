'use client';

/**
 * "Cannot reach your Ri on Mac Mini" (docs/homes-spec.md §3.5).
 *
 * Shown on any screen while the home doesn't answer. It names the computer
 * the home runs on, keeps checking quietly, and refreshes everything once
 * the home is back. Unsent messages stay in the chat as failed messages
 * with a retry, and drafts stay in the composer, so nothing typed is lost.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { api, getAuthToken } from '@/lib/api/client';
import { getConnectivity, probeHome, reportReachable, subscribeConnectivity } from '@/lib/api/connectivity';

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
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

  // Which computer the home runs on, remembered so an offline screen can say it.
  const { data: home } = useQuery({
    queryKey: ['home'],
    queryFn: async () => {
      const info = await api.get<HomeInfo>('/home');
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
    setChecking(true);
    const ok = await probeHome();
    setChecking(false);
    if (ok) {
      reportReachable();
      void queryClient.invalidateQueries();
    }
  }, [queryClient]);

  useEffect(() => {
    if (connectivity.reachable) return;
    const timer = setInterval(() => void check(), RETRY_EVERY_MS);
    return () => clearInterval(timer);
  }, [connectivity.reachable, check]);

  if (connectivity.reachable) return null;

  const where = known?.host?.name ? `your ${APP_NAME} on ${known.host.name}` : `your ${APP_NAME}`;
  return (
    // Fixed over the top bar rather than in the flow: the app fills the
    // viewport, and nothing in the top bar works until the home answers.
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-500/30 bg-background/95 px-5 py-2.5 shadow-sm backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <WifiOff size={13} className="flex-shrink-0 text-amber-400" />
        <p className="min-w-0 flex-1 text-[11px] text-foreground/90">
          <span className="font-medium">Cannot reach {where}.</span>{' '}
          <span className="text-muted-foreground">
            {known?.host?.name ? `${known.host.name} needs to be awake and online.` : 'It needs to be awake and online.'}{' '}
            Unsent messages are kept. Checking again every few seconds.
          </span>
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
