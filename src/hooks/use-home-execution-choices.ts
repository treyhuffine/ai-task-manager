'use client';

import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';

/** Only AI controls request runtime discovery. Content never waits for it. */
export function useHomeExecutionChoices(enabled = true) {
  return useQuery({ ...trpc.homeExecutionChoices.queryOptions(), enabled, staleTime: 30_000, retry: false });
}
