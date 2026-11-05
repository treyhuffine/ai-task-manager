'use client';

import { useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useNeedsReviewSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { SessionRow } from './session-row';
import { useAgentAttention } from '@/hooks/use-agent-attention';
import { AgentAttentionRow } from './agent-attention-row';
import { InactiveFold } from './inactive-fold';
import { useInactivity } from '@/hooks/use-inactivity';

/**
 * Top of the rail: everything that wants you, across agents. Agents first
 * (their main chat is waiting on you or has replied, `useAgentAttention`),
 * then executions with output you haven't read or a prompt waiting, the same
 * order as the tree below. Hidden when nothing wants you, never an empty
 * header. Executions that have gone inactive fold behind "N inactive hidden"
 * at the foot, so a week-old unread stops crowding today's.
 *
 * The agents-only rail folds the chats into one Unread row instead
 * (`UnreadRow`), from the same reading (`useWaitingChats`).
 */
export function NeedsReviewSection() {
  const { agents, active, inactive, wsName, openSetup } = useWaitingChats({ includeAgents: true });
  if (active.length + inactive.length === 0 && agents.length === 0) return null;

  return (
    <>
      <div className="px-1 py-2 border-b border-border/60">
        <div className="px-1.5 pb-1.5 flex items-center justify-between">
          <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-amber-500/80">
            Needs you
          </span>
          <span className="text-[9px] text-muted-foreground/70 font-mono">{agents.length + active.length}</span>
        </div>
        <div className="space-y-0.5">
          {agents.map((item) => (
            <AgentAttentionRow key={item.workspace.id} item={item} />
          ))}
        </div>
        <WaitingChatRows active={active} inactive={inactive} wsName={wsName} openSetup={openSetup} />
      </div>
    </>
  );
}

type WaitingChat = NonNullable<ReturnType<typeof useNeedsReviewSessions>['data']>[number];

/**
 * Everything that wants you: agents whose own chat does (when asked for), and
 * chats with output you haven't read or a prompt waiting, newest first, the
 * inactive ones apart.
 */
export function useWaitingChats({ includeAgents }: { includeAgents: boolean }) {
  const { streamingSessionIds, pendingInputSessionIds, openAgent } = useDashboard();
  const { data: candidates } = useNeedsReviewSessions();
  const attention = useAgentAttention();
  const agents = includeAgents ? attention : [];
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { partition } = useInactivity();
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

  const { active, inactive } = useMemo(() => partition(filtered), [partition, filtered]);

  const wsName = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return workspaces?.find((w) => w.id === id)?.name;
  };

  return { agents, active, inactive, loaded: candidates !== undefined && workspaces !== undefined, workspaces, wsName, openSetup };
}

/** The waiting chats, each naming its agent, the inactive ones behind the fold. */
export function WaitingChatRows({
  active,
  inactive,
  wsName,
  openSetup,
}: {
  active: readonly WaitingChat[];
  inactive: readonly WaitingChat[];
  wsName: (id: string | null) => string | undefined;
  openSetup: (id: string) => void;
}) {
  return (
    <>
      <div className="space-y-0.5">
        {active.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            variant="needs-review"
            showWorkspaceLabel={wsName(session.workspaceId)}
            onOpenWorkspaceSettings={openSetup}
          />
        ))}
      </div>
      <InactiveFold sectionId="unread" count={inactive.length} className="pl-8">
        {inactive.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            variant="needs-review"
            showWorkspaceLabel={wsName(session.workspaceId)}
            onOpenWorkspaceSettings={openSetup}
            inactive
          />
        ))}
      </InactiveFold>
    </>
  );
}
