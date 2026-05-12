'use client';

import { useEffect } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions } from '@/hooks/use-workspaces';

/**
 * Bridge from the rail GET response into the dashboard context's
 * pending-input + streaming sets. The rail endpoint snapshots both
 * lists server-side on every fetch — much cheaper than a long-lived
 * cross-session SSE, and the per-session stream's result/runtime
 * frames invalidate the rail so we re-fetch as soon as anything
 * meaningful changes.
 *
 * Execution-view's per-session `setSessionStreaming` still fires for
 * the open session as a fast-path; on the next rail refresh the
 * context set is replaced with the server's snapshot, which by then
 * agrees with what the local view already wrote.
 */
export function useRailContextHydrate(): void {
  const { data } = useRailSessions();
  const { setPendingInputSessions, setStreamingSessions } = useDashboard();

  useEffect(() => {
    if (!data) return;
    setPendingInputSessions(data.pendingSessionIds);
    setStreamingSessions(data.runningSessionIds);
  }, [data, setPendingInputSessions, setStreamingSessions]);
}
