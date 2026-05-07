'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSession, useSendMessage, useRuntimeStatus, useInterruptSession } from '@/hooks/use-execution';
import { useWorkspace, useMarkSessionViewed } from '@/hooks/use-workspaces';
import { ExecutionHeader } from './execution-header';
import { ExecutionTranscript } from './execution-transcript';
import { ExecutionComposer } from './execution-composer';
import { ExecutionContextPane } from './execution-context-pane';
import { DiffSlideout } from './diff-slideout';

interface ExecutionViewProps {
  sessionId: string;
}

/**
 * The right-side surface when the user has an execution selected.
 * Replaces the dashboard's PanelLayout. Three regions:
 *
 *   - Header (top): workspace + label + branch + status + close.
 *   - Main: transcript scroller + composer at bottom (chat surface).
 *   - Right pane: files changed + actions + metadata (context pane).
 *
 * Marks the session as viewed on open so it leaves the Needs Review
 * surface — opening the session is the read receipt.
 */
export function ExecutionView({ sessionId }: ExecutionViewProps) {
  const { setActiveView, setSessionStreaming } = useDashboard();
  const qc = useQueryClient();
  const { data: session, isLoading, error } = useSession(sessionId);
  const { data: workspace } = useWorkspace(session?.workspace_id ?? null);
  const { data: runtime } = useRuntimeStatus(sessionId);
  const markViewed = useMarkSessionViewed();
  const sendMessage = useSendMessage(sessionId);
  const interruptSession = useInterruptSession(sessionId);
  const isRunning = runtime?.running ?? false;

  // Setting-up state: dispatch creates the chat_session row immediately
  // and provisions the worktree in the background (~2-5s for `git
  // worktree add` + fromSource apply). Until worktree_path lands on the
  // row we render the SettingUp variant of the SetupCard. The row gets
  // updated by the server, so we poll the session query.
  const isSettingUp =
    !!session && !!workspace && workspace.is_git === true && !session.worktree_path;

  useEffect(() => {
    if (!isSettingUp || !sessionId) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    }, 1500);
    return () => clearInterval(id);
  }, [isSettingUp, sessionId, qc]);

  // Mirror server runtime state into the dashboard's streamingSessionIds
  // so the rail's "● working" badge and other consumers stay in sync.
  useEffect(() => {
    if (!sessionId) return;
    setSessionStreaming(sessionId, isRunning);
  }, [sessionId, isRunning, setSessionStreaming]);

  // Diff slideout state — opening file from context pane.
  const [diffFile, setDiffFile] = useState<string | null>(null);

  useEffect(() => {
    if (sessionId) markViewed.mutate(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleClose = () => setActiveView('command');

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-8">
        <div>
          <p className="text-[12px] font-semibold text-foreground">Execution not found.</p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            It may have been archived or deleted.
          </p>
          <button
            onClick={handleClose}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  const isArchived = session.status === 'archived';
  // While running, leave the composer enabled so the stop button reads
  // as active (it lives in the send slot). The send button itself
  // doesn't render — `isRunning` swaps it for stop in the composer.
  const composerDisabled = isArchived || isSettingUp;
  const composerDisabledReason = isSettingUp
    ? 'Setting up worktree…'
    : isArchived
      ? 'This execution is archived.'
      : undefined;

  return (
    <div className="flex flex-1 min-w-0">
      <div className="flex flex-col flex-1 min-w-0 bg-background">
        <ExecutionHeader session={session} workspace={workspace} onClose={handleClose} />
        <ExecutionTranscript session={session} workspace={workspace} isRunning={isRunning} />
        <ExecutionComposer
          sessionId={session.id}
          disabled={composerDisabled}
          disabledReason={composerDisabledReason}
          isRunning={isRunning}
          onSend={async (content) => { await sendMessage.mutateAsync(content); }}
          onStop={async () => { await interruptSession.mutateAsync(); }}
        />
      </div>

      {/* Context pane + diff slideout are desktop-only — on mobile the
          execution view is just chat (header + transcript + composer).
          Hidden below lg so the chat surface gets the full width. */}
      <div className="hidden lg:contents">
        <ExecutionContextPane session={session} onOpenDiff={setDiffFile} />

        <DiffSlideout
          sessionId={session.id}
          filePath={diffFile}
          onClose={() => setDiffFile(null)}
        />
      </div>
    </div>
  );
}
