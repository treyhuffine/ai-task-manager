import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { searchApi, type SearchMode } from '@/lib/api/search';

/**
 * Cross-entity search (tasks, notes, stream) behind the ⌘K palette.
 *
 * `keepPreviousData` keeps the last query's hits on screen while the next query
 * is in flight, so refining a search ("proj" → "project") updates the list in
 * place instead of flashing empty between keystrokes. Callers should still defer
 * the input value (useDeferredValue) so we fire one request per settle, not one
 * per keystroke.
 */
export function useSearch(query: string, mode?: SearchMode) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['search', trimmed, mode],
    queryFn: () => searchApi.query(trimmed, { mode }),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
