import { trpcClient } from '@/lib/trpc/client';
/**
 * Polls `/api/runs/stats` every 5s for the TopHud rollup. Cheap query —
 * three single-row aggregates — so the cadence is generous without
 * worrying about contention.
 */

import { useQuery } from '@tanstack/react-query';

export interface RunsStats {
  activeRuns: number;
  todaySpend: number;
  monthSpend: number;
  budget: number | null;
  budgetFraction: number | null;
  budgetState: 'ok' | 'warn' | 'block';
}

export function useRunsStats() {
  return useQuery<RunsStats>({
    queryKey: ['runs-stats'],
    queryFn: () => trpcClient.runs.statsGet.query({}),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  });
}
