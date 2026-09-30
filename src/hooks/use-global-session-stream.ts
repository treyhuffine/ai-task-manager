'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateRailSoon } from '@/lib/query/invalidate-rail';
import { pageStream } from '@/lib/realtime/page-stream';

/**
 * Refresh rail-facing state when any session changes lifecycle, including
 * sessions whose detailed chat view is no longer mounted. Carried by the
 * page's one stream (P3 review).
 */
export function useGlobalSessionStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Coalesced with every other stream's refresh (invalidateRailSoon).
    // Chat-tab strips too: any open strip refreshes whichever chat changed.
    const refresh = () => invalidateRailSoon(queryClient, { includeChatStrips: true });
    return pageStream().subscribeGlobal((event) => {
      if (event === 'session_updated' || event === 'ready') refresh();
      // A computer connected, dropped, or reported sleep (P3.2).
      if (event === 'computer_updated') queryClient.invalidateQueries({ queryKey: ['computers'] });
    });
  }, [queryClient]);
}
