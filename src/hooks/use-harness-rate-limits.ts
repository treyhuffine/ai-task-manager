'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { pageStream } from '@/lib/realtime/page-stream';

/** Provider reads are shared and throttled on the server, including across tabs. */
export const USAGE_POLL_INTERVAL_MS = 2 * 60_000;

export function useHarnessRateLimits(enabled: boolean) {
  const queryClient = useQueryClient();
  const limits = trpc.harness.rateLimitsGet;
  const query = useQuery({
    ...limits.queryOptions({}),
    enabled,
    staleTime: 30_000,
    refetchInterval: USAGE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
  const { mutate: readNow, isPending: updating } = useMutation(trpc.harness.rateLimitsPost.mutationOptions({
    onSuccess: (result) => queryClient.setQueryData(limits.queryKey({}), result),
  }));
  const handled = useRef(0);
  useEffect(() => {
    if (!enabled || !query.data?.stale || updating || handled.current === query.dataUpdatedAt) return;
    handled.current = query.dataUpdatedAt;
    readNow({});
  }, [enabled, query.data?.stale, query.dataUpdatedAt, updating, readNow]);

  useEffect(() => {
    if (!enabled) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = pageStream().subscribeGlobal((event) => {
      if (event !== 'rate_limits_updated' && event !== 'ready') return;
      // A snapshot can carry several windows. Coalesce the burst, without
      // starting a second event stream or polling any transcript.
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        void queryClient.invalidateQueries({ queryKey: limits.queryKey({}) });
      }, 150);
    });
    return () => { unsubscribe(); if (pending) clearTimeout(pending); };
  }, [enabled, limits, queryClient]);
  return { ...query, updating };
}
