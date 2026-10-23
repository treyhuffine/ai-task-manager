import { trpc } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { recentsApi } from '@/lib/api/recents';

export function useRecents(limit = 10, enabled = true) {
  return useQuery({
    queryKey: trpc.recents.list.queryKey({ query: { limit: String(limit) } }),
    queryFn: () => recentsApi.list(limit),
    enabled,
    staleTime: 0,
  });
}
