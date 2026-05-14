'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { HostInfoResponse } from '@/app/api/system/host-info/route';

/**
 * Identity of the machine running the app. Cached forever — hostname
 * doesn't change mid-session.
 */
export function useHostInfo() {
  return useQuery<HostInfoResponse>({
    queryKey: ['system', 'host-info'],
    queryFn: () => api.get<HostInfoResponse>('/system/host-info'),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
