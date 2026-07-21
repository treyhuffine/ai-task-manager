import { keepPreviousData, useQueryClient, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/lib/api/client';
import type { CalendarRangeResult } from '@/lib/calendar/types';

const fetchRange = (start: string, days: number) =>
  api.get<CalendarRangeResult>('/calendar', { query: { start, days } });

/**
 * The day shape for a date range, from `GET /api/calendar`. Client-driven
 * freshness only: short staleTime, a gentle background interval, and a
 * refetch on window focus — there is no server-side polling to lean on.
 * While navigating between dates/weeks the previous range stays on screen
 * instead of flashing blank.
 */
export function useDayShape(start: string, days = 1) {
  return useQuery({
    queryKey: ['calendar', start, days],
    queryFn: () => fetchRange(start, days),
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

/**
 * Warm a range before a surface needs it — e.g. the week, the moment the
 * HUD peek or the calendar panel appears — so opening Week is instant
 * instead of a several-second Google round-trip.
 */
export function usePrefetchDayShape() {
  const qc = useQueryClient();
  return useCallback(
    (start: string, days = 1) => {
      void qc.prefetchQuery({
        queryKey: ['calendar', start, days],
        queryFn: () => fetchRange(start, days),
        staleTime: 60_000,
      });
    },
    [qc],
  );
}

/** Manual refresh: bust the server cache, then invalidate every range. */
export function useRefreshDayShape() {
  const qc = useQueryClient();
  return useCallback(
    async (start: string, days = 1) => {
      await api.get<CalendarRangeResult>('/calendar', { query: { start, days, fresh: 1 } });
      await qc.invalidateQueries({ queryKey: ['calendar'] });
    },
    [qc],
  );
}
