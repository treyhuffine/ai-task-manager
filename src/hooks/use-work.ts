import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/lib/trpc/client';

/**
 * What you and your agents did over a run of days (docs/work-view.md). The
 * server folds new chat events into its ledger on every read, so a minute's
 * refetch keeps today live while the calendar is open. The first read of a
 * home builds the ledger from all history, which can take several seconds.
 */
export function useWorkRange(start: string, days: number, enabled = true) {
  return useQuery({
    queryKey: ['work', start, days],
    queryFn: () => trpcClient.work.range.query({ start, days }),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Save a range's report as a note. Returns the note. */
export function useSaveWorkReport() {
  return useMutation({
    mutationFn: (input: { start: string; days: number }) => trpcClient.work.saveReport.mutate(input),
    onError: (err) => toast.error("Couldn't save the report", { description: String(err) }),
  });
}
