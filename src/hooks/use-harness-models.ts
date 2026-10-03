'use client';

import {
	modelsForProvider,
	type ProviderId
} from '@/lib/harness/options';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export function useHarnessModels(
  providerId: ProviderId | null | undefined,
  options: { catalog?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const key = ['agent-models', providerId ?? 'none', options.catalog ? 'catalog' : 'enabled'] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => trpcClient.harness.modelsGet.query({query: rpcQuery({ provider: providerId, ...(options.catalog ? { scope: 'catalog' } : {}) })}),
    enabled: providerId != null,
    staleTime: 15 * 60 * 1000,
  });
  const refresh = useCallback(async () => {
    if (!providerId) return null;
    const data = await trpcClient.harness.modelsGet.query({query: rpcQuery({
        provider: providerId,
        refresh: true,
        ...(options.catalog ? { scope: 'catalog' } : {}),
      })});
    queryClient.setQueryData(key, data);
    return data;
  }, [key, options.catalog, providerId, queryClient]);

  return {
    ...query,
    refresh,
    models: query.data?.models ?? (!options.catalog && providerId ? modelsForProvider(providerId) : []),
    source: query.data?.source ?? 'config',
  };
}
