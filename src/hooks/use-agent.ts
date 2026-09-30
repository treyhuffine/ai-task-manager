import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentsApi } from '@/lib/api/agents';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions } from '@/hooks/use-workspaces';
import { useInactivity } from '@/hooks/use-inactivity';
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
  /** Waiting on you but idle past the inactive threshold (src/lib/sessions/inactive.ts). */
  needsYouInactive: Array<{ session: RailSession; bucket: BucketId }>;
  working: RailSession[];
  /** Everything else that is still active, newest first. */
  recent: RailSession[];
  /** The rest of the agent's executions, idle past the inactive threshold. */
  recentInactive: RailSession[];
  pinned: RailSession[];
  /** Pinned executions idle past the inactive threshold: they fold like everything else. */
  pinnedInactive: RailSession[];
  /** Every active execution of the agent. */
  all: RailSession[];
}

/**
 * Classified from the same rail feed and live signals the rail uses, so the
 * agent view and the rail can never disagree about what needs you. Inactive
 * work is split out of Needs you and Recent (the rail folds it the same way),
 * so it no longer counts toward what needs you. Pins fold the same way.
 */
export function useAgentExecutions(workspaceId: string): AgentExecutions & { isLoading: boolean } {
  const { data, isLoading } = useRailSessions();
  const { pendingInputSessionIds, streamingSessionIds } = useDashboard();
  const { isInactive } = useInactivity();
  const grouped = useMemo(() => {
    const all = sortSessionsHotnessDesc(
      (data?.sessions ?? []).filter((s) => s.workspaceId === workspaceId && s.status === 'active'),
    );
    const out: AgentExecutions = {
      needsYou: [],
      needsYouInactive: [],
      working: [],
      recent: [],
      recentInactive: [],
      pinned: [],
      pinnedInactive: [],
      all,
    };
    for (const session of selectPinnedSessions(all)) {
      (isInactive(session) ? out.pinnedInactive : out.pinned).push(session);
    }
    for (const session of all) {
      const bucket = classifySession(session, pendingInputSessionIds, streamingSessionIds);
      const inactive = isInactive(session);
      if (bucket === 'needsApproval' || bucket === 'unread') {
        (inactive ? out.needsYouInactive : out.needsYou).push({ session, bucket });
      } else if (bucket === 'working') out.working.push(session);
      else (inactive ? out.recentInactive : out.recent).push(session);
    }
    return out;
  }, [data?.sessions, workspaceId, pendingInputSessionIds, streamingSessionIds, isInactive]);
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
