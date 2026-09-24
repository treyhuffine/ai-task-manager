'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useMainChat, useNewMainChat, type MainChatScope } from '@/hooks/use-main-chat';
import type { HarnessId } from '@/lib/harness/registry';
import {
  useSession,
  useSendMessage,
  useRuntimeStatus,
  useInterruptSession,
} from '@/hooks/use-execution';
import { useMarkSessionRead } from '@/hooks/use-workspaces';
import { useSessionStream } from '@/hooks/use-session-stream';
import { useSessionReconcile } from '@/hooks/use-session-reconcile';
import { ExecutionTranscript } from '@/components/executions/execution-transcript';
import {
  ExecutionComposer,
  type ExecutionComposerHandle,
} from '@/components/executions/execution-composer';
import { PendingInputArea } from '@/components/executions/pending-input-overlay';
import { BackgroundTasksBar } from '@/components/executions/background-tasks-bar';
import { SyncingPill } from '@/components/executions/syncing-pill';
import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import { ApiError } from '@/lib/api/client';
import type { EffortLevel } from '@/db/types';

/**
 * The harness-backed orchestrator chat — the dashboard Chat tab when
 * `orchestratorMode` is a harness mode. A persistent `type='orchestration'`
 * chat session runs a real harness process (Claude Code today) with
 * cwd = the app data root, acting through the orchestrator action surface
 * (CLI in skills mode, MCP in mcp mode — see
 * `src/lib/orchestrator/harness-surface.ts`).
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
}: {
  isMobile?: boolean;
  scope?: MainChatScope;
  composerPlaceholder?: string;
  autoFocusComposer?: boolean;
}) {
  const { data, isLoading, error, refetch } = useMainChat(scope);
  const newChat = useNewMainChat(scope);
  const sessionId = data?.session.id ?? null;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-8">
        <div>
          <p className="text-[12px] font-semibold text-foreground">
            {scope === null ? 'Couldn\u2019t load the orchestrator chat.' : 'Couldn\u2019t load this agent\u2019s chat.'}
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            {error instanceof ApiError
              ? ((error.body as { error?: string } | null)?.error ?? error.message)
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
    <HarnessChatSession
      sessionId={sessionId}
      isMobile={isMobile}
      composerPlaceholder={composerPlaceholder}
      autoFocusComposer={autoFocusComposer}
      onSwitchProvider={(next) => newChat.mutate({
        providerId: next.harness,
        model: next.model,
        variant: next.variant,
        effort: next.effort,
      })}
      switchingProvider={newChat.isPending}
    />
  );
}

/**
 * The harness chat surface for a single session id — transcript +
 * pending-input + composer, no workspace chrome. Reused by both the
 * dashboard orchestrator chat (above) and the in-document (note/task)
 * `type='content'` chat (see slideout-chat.tsx). Everything it needs is
 * keyed off the session id, so the same component drives either.
 */
export function HarnessChatSession({
  sessionId,
  isMobile = false,
  autoFocusComposer = true,
  composerPlaceholder,
  onSwitchProvider,
  switchingProvider,
}: {
  sessionId: string;
  isMobile?: boolean;
  /** Placeholder for the composer. The agent-first entity view passes
   *  document-specific teaching copy; executions keep the default. */
  composerPlaceholder?: string;
  /** Auto-focus the composer on mount. Defaults to true (executions). The
   *  slideout document-chat passes false so the composer doesn't steal focus
   *  from the task/note title. */
  autoFocusComposer?: boolean;
  /** Optional: enables the composer's provider switcher (starts a fresh chat
   *  on the chosen provider). The host owns what "new chat" means. */
  onSwitchProvider?: (next: {
    harness: HarnessId;
    model: string;
    variant?: string;
    effort?: EffortLevel;
  }) => void;
  switchingProvider?: boolean;
}) {
  const { data: session } = useSession(sessionId);
  const { data: runtime } = useRuntimeStatus(sessionId);
  // Live event stream — appends rows into the events cache as the
  // executor writes them (same transport as the execution view).
  useSessionStream(sessionId);
  // Catch up to the harness's on-disk transcript after server restarts.
  const { reconciling } = useSessionReconcile(sessionId);
  const sendMessage = useSendMessage(sessionId);
  const interruptSession = useInterruptSession(sessionId);
  const isRunning = runtime?.running ?? false;

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

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ChatDropZone
      className="flex flex-1 min-h-0 flex-col"
      onFiles={(files) => {
        for (const f of files) void composerHandleRef.current?.uploadFile(f);
        composerHandleRef.current?.focus({ end: true });
      }}
    >
      {reconciling && <SyncingPill />}
      <ExecutionTranscript
        session={session}
        workspace={undefined}
        isRunning={isRunning}
        voiceSentIds={voiceSentIds}
      />
      <div className="flex-shrink-0 bg-background">
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
          harness={session.harness}
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
          onStop={async () => {
            await interruptSession.mutateAsync();
          }}
        />
      </div>
    </ChatDropZone>
  );
}
