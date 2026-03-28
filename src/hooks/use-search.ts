import { useQuery } from '@tanstack/react-query';
import { searchApi, type SearchMode } from '@/lib/api/search';

export function useSearch(query: string, mode?: SearchMode) {
  return useQuery({
    queryKey: ['search', query, mode],
    queryFn: () => searchApi.query(query, { mode }),
    enabled: query.trim().length > 0,
  });
}
