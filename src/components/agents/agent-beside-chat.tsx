'use client';

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { History, Loader2, Maximize2, MessageSquare } from 'lucide-react';
import { apiErrorStatus } from '@/lib/api/client';
import { ChatLookupState } from '@/components/chat/chat-lookup-state';
import { HarnessChatSession } from '@/components/chat/harness-chat';
import { ExecutionTranscript } from '@/components/executions/execution-transcript';
import { ExecutionActionBar } from '@/components/executions/action-bar/execution-action-bar';
import { ExecutionChatsMenu } from '@/components/executions/execution-chat-tabs';
import { ChatStatusText, CHAT_STATUS_DOT, useChatStatus } from '@/components/executions/chat-status';
import {
  ExecutionChatColumn,
  useExecutionChat,
  useStartExecutionChat,
  type ExecutionChatState,
} from '@/components/executions/execution-chat-column';
import type { ExecutionComposerHandle } from '@/components/executions/execution-composer';
import { requestWorkbenchView } from '@/components/executions/workbench/view-request';
import { WorkContext, useWorkActivity, useWorkNavigation } from '@/contexts/work-context';
import { useContinueSession, useExecutionChats, useSession } from '@/hooks/use-execution';
import { useMarkSessionRead, useWorkspace } from '@/hooks/use-workspaces';
import { useOrchestratorName } from '@/hooks/use-user-state';
import { useOpenFileListener } from '@/lib/entity-refs/open-file-event';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import type { WorkspaceRecord } from '@/db/types';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { BACKGROUND_DOT } from '@/components/workspaces/activity-style';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';

/**
 * A chat open beside an agent's main chat (docs/agents-view-spec.md,
 * "Chats beside the agent"). The agent view is where you oversee the
 * agent's work, so a chat you open from it (a link in the main chat, a row
 * in Overview) opens here, in the tools panel, instead of leaving.
 *
 * It's the chat itself, not a preview: the same column the execution view
 * has (execution-chat-column.tsx), so you can answer a question, approve,
 * steer or stop it here. The workbench's tools (files, preview, terminal,
 * changes) stay in the full view, one click away on Full view. The git
 * chip comes along, since it's where the work ends up.
 *
 * Put away with the × on its tab. Putting it away never closes or
 * archives the chat. Links inside it open here too, replacing it.
 */
export function AgentBesideChat({
  chatId,
  agent,
  active,
  onOpenChat,
  onOpenFull,
  onClose,
}: {
  chatId: string;
  /** The agent whose view this is. A chat in another agent names its agent. */
  agent: WorkspaceRecord;
  /** Its tab is in front, so it's being looked at: viewing is the read receipt. */
  active: boolean;
  /** Show another chat here (a sibling on the execution, a new one). */
  onOpenChat: (chatId: string) => void;
  /** Leave for the chat's full view. */
  onOpenFull: (chatId: string) => void;
  onClose: () => void;
}) {
  const { data: session, error, fetchStatus, refetch } = useSession(chatId);
  const navigation = useWorkNavigation();
  const activity = useWorkActivity();
  // Inside, leaving for Home (what archiving from the git chip does next)
  // means this chat is done here: put it away instead.
  const inner = useMemo(() => ({ ...navigation, goHome: onClose }), [navigation, onClose]);

  let body: ReactNode;
  if (!session) {
    body = apiErrorStatus(error) === 404 ? (
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div>
          <p className="text-[13px] font-semibold text-foreground">This chat isn&apos;t here anymore.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">It may have been deleted, or the link is wrong.</p>
          <button
            onClick={onClose}
            className="mt-3 inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            Put it away
          </button>
        </div>
      </div>
    ) : (
      <ChatLookupState paused={fetchStatus === 'paused'} error={error} retry={() => void refetch()} />
    );
  } else if (session.type === 'execution' || session.executionId) {
    body = <BesideExecutionChat key={chatId} session={session} agent={agent} active={active} onOpenChat={onOpenChat} onOpenFull={onOpenFull} />;
  } else {
    body = <BesideOtherChat key={chatId} session={session} agent={agent} active={active} />;
  }

  return (
    <WorkContext navigation={inner} activity={activity}>
      <section aria-label="Chat beside the agent's main chat" className="flex h-full min-h-0 min-w-0 flex-col bg-background">
        {body}
      </section>
    </WorkContext>
  );
}

/**
 * An execution chat: its header, then its column. An archived chat shows
 * its conversation and waits for Continue rather than resuming on sight:
 * looking at an old chat from a link shouldn't bring it back.
 */
function BesideExecutionChat({
  session,
  agent,
  active,
  onOpenChat,
  onOpenFull,
}: {
  session: ChatSessionWithExecution;
  agent: WorkspaceRecord;
  active: boolean;
  onOpenChat: (chatId: string) => void;
  onOpenFull: (chatId: string) => void;
}) {
  const chatId = session.id;
  const chat = useExecutionChat(chatId);
  const composerRef = useRef<ExecutionComposerHandle | null>(null);
  const newChat = useStartExecutionChat(chatId, onOpenChat);
  const continueWork = useContinueSession(chatId);
  const rootRef = useRef<HTMLDivElement>(null);
  useReadWhileShown(chatId, active, chat.isRunning);

  // File chips in this chat open its full view on Files, at the file: the
  // file tree and viewer are the workbench's. Only chips in this chat, so
  // the main chat's own chips are left alone.
  useOpenFileListener(
    useCallback(
      (detail) => {
        if (!detail.origin || !rootRef.current?.contains(detail.origin)) return;
        requestWorkbenchView(chatId, 'files', detail.path);
        onOpenFull(chatId);
      },
      [chatId, onOpenFull],
    ),
  );

  const current = chat.session ?? session;
  const archived = current.status === 'archived';
  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <BesideHeader
        session={current}
        agent={agent}
        chat={chat}
        onOpenChat={onOpenChat}
        onOpenFull={() => onOpenFull(chatId)}
      />
      {chat.session ? (
        <ExecutionChatColumn
          chat={chat}
          composerRef={composerRef}
          submitOnEnter
          // Opening it beside is for looking first: the main chat keeps the caret.
          autoFocus={false}
          // Short, for the narrower column, and about what you do from here.
          placeholder="Steer this chat"
          composerDisabledReason={archived ? (continueWork.isPending ? 'Resuming…' : 'Continue this chat to reply') : undefined}
          notice={archived && (
            <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
              <span className="min-w-0">This chat is archived.</span>
              <button
                type="button"
                disabled={continueWork.isPending}
                onClick={() => continueWork.mutate(undefined)}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {continueWork.isPending && <Loader2 size={11} className="animate-spin" />}
                Continue
              </button>
            </div>
          )}
          onSwitchProvider={newChat.start}
          switchingProvider={newChat.isPending}
        />
      ) : (
        <ChatLookupState error={chat.error} retry={() => undefined} />
      )}
    </div>
  );
}

/**
 * Who it is and where it stands, and the ways out: the execution's other
 * chats when it has more than one, the git chip, and Full view.
 */
function BesideHeader({
  session,
  agent,
  chat,
  onOpenChat,
  onOpenFull,
}: {
  session: ChatSessionWithExecution;
  agent: WorkspaceRecord;
  chat: ExecutionChatState;
  onOpenChat: (chatId: string) => void;
  onOpenFull: () => void;
}) {
  const status = useChatStatus({
    session,
    workspace: chat.workspace,
    isRunning: chat.isRunning,
    hasBackgroundTasks: chat.hasBackgroundTasks,
  });
  const { data: chats } = useExecutionChats(session.executionId ?? null, session.id, { refetchInterval: 30_000 });
  const entries = (chats?.sessions ?? []).map((s) => ({ ...s, isCurrent: s.id === session.id }));
  const title = session.execution?.label ?? session.label ?? 'Untitled chat';
  const elsewhere = session.workspaceId && session.workspaceId !== agent.id ? chat.workspace?.name : null;

  return (
    <header className="@container/beside flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-1.5">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
        {entries.length > 1 && (
          <ExecutionChatsMenu
            entries={entries}
            onOpen={onOpenChat}
            unreadElsewhere={entries.some((s) => !s.isCurrent && isSessionUnread(s))}
          />
        )}
        <div className="min-w-0">
          <Tip label={elsewhere ? `${elsewhere} › ${title}` : title} onlyWhenTextHidden>
            <h2 className="truncate text-[12.5px] font-semibold text-foreground">
              {elsewhere && <span className="font-medium text-muted-foreground">{elsewhere} › </span>}
              {title}
            </h2>
          </Tip>
          <ChatStatusText status={status} className="text-[11px]" />
        </div>
      </div>
      <div className="ml-auto flex min-w-0 max-w-full items-center gap-1.5">
        {chat.workspace && <ExecutionActionBar session={session} workspace={chat.workspace} fit />}
        <Tip label="Open it with its files, changes, preview and terminal">
          <button
            type="button"
            onClick={onOpenFull}
            className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Maximize2 size={12} />
            Full view
          </button>
        </Tip>
      </div>
    </header>
  );
}

/**
 * A chat that isn't an execution's: the app's main chat or another
 * agent's, reached through a link between chats. Live like any other, with
 * a header naming whose it is.
 */
function BesideOtherChat({ session, agent, active }: { session: ChatSessionWithExecution; agent: WorkspaceRecord; active: boolean }) {
  const { data: owner } = useWorkspace(session.workspaceId ?? null);
  const orchestratorName = useOrchestratorName();
  const archived = session.status === 'archived';
  useReadWhileShown(session.id, active && !archived, false);
  const whose = session.type === 'orchestration'
    ? session.workspaceId === agent.id ? `${agent.name}'s earlier main chat` : session.workspaceId ? `${owner?.name ?? 'Agent'} main chat` : `${orchestratorName} main chat`
    : 'Chat';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {archived ? <History size={13} className="text-muted-foreground" /> : <MessageSquare size={13} className="text-muted-foreground" />}
        <div className="min-w-0">
          <h2 className="truncate text-[12.5px] font-semibold text-foreground">{session.label ?? whose}</h2>
          <p className="truncate text-[11px] text-muted-foreground">{archived ? `${whose} · archived` : whose}</p>
        </div>
      </header>
      {archived ? (
        <ExecutionTranscript session={session} workspace={undefined} isRunning={false} />
      ) : (
        <HarnessChatSession sessionId={session.id} autoFocusComposer={false} />
      )}
    </div>
  );
}

/**
 * Viewing is the read receipt: mark the chat read when its tab comes to
 * the front, and when a reply lands while it's in front. The composer marks
 * it read on focus and send as well.
 */
function useReadWhileShown(chatId: string, shown: boolean, isRunning: boolean) {
  const markRead = useMarkSessionRead();
  const markReadRef = useRef(markRead);
  useEffect(() => {
    markReadRef.current = markRead;
  }, [markRead]);
  useEffect(() => {
    if (shown) markReadRef.current.mutate(chatId);
  }, [shown, chatId]);
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning && shown) markReadRef.current.mutate(chatId);
    prevRunningRef.current = isRunning;
  }, [isRunning, shown, chatId]);
}

/**
 * The chat beside, in a word and a dot: its title, and how it's doing by
 * the same signals the rail shows (working, waiting on you, something
 * running in the background). Its tab and the tools box both show it.
 */
export function useBesideChatSummary(chatId: string): { title: string; dot: string | null } {
  const { data: session } = useSession(chatId);
  const { streamingSessionIds, pendingInputSessionIds, backgroundSessionIds } = useWorkActivity();
  const title = session ? session.execution?.label ?? session.label ?? 'Untitled chat' : 'Chat';
  const dot = pendingInputSessionIds.has(chatId)
    ? cn(CHAT_STATUS_DOT.amber, 'animate-pulse')
    : streamingSessionIds.has(chatId)
      ? cn(CHAT_STATUS_DOT.green, 'animate-pulse')
      : backgroundSessionIds.has(chatId)
        ? BACKGROUND_DOT
        : null;
  return { title, dot };
}

/** The beside chat's tab in the tools strip. */
export function BesideChatTabLabel({ chatId }: { chatId: string }) {
  const { title, dot } = useBesideChatSummary(chatId);
  return (
    <>
      <MessageSquare size={12} className="flex-shrink-0" />
      <span className="max-w-40 truncate">{title}</span>
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', dot)} />}
    </>
  );
}
