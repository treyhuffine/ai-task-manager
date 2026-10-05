'use client';

import { useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { latestActivityAt } from '@/lib/utils/session-sort';
import { agentAttention, mainChatActivity } from '@/lib/utils/agent-rail';
import type { RailMainChat } from '@/lib/api/sessions';
import type { WorkspaceWithCounts } from '@/db/types';

/** An agent whose main chat wants you: it's waiting on you or it has replied. */
export interface AgentAttentionItem {
  workspace: WorkspaceWithCounts;
  chat: RailMainChat;
  activity: 'waiting' | 'replied';
  bucket: 'needsApproval' | 'unread';
}

/**
 * Every agent that wants you, for the surfaces that count what wants you:
 * the rail's Needs you group, the header's pills and the collapsed rail's
 * Agents badge. One source, so they always agree with each other and with
 * the agent's own row. Waiting on you first, then new replies, newest first.
 *
 * Thinking is left out on purpose: it is activity, not attention, and the
 * header's working count stays about executions
 * (`executionActivity` in `src/lib/sessions/classification.ts`).
 */
export function useAgentAttention(): AgentAttentionItem[] {
  const { data: rail } = useRailSessions();
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { pendingInputSessionIds, streamingSessionIds } = useDashboard();

  return useMemo(() => {
    const byId = new Map((workspaces ?? []).map((w) => [w.id, w]));
    const items: AgentAttentionItem[] = [];
    for (const chat of rail?.mainChats ?? []) {
      const workspace = byId.get(chat.workspaceId);
      if (!workspace) continue;
      const activity = mainChatActivity(chat, pendingInputSessionIds, streamingSessionIds);
      const bucket = agentAttention(activity);
      if (!bucket || (activity !== 'waiting' && activity !== 'replied')) continue;
      items.push({ workspace, chat, activity, bucket });
    }
    return items.sort((a, b) => {
      if (a.activity !== b.activity) return a.activity === 'waiting' ? -1 : 1;
      return (latestActivityAt(b.chat) ?? '').localeCompare(latestActivityAt(a.chat) ?? '');
    });
  }, [rail?.mainChats, workspaces, pendingInputSessionIds, streamingSessionIds]);
}
