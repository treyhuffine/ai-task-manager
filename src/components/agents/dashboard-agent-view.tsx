'use client';

import { useCallback, useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { agentView } from '@/lib/client/active-view';
import type { ActiveView, AgentTab } from '@/types/dashboard';
import { AgentView } from './agent-view';

/**
 * The agent view on the personal dashboard, where the URL carries the tab
 * and the chat beside the main chat (`?agent=&tab=&chat=`). Moving within
 * the view replaces the history entry, as switching tabs always has, so
 * Back leaves the agent rather than stepping through every chat looked at.
 */
export function DashboardAgentView({ view }: { view: Extract<ActiveView, { kind: 'agent' }> }) {
  const { setActiveView } = useDashboard();
  const { id, chat, message } = view;
  const besideChat = useMemo(() => (chat ? { id: chat, message } : null), [chat, message]);
  const onNavigate = useCallback(
    (tab: AgentTab | undefined, next: { id: string; message?: string } | null) =>
      setActiveView(agentView(id, tab, next?.id, next?.message)),
    [setActiveView, id],
  );
  return <AgentView workspaceId={id} tab={view.tab} besideChat={besideChat} onNavigate={onNavigate} />;
}
