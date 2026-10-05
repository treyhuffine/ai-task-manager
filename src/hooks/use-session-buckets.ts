'use client';

import { useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions } from '@/hooks/use-workspaces';
import { useInactivity } from '@/hooks/use-inactivity';
import { bucketSessions, type BucketId } from '@/lib/sessions/classification';
import type { RailSession } from '@/lib/api/sessions';

/**
 * The rail's active work by status (Needs approval, Unread, Working, Waiting),
 * hottest first in each, with inactive work left out. One reading shared by
 * the header's pills and the collapsed rail's Agents badge.
 */
export function useSessionBuckets(): Record<BucketId, RailSession[]> {
  const { data } = useRailSessions();
  const { streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const { isInactive } = useInactivity();
  return useMemo(
    () => bucketSessions(data?.sessions ?? [], pendingInputSessionIds, streamingSessionIds, isInactive),
    [data?.sessions, pendingInputSessionIds, streamingSessionIds, isInactive],
  );
}
