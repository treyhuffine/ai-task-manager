'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useOrchestratorChat } from '@/hooks/use-orchestrator-chat';
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
import { SyncingPill } from '@/components/executions/syncing-pill';
import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import { ApiError } from '@/lib/api/client';

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
 */
export function HarnessChat({ isMobile = false }: { isMobile?: boolean }) {
  const { data, isLoading, error, refetch } = useOrchestratorChat();
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
            Couldn&apos;t load the orchestrator chat.
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            {error instanceof ApiError ? error.message : 'Unknown error.'}
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

  return <HarnessChatSession sessionId={sessionId} isMobile={isMobile} />;
}

function HarnessChatSession({ sessionId, isMobile }: { sessionId: string; isMobile: boolean }) {
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
  markReadRef.current = markRead;
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
      <div className="flex-shrink-0 border-t border-border bg-background">
        <PendingInputArea sessionId={session.id} />
        <ExecutionComposer
          ref={composerHandleRef}
          sessionId={session.id}
          permissionMode={session.permissionMode}
          model={session.model}
          effort={session.effort}
          harness={session.agentHarness ?? null}
          submitOnEnter={!isMobile}
          isRunning={isRunning}
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
