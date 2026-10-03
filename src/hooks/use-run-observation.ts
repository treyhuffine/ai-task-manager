import { trpcClient } from '@/lib/trpc/client';
/**
 * Polls `/api/runs/<id>/observe` for live activity status. Stops
 * polling once the run reaches a terminal state — there's no point
 * re-asking when the answer can't change.
 */

import type { RunObservation } from '@/lib/runs/observe';
import { useQuery } from '@tanstack/react-query';

export type RunObservationResponse = RunObservation & { summary: string };

export function useRunObservation(runId: string | null) {
  return useQuery<RunObservationResponse>({
    queryKey: ['run-observation', runId],
    queryFn: () => trpcClient.runs.observeGet.query({params: {id: runId ?? ''}}),
    enabled: !!runId,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 5_000;
      // Terminal — no further polling needed.
      if (data.activity.kind === 'terminal' || data.activity.kind === 'crashed') {
        return false;
      }
      // While waiting on input, the user is presumably going to react;
      // 3s is responsive without being chatty.
      if (data.activity.kind === 'awaiting_input') return 3_000;
      // 5s default for active runs.
      return 5_000;
    },
    refetchOnWindowFocus: true,
  });
}
