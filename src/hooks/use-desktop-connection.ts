'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getConnectivity, reportReachable } from '@/lib/api/connectivity';
import type { DesktopConnectionState } from '@/lib/connection/desktop-contract';
import '@/lib/client/desktop';

/** Optional bridge keeps older shells and ordinary browsers compatible. */
export function useDesktopConnection() {
  const [state, setState] = useState<DesktopConnectionState | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    const desktop = window.riDesktop;
    if (!desktop?.connection || !desktop.onConnectionChange) return;
    let disposed = false;
    let revision = 0;
    let previous: DesktopConnectionState | null = null;
    const accept = (next: DesktopConnectionState) => {
      if (disposed) return;
      if (previous && previous.phase !== 'connected' && next.phase === 'connected') {
        // The shared Home observer already refreshes an unreachable viewer.
        const reachable = getConnectivity().reachable;
        reportReachable();
        if (reachable) void queryClient.invalidateQueries();
      }
      previous = next;
      setState(next);
    };
    const unsubscribe = desktop.onConnectionChange(next => { revision++; accept(next); });
    void desktop.connection('status').then(next => { if (revision === 0) accept(next); }).catch(() => {});
    return () => { disposed = true; unsubscribe(); };
  }, [queryClient]);
  return state;
}
