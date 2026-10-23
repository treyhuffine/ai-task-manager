'use client';

import { Loader2, Plus } from 'lucide-react';
import { HarnessChat, HarnessChatSession } from '@/components/chat/harness-chat';
import { MainChatHistoryMenu } from '@/components/chat/main-chat-history-menu';
import { agentMainChatIntro } from '@/components/chat/main-chat-intro';
import { useMainChat, useNewMainChat } from '@/hooks/use-main-chat';
import { useDevice } from '@/hooks/use-devices';
import type { WorkspaceRecord } from '@/db/types';
import { CoordinationMenu } from '@/components/chat-ui/coordination/controls';
import { Tip } from '@/components/ui/tip';
import { useSession } from '@/hooks/use-execution';
import { useWorkNavigation } from '@/contexts/work-context';

/**
 * The agent's main chat (docs/agents-view-spec.md §4): one persistent chat
 * per agent that manages its work, resumed when the view opens. History and
 * "New chat" sit in the bar above it, the same controls the app's main chat
 * has.
 */
export function AgentChatPanel({ workspace, sessionId }: { workspace: WorkspaceRecord; sessionId?: string }) {
  const newChat = useNewMainChat(workspace.id);
  const archived = workspace.status === 'archived';
  // Pinned to the device the agent lives on when that isn't the home
  // (P3.4). Its history stays here while that device is away, and a
  // message waits for it.
  const { data: current } = useMainChat(workspace.id, !sessionId);
  const { data: saved } = useSession(sessionId ?? null);
  const { openAgent, openExecution } = useWorkNavigation();
  const device = useDevice(sessionId ? saved?.deviceId : current?.session?.deviceId);
  const elsewhere = device && !device.isHome ? device : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1 border-b border-border/50">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{sessionId ? saved?.label ?? 'Chat' : 'Main chat'}</span>
          {elsewhere && (
            <Tip
              label={
                !elsewhere.runsAgents
                  ? `This chat is on ${elsewhere.name}, which doesn't run agents yet. Messages wait until you turn it on: run ri worker enroll on it.`
                  : elsewhere.worker?.connected
                    ? `Runs on ${elsewhere.name}`
                    : `Runs on ${elsewhere.name}, which isn't connected. Messages wait for it.`
              }
            >
              <span
                className="truncate text-[10px] text-muted-foreground/70"
              >
                on {elsewhere.name}
                {!elsewhere.runsAgents ? ' · doesn\u2019t run agents yet' : elsewhere.worker?.connected ? '' : ' · not connected'}
              </span>
            </Tip>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <CoordinationMenu sessionId={sessionId ?? current?.session?.id ?? null} />
          {sessionId ? <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => openAgent(workspace.id)}>Agent chat</button> : <MainChatHistoryMenu scope={workspace.id} />}
          {!archived && (
            <Tip label="Earlier conversations stay in History">
              <button
                onClick={() => newChat.mutate(sessionId ? { sourceChatId: sessionId } : undefined, { onSuccess: data => { if (sessionId) openExecution(data.session.id); } })}
                disabled={newChat.isPending}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
              >
                {newChat.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                New
              </button>
            </Tip>
          )}
        </div>
      </div>
      {sessionId ? <HarnessChatSession sessionId={sessionId} chatMenuInHeader composerPlaceholder={`Tell ${workspace.name} what to build, or ask about its work`}
        onSwitchProvider={next => newChat.mutate({ sourceChatId: sessionId, providerId: next.harness, model: next.model, variant: next.variant, effort: next.effort }, { onSuccess: data => openExecution(data.session.id) })}
        switchingProvider={newChat.isPending} /> : <HarnessChat
        scope={workspace.id}
        composerPlaceholder={`Tell ${workspace.name} what to build, or ask about its work`}
        intro={archived ? undefined : agentMainChatIntro(workspace.name)}
      />}
    </div>
  );
}
