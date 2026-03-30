import { useQuery } from '@tanstack/react-query';
import { recentsApi } from '@/lib/api/recents';

export function useRecents(limit = 10, enabled = true) {
  return useQuery({
    queryKey: ['recents', limit],
    queryFn: () => recentsApi.list(limit),
    enabled,
    staleTime: 0,
  });
}
