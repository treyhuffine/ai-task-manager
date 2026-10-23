import { trpc, trpcClient } from '@/lib/trpc/client';
import { useEntityLinkHome } from '@/components/editor/entity-link-scope';
import { rpcQuery } from '@/lib/trpc/request-options';
import { useQuery } from '@tanstack/react-query';

export type LinkEntityType = 'task' | 'note';

export interface BacklinkItem {
  sourceType: LinkEntityType;
  sourceId: string;
  title: string | null;
}

export interface OutgoingLinkItem {
  targetType: LinkEntityType;
  targetId: string;
  title: string | null;
  resolved: boolean;
}

export interface BacklinksResponse {
  backlinks: BacklinkItem[];
  outgoing: OutgoingLinkItem[];
}

export interface EntityTitle {
  type: LinkEntityType;
  id: string;
  title: string | null;
  status: string;
}

/**
 * Backlinks + outgoing links for a task/note. Keyed under a shared
 * typed backlinks procedure root so `settleEntity` can invalidate every
 * mounted panel in the target direction on any task/note mutation.
 *
 * `refetchOnMount: 'always'` so reopening a slideout always refreshes — this is
 * the safety net for writes that don't flow through `settleEntity` (agent
 * edits, document-chat completion, version reverts, external SQL). The default
 * `refetchOnWindowFocus` covers returning to an already-open panel.
 */
export function useBacklinks(type: LinkEntityType, id: string | null | undefined) {
  return useQuery({
    queryKey: trpc.entities.backlinksTypeGet.queryKey({ params: { type, id: id ?? '' } }),
    queryFn: () => trpcClient.entities.backlinksTypeGet.query({params: {type: type, id: id ?? ''}}),
    enabled: !!id,
    staleTime: 30_000,
    refetchOnMount: 'always',
  });
}

/**
 * Live title/status for one entity, via the read-only batch titles endpoint
 * (never bumps `last_viewed_at`, never fetches the body). Keyed per (type, id)
 * so React Query dedupes across the many chips in a document.
 */
export function useEntityTitle(type: LinkEntityType, id: string | null | undefined) {
  const sourceHome = useEntityLinkHome();
  return useQuery({
    queryKey: sourceHome ? trpc.spaces.entityTitles.queryKey({ teamId: sourceHome, refs: `${type}:${id}` }) : trpc.entities.titlesGet.queryKey({ query: { refs: `${type}:${id}` } }),
    queryFn: async () => {
      const res = sourceHome ? await trpcClient.spaces.entityTitles.query({ teamId: sourceHome, refs: `${type}:${id}` }) : await trpcClient.entities.titlesGet.query({query: rpcQuery({ refs: `${type}:${id}` })});
      return res.titles[0] ?? null;
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}
