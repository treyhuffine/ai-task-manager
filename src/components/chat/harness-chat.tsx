'use client';

import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import { AppCompanion } from '@/components/local-apps/app-companion';
import { AppCompanionButton } from '@/components/local-apps/app-companion-button';
import {
	EmptyChatActionsContext,
	MainChatIntroPanel,
	type EmptyChatActions,
	type MainChatIntro,
} from '@/components/chat/main-chat-intro';
import { ChatMenu } from '@/components/chat-ui/chat-menu';
import { BackgroundTasksBar } from '@/components/chat-ui/activity/background-tasks-bar';
import {
	ExecutionComposer,
	type ExecutionComposerHandle,
} from '@/components/executions/execution-composer';
import { ExecutionTranscript } from '@/components/executions/execution-transcript';
import { PendingInputArea } from '@/components/chat-ui/pending-input-area';
import { SyncingPill } from '@/components/executions/syncing-pill';
import type { EffortLevel } from '@/db/types';
import {
	useInterruptSession,
	useRuntimeStatus,
	useSendMessage,
	useSession,
	useSessionEvents,
} from '@/hooks/use-execution';
import { useMainChat, useNewMainChat, createMainChat, switchToMainChat, type MainChatScope } from '@/hooks/use-main-chat';
import { useSessionReconcile } from '@/hooks/use-session-reconcile';
import { useSessionStream } from '@/hooks/use-session-stream';
import { useMarkSessionRead } from '@/hooks/use-workspaces';
import { apiErrorBody, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import type { HarnessId } from '@/lib/harness/registry';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
import { useHomeExecutionChoices } from '@/hooks/use-home-execution-choices';
import { toast } from 'sonner';
import { ChatLookupState, ChatRefreshBoundary } from './chat-lookup-state';
import { ChatRecovery } from '@/components/chat-ui/chat-recovery';
import type { Attachment } from '@/db/types';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * The harness-backed orchestrator chat — the dashboard Chat tab. A
 * persistent `type='orchestration'` chat session runs a real harness process
 * (Claude Code today) with cwd = the app data root, acting through the
 * orchestrator's MCP tools (see `src/lib/orchestrator/harness-surface.ts`).
 *
 * Deliberately a recomposition of the execution chat column —
 * transcript + pending-input + composer — minus the workspace chrome
 * (header, git action bar, file tree, terminals) that has no meaning for
 * a data-root session. Events arrive over the same SSE stream the
 * execution view uses.
 *
 * `scope` picks the main chat: null is the app's, a workspace id is that
 * agent's (docs/agents-view-spec.md §4). Same component, same composer.
 */
export function HarnessChat({
  isMobile = false,
  scope = null,
  composerPlaceholder,
  autoFocusComposer,
  intro,
  emptyState,
}: {
  isMobile?: boolean;
  scope?: MainChatScope;
  composerPlaceholder?: string;
  autoFocusComposer?: boolean;
  /** Shown while the chat is empty, in place of a blank transcript. */
  intro?: MainChatIntro;
  /** Drawn while the chat is empty, instead of `intro` (the main chat's first run). It reads the chat's send and draft through `useEmptyChatActions`. */
  emptyState?: React.ReactNode;
}) {
  const { data, error, refetch, fetchStatus } = useMainChat(scope);
  const newChat = useNewMainChat(scope);
  const sessionId = data?.session?.id ?? null;

  if (!data) return <ChatLookupState paused={fetchStatus === 'paused'} error={error} retry={() => void refetch()} />;

  if (data.session === null && scope) return <ChatRefreshBoundary error={error} retry={() => void refetch()}><NewAgentConversation scope={scope} placeholder={composerPlaceholder} /></ChatRefreshBoundary>;

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-8">
        <div>
          <p className="text-[12px] font-semibold text-foreground">
            {scope === null ? 'Couldn\u2019t load the orchestrator chat.' : 'Couldn\u2019t load this agent\u2019s chat.'}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            {apiErrorStatus(error) !== undefined
              ? ((apiErrorBody(error) as { error?: string } | null)?.error ?? apiErrorText(error))
              : 'Unknown error.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <ChatRefreshBoundary error={error} retry={() => void refetch()}><HarnessChatSession
      sessionId={sessionId}
      chatMenuInHeader
      isMobile={isMobile}
      composerPlaceholder={composerPlaceholder}
      autoFocusComposer={autoFocusComposer}
      intro={intro}
      emptyState={emptyState}
      onSwitchProvider={(next) => newChat.mutate({
        providerId: next.harness,
        model: next.model,
        variant: next.variant,
        effort: next.effort,
        serviceTier: next.serviceTier,
      })}
      switchingProvider={newChat.isPending}
    /></ChatRefreshBoundary>
  );
}

/**
 * The harness chat surface for a single session id — transcript +
 * pending-input + composer, no workspace chrome. Reused by both the
 * dashboard orchestrator chat (above) and the in-document (note/task)
 * `type='content'` chat (see slideout-chat.tsx). Everything it needs is
 * keyed off the session id, so the same component drives either.
 */
type HarnessChatSessionProps = {
  sessionId: string;
  /** Main chats provide their menu in the surrounding header. Embedded chats keep it in their action row. */
  chatMenuInHeader?: boolean;
  isMobile?: boolean;
  /** Placeholder for the composer. The agent-first entity view passes
   *  document-specific teaching copy; executions keep the default. */
  composerPlaceholder?: string;
  /** Auto-focus the composer on mount. Defaults to true (executions). The
   *  slideout document-chat passes false so the composer doesn't steal focus
   *  from the task/note title. */
  autoFocusComposer?: boolean;
  /** Shown while the conversation is empty, in place of a blank transcript. */
  intro?: MainChatIntro;
  /** Drawn while the conversation is empty, instead of `intro`. */
  emptyState?: React.ReactNode;
  /** Optional: enables the composer's provider switcher (starts a fresh chat
   *  on the chosen provider). The host owns what "new chat" means. */
  onSwitchProvider?: (next: {
    harness: HarnessId;
    model: string;
    variant?: string;
    effort?: EffortLevel; serviceTier?: string;
  }) => void;
  switchingProvider?: boolean;
};

export function HarnessChatSession(props: HarnessChatSessionProps) {
  return <ChatSession key={props.sessionId} {...props} />;
}

function ChatSession({
  sessionId,
  isMobile = false,
  autoFocusComposer = true,
  composerPlaceholder,
  intro,
  emptyState,
  onSwitchProvider,
  switchingProvider,
  chatMenuInHeader = false,
}: HarnessChatSessionProps) {
  const { data: session, error: sessionError, fetchStatus, refetch } = useSession(sessionId);
  const { data: runtime } = useRuntimeStatus(sessionId);
  // Live event stream — appends rows into the events cache as the
  // executor writes them (same transport as the execution view).
  useSessionStream(sessionId);
  // Catch up to the harness's on-disk transcript after server restarts.
  const { reconciling } = useSessionReconcile(sessionId);
  const sendMessage = useSendMessage(sessionId);
  const interruptSession = useInterruptSession(sessionId);
  const isRunning = runtime?.running ?? false;
  // The same cache the transcript reads. A send inserts its row
  // optimistically, so the intro gives way the moment anything is sent.
  const { data: events, isLoading: eventsLoading } = useSessionEvents(sessionId);
  const showIntro = (!!intro || !!emptyState) && !eventsLoading && (events?.length ?? 0) === 0 && !isRunning;
  const emptyActions: EmptyChatActions = {
    send: (prompt) => void sendMessage.mutateAsync(prompt),
    draft: (prompt) => {
      composerHandleRef.current?.insertTextAtCursor(prompt);
      composerHandleRef.current?.focus({ end: true });
    },
    disabled: sendMessage.isPending,
  };

  // Voice-sent event ids, client-memory only — same soft-signal model as
  // the execution view and the legacy chat.
  const [voiceSentIds, setVoiceSentIds] = useState<Set<string>>(() => new Set());
  const composerHandleRef = useRef<ExecutionComposerHandle | null>(null);

  // Viewing IS the read receipt. This component only mounts while the Chat
  // tab is the active tab, so: mark read on mount (tab switched back) and on
  // each running→idle edge (a reply landed while the user was watching).
  // Keeps lastViewedAt truthful — the needs-review query excludes this chat
  // anyway, but future surfaces (a Chat-tab unread badge) read this field.
  const markRead = useMarkSessionRead();
  const markReadRef = useRef(markRead);
  useEffect(() => {
    markReadRef.current = markRead;
  }, [markRead]);
  useEffect(() => {
    markReadRef.current.mutate(sessionId);
  }, [sessionId]);
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      markReadRef.current.mutate(sessionId);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, sessionId]);

  if (!session) return <ChatLookupState paused={fetchStatus === 'paused'} error={sessionError} retry={() => void refetch()} />;

  return (
    <AppCompanion chatId={sessionId} surfaceKind={session.surfaceKind}>
      <ChatRefreshBoundary error={sessionError} retry={() => void refetch()}>
    <ChatDropZone
      className="flex flex-1 min-h-0 flex-col"
      onFiles={(files) => {
        for (const f of files) void composerHandleRef.current?.uploadFile(f);
        composerHandleRef.current?.focus({ end: true });
      }}
    >
      {reconciling && <SyncingPill />}
      {showIntro && emptyState ? (
        <EmptyChatActionsContext.Provider value={emptyActions}>{emptyState}</EmptyChatActionsContext.Provider>
      ) : showIntro && intro ? (
        <MainChatIntroPanel
          intro={intro}
          disabled={emptyActions.disabled}
          onSend={emptyActions.send}
          onDraft={emptyActions.draft}
        />
      ) : (
        <ExecutionTranscript
          session={session}
          workspace={undefined}
          isRunning={isRunning}
          voiceSentIds={voiceSentIds}
        />
      )}
      <div className="flex-shrink-0 bg-background">
        <ChatRecovery sessionId={session.id} runtime={runtime} />
        <PendingInputArea sessionId={session.id} />
        <BackgroundTasksBar
          sessionId={session.id}
          runtimeHasBackgroundTasks={runtime?.backgroundTasks}
          runtimeBackgroundTaskIds={runtime?.backgroundTaskIds}
        />
        <ExecutionComposer
          ref={composerHandleRef}
          sessionId={session.id}
          autoFocus={autoFocusComposer}
          placeholder={composerPlaceholder}
          permissionMode={session.permissionMode}
          model={session.model}
          modelVariant={session.modelVariant}
          effort={session.effort}
          serviceTier={session.serviceTier}
          harness={session.harness}
          leadingActions={<><AppCompanionButton chatId={session.id} surfaceKind={session.surfaceKind} />{!chatMenuInHeader && <ChatMenu sessionId={session.id} />}</>}
          submitOnEnter={!isMobile}
          isRunning={isRunning}
          onSwitchProvider={onSwitchProvider}
          switchingProvider={switchingProvider}
          onSend={async (content, opts) => {
            const event = await sendMessage.mutateAsync({
              content,
              attachments: opts?.attachments,
            });
            if (opts?.viaVoice && event?.id) {
              setVoiceSentIds((prev) => {
                if (prev.has(event.id)) return prev;
                const next = new Set(prev);
                next.add(event.id);
                return next;
              });
            }
          }}
          onStop={runtime?.canStop ? async () => {
            await interruptSession.mutateAsync();
          } : undefined}
        />
      </div>
    </ChatDropZone>
      </ChatRefreshBoundary>
    </AppCompanion>
  );
}

/** Opening an agent is read-only. Its first message creates the shared chat. */
function NewAgentConversation({ scope, placeholder }: { scope: string; placeholder?: string }) {
  const cache = useQueryClient();
  const availability = useHomeExecutionChoices();
  const created = useRef<Awaited<ReturnType<typeof createMainChat>> | null>(null);
  const choice = availability.data?.[0];
  const send = useMutation({
    meta: { carriesInput: true },
    mutationFn: async ({ content, attachments }: { content: string; attachments?: Attachment[] }) => {
      const chat = created.current ?? await createMainChat(scope, {});
      created.current = chat;
      await trpcClient.sessions.messagesPost.mutate({ params: { id: chat.session.id }, body: { id: crypto.randomUUID(), content, attachments } });
      return chat;
    },
    onSuccess: chat => switchToMainChat(cache, scope, chat),
    onError: error => toast.error('Could not send your message', { description: apiErrorText(error) }),
  });
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 p-6 text-sm text-muted-foreground">Start a conversation. Everyone in this Home can read it.</div>
    {availability.error && <button type="button" className="mx-4 mb-2 self-start text-xs text-muted-foreground underline" onClick={() => void availability.refetch()}>Retry agent availability</button>}
    <ExecutionComposer sessionId="" draftKey={`main:new:${scope}`} permissionMode={DEFAULT_PERMISSION_MODE} model={null} effort={null} harness={null}
      placeholder={placeholder} helperText="Starts with this Home's default model and permissions." disabled={send.isPending || !choice?.available}
      disabledReason={availability.isPending ? 'Checking agent availability…' : availability.error ? 'Agent availability could not be checked.' : choice?.unavailableReason ?? undefined}
      onSend={(content, opts) => send.mutateAsync({ content, attachments: opts?.attachments }).then(() => {})} />
  </div>;
}
