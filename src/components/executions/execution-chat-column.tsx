'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useHomeDocumentScope } from '@/components/home/home-context';
import { DRAFT_STORAGE_PREFIX, encodeChatDraft, scopedDraftKey } from '@/components/chat/editor/draft-storage';
import type { EditorSnapshot } from '@/components/chat/editor/chat-input-editor';
import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import { AppCompanion } from '@/components/local-apps/app-companion';
import { AppCompanionButton } from '@/components/local-apps/app-companion-button';
import { ChatRecovery } from '@/components/chat-ui/chat-recovery';
import { PendingInputArea } from '@/components/chat-ui/pending-input-area';
import { BackgroundTasksBar } from '@/components/chat-ui/activity/background-tasks-bar';
import { useWorkActivity } from '@/contexts/work-context';
import {
  useInterruptSession,
  useNewExecutionChat,
  useRuntimeStatus,
  useSendMessage,
  useSession,
  useWorktreeScope,
} from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';
import { useSessionReconcile } from '@/hooks/use-session-reconcile';
import { useWorkspace } from '@/hooks/use-workspaces';
import type { EffortLevel } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';
import { preparedFolder } from '@/lib/executions/location';
import { isImportMirror } from '@/lib/import/mirror';
import { hot } from '@/lib/_debug/hot-path';
import { cn } from '@/lib/utils';
import { ExecutionTranscript } from './execution-transcript';
import { ExecutionReviewBar } from './execution-review-bar';
import { ExecutionComposer, type ExecutionComposerHandle } from './execution-composer';
import { ImportedTakeoverBar } from './imported-takeover-bar';
import { providerLabel as importedProviderLabel } from './setup-card';
import { SyncingPill } from './syncing-pill';
import { WipHandoffBanner } from './wip-handoff-banner';
import { TransferProgress } from './transfer/transfer-progress';
import { ReviewBar } from './transfer/review-bar';

/**
 * One execution chat, apart from the workbench around it: what it is, how
 * it's running, and its column (transcript, the input region, composer).
 * The execution view puts the column beside its tools, and an agent's view
 * opens it beside the agent's main chat (docs/agents-view-spec.md, "Chats
 * beside the agent"), so the conversation behaves the same in both.
 */

/**
 * The chat's live state, and the work that keeps it true while it's on
 * screen: its event stream, catching up to the harness's transcript, the
 * worktree poll while setup runs, the rail's working mirror, and a refresh
 * of what a turn may have moved on disk when it ends.
 */
export function useExecutionChat(sessionId: string) {
  const { setSessionStreaming } = useWorkActivity();
  const qc = useQueryClient();
  const { data: session, isLoading, error } = useSession(sessionId);
  const { data: workspace } = useWorkspace(session?.workspaceId ?? null);
  const { data: runtime } = useRuntimeStatus(sessionId);
  const isRunning = runtime?.running ?? false;
  const hasBackgroundTasks = runtime?.backgroundTasks ?? false;
  // Live chat-event stream: appends rows into the events cache as the
  // executor (or any other write path) inserts them.
  useSessionStream(sessionId);
  // Catch up to the on-disk Claude JSONL on open. The indicator renders
  // only if the server actually finds drift and starts a replay.
  const { reconciling } = useSessionReconcile(sessionId);

  // Cache scope for everything read off the worktree. Execution-keyed, so
  // it holds steady while the user hops between this execution's chats.
  const worktreeScope = useWorktreeScope(sessionId);

  // Its folder wherever it runs: the worktree here, or the one its device
  // prepared (P3.1).
  const folder = session ? preparedFolder(session) : null;

  // Setting-up state: dispatch creates the chat_session row immediately
  // and provisions the worktree in the background (~2-5s for `git
  // worktree add` + fromSource apply). Until the folder lands on the row
  // the worktree views show a placeholder and the composer waits. The row
  // gets updated by the server, so we poll the session query.
  const isSettingUp = !!session && !!workspace && workspace.isGit === true && !folder;

  // The setup script runs in the background AFTER the worktree is ready, so
  // keep polling through it too, otherwise the "Running setup script…" row
  // never clears (and a failure never surfaces) without a manual refresh.
  const isSetupScriptRunning = session?.setupScriptStatus === 'running';

  useEffect(() => {
    hot('effect ExecutionChat.isSettingUp-poll');
    if (!isSettingUp && !isSetupScriptRunning) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    }, 1500);
    return () => clearInterval(id);
  }, [isSettingUp, isSetupScriptRunning, sessionId, qc]);

  // Mirror server runtime state into the dashboard's streamingSessionIds
  // so the rail's "● working" badge and other consumers stay in sync.
  useEffect(() => {
    hot('effect ExecutionChat.mirror-streaming');
    setSessionStreaming(sessionId, isRunning);
    return () => setSessionStreaming(sessionId, false);
  }, [sessionId, isRunning, setSessionStreaming]);

  // Events and runtime-status come through the SSE stream in order. Diff
  // state, though, isn't streamed. Refresh it and the session metadata
  // whenever either the root turn or detached child work ends. A child can
  // keep editing after the root result, so the background edge needs its
  // own refresh.
  const prevRunningRef = useRef(isRunning);
  const prevBackgroundTasksRef = useRef(hasBackgroundTasks);
  useEffect(() => {
    hot('effect ExecutionChat.runtime-edge');
    const rootEnded = prevRunningRef.current && !isRunning;
    const backgroundEnded = prevBackgroundTasksRef.current && !hasBackgroundTasks;
    prevRunningRef.current = isRunning;
    prevBackgroundTasksRef.current = hasBackgroundTasks;

    if (!rootEnded && !backgroundEnded) return;
    if (worktreeScope) {
      // One prefix covers diff / tree / status / pr: everything the turn
      // or detached child may have moved on disk.
      qc.invalidateQueries({ queryKey: worktreeScope });
    }
    // Plus the row itself for its derived metadata. `exact` keeps this off
    // the transcript, whose events already arrive over SSE.
    qc.invalidateQueries({ queryKey: ['session', sessionId], exact: true });
  }, [isRunning, hasBackgroundTasks, sessionId, worktreeScope, qc]);

  return { session, isLoading, error, workspace, runtime, isRunning, hasBackgroundTasks, reconciling, worktreeScope, folder, isSettingUp };
}

export type ExecutionChatState = ReturnType<typeof useExecutionChat>;

type ProviderChoice = {
  harness: HarnessId;
  model: string;
  variant?: string;
  effort?: EffortLevel;
  serviceTier?: string;
};

/**
 * Start a fresh chat on this chat's execution (the tab strip's New chat,
 * and the composer's provider switcher), carrying over a draft if there is
 * one, then open it where the caller shows chats.
 */
export function useStartExecutionChat(sessionId: string, open: (chatId: string) => void) {
  const newExecutionChat = useNewExecutionChat(sessionId);
  const draftScope = useHomeDocumentScope();
  const start = (choice?: ProviderChoice, draft?: EditorSnapshot | null) => {
    const opts = choice
      ? { providerId: choice.harness, model: choice.model, variant: choice.variant, effort: choice.effort, serviceTier: choice.serviceTier }
      : undefined;
    newExecutionChat
      .mutateAsync(opts)
      .then((r) => {
        if (draft) {
          try {
            window.localStorage.setItem(
              `${DRAFT_STORAGE_PREFIX}${scopedDraftKey(`exec:${r.session.id}`, draftScope)}`,
              encodeChatDraft(scopedDraftKey(`exec:${r.session.id}`, draftScope), draft.doc),
            );
          } catch {
            // Draft persistence is best-effort when storage is unavailable.
          }
        }
        open(r.session.id);
      })
      .catch(() => { });
  };
  return { start, isPending: newExecutionChat.isPending };
}

/**
 * The chat column: transcript, the input region (pending questions, then
 * running background work as a strip attached to the top of the composer)
 * and the composer.
 *
 * Render it once `chat.session` has loaded. `clearBox` pads the parts a
 * floating overlay (the workbench's tools box) would cover. The transcript pads its scrolling element rather than its
 * frame, so the scrollbar stays at the column's far right edge.
 */
export function ExecutionChatColumn({
  chat,
  composerRef,
  submitOnEnter,
  autoFocus,
  tabs,
  overlay,
  clearBox,
  composerDisabledReason,
  notice,
  placeholder,
  onSwitchProvider,
  switchingProvider,
}: {
  chat: ExecutionChatState;
  composerRef: RefObject<ExecutionComposerHandle | null>;
  /** Desktop submits on Enter. The phone inserts a newline, and the send button submits. */
  submitOnEnter: boolean;
  autoFocus?: boolean;
  /** Above the conversation: the execution's sibling chats, in the workbench. */
  tabs?: ReactNode;
  /** Floats over the column, such as the workbench's tools box. */
  overlay?: ReactNode;
  clearBox?: string;
  /** Holds the composer with this reason, over the chat's own (resuming, setting up, imported). */
  composerDisabledReason?: string;
  /** Above the composer, at the top of the input region. */
  notice?: ReactNode;
  /** The composer's placeholder, where the default doesn't fit the place. */
  placeholder?: string;
  onSwitchProvider?: (next: ProviderChoice, draft?: EditorSnapshot | null) => void;
  switchingProvider?: boolean;
}) {
  const { workspace, runtime, isRunning, reconciling, folder, isSettingUp } = chat;
  // Rendered once the chat's row has loaded.
  const session = chat.session!;
  const sendMessage = useSendMessage(session.id);
  const interruptSession = useInterruptSession(session.id);

  // Voice-sent event ids tracked in client memory for this open session.
  // Lost on reload by design. The set only grows.
  const [voiceSentIds, setVoiceSentIds] = useState<Set<string>>(() => new Set());

  // While running, leave the composer enabled so the stop button reads
  // as active (it lives in the send slot).
  //
  // Archived: covers the brief window before a resume succeeds, to avoid a
  // 400 from a very fast send.
  //
  // An imported chat mirrors a session this app doesn't drive. Sending would
  // spawn an agent with none of the context shown above it, so the composer
  // stays locked until the user takes the chat over on purpose.
  const isMirroredImport = isImportMirror(session);
  const ownReason = session.status === 'archived'
    ? 'Resuming…'
    : isSettingUp
      ? 'Setting up worktree…'
      : isMirroredImport
        ? 'Continue here to reply'
        : undefined;
  const disabledReason = composerDisabledReason ?? ownReason;
  const composerDisabled = !!disabledReason;

  return (
    <AppCompanion chatId={session.id} surfaceKind={session.surfaceKind}>
    <ChatDropZone
      className="flex flex-1 min-h-0 flex-col"
      onFiles={(files) => {
        for (const f of files) void composerRef.current?.uploadFile(f);
        composerRef.current?.focus({ end: true });
      }}
      disabled={composerDisabled}
    >
      {tabs}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {workspace?.isGit &&
          !!folder &&
          folder !== workspace.cwd && (
            // Skip for Live / in-place sessions: their "worktree" IS the source
            // checkout, so no WIP ever "stayed behind".
            <div className={clearBox}>
              <WipHandoffBanner sessionId={session.id} worktreeReady={!!folder} />
            </div>
          )}
        {reconciling && (
          <div className={clearBox}>
            <SyncingPill />
          </div>
        )}
        <ExecutionTranscript
          session={session}
          workspace={workspace}
          isRunning={isRunning}
          voiceSentIds={voiceSentIds}
          scrollClassName={clearBox}
        />
        {session.executionId && !isRunning && (
          <div className={clearBox}>
            <ExecutionReviewBar executionId={session.executionId} />
          </div>
        )}
        {/* The input region: pending questions, then running background
            work as a strip attached to the top of the composer. No rule
            above it, so it reads as one piece with the conversation. */}
        <div className={cn('flex-shrink-0 bg-background', clearBox)}>
          {/* A move to another device, while it runs or once it stopped (P4.2). */}
          <div className="space-y-1.5 px-3 pt-2 empty:hidden">
            <TransferProgress sessionId={session.id} />
            <ReviewBar session={session} workspace={workspace} />
          </div>
          {notice}
          <ChatRecovery sessionId={session.id} runtime={runtime} />
          <PendingInputArea sessionId={session.id} />
          {isMirroredImport && (
            <ImportedTakeoverBar
              sessionId={session.id}
              providerLabel={importedProviderLabel(session.surfaceRef)}
              cwd={workspace?.cwd ?? null}
            />
          )}
          <BackgroundTasksBar
            sessionId={session.id}
            runtimeHasBackgroundTasks={runtime?.backgroundTasks}
            runtimeBackgroundTaskIds={runtime?.backgroundTaskIds}
          />
          <ExecutionComposer
            ref={composerRef}
            sessionId={session.id}
            autoFocus={autoFocus}
            placeholder={placeholder}
            permissionMode={session.permissionMode}
            model={session.model}
            modelVariant={session.modelVariant}
            effort={session.effort}
            serviceTier={session.serviceTier}
            harness={session.harness}
            leadingActions={<AppCompanionButton chatId={session.id} surfaceKind={session.surfaceKind} />}
            disabled={composerDisabled}
            disabledReason={disabledReason}
            submitOnEnter={submitOnEnter}
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
            onStop={runtime?.canStop ? async () => { await interruptSession.mutateAsync(); } : undefined}
          />
        </div>
        {overlay}
      </div>
    </ChatDropZone>
    </AppCompanion>
  );
}
