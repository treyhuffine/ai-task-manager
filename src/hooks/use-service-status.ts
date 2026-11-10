'use client';

import { queryOptions } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';

/**
 * The Home's service status (`service.list`): its phase, version and update.
 * One cache entry every reader shares. `ServiceConnection` already asks every
 * 5 seconds in each window and writes its answer here, so a reader's own
 * interval is only a fallback, and Settings asks faster while it's open.
 */
export const SERVICE_STATUS_KEY = ['local-service'] as const;

export function serviceStatusQuery(refetchInterval: number | false) {
  return queryOptions({ queryKey: SERVICE_STATUS_KEY, queryFn: () => trpcClient.service.list.query({}), refetchInterval, retry: false });
}
