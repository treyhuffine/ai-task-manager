/**
 * Polls /api/system/portless-status. Cheap on the server (cached),
 * useful in the workspace settings UI for surfacing the right hint
 * banner ("install Portless" vs "switch to Portless").
 *
 * Refetches on focus so flipping back to the Flow tab after starting
 * Portless picks up the new state without a hard refresh.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface PortlessStatusResponse {
  installed: boolean;
  proxy_running: boolean;
  state_dir: string;
}

export function usePortlessStatus() {
  return useQuery({
    queryKey: ['system', 'portless-status'],
    queryFn: () => api.get<PortlessStatusResponse>('/system/portless-status'),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}
