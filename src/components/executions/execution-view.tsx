'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSession, useSendMessage, useRuntimeStatus, useInterruptSession } from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';
import { useSessionReconcile } from '@/hooks/use-session-reconcile';
import { useWorkspace, useMarkSessionRead } from '@/hooks/use-workspaces';
import type { RailResponse } from '@/lib/api/sessions';
import { isSessionUnread, latestActivityAt } from '@/lib/utils/session-sort';
import { ExecutionHeader } from './execution-header';
import { ExecutionTranscript } from './execution-transcript';
import { ExecutionComposer } from './execution-composer';
import { ExecutionContextPane } from './execution-context-pane';
import { ExecutionTerminalPanel } from './execution-terminal-panel';
import { DiffSlideout } from './diff-slideout';
import { PendingInputArea } from './pending-input-overlay';
import { SyncingPill } from './syncing-pill';
import { WipHandoffBanner } from './wip-handoff-banner';

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
  // Live chat-event stream: appends rows into the events cache as the
  // executor (or any other write path) inserts them. Replaces the 3s
  // poll that used to live in `useSessionEvents`.
  useSessionStream(sessionId);
  // Catch up to the on-disk Claude JSONL on open. Fires the POST in
  // the background; the indicator below renders only if the server
  // actually finds drift and starts a replay (server pushes
  // `reconcile: started` over SSE).
  const { reconciling } = useSessionReconcile(sessionId);
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

  // Events and runtime-status come through the SSE stream in order, so
  // the thinking-vs-message race is gone. Diff state, though, isn't
  // streamed — it's computed on-demand from git. Kick diff (and the
  // session row, which carries derived metadata) on the running → idle
  // transition so a turn ending repaints the changed-files panel
  // without waiting for the user to touch anything.
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (!sessionId) return;
    if (prevRunningRef.current && !isRunning) {
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'diff'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, sessionId, qc]);

  // Diff slideout state — opening file from context pane.
  const [diffFile, setDiffFile] = useState<string | null>(null);

  // Voice-sent event ids tracked in client memory for this open session.
  // Lost on reload by design — same model the orchestrator uses. The
  // VoiceSentBadge is a soft signal, not a permanent attribute, so we
  // don't persist it. The set only grows; nothing removes ids.
  const [voiceSentIds, setVoiceSentIds] = useState<Set<string>>(() => new Set());

  // Bottom terminal dock — closed by default. Open state is per-session
  // ephemeral; refreshing closes the panel even though the PTYs keep
  // running on the server (they'll show up again next time the user
  // opens the dock on this session).
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Navigate-away read receipt. The composer fires markRead eagerly on
  // focus and send, so all engaged-then-leave cases are covered already.
  // This cleanup handles the remaining case: "user entered an unread
  // chat, looked at it, left without engaging." We mark read only if
  // the unread state at leave is the SAME one that was there at entry —
  // i.e., no new activity landed during the visit.
  //
  // Snapshot at mount: if the chat is currently unread, capture the
  // latest-activity timestamp. On leave, if that timestamp hasn't moved
  // and the chat is still unread, the user saw what was there — clear
  // the unread. If the timestamp moved (agent did another turn, an
  // unread marker landed) the user didn't see the new content, so we
  // leave it unread for next time.
  //
  // We snapshot from the rail cache, which the dashboard always has
  // loaded. If by some race the cache is empty (direct URL entry, etc.)
  // we fall back to the safe peek default — never mark read.
  const markRead = useMarkSessionRead();
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const entryActivityRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    entryActivityRef.current = null;
    const rail = qc.getQueryData<RailResponse>(['sessions', 'rail']);
    const entry = rail?.sessions.find((s) => s.id === sessionId);
    if (entry && isSessionUnread(entry)) {
      entryActivityRef.current = latestActivityAt(entry);
    }
    return () => {
      const snapshot = entryActivityRef.current;
      if (!snapshot) return;
      const railNow = qc.getQueryData<RailResponse>(['sessions', 'rail']);
      const entryNow = railNow?.sessions.find((s) => s.id === sessionId);
      if (!entryNow) return;
      if (!isSessionUnread(entryNow)) return;
      if (latestActivityAt(entryNow) !== snapshot) return;
      markReadRef.current.mutate(sessionId);
    };
  }, [sessionId, qc]);

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
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex flex-1 min-w-0 min-h-0">
        <div className="flex flex-col flex-1 min-w-0 bg-background">
          <ExecutionHeader session={session} workspace={workspace} onClose={handleClose} />
          {workspace?.is_git && !!session.worktree_path && (
            <WipHandoffBanner sessionId={session.id} worktreeReady={!!session.worktree_path} />
          )}
          {reconciling && <SyncingPill />}
          <ExecutionTranscript
            session={session}
            workspace={workspace}
            isRunning={isRunning}
            voiceSentIds={voiceSentIds}
          />
          {/* Pending input + composer share a single top border so they
              read as one connected input region. PendingInputArea returns
              null when nothing's pending, in which case the composer is
              the sole child and the wrapper is just a thin border. */}
          <div className="flex-shrink-0 border-t border-border bg-background">
            <PendingInputArea sessionId={session.id} />
            <ExecutionComposer
              sessionId={session.id}
              permissionMode={session.permission_mode}
              model={session.model}
              effort={session.effort}
              harness={session.agent_harness ?? null}
              disabled={composerDisabled}
              disabledReason={composerDisabledReason}
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
              onStop={async () => { await interruptSession.mutateAsync(); }}
            />
          </div>
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

      {/* Terminal dock — full width below the chat + context pane. Only
          rendered for sessions that have a resolvable cwd (worktree or
          workspace.cwd). Disabled while the worktree is provisioning so
          we don't spawn a shell in the wrong directory. */}
      {session.workspace_id && (
        <div className="flex-shrink-0 hidden lg:block">
          <ExecutionTerminalPanel
            sessionId={session.id}
            open={terminalOpen}
            onToggle={() => setTerminalOpen((v) => !v)}
            disabled={isSettingUp}
            disabledReason={isSettingUp ? 'Setting up worktree…' : undefined}
          />
        </div>
      )}
    </div>
  );
}
