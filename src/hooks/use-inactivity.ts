'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDashboard } from '@/contexts/dashboard-context';
import { useUserState } from '@/hooks/use-user-state';
import { userStateApi } from '@/lib/api/user-state';
import { isSessionInactive, partitionInactive, resolveInactiveAfterDays } from '@/lib/sessions/inactive';
import type { UserStateRecord } from '@/db/types';

/** Re-render on an interval so rows cross the inactive line while the app stays open. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

interface InactivityCandidate {
  id: string;
  lastActivityAt?: string | null;
  unreadMarkerAt: string | null;
  startedAt: string;
}

export interface Inactivity {
  /** The threshold in days, or null when folding is off (or settings haven't loaded). */
  afterDays: number | null;
  /** The stored preference: null (default), 0 (never), or days. Undefined until loaded. */
  stored: number | null | undefined;
  /** Idle past the threshold. */
  isInactive: (session: InactivityCandidate) => boolean;
  /** Split a list into what stays and what folds, pins included, each half in order. */
  partition: <T extends InactivityCandidate>(sessions: readonly T[]) => { active: T[]; inactive: T[] };
}

/**
 * The inactive-execution rule for the current user, ready to apply to any list
 * of sessions (see `src/lib/sessions/inactive.ts`). Running work (a live turn
 * or a background task) never counts as inactive. Until settings load nothing
 * folds, so a user who turned folding off never sees rows vanish and return.
 */
export function useInactivity(): Inactivity {
  const { data: userState, isSuccess } = useUserState();
  const { streamingSessionIds, backgroundSessionIds } = useDashboard();
  const now = useNow(60_000);
  const stored = isSuccess ? (userState?.executionInactiveAfterDays ?? null) : undefined;
  const afterDays = stored === undefined ? null : resolveInactiveAfterDays(stored);

  const isInactive = useCallback(
    (s: InactivityCandidate) =>
      isSessionInactive(s, afterDays, now, streamingSessionIds.has(s.id) || backgroundSessionIds.has(s.id)),
    [afterDays, now, streamingSessionIds, backgroundSessionIds],
  );
  const partition = useCallback(
    <T extends InactivityCandidate>(sessions: readonly T[]) => partitionInactive(sessions, isInactive),
    [isInactive],
  );
  return useMemo(() => ({ afterDays, stored, isInactive, partition }), [afterDays, stored, isInactive, partition]);
}

/**
 * Change the global threshold: null (default), 0 (never), or days. Optimistic,
 * so every fold in the app re-sorts the moment a choice is picked.
 */
export function useSetInactiveAfterDays() {
  const qc = useQueryClient();
  const key = ['user-state'] as const;
  return useMutation({
    mutationFn: (days: number | null) => userStateApi.update({ executionInactiveAfterDays: days }),
    onMutate: async (days) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UserStateRecord>(key);
      if (previous) qc.setQueryData<UserStateRecord>(key, { ...previous, executionInactiveAfterDays: days });
      return { previous };
    },
    onError: (_err, _days, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error('Couldn’t change when executions go inactive.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
