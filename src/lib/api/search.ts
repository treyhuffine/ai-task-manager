import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';

export type SearchMode = 'hybrid' | 'keyword' | 'vector';

export type SearchResult = import('@/lib/trpc/router').RouterOutputs['search']['list'][number];

export const searchApi = {
  query(q: string, opts?: { mode?: SearchMode; limit?: number }) {
    return trpcClient.search.list.query({query: rpcQuery({ q, ...opts })});
  },
};
