import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AgentRecord } from '@/db/types';

export function useAgents(filter?: { status?: 'active' | 'archived' }) {
  return useQuery<AgentRecord[]>({
    queryKey: ['agents', filter],
    queryFn: () =>
      api.get<AgentRecord[]>('/agents', {
        query: filter as Record<string, string>,
      }),
    staleTime: 60_000,
  });
}
