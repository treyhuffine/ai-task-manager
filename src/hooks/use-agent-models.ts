'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  modelsForProvider,
  type AgentModelsResponse,
  type ProviderId,
} from '@/lib/agent-options';

export function useAgentModels(providerId: ProviderId | null | undefined) {
  const query = useQuery({
    queryKey: ['agent-models', providerId ?? 'none'],
    queryFn: () => api.get<AgentModelsResponse>('/agent/models', { query: { provider: providerId } }),
    enabled: providerId != null,
    staleTime: 15 * 60 * 1000,
  });

  return {
    ...query,
    models: query.data?.models ?? (providerId ? modelsForProvider(providerId) : []),
    source: query.data?.source ?? 'config',
  };
}
