'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api/sessions';

/**
 * Fires a Claude transcript reconcile when a session is opened, and
 * exposes the "syncing" indicator state.
 *
 * Lifecycle:
 *
 *   1. On mount, POST `/api/sessions/:id/reconcile`. Fire-and-forget —
 *      we don't await the response for UI purposes (the SSE drives
 *      everything visible to the user). The server publishes a
 *      `reconcile: started` frame the moment it confirms drift, then
 *      streams the replayed events as regular `chat_event` frames,
 *      then publishes `reconcile: done` when finished.
 *
 *   2. `useSessionStream`'s reconcile-frame handler folds the
 *      started/done state into the `['session', id, 'reconciling']`
 *      cache key. Read it here to drive the "Syncing…" pill.
 *
 * Cross-tab correct: any tab open to this session sees the indicator
 * because they all subscribe to the same SSE channel.
 */
export function useSessionReconcile(sessionId: string | null): { reconciling: boolean } {
  const queryClient = useQueryClient();
  const reconcilingKey = ['session', sessionId, 'reconciling'] as const;

  useEffect(() => {
    if (!sessionId) return;
    sessionsApi.reconcile(sessionId).catch((err) => {
      console.warn('[useSessionReconcile] reconcile request failed:', err);
    });
  }, [sessionId]);

  // Cache-only query — the actual value is written by useSessionStream's
  // `reconcile`-frame handler. `enabled: false` keeps this from ever
  // fetching; the queryFn is a fallback that just reads what's in cache
  // so React Query's "queryFn required" validation in v5 is satisfied
  // even though it never runs. Default `false` so we render correctly
  // before any frame has arrived.
  const { data: reconciling = false } = useQuery({
    queryKey: reconcilingKey,
    queryFn: () => queryClient.getQueryData<boolean>(reconcilingKey) ?? false,
    enabled: false,
    initialData: queryClient.getQueryData<boolean>(reconcilingKey) ?? false,
  });

  return { reconciling };
}
