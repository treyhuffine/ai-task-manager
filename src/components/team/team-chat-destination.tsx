'use client';

import { useEffect, useState } from 'react';
import { useMainChat } from '@/hooks/use-main-chat';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useSession } from '@/hooks/use-execution';
import { AgentView } from '@/components/agents/agent-view';
import { ExecutionView } from '@/components/executions/execution-view';
import { useTeamNav } from './team-context';
import { LegacyTeamChatAgentChoice, TeamChat } from './team-chat';
import { apiErrorText } from '@/lib/api/client';
import { ChatLookupState, ChatRefreshBoundary } from '@/components/chat/chat-lookup-state';

/** Resolve private navigation, then keep the exact conversation in this document's URL. */
export function TeamChatDestination() {
  const nav = useTeamNav();
  const agents = useWorkspaces({ status: 'active' });
  if (nav.chatId) return <SelectedTeamChat chatId={nav.chatId} />;
  const agentId = nav.agentId ?? (agents.data?.length === 1 ? agents.data[0].id : null);
  if (agentId) return <MemberAgentChat key={agentId} agentId={agentId} />;
  if (!agents.data) return <ChatLookupState paused={agents.fetchStatus === 'paused'} error={agents.error} retry={() => void agents.refetch()} />;
  return <TeamChat />;
}
function MemberAgentChat({ agentId }: { agentId: string }) {
  const nav = useTeamNav();
  const current = useMainChat(agentId);
  const [opened, setOpened] = useState<string | null>(null);
  const selected = current.data?.session?.id ?? null;
  if (!opened && selected) setOpened(selected);
  const chatId = opened ?? selected;
  useEffect(() => { if (chatId) nav.pinChat(chatId); }, [chatId, nav]);
  if (!current.data && !chatId) return current.error ? <UnavailableChat error={current.error} retry={() => void current.refetch()} /> : <ChatLookupState paused={current.fetchStatus === 'paused'} retry={() => void current.refetch()} />;
  return <ChatRefreshBoundary error={current.error} retry={() => void current.refetch()}>{chatId ? <SelectedTeamChat chatId={chatId} /> : <AgentView workspaceId={agentId} />}</ChatRefreshBoundary>;
}
function SelectedTeamChat({ chatId }: { chatId: string }) {
  const nav = useTeamNav();
  const session = useSession(chatId);
  if (!session.data) return session.error ? <UnavailableChat error={session.error} retry={() => void session.refetch()} /> : <ChatLookupState paused={session.fetchStatus === 'paused'} retry={() => void session.refetch()} />;
  const content = session.data.workspaceId && session.data.executionId ? <ExecutionView sessionId={session.data.id} />
    : session.data.workspaceId ? <AgentView workspaceId={session.data.workspaceId} chatSessionId={session.data.id} tab={nav.agentTab} />
      : <div className="flex min-h-0 flex-1 flex-col"><LegacyTeamChatAgentChoice chatId={session.data.id} /><ExecutionView sessionId={session.data.id} /></div>;
  return <ChatRefreshBoundary error={session.error} retry={() => void session.refetch()}>{content}</ChatRefreshBoundary>;
}

function UnavailableChat({ error, retry }: { error: unknown; retry: () => void }) {
  const nav = useTeamNav();
  return <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6" aria-label="Chat unavailable">
    <h2 className="text-sm font-medium">This chat is unavailable</h2>
    <p className="max-w-sm text-center text-sm text-muted-foreground">{apiErrorText(error)}</p>
    <div className="flex gap-3 text-sm"><button onClick={retry} className="underline">Retry</button><button onClick={() => nav.show('agents')} className="underline">Choose a chat</button></div>
  </section>;
}
