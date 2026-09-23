import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentsApi } from '@/lib/api/agents';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions } from '@/hooks/use-workspaces';
import { classifySession, type BucketId } from '@/components/workspaces/bucket-config';
import { selectPinnedSessions, sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import type { RailSession } from '@/lib/api/sessions';

/**
 * Data for the agent view (docs/agents-view-spec.md Phase 7).
 */

/** The agent's executions, grouped the way the rail's status view groups them. */
export interface AgentExecutions {
  /** Waiting on you: a permission prompt or question, or finished output you haven't read. */
  needsYou: Array<{ session: RailSession; bucket: BucketId }>;
  working: RailSession[];
  /** Everything else that is still active, newest first. */
  recent: RailSession[];
  pinned: RailSession[];
  /** Every active execution of the agent. */
  all: RailSession[];
}

/**
 * Classified from the same rail feed and live signals the rail uses, so the
 * agent view and the rail can never disagree about what needs you.
 */
export function useAgentExecutions(workspaceId: string): AgentExecutions & { isLoading: boolean } {
  const { data, isLoading } = useRailSessions();
  const { pendingInputSessionIds, streamingSessionIds } = useDashboard();
  const grouped = useMemo(() => {
    const all = sortSessionsHotnessDesc(
      (data?.sessions ?? []).filter((s) => s.workspaceId === workspaceId && s.status === 'active'),
    );
    const out: AgentExecutions = { needsYou: [], working: [], recent: [], pinned: selectPinnedSessions(all), all };
    for (const session of all) {
      const bucket = classifySession(session, pendingInputSessionIds, streamingSessionIds);
      if (bucket === 'needsApproval' || bucket === 'unread') out.needsYou.push({ session, bucket });
      else if (bucket === 'working') out.working.push(session);
      else out.recent.push(session);
    }
    return out;
  }, [data?.sessions, workspaceId, pendingInputSessionIds, streamingSessionIds]);
  return { ...grouped, isLoading };
}


export function useAgentPreviews(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ['agent', workspaceId, 'previews'],
    queryFn: () => agentsApi.previews(workspaceId),
    enabled,
    // A preview going up or down is worth seeing without a reload. Reading
    // never keeps a preview warm, so polling is safe.
    refetchInterval: 10_000,
  });
}

export function useAgentTasks(workspaceId: string) {
  return useQuery({
    queryKey: ['agent', workspaceId, 'tasks'],
    queryFn: () => agentsApi.tasks(workspaceId),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
