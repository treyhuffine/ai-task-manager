'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSession, useSendMessage, useRuntimeStatus, useInterruptSession, useContinueSession, useNewExecutionChat } from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';
import { useSessionReconcile } from '@/hooks/use-session-reconcile';
import { useWorkspace, useMarkSessionRead } from '@/hooks/use-workspaces';
import {
  useExecutionLayoutSizes,
  HORIZONTAL_PANEL_IDS,
  VERTICAL_PANEL_IDS,
} from '@/hooks/use-execution-layout-sizes';
import type { RailResponse } from '@/lib/api/sessions';
import { isSessionUnread, latestActivityAt } from '@/lib/utils/session-sort';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { ExecutionHeader } from './execution-header';
import { ExecutionTranscript } from './execution-transcript';
import { ExecutionComposer, type ExecutionComposerHandle } from './execution-composer';
import { BackgroundTasksBar } from './background-tasks-bar';
import { ExecutionTerminalPanel } from './execution-terminal-panel';
import { PendingInputArea } from './pending-input-overlay';
import { SyncingPill } from './syncing-pill';
import { WipHandoffBanner } from './wip-handoff-banner';
import { FileTree } from './file-tree/file-tree';
import { ViewerArea } from './viewer-area';
import { useInitialSelectedFile } from './viewer/use-initial-selected-file';
import { useOpenFileListener, toWorktreeRelative } from '@/lib/entity-refs/open-file-event';
import { ExecutionActionBar } from './action-bar/execution-action-bar';
import { TakeoverBanner } from './takeover/takeover-banner';
import { SetupPlaceholder } from './setup-placeholder';
import { ExecutionSkeleton } from './execution-skeleton';
import { ReferencesPane } from './references-pane';
import { ScratchpadPane } from './scratchpad-pane';
import { useOpenReferenceListener } from '@/lib/entity-refs/open-event';
import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import { hot } from '@/lib/_debug/hot-path';

interface ExecutionViewProps {
  sessionId: string;
}

/**
 * The right-side surface when the user has an execution selected.
 * Three horizontal columns (chat / file tree / viewer+terminal), each
 * resizable. The right column splits vertically (viewer over terminal).
 *
 * Marks the session as viewed on open so it leaves the Needs Review
 * surface — opening the session is the read receipt.
 */
export function ExecutionView({ sessionId }: ExecutionViewProps) {
  const { setActiveView, setActiveExecutionId, setSessionStreaming } = useDashboard();
  const qc = useQueryClient();
  const { data: session, isLoading, error } = useSession(sessionId);
  const { data: workspace } = useWorkspace(session?.workspaceId ?? null);
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

  // Tell the rail which execution is open so its (one-row-per-execution)
  // workspace-tree row stays highlighted even when the active chat is a
  // sibling, not the execution's primary chat. Cleared on unmount.
  useEffect(() => {
    setActiveExecutionId(session?.executionId ?? null);
  }, [session?.executionId, setActiveExecutionId]);
  useEffect(() => () => setActiveExecutionId(null), [setActiveExecutionId]);
  const sendMessage = useSendMessage(sessionId);
  const interruptSession = useInterruptSession(sessionId);
  const continueWork = useContinueSession(sessionId);
  const newExecutionChat = useNewExecutionChat(sessionId);
  const isRunning = runtime?.running ?? false;

  // Start a fresh chat on this execution's worktree (the "New chat" button and
  // the composer's provider switcher), then navigate to it. Provider switch
  // passes { providerId, model }; a plain new chat passes nothing.
  const startNewChat = (opts?: { providerId?: 'claude' | 'codex'; model?: string | null }) => {
    newExecutionChat
      .mutateAsync(opts ?? undefined)
      .then((r) => setActiveView(r.session.id))
      .catch(() => {});
  };

  // Conductor-style auto-resume: opening an archived execution is the
  // signal to reopen — fire `continue` once on mount so the row flips to
  // active and a fresh worktree provisions in the background. By the time
  // the user reads a few lines of transcript and decides to type, the
  // worktree is usually already there. The existing setting-up state
  // (driven by `isSettingUp` above) covers the wait.
  //
  // Doing this on view (rather than on send, which we tried first) avoids
  // a multi-second hiccup between hitting send and the agent actually
  // dispatching. The user-perceived latency hides inside the page
  // transition, matching the way Conductor handles archived sessions.
  //
  // Per-session ref guards against re-fire after the mutation succeeds
  // and the cache refetches (status will be 'active' on the next render,
  // so the gate would self-clear anyway; the ref is belt-and-suspenders
  // against transient errors that leave status='archived').
  const resumedSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !sessionId) return;
    if (resumedSessionIdRef.current === sessionId) return;
    resumedSessionIdRef.current = sessionId;
    if (session.status === 'archived') {
      continueWork.mutate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, sessionId]);

  // Persisted resizable column / row sizes — per-session in localStorage.
  const {
    horizontal,
    vertical,
    terminalOpenPct,
    setHorizontal,
    setVertical,
    setTerminalOpenPct,
  } = useExecutionLayoutSizes(sessionId);

  // Setting-up state: dispatch creates the chat_session row immediately
  // and provisions the worktree in the background (~2-5s for `git
  // worktree add` + fromSource apply). Until worktreePath lands on the
  // row we render the SettingUp variant of the SetupCard. The row gets
  // updated by the server, so we poll the session query.
  const isSettingUp =
    !!session && !!workspace && workspace.isGit === true && !session.worktreePath;

  // Gate for the terminal panel's auto-spawn. The terminal's cwd resolves
  // to the session's worktree, but `workspace` loads from a separate query
  // than `session` — so there's a window where the session is ready while
  // `workspace` is still `undefined`. In that window `isSettingUp` is false
  // (it needs `workspace.isGit === true`), so without this guard the panel
  // would auto-create a terminal before we know the worktree state and the
  // server would resolve cwd to the workspace's main checkout. The spawned
  // PTY's cwd is frozen for its lifetime, so that lands the user in the
  // main repo for good. Treat "workspace not loaded yet" as not-ready.
  const terminalNotReady =
    isSettingUp || (!!session?.workspaceId && workspace === undefined);

  // The setup script runs in the background AFTER the worktree is ready, so
  // keep polling through it too — otherwise the "Running setup script…" row
  // never clears (and a failure never surfaces) without a manual refresh.
  const isSetupScriptRunning = session?.setupScriptStatus === 'running';

  useEffect(() => {
    hot('effect ExecutionView.isSettingUp-poll');
    if ((!isSettingUp && !isSetupScriptRunning) || !sessionId) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    }, 1500);
    return () => clearInterval(id);
  }, [isSettingUp, isSetupScriptRunning, sessionId, qc]);

  // Mirror server runtime state into the dashboard's streamingSessionIds
  // so the rail's "● working" badge and other consumers stay in sync.
  useEffect(() => {
    hot('effect ExecutionView.mirror-streaming');
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
    hot('effect ExecutionView.running-edge');
    if (!sessionId) return;
    if (prevRunningRef.current && !isRunning) {
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'diff'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'tree'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, sessionId, qc]);

  // Worktree just landed (provisioning finished) → pull the file tree + diff
  // immediately. The tree was fetched empty while `worktreePath` was null, and
  // nothing else refetches it on this transition — so without this it sits on
  // "No files" until the 30s tree poll, which reads as slow-and-empty.
  const prevWorktreeRef = useRef(!!session?.worktreePath);
  useEffect(() => {
    hot('effect ExecutionView.worktree-edge');
    const has = !!session?.worktreePath;
    const justLanded = !prevWorktreeRef.current && has && !!sessionId;
    prevWorktreeRef.current = has;
    if (!justLanded) return;
    qc.invalidateQueries({ queryKey: ['session', sessionId, 'tree'] });
    qc.invalidateQueries({ queryKey: ['session', sessionId, 'diff'] });
    // The background copy (.env etc.) lands a beat after the worktree itself —
    // pull the tree again so those files appear without waiting out the 30s
    // poll. (The setup-script poll covers slower, longer-running output.)
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ['session', sessionId, 'tree'] }), 2500);
    return () => clearTimeout(t);
  }, [session?.worktreePath, sessionId, qc]);

  // Voice-sent event ids tracked in client memory for this open session.
  // Lost on reload by design — same model the orchestrator uses. The
  // VoiceSentBadge is a soft signal, not a permanent attribute, so we
  // don't persist it. The set only grows; nothing removes ids.
  const [voiceSentIds, setVoiceSentIds] = useState<Set<string>>(() => new Set());

  // Selected file path in the file tree / viewer pair. Lifted here so
  // the tree and viewer can render in different columns and still share
  // selection state.
  //
  // Reset on session change. ExecutionView is mounted once and just
  // re-renders when sessionId changes (no `key={sessionId}` upstream),
  // so without this reset, a file picked in execution A would leak
  // into execution B — and useInitialSelectedFile's "already selected"
  // early-return would suppress picking a fresh default for B.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const lastSelectedSessionRef = useRef(sessionId);
  if (lastSelectedSessionRef.current !== sessionId) {
    lastSelectedSessionRef.current = sessionId;
    setSelectedPath(null);
  }

  // Monotonic signal the ViewerArea watches to know "the user *intentionally*
  // picked a file" — distinct from the auto-seed that `useInitialSelectedFile`
  // does on mount. Bumped here in the tree's onSelect path; ViewerArea
  // swaps to its Files tab when this changes. Closing a file (onSelect(null))
  // does NOT bump it — closing isn't a request to view files.
  const [filePickSignal, setFilePickSignal] = useState(0);
  const handleFilePicked = (path: string | null) => {
    setSelectedPath(path);
    if (path) setFilePickSignal((n) => n + 1);
  };

  // Transcript file chips fire `flow:open-file` (a window event) when
  // clicked; route it to the same tree/viewer selection the file tree
  // uses, normalizing absolute tool-input paths to worktree-relative.
  useOpenFileListener(
    useCallback(
      (detail) => {
        const rel = toWorktreeRelative(detail.path, session?.worktreePath ?? null);
        if (!rel) return;
        setSelectedPath(rel);
        setFilePickSignal((n) => n + 1);
      },
      [session?.worktreePath],
    ),
  );

  // Lets the file tree drop an `@<path>` token into the composer when
  // the user picks "Reference in chat" from a row's kebab. The composer
  // exposes a narrow imperative handle; we hold it here so the tree
  // doesn't need to know how to reach the composer otherwise.
  const composerHandleRef = useRef<ExecutionComposerHandle | null>(null);
  const handleReferenceFileInChat = (relativePath: string) => {
    composerHandleRef.current?.insertTextAtCursor(`@${relativePath} `);
    composerHandleRef.current?.focus({ end: true });
  };

  // Slide-over panes that overlay the tree + viewer columns. One at a
  // time — opening references closes the scratchpad and vice versa.
  // Clicking the active pane's button again toggles it closed.
  const [activePane, setActivePane] = useState<'references' | 'scratchpad' | null>(null);
  const toggleReferences = useCallback(
    () => setActivePane((p) => (p === 'references' ? null : 'references')),
    [],
  );
  const toggleScratchpad = useCallback(
    () => setActivePane((p) => (p === 'scratchpad' ? null : 'scratchpad')),
    [],
  );
  const closePane = useCallback(() => setActivePane(null), []);

  // Reset pane when session changes so a pane left open on session A
  // doesn't leak into session B's viewer column.
  const lastPaneSessionRef = useRef(sessionId);
  if (lastPaneSessionRef.current !== sessionId) {
    lastPaneSessionRef.current = sessionId;
    if (activePane !== null) setActivePane(null);
  }

  // Transcript chips fire `flow:open-reference` events on click; surface
  // the references pane so the user can browse / open the entity
  // without losing chat state.
  useOpenReferenceListener(
    useCallback(() => {
      setActivePane('references');
    }, []),
  );

  // Composer-bound chip insertion used by both panes. Lives here so the
  // pane components don't have to know about the editor's command API.
  const handleInsertChip = useCallback(
    (attrs: { kind: 'task' | 'note' | 'scratchpad'; id: string; title: string; status?: string }) => {
      composerHandleRef.current?.insertEntityChip(attrs);
      composerHandleRef.current?.focus({ end: true });
    },
    [],
  );
  const handleInsertText = useCallback((text: string) => {
    composerHandleRef.current?.insertTextAtCursor(text);
    composerHandleRef.current?.focus({ end: true });
  }, []);

  // Terminal collapse state. We manage open/closed ourselves rather than
  // using the library's `collapsible` + `collapsedSize` props — those store
  // the "expand-to" size at the moment of toggle, which conflates "user
  // dragged to a tiny size" with "user clicked collapse" and produces
  // wildly inconsistent open heights on the next toggle. Instead the panel
  // has `minSize="32px"` (the tab strip can never disappear) and we snap
  // it between exactly two sizes: 32px (closed) and `terminalOpenPct`
  // (open, persisted across reloads).
  const terminalPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  // Read-the-latest ref so the toggle doesn't capture a stale openPct
  // from the closure it was created with.
  const terminalOpenPctRef = useRef(terminalOpenPct);
  terminalOpenPctRef.current = terminalOpenPct;
  const handleToggleTerminal = () => {
    const panel = terminalPanelRef.current;
    if (!panel) return;
    const size = panel.getSize();
    if (size.inPixels > 40) {
      // Open → closed. Remember the current size so the next expand
      // restores to where the user had it.
      setTerminalOpenPct(size.asPercentage);
      panel.resize('32px');
    } else {
      panel.resize(`${terminalOpenPctRef.current}%`);
    }
  };
  const handleVerticalLayoutChanged = (layout: Parameters<typeof setVertical>[0]) => {
    setVertical(layout);
    // Track the user's preferred open height from drag commits — but only
    // when the terminal is actually in its open state. We read the
    // panel's rendered pixel size directly rather than `terminalCollapsed`
    // because the React state hasn't necessarily been updated yet when
    // the library first fires this callback on mount.
    const panel = terminalPanelRef.current;
    if (!panel) return;
    if (panel.getSize().inPixels <= 40) return;
    const t = layout[VERTICAL_PANEL_IDS.terminal];
    if (typeof t === 'number' && Number.isFinite(t)) {
      setTerminalOpenPct(t);
    }
  };

  // Seed the initial selection from the agent's most recent file-touch
  // tool call (falling back to the most recently changed file) so the
  // user lands on something meaningful when they open the view.
  useInitialSelectedFile(sessionId, selectedPath, setSelectedPath);

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
    // Mirror the real 3-column layout while the session record loads,
    // sized off the user's persisted column widths so the swap from
    // skeleton → content is content-only (no panel reflow / jump).
    // Mobile collapses to chat-only inside the skeleton itself.
    return <ExecutionSkeleton horizontal={horizontal} vertical={vertical} />;
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

  // While running, leave the composer enabled so the stop button reads
  // as active (it lives in the send slot). The send button itself
  // doesn't render — `isRunning` swaps it for stop in the composer.
  //
  // Archived: covers the brief window between mount and the auto-resume
  // mutation succeeding. As soon as `continueWork` flips the row to
  // `active` and clears `worktreePath`, the next branch (`isSettingUp`)
  // takes over and the message reads as the normal setup spinner. Avoids
  // a race where a very fast user could send during the ~200-500ms
  // round-trip and hit a 400 from `/messages`.
  const isResuming = session.status === 'archived';
  const composerDisabled = isResuming || isSettingUp;
  const composerDisabledReason = isResuming
    ? 'Resuming…'
    : isSettingUp
      ? 'Setting up worktree…'
      : undefined;

  // Chat body — WIP banner + transcript + composer. Used in both
  // desktop and mobile chat columns. The header (and on desktop, the
  // action bar) lives elsewhere; the WIP banner stays in-column so it
  // reads as part of the agent conversation rather than a full-width
  // app-wide alert.
  //
  // Parametrized by `submitOnEnter` because the same body renders in both
  // the mobile (`lg:hidden`) and desktop (`hidden lg:flex`) subtrees, and
  // they want opposite Enter semantics: the mobile composer treats Enter
  // as a newline (send via button, like a native phone keyboard); the
  // desktop composer submits on Enter. Both subtrees mount simultaneously
  // (see project_composer_double_mount), so binding the behavior to the
  // column rather than to a runtime viewport check keeps each instance
  // matched to the layout that's actually visible at its breakpoint.
  const renderChatBody = (submitOnEnter: boolean) => (
    <ChatDropZone
      className="flex flex-1 min-h-0 flex-col"
      onFiles={(files) => {
        for (const f of files) void composerHandleRef.current?.uploadFile(f);
        composerHandleRef.current?.focus({ end: true });
      }}
      disabled={composerDisabled}
    >
      {workspace?.isGit && !!session.worktreePath && (
        <WipHandoffBanner sessionId={session.id} worktreeReady={!!session.worktreePath} />
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
        <BackgroundTasksBar sessionId={session.id} />
        <PendingInputArea sessionId={session.id} />
        <ExecutionComposer
          ref={composerHandleRef}
          sessionId={session.id}
          permissionMode={session.permissionMode}
          model={session.model}
          effort={session.effort}
          harness={session.agentHarness ?? null}
          disabled={composerDisabled}
          disabledReason={composerDisabledReason}
          submitOnEnter={submitOnEnter}
          isRunning={isRunning}
          onSwitchProvider={(next) => startNewChat({ providerId: next.harness, model: next.model })}
          switchingProvider={newExecutionChat.isPending}
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
    </ChatDropZone>
  );

  // Mobile (under lg): the header, action bar (its own row), then
  // chat body. Same as the prior mobile experience — the four-column
  // layout doesn't fit on narrow viewports.
  const mobileChatColumn = (
    <div className="flex h-full flex-col min-w-0 bg-background">
      <ExecutionHeader
        session={session}
        workspace={workspace}
        onClose={handleClose}
        onToggleReferences={toggleReferences}
        onToggleScratchpad={toggleScratchpad}
        referencesOpen={activePane === 'references'}
        scratchpadOpen={activePane === 'scratchpad'}
        onNewChat={() => startNewChat()}
        newChatPending={newExecutionChat.isPending}
      />
      <TakeoverBanner session={session} />
      {workspace?.isGit && !!session.worktreePath && (
        <ExecutionActionBar session={session} workspace={workspace} />
      )}
      {/* Mobile: Enter inserts a newline; the send button submits. */}
      {renderChatBody(false)}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Mobile / tablet: single-pane chat-only view. */}
      <div className="lg:hidden flex flex-1 min-w-0 min-h-0">
        {mobileChatColumn}
      </div>

      {/* Desktop ≥lg: full-width header above a 3-column panel group.
          Header carries the action bar inline so the workspace name,
          git actions, status, and menu all sit on one row. The WIP
          banner stays in the chat column (rendered by `chatBody`). */}
      <div className="hidden lg:flex flex-col flex-1 min-w-0 min-h-0">
        <ExecutionHeader
          session={session}
          workspace={workspace}
          onClose={handleClose}
          onToggleReferences={toggleReferences}
          onToggleScratchpad={toggleScratchpad}
          referencesOpen={activePane === 'references'}
          scratchpadOpen={activePane === 'scratchpad'}
          onNewChat={() => startNewChat()}
          newChatPending={newExecutionChat.isPending}
        />
        <TakeoverBanner session={session} />
        <div className="flex flex-1 min-w-0 min-h-0 relative">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={horizontal}
          onLayoutChanged={setHorizontal}
          className="h-full w-full"
        >
          {/* Chat column. Min ~20% (≈360px on a 1800px viewport). The
              header is hoisted to the full-width row above, so here we
              just render the chat body (transcript + composer). */}
          <ResizablePanel
            id={HORIZONTAL_PANEL_IDS.chat}
            defaultSize={horizontal[HORIZONTAL_PANEL_IDS.chat]}
            minSize={20}
          >
            <div className="flex h-full flex-col min-w-0 bg-background">
              {/* Desktop: Enter submits (Shift+Enter for a newline). */}
              {renderChatBody(true)}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* File tree column. Min ~12% (≈200px on a 1800px viewport). */}
          <ResizablePanel
            id={HORIZONTAL_PANEL_IDS.tree}
            defaultSize={horizontal[HORIZONTAL_PANEL_IDS.tree]}
            minSize={12}
          >
            {isSettingUp ? (
              <SetupPlaceholder
                variant="tree"
                animated={!session.setupError}
                label={
                  session.setupError
                    ? 'Setup failed, see chat to retry'
                    : 'Preparing environment…'
                }
              />
            ) : (
              <FileTree
                sessionId={session.id}
                selectedPath={selectedPath}
                onSelect={handleFilePicked}
                worktreePath={session.worktreePath}
                onReferenceInChat={handleReferenceFileInChat}
              />
            )}
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Viewer + terminal column. Min ~24% (≈400px on a 1800px viewport).
              The references / scratchpad overlay (rendered below the
              ResizablePanelGroup) spans tree + this column when open
              so the panes cover everything except the chat. */}
          <ResizablePanel
            id={HORIZONTAL_PANEL_IDS.right}
            defaultSize={horizontal[HORIZONTAL_PANEL_IDS.right]}
            minSize={24}
          >
            <ResizablePanelGroup
              orientation="vertical"
              defaultLayout={vertical}
              onLayoutChanged={handleVerticalLayoutChanged}
              className="h-full w-full"
            >
              <ResizablePanel
                id={VERTICAL_PANEL_IDS.viewer}
                defaultSize={vertical[VERTICAL_PANEL_IDS.viewer]}
                minSize={15}
              >
                {isSettingUp ? (
                  <SetupPlaceholder
                    variant="viewer"
                    animated={!session.setupError}
                    label={
                      session.setupError
                        ? 'Setup failed, see chat to retry'
                        : 'Preparing environment…'
                    }
                  />
                ) : (
                  <ViewerArea
                    sessionId={session.id}
                    workspaceId={session.workspaceId ?? null}
                    executionId={session.executionId ?? null}
                    selectedPath={selectedPath}
                    onCloseFile={() => setSelectedPath(null)}
                    filePickSignal={filePickSignal}
                    onReferenceInChat={handleReferenceFileInChat}
                    active
                  />
                )}
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                id={VERTICAL_PANEL_IDS.terminal}
                panelRef={terminalPanelRef}
                defaultSize={vertical[VERTICAL_PANEL_IDS.terminal]}
                minSize="32px"
                onResize={(size) => {
                  // 32px = the tab strip; anything under ~40px reads as
                  // "collapsed". Pixel-based so a short right column
                  // can't collapse below the strip's visible height.
                  setTerminalCollapsed(size.inPixels <= 40);
                }}
              >
                {session.workspaceId && (
                  <ExecutionTerminalPanel
                    sessionId={session.id}
                    disabled={terminalNotReady}
                    disabledReason={terminalNotReady ? 'Setting up worktree…' : undefined}
                    collapsed={terminalCollapsed}
                    onToggleCollapsed={handleToggleTerminal}
                  />
                )}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* References / scratchpad overlay. Positioned to start at the
            right edge of the chat column so the pane covers both the
            file tree and the viewer+terminal columns. Chat stays
            interactive on the left. The left offset follows
            `horizontal[chat]` (a percentage), so dragging the chat
            divider moves the overlay's edge with it. */}
        {activePane !== null && (
          <div
            className="absolute top-0 right-0 bottom-0 z-30"
            style={{ left: `${horizontal[HORIZONTAL_PANEL_IDS.chat]}%` }}
          >
            {activePane === 'references' && (
              <ReferencesPane
                sessionId={session.id}
                workspaceId={session.workspaceId ?? null}
                open
                onClose={closePane}
                onInsertChip={handleInsertChip}
              />
            )}
            {activePane === 'scratchpad' && (
              <ScratchpadPane
                sessionId={session.id}
                workspaceId={session.workspaceId ?? null}
                open
                onClose={closePane}
                onInsertText={handleInsertText}
                onInsertChip={handleInsertChip}
              />
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
