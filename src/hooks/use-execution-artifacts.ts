'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import type { ArtifactCursor } from '@/lib/sessions/artifact-messages';

export function useExecutionArtifacts(sessionId: string, executionId: string | null, active: boolean) {
  return useInfiniteQuery(trpc.artifacts.list.infiniteQueryOptions({
    scope: executionId ? { executionId } : { sessionId },
  }, {
    initialCursor: null as ArtifactCursor | null,
    getNextPageParam: page => page.nextCursor,
    staleTime: 10_000,
    enabled: active,
    refetchInterval: active ? 15_000 : false,
  }));
}
