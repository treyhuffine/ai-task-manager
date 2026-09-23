'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  modelsForProvider,
  type HarnessModelsResponse,
  type ProviderId,
} from '@/lib/harness/options';

export function useHarnessModels(
  providerId: ProviderId | null | undefined,
  options: { catalog?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const key = ['agent-models', providerId ?? 'none', options.catalog ? 'catalog' : 'enabled'] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<HarnessModelsResponse>('/harness/models', {
      query: { provider: providerId, ...(options.catalog ? { scope: 'catalog' } : {}) },
    }),
    enabled: providerId != null,
    staleTime: 15 * 60 * 1000,
  });
  const refresh = useCallback(async () => {
    if (!providerId) return null;
    const data = await api.get<HarnessModelsResponse>('/harness/models', {
      query: {
        provider: providerId,
        refresh: true,
        ...(options.catalog ? { scope: 'catalog' } : {}),
      },
    });
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
