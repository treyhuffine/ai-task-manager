import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** A computer of this home, as `GET /api/computers` gives it. */
export interface HomeComputer {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  isHome: boolean;
  worker: { enrolled: boolean; connected: boolean } | null;
}

/** This home's computers. Shares its cache with the imports panel's list. */
export function useComputers() {
  return useQuery({
    queryKey: ['computers'],
    queryFn: () => api.get<HomeComputer[]>('/computers'),
    staleTime: 30_000,
  });
}

/**
 * Whether work here can run on more than one computer: the home and at least
 * one enrolled worker. Only then is where an execution runs worth saying
 * (P3.1). A one-computer home shows nothing new.
 */
export function useRunsOnSeveralComputers(): boolean {
  const { data } = useComputers();
  return (data ?? []).filter((c) => c.status === 'active' && (c.isHome || c.worker?.enrolled)).length > 1;
}
