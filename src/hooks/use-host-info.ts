'use client';

import type { HostInfoResponse } from '@/lib/server/operations/system/host-info';
import { trpcClient } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';

/**
 * Identity of the machine running the app. Cached forever — hostname
 * doesn't change mid-session.
 */
export function useHostInfo() {
  return useQuery<HostInfoResponse>({
    queryKey: ['system', 'host-info'],
    queryFn: () => trpcClient.system.hostInfoGet.query({}),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
