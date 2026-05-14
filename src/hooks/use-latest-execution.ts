'use client';

import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions } from '@/hooks/use-workspaces';

/**
 * Resolve the last-viewed execution id to one that is still openable —
 * the session must exist in the rail and be `active` (not archived).
 * Returns null otherwise so callers can hide affordances cleanly.
 */
export function useLatestExecutionId(): string | null {
  const { lastExecutionId } = useDashboard();
  const { data } = useRailSessions();
  if (!lastExecutionId) return null;
  const match = data?.sessions.find((s) => s.id === lastExecutionId);
  if (!match || match.status !== 'active') return null;
  return lastExecutionId;
}
