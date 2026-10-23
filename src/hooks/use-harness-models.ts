'use client';

import {
	modelsForProvider,
	type ProviderId
} from '@/lib/harness/options';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useExecutionRuntimeScope } from '@/components/home/execution-runtime-context';

export function useHarnessModels(
  providerId: ProviderId | null | undefined,
  options: { catalog?: boolean } = {},
) {
  const scope = useExecutionRuntimeScope();
  const { personalControls } = scope;
  const queryClient = useQueryClient();
  const key = useMemo(() => trpc.harness.modelsGet.queryKey({ query: { provider: providerId ?? undefined, ...(options.catalog ? { scope: 'catalog' } : {}) } }), [providerId, options.catalog]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => trpcClient.harness.modelsGet.query({query: rpcQuery({ provider: providerId, ...(options.catalog ? { scope: 'catalog' } : {}) })}),
    enabled: providerId != null,
    staleTime: 15 * 60 * 1000,
    refetchInterval: false,
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
    models: query.data?.models ?? (personalControls && !options.catalog && providerId ? modelsForProvider(providerId) : []),
    source: query.data?.source ?? 'config',
  };
}
