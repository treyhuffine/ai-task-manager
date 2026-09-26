'use client';

import { Loader2, Plus } from 'lucide-react';
import { HarnessChat } from '@/components/chat/harness-chat';
import { MainChatHistoryMenu } from '@/components/chat/main-chat-history-menu';
import { useMainChat, useNewMainChat } from '@/hooks/use-main-chat';
import { useComputer } from '@/hooks/use-computers';
import type { WorkspaceRecord } from '@/db/types';

/**
 * The agent's main chat (docs/agents-view-spec.md §4): one persistent chat
 * per agent that manages its work, resumed when the view opens. History and
 * "New chat" sit in the bar above it, the same controls the app's main chat
 * has.
 */
export function AgentChatPanel({ workspace }: { workspace: WorkspaceRecord }) {
  const newChat = useNewMainChat(workspace.id);
  const archived = workspace.status === 'archived';
  // Pinned to the computer the agent lives on when that isn't the home
  // (P3.4). Its history stays here while that computer is away, and a
  // message waits for it.
  const { data: current } = useMainChat(workspace.id);
  const computer = useComputer(current?.session.computerId);
  const elsewhere = computer && !computer.isHome ? computer : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1 border-b border-border/50">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Main chat</span>
          {elsewhere && (
            <span
              className="truncate text-[10px] text-muted-foreground/70"
              title={elsewhere.worker?.connected ? `Runs on ${elsewhere.name}` : `Runs on ${elsewhere.name}, which isn't connected. Messages wait for it.`}
            >
              on {elsewhere.name}{elsewhere.worker?.connected ? '' : ' · not connected'}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <MainChatHistoryMenu scope={workspace.id} />
          {!archived && (
            <button
              onClick={() => newChat.mutate()}
              disabled={newChat.isPending}
              title="Start a new chat (archives the current one)"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
            >
              {newChat.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              New
            </button>
          )}
        </div>
      </div>
      <HarnessChat
        scope={workspace.id}
        composerPlaceholder={`Ask ${workspace.name} about its work, or what to start next`}
      />
    </div>
  );
}
