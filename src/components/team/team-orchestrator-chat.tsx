'use client';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { MainChatContent } from '@/components/chat/main-chat-content';
import { ChatLookupState } from '@/components/chat/chat-lookup-state';
import { useHomeContext } from '@/components/home/home-context';
import { useTeamNav } from './team-context';

/** Same main-chat experience and history, with a Team-owned execution scope. */
export function TeamOrchestratorChat() {
  const home = useHomeContext();
  const nav = useTeamNav();
  const assistant = useQuery({ ...trpc.team.ai.orchestrator.queryOptions(), staleTime: 30_000 });
  if (!assistant.data) return <ChatLookupState error={assistant.error} paused={assistant.fetchStatus === 'paused'} retry={() => void assistant.refetch()} />;
  if (assistant.data.workspaceId) return <MainChatContent scope={assistant.data.workspaceId} name={home.home.name} enabled={assistant.data.enabled} intro={{
    title: 'What should the team work on?',
    description: `Help with ${home.home.name}’s shared tasks, notes, decisions and agents. Everyone in this team can read this conversation.`,
    starters: [
      { label: 'What needs our attention?', prompt: 'Review the team’s shared work and tell us what needs attention.' },
      { label: 'Find a decision', prompt: 'Find the team’s decision about ', draft: true },
      { label: 'Check agent progress', prompt: 'What are the team’s agents working on, and what needs a person’s input?' },
    ],
  }} />;
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
    <p className="font-medium text-foreground">Your team’s shared assistant</p>
    <p className="max-w-xs">Tasks and notes work without AI. {home.capabilities.configureAgents ? 'Turn on Team AI when you want help with shared work.' : 'The owner can turn on Team AI when your team wants it.'}</p>
    {home.capabilities.configureAgents && <button className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted/50" onClick={() => nav.openSettings('ai')}>Set up Team AI</button>}
  </div>;
}
