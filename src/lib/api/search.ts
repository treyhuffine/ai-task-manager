import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';

export type SearchMode = 'hybrid' | 'keyword' | 'vector';

export type SearchResult = import('@/lib/trpc/router').RouterOutputs['search']['list'][number];

export const searchApi = {
  /** `kind` keeps notes of that kind only, and leaves out tasks and stream. */
  query(q: string, opts?: { mode?: SearchMode; limit?: number; kind?: 'note' | 'decision' }) {
    return trpcClient.search.list.query({query: rpcQuery({ q, ...opts })});
  },
};
