import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { sessionsApi, type SessionSearchFilters } from '@/lib/api/sessions';

/**
 * Full-text search over chat/execution transcripts. Disabled (returns no data)
 * until the query is non-empty. Prior results stay visible while a new query is
 * in flight so the rail doesn't flash empty on every keystroke — callers should
 * still defer the input value (useDeferredValue) to avoid a request per key.
 */
export function useSessionSearch(query: string, filters?: SessionSearchFilters) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: [
      'sessions',
      'search',
      trimmed,
      filters?.status ?? null,
      filters?.workspaceId ?? null,
      filters?.source ?? null,
      filters?.limit ?? null,
    ],
    queryFn: () => sessionsApi.search(trimmed, filters),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}
