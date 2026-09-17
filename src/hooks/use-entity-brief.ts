'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { BriefEntityType, BriefState } from '@/lib/briefs/types';

interface BriefResponse {
  state: BriefState;
}

/**
 * The agent's brief of a note/task for the agent-first view.
 *
 * Read path: GET returns the cached state instantly. Generation policy lives
 * here, not on the server, so the UI decides when a model call is worth it:
 *
 *   - On open, if the brief is `missing` or `stale`, generate once.
 *   - After that, a stale brief (the document changed while you were here,
 *     e.g. the agent edited it) is shown with an "updated" affordance rather
 *     than regenerated on every write. The conversation already says what
 *     changed; the next open refreshes it.
 *
 * Invalidate `['entity-brief', type, id]` after an entity write so the state
 * reflects the new content hash.
 */
export function useEntityBrief(entityType: BriefEntityType, entityId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['entity-brief', entityType, entityId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<BriefResponse>(`/entity-brief?entityType=${entityType}&entityId=${entityId}`),
    enabled: !!entityId,
    staleTime: 10_000,
  });

  const generate = useMutation({
    mutationFn: () => api.post<BriefResponse>('/entity-brief', { entityType, entityId }),
    onSuccess: (data) => qc.setQueryData(queryKey, data),
  });

  // One automatic generation per mount: the first observed missing/stale state.
  const autoRanRef = useRef(false);
  useEffect(() => {
    autoRanRef.current = false;
  }, [entityId]);
  const status = query.data?.state.status;
  useEffect(() => {
    if (!entityId || !status || autoRanRef.current) return;
    if (status !== 'missing' && status !== 'stale') return;
    autoRanRef.current = true;
    generate.mutate();
    // generate is stable enough for this: we only want to fire on status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, status]);

  const refresh = useCallback(() => generate.mutate(), [generate]);

  return {
    state: query.data?.state ?? null,
    isLoading: query.isLoading,
    isGenerating: generate.isPending,
    generateError: generate.error as unknown,
    loadError: query.error as unknown,
    refresh,
  };
}

export type EntityBriefHandle = ReturnType<typeof useEntityBrief>;
