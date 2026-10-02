'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateRailSoon } from '@/lib/query/invalidate-rail';
import { invalidateTaskListsSoon } from '@/lib/query/invalidate-tasks';
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
    return pageStream().subscribeGlobal((event, data) => {
      if (event === 'session_updated' || event === 'ready') refresh();
      // A turn starting or ending, or a reconnect that may have missed some:
      // tasks the agent moved and its Working badge (invalidate-tasks.ts).
      const reason = (data as { reason?: string } | null)?.reason;
      if (event === 'ready' || (event === 'session_updated' && (reason === 'runtime' || reason === 'outcome'))) {
        invalidateTaskListsSoon(queryClient);
      }
      // A device connected, dropped, or reported sleep (P3.2).
      if (event === 'device_updated') queryClient.invalidateQueries({ queryKey: ['devices'] });
    });
  }, [queryClient]);
}
