import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';

export type RecentItem = import('@/lib/trpc/router').RouterOutputs['recents']['list'][number];

export const recentsApi = {
  list(limit = 10) {
    return trpcClient.recents.list.query({query: rpcQuery({ limit })});
  },
};
