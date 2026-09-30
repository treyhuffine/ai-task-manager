'use client';

import { useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useNeedsReviewSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { SessionRow } from './session-row';
import { useAgentAttention } from '@/hooks/use-agent-attention';
import { AgentAttentionRow } from './agent-attention-row';

/**
 * Top of the rail: everything that wants you, across agents. Agents first
 * (their main chat is waiting on you or has replied, `useAgentAttention`),
 * then executions with output you haven't read or a prompt waiting, the same
 * order as the tree below. Hidden when nothing wants you, never an empty
 * header.
 */
export function NeedsReviewSection() {
  const { streamingSessionIds, pendingInputSessionIds, openAgent } = useDashboard();
  const { data: candidates } = useNeedsReviewSessions();
  const agents = useAgentAttention();
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  // Session row menus open the agent's setup: its view, on the Setup tab.
  const openSetup = (id: string) => openAgent(id, 'setup');

  // Hide mid-turn sessions — a fresh outcome is imminent. Exception:
  // streaming-but-blocked-on-user-input is the most actionable state
  // there is, so let those through even though they look "streaming."
  const filtered = useMemo(
    () =>
      (candidates ?? []).filter(
        (s) => pendingInputSessionIds.has(s.id) || !streamingSessionIds.has(s.id),
      ),
    [candidates, streamingSessionIds, pendingInputSessionIds],
  );

  if (filtered.length === 0 && agents.length === 0) return null;

  const wsName = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return workspaces?.find((w) => w.id === id)?.name;
  };

  return (
    <>
      <div className="px-1 py-2 border-b border-border/60">
        <div className="px-1.5 pb-1.5 flex items-center justify-between">
          <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-amber-500/80">
            Needs you
          </span>
          <span className="text-[9px] text-muted-foreground/70 font-mono">{agents.length + filtered.length}</span>
        </div>
        <div className="space-y-0.5">
          {agents.map((item) => (
            <AgentAttentionRow key={item.workspace.id} item={item} />
          ))}
          {filtered.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              variant="needs-review"
              showWorkspaceLabel={wsName(session.workspaceId)}
              onOpenWorkspaceSettings={openSetup}
            />
          ))}
        </div>
      </div>
    </>
  );
}
