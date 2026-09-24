'use client';

import type { HarnessId } from '@/lib/harness/registry';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  useSession,
  useSendMessage,
  useRuntimeStatus,
  useInterruptSession,
  useContinueSession,
  useNewExecutionChat,
  useWorktreeScope,
  useSessionReferences,
  useScratchpad,
} from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';
import { useSessionReconcile } from '@/hooks/use-session-reconcile';
import { useWorkspace, useMarkSessionRead, useDiffStats } from '@/hooks/use-workspaces';
import { useElementWidth } from '@/hooks/use-element-width';
import type { RailResponse } from '@/lib/api/sessions';
import type { EffortLevel } from '@/db/types';
import { isSessionUnread, latestActivityAt } from '@/lib/utils/session-sort';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { cn } from '@/lib/utils';
import { ExecutionHeader } from './execution-header';
import { ExecutionChatTabs } from './execution-chat-tabs';
import { ExecutionTranscript } from './execution-transcript';
import { ExecutionReviewBar } from './execution-review-bar';
import { ExecutionComposer, type ExecutionComposerHandle } from './execution-composer';
import { BackgroundTasksBar } from './background-tasks-bar';
import { PendingInputArea } from './pending-input-overlay';
import { SyncingPill } from './syncing-pill';
import { WipHandoffBanner } from './wip-handoff-banner';
import { sessionFolder } from '@/lib/folders/source';
import { useOpenFileListener, toWorktreeRelative } from '@/lib/entity-refs/open-file-event';
import { useFileHistory } from '@/hooks/use-file-history';
import { ExecutionActionBar } from './action-bar/execution-action-bar';
import { TakeoverBanner } from './takeover/takeover-banner';
import { ImportedTakeoverBar } from './imported-takeover-bar';
import { providerLabel as importedProviderLabel } from './setup-card';
import { ExecutionSkeleton } from './execution-skeleton';
import { useOpenReferenceListener } from '@/lib/entity-refs/open-event';
import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import type { EditorSnapshot } from '@/components/chat/editor/chat-input-editor';
import { DRAFT_STORAGE_PREFIX } from '@/components/chat/editor/draft-storage';
import { hot } from '@/lib/_debug/hot-path';
import { HOME_VIEW, executionView } from '@/lib/client/active-view';
import { usePreviewController } from './preview/use-preview-controller';
import { runDotClass } from './preview/run-status';
import { useWorkbench, DEFAULT_PANEL_PCT, DEFAULT_TERMINAL_PCT } from './workbench/use-workbench';
import { PANEL_VIEW_LABELS, type PanelView } from './workbench/workbench-state';
import { WorkbenchPanel } from './workbench/workbench-panel';
import { TerminalDrawer } from './workbench/terminal-drawer';
import { ToolsBox } from './workbench/tools-box';
import { ResizeHandle } from './workbench/resize-handle';
import { MobileDestination, MobileToolsSheet } from './workbench/mobile-workbench';
import type { WorkbenchViewContext } from './workbench/workbench-views';

interface ExecutionViewProps {
  sessionId: string;
}

/** Text fields keep Escape for themselves (closing menus, cancelling edits). */
function isEditableTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The surface for an open execution: the workbench.
 *
 *   header      identity · the chat's status · menu · [Terminal] [Tools] · git
 *   chat        tabs, transcript, composer. A floating tools box sits on its
 *               right while the panel is closed.
 *   panel       Run · Preview · Changes · Files · More (Notes & tasks,
 *               Scratchpad), opened from the box or the Tools toggle.
 *   terminal    a drawer across the whole bottom, for commands you type.
 *
 * The phone gets the chat with a Tools sheet, and opens tools full width.
 * Rules and rationale: docs/execution-view-spec.md, "Workbench layout".
 *
 * This view mounts more than once at a time (the dashboard renders its
 * desktop, tablet and phone layouts together and hides two with CSS, and
 * each instance has a desktop and a phone subtree). So anything heavy (the
 * panel, the terminal, a phone destination) mounts only in the subtree that
 * is actually on screen, measured by width. That also keeps a hidden copy
 * from spawning a terminal.
 *
 * Marks the session as viewed on open so it leaves the Needs Review
 * surface — opening the session is the read receipt.
 */
export function ExecutionView({ sessionId }: ExecutionViewProps) {
  const { setActiveView, setActiveExecutionId, setSessionStreaming, openAgent, pendingInputSessionIds } = useDashboard();
  const qc = useQueryClient();
  const { data: session, isLoading, error } = useSession(sessionId);
  const { data: workspace } = useWorkspace(session?.workspaceId ?? null);
  const { data: runtime } = useRuntimeStatus(sessionId);
  const hasBackgroundTasks = runtime?.backgroundTasks ?? false;
  // Live chat-event stream: appends rows into the events cache as the
  // executor (or any other write path) inserts them.
  useSessionStream(sessionId);
  // Catch up to the on-disk Claude JSONL on open. The indicator below
  // renders only if the server actually finds drift and starts a replay.
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

  // Cache scope for everything read off the worktree. Execution-keyed, so
  // it holds steady while the user hops between this execution's chats.
  const worktreeScope = useWorktreeScope(sessionId);

  // The execution, not the chat, is what "which code am I looking at"
  // means. Every reset below keys off this: a new chat on the same
  // execution is the same worktree, the same files, the same terminal —
  // so selection, the workbench and the preview survive it.
  const executionId = session?.executionId ?? null;

  // Stable id for per-worktree UI state (workbench, file-open history).
  // Falls back to the chat's own id for execution-less sessions, matching
  // how the query scope resolves.
  const worktreeId = executionId ?? sessionId;

  // Start a fresh chat on this execution's worktree (the "New chat" button and
  // the composer's provider switcher), then navigate to it. Provider switch
  // passes { providerId, model }; a plain new chat passes nothing.
  const startNewChat = (opts?: {
    providerId?: HarnessId;
    model?: string;
    variant?: string;
    effort?: EffortLevel;
  }, draft?: EditorSnapshot | null) => {
    newExecutionChat
      .mutateAsync(opts ?? undefined)
      .then((r) => {
        if (draft) {
          try {
            window.localStorage.setItem(
              `${DRAFT_STORAGE_PREFIX}exec:${r.session.id}`,
              JSON.stringify(draft.doc),
            );
          } catch {
            // Draft persistence is best-effort when storage is unavailable.
          }
        }
        setActiveView(executionView(r.session.id));
      })
      .catch(() => { });
  };

  // Conductor-style auto-resume: opening an archived execution is the
  // signal to reopen — fire `continue` once on mount so the row flips to
  // active and a fresh worktree provisions in the background. The
  // setting-up state covers the wait.
  //
  // The ref is consumed only when the resume actually FIRES. Consuming it
  // on first sight of the session would defeat the resume whenever the
  // first render serves a stale cached row: reopening a just-closed chat
  // from the tab strip's "All chats" list mounts with the cached
  // status='active' (marked stale, refetch in flight), and by the time
  // the fresh 'archived' lands the guard would already be spent.
  const resumedSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !sessionId) return;
    if (resumedSessionIdRef.current === sessionId) return;
    if (session.status === 'archived') {
      resumedSessionIdRef.current = sessionId;
      continueWork.mutate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, sessionId]);

  // Setting-up state: dispatch creates the chat_session row immediately
  // and provisions the worktree in the background (~2-5s for `git
  // worktree add` + fromSource apply). Until worktreePath lands on the
  // row the worktree views show a placeholder. The row gets updated by
  // the server, so we poll the session query.
  const isSettingUp =
    !!session && !!workspace && workspace.isGit === true && !session.worktreePath;

  // Gate for the terminal's auto-spawn. Its cwd resolves to the session's
  // worktree, but `workspace` loads from a separate query than `session` —
  // so there's a window where the session is ready while `workspace` is
  // still `undefined`. Spawning then would land the PTY in the workspace's
  // main checkout for good (a PTY's cwd is frozen), so treat "workspace not
  // loaded yet" as not ready.
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
    hot('effect ExecutionView.runtime-edge');
    const rootEnded = prevRunningRef.current && !isRunning;
    const backgroundEnded = prevBackgroundTasksRef.current && !hasBackgroundTasks;
    prevRunningRef.current = isRunning;
    prevBackgroundTasksRef.current = hasBackgroundTasks;

    if (!sessionId || (!rootEnded && !backgroundEnded)) return;
    if (worktreeScope) {
      // One prefix covers diff / tree / status / pr — everything the turn
      // or detached child may have moved on disk.
      qc.invalidateQueries({ queryKey: worktreeScope });
    }
    // Plus the row itself for its derived metadata. `exact` keeps this off
    // the transcript, whose events already arrive over SSE.
    qc.invalidateQueries({ queryKey: ['session', sessionId], exact: true });
  }, [isRunning, hasBackgroundTasks, sessionId, worktreeScope, qc]);

  // Worktree just landed (provisioning finished) → pull the file tree + diff
  // immediately. The tree was fetched empty while `worktreePath` was null, and
  // nothing else refetches it on this transition.
  const prevWorktreeRef = useRef(!!session?.worktreePath);
  useEffect(() => {
    hot('effect ExecutionView.worktree-edge');
    const has = !!session?.worktreePath;
    const justLanded = !prevWorktreeRef.current && has && !!sessionId && !!worktreeScope;
    prevWorktreeRef.current = has;
    if (!justLanded) return;
    qc.invalidateQueries({ queryKey: [...worktreeScope!, 'tree'] });
    qc.invalidateQueries({ queryKey: [...worktreeScope!, 'diff'] });
    // The background copy (.env etc.) lands a beat after the worktree itself —
    // pull the tree again so those files appear without waiting out the poll.
    const t = setTimeout(
      () => qc.invalidateQueries({ queryKey: [...worktreeScope!, 'tree'] }),
      2500,
    );
    return () => clearTimeout(t);
  }, [session?.worktreePath, sessionId, worktreeScope, qc]);

  // Voice-sent event ids tracked in client memory for this open session.
  // Lost on reload by design. The set only grows.
  const [voiceSentIds, setVoiceSentIds] = useState<Set<string>>(() => new Set());

  // ── Which subtree is on screen ───────────────────────────────────────
  // Width 0 means hidden (this subtree, or this whole instance). Heavy
  // parts mount only where the width is real.
  const [desktopRef, desktopWidth] = useElementWidth<HTMLDivElement>();
  const [mobileRef, mobileWidth] = useElementWidth<HTMLDivElement>();
  const desktopVisible = (desktopWidth ?? 0) > 0;
  const mobileVisible = (mobileWidth ?? 0) > 0;
  const desktopVisibleRef = useRef(desktopVisible);
  desktopVisibleRef.current = desktopVisible;
  const mobileVisibleRef = useRef(mobileVisible);
  mobileVisibleRef.current = mobileVisible;

  // ── Workbench state ──────────────────────────────────────────────────
  const workbench = useWorkbench(worktreeId);
  const wb = workbench.state;
  const workbenchRef = useRef(workbench);
  workbenchRef.current = workbench;

  // The phone's own navigation: a tool opened full width, and the sheet.
  const [mobileView, setMobileView] = useState<PanelView | null>(null);
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);

  // Selected file in the Files view. Lifted here because Changes (open in
  // Files), the transcript's file chips and the tree all set it. Starts
  // empty on every open, and resets on a different execution, but survives
  // hopping between chats on one execution (same worktree, same files).
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const lastExecutionRef = useRef(executionId);
  if (lastExecutionRef.current !== executionId) {
    lastExecutionRef.current = executionId;
    setSelectedPath(null);
    setMobileView(null);
    setToolsSheetOpen(false);
  }

  // Per-execution LRU of files opened, surfaced by the Files view's history
  // menu and its empty state.
  const { history: fileHistory, recordOpen: recordFileOpen } = useFileHistory(worktreeId);

  const selectFile = useCallback(
    (path: string | null) => {
      setSelectedPath(path);
      if (path) recordFileOpen(path);
    },
    [recordFileOpen],
  );

  /** Open a view where the user is: the desktop panel, or full width on a phone. */
  const openViewHere = useCallback((view: PanelView, how: 'show' | 'jump') => {
    if (desktopVisibleRef.current) {
      if (how === 'jump') workbenchRef.current.jump(view);
      else workbenchRef.current.show(view);
    } else if (mobileVisibleRef.current) {
      setToolsSheetOpen(false);
      setMobileView(view);
    }
  }, []);

  // Transcript file chips fire `ri:open-file` (a window event) when clicked;
  // open the file in Files, normalizing absolute tool-input paths to
  // worktree-relative. A jump, so the panel offers a way back.
  useOpenFileListener(
    useCallback(
      (detail) => {
        const rel = toWorktreeRelative(detail.path, session?.worktreePath ?? null);
        if (!rel) return;
        selectFile(rel);
        openViewHere('files', 'jump');
      },
      [session?.worktreePath, selectFile, openViewHere],
    ),
  );

  // Transcript task / note chips fire `ri:open-reference`: show Notes & tasks.
  useOpenReferenceListener(useCallback(() => openViewHere('notes', 'jump'), [openViewHere]));

  // Lets the file tree drop an `@<path>` token into the composer when the
  // user picks "Reference in chat" from a row's menu.
  const composerHandleRef = useRef<ExecutionComposerHandle | null>(null);
  const handleReferenceFileInChat = useCallback((relativePath: string) => {
    composerHandleRef.current?.insertTextAtCursor(`@${relativePath} `);
    composerHandleRef.current?.focus({ end: true });
  }, []);
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

  // ── The app process (Run) and its interface (Preview) ────────────────
  const controller = usePreviewController(executionId, session?.workspaceId ?? null, {
    active: desktopVisible || mobileVisible,
    logs: (desktopVisible && wb.view === 'run') || (mobileVisible && mobileView === 'run'),
  });
  const startAndPreview = useCallback(() => {
    controller.start();
    openViewHere('preview', 'show');
  }, [controller, openViewHere]);

  // Status for the box, tabs and sheet.
  const diffStats = useDiffStats(session?.worktreePath ? sessionId : null, executionId);
  const references = useSessionReferences(sessionId, 'all');
  const linkedCount = references.data?.inChat.length ?? 0;
  const { data: scratch } = useScratchpad(sessionId);
  const scratchHasContent = !!scratch?.scratchPad?.trim();

  // ── Keyboard: ⌃` terminal, ⌘P go to file, Escape restores then closes ─
  useEffect(() => {
    const focusTreeSearch = () => {
      let tries = 0;
      const tick = () => {
        const input = document.querySelector<HTMLInputElement>('[data-tree-search]');
        if (input && input.offsetParent !== null) {
          input.focus();
          input.select();
        } else if (tries++ < 20) {
          window.setTimeout(tick, 50);
        }
      };
      tick();
    };
    // Capture phase, so a focused terminal can't swallow the toggle.
    const onKeyCapture = (e: KeyboardEvent) => {
      if (!desktopVisibleRef.current) return;
      if (matchesHotkey(e, HOTKEYS.toggleTerminal)) {
        e.preventDefault();
        e.stopPropagation();
        workbenchRef.current.dispatch({ type: 'toggleTerminal' });
      } else if (matchesHotkey(e, HOTKEYS.goToFile)) {
        e.preventDefault();
        e.stopPropagation();
        workbenchRef.current.show('files');
        focusTreeSearch();
      }
    };
    // Bubble phase for Escape, so dialogs, menus, editors and the terminal
    // get it first and can claim it.
    const onKey = (e: KeyboardEvent) => {
      if (!desktopVisibleRef.current || !matchesHotkey(e, HOTKEYS.slideoutBack)) return;
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.closest('.xterm') || isEditableTarget(target) || target.closest('[role="dialog"],[role="menu"]'))) return;
      const s = workbenchRef.current.state;
      if (!s.maximized && !s.view) return;
      e.preventDefault();
      workbenchRef.current.dispatch({ type: 'escape' });
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Navigate-away read receipt. The composer fires markRead eagerly on
  // focus and send, so all engaged-then-leave cases are covered already.
  // This cleanup handles "user entered an unread chat, looked at it, left
  // without engaging": mark read only if the unread state at leave is the
  // same one that was there at entry (no new activity landed meanwhile).
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

  const handleClose = () => setActiveView(HOME_VIEW);

  // Layout refs for the two resizable splits.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  if (isLoading) {
    return <ExecutionSkeleton />;
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
  // as active (it lives in the send slot).
  //
  // Archived: covers the brief window between mount and the auto-resume
  // mutation succeeding, to avoid a 400 from a very fast send.
  //
  // An imported chat mirrors a session this app doesn't drive. Sending would
  // spawn an agent with none of the context shown above it, so the composer
  // stays locked until the user takes the chat over on purpose.
  const isMirroredImport =
    session.surfaceKind === 'imported_agent' && !session.externalSessionId;
  const isResuming = session.status === 'archived';
  const composerDisabled = isResuming || isSettingUp || isMirroredImport;
  const composerDisabledReason = isResuming
    ? 'Resuming…'
    : isSettingUp
      ? 'Setting up worktree…'
      : isMirroredImport
        ? 'Continue here to reply'
        : undefined;

  const isGitWorktree = !!workspace?.isGit && !!session.worktreePath;
  const chatLabel = session.label ?? 'this chat';
  const needsInput = pendingInputSessionIds.has(session.id);
  const openWorkspaceSettings = session.workspaceId ? () => openAgent(session.workspaceId!, 'setup') : undefined;

  const toolsListProps = {
    controller,
    branchName: session.branchName ?? null,
    diffStats: diffStats.data,
    linkedCount,
    scratchHasContent,
  };

  const viewContext = (surface: 'desktop' | 'phone'): WorkbenchViewContext => ({
    sessionId: session.id,
    workspaceId: session.workspaceId ?? null,
    worktreeId,
    worktreePath: session.worktreePath ?? null,
    baseBranch: workspace?.baseBranch ?? null,
    chatLabel,
    settingUp: isSettingUp ? { failed: !!session.setupError } : null,
    controller,
    selectedPath,
    onSelectFile: selectFile,
    fileHistory,
    onReferenceInChat: handleReferenceFileInChat,
    onInsertChip: handleInsertChip,
    onInsertText: handleInsertText,
    onOpenWorkspaceSettings: openWorkspaceSettings,
    onStartAndPreview: startAndPreview,
    show: surface === 'desktop' ? workbench.show : (v) => setMobileView(v),
    jump: surface === 'desktop' ? workbench.jump : (v) => setMobileView(v),
    autoFocus: surface === 'desktop' ? workbench.openedThisVisit : () => true,
  });

  // Chat body — tabs, WIP banner, transcript, composer. Rendered in both
  // the phone (`lg:hidden`) and desktop (`hidden lg:flex`) subtrees, with
  // opposite Enter semantics: the phone composer treats Enter as a newline
  // (send via button, like a native keyboard), the desktop composer
  // submits on Enter. Binding it to the subtree rather than a runtime
  // viewport check keeps each instance matched to the layout it's in.
  //
  // `withBox` floats the tools box over the chat's right side. The chat
  // pads for it where it would otherwise cover the transcript, and below
  // ~1060px of chat width the box folds into an icon strip.
  const renderChatBody = (submitOnEnter: boolean, withBox: boolean) => (
    <ChatDropZone
      className="flex flex-1 min-h-0 flex-col"
      onFiles={(files) => {
        for (const f of files) void composerHandleRef.current?.uploadFile(f);
        composerHandleRef.current?.focus({ end: true });
      }}
      disabled={composerDisabled}
    >
      {/* Sibling-chat tabs: conversations only, never files. */}
      {!!session.executionId && (
        <ExecutionChatTabs
          sessionId={session.id}
          executionId={session.executionId}
          onNewChat={() => startNewChat()}
          newChatPending={newExecutionChat.isPending}
        />
      )}
      <div
        className={cn(
          'relative flex min-h-0 flex-1 flex-col',
          withBox && '@max-[1390px]/chat:pr-[308px] @max-[1060px]/chat:pr-[60px]',
        )}
      >
        {workspace?.isGit &&
          !!session.worktreePath &&
          session.worktreePath !== workspace.cwd && (
            // Skip for Live / in-place sessions: their "worktree" IS the source
            // checkout, so no WIP ever "stayed behind".
            <WipHandoffBanner sessionId={session.id} worktreeReady={!!session.worktreePath} />
          )}
        {reconciling && <SyncingPill />}
        <ExecutionTranscript
          session={session}
          workspace={workspace}
          isRunning={isRunning}
          voiceSentIds={voiceSentIds}
        />
        {session.executionId && !isRunning && <ExecutionReviewBar executionId={session.executionId} />}
        {/* The input region: pending questions, then running background
            work as a strip attached to the top of the composer. No rule
            above it, so it reads as one piece with the conversation. */}
        <div className="flex-shrink-0 bg-background">
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
            ref={composerHandleRef}
            sessionId={session.id}
            permissionMode={session.permissionMode}
            model={session.model}
            modelVariant={session.modelVariant}
            effort={session.effort}
            harness={session.harness}
            disabled={composerDisabled}
            disabledReason={composerDisabledReason}
            submitOnEnter={submitOnEnter}
            isRunning={isRunning}
            onSwitchProvider={(next, draft) => startNewChat({
              providerId: next.harness,
              model: next.model,
              variant: next.variant,
              effort: next.effort,
            }, draft)}
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
        {withBox && desktopVisible && (
          <ToolsBox
            {...toolsListProps}
            onShow={workbench.show}
            onStartAndPreview={startAndPreview}
            terminal={{ open: wb.terminalOpen, onToggle: () => workbench.dispatch({ type: 'toggleTerminal' }) }}
          />
        )}
      </div>
    </ChatDropZone>
  );

  const panelOpen = !!wb.view;
  const maximized = panelOpen && wb.maximized;
  const terminalOpen = wb.terminalOpen && !!session.workspaceId;
  const terminalMax = terminalOpen && wb.terminalMaximized;
  const runDot =
    controller.runStatus === 'stopped' || controller.runStatus === 'not-configured' ? null : runDotClass(controller.runStatus);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* ─── Phone / tablet (under lg) ─────────────────────────────────── */}
      <div ref={mobileRef} className="lg:hidden relative flex flex-1 min-w-0 min-h-0">
        {/* The chat stays mounted under a tool opened full width, so its
            scroll position and draft survive the round trip. */}
        <div className={cn('flex h-full flex-1 flex-col min-w-0 bg-background', mobileVisible && mobileView && 'hidden')}>
          <ExecutionHeader
            session={session}
            workspace={workspace}
            onClose={handleClose}
            isRunning={isRunning}
            hasBackgroundTasks={hasBackgroundTasks}
            onOpenTools={() => setToolsSheetOpen(true)}
            toolsBadgeClass={runDot}
          />
          <TakeoverBanner session={session} />
          {isGitWorktree && workspace && (
            // `empty:hidden`: the chip renders nothing in some states (a clean
            // worktree with no branch commits), and the row goes with it.
            <div className="flex-shrink-0 border-b border-border px-3 py-2 empty:hidden">
              <ExecutionActionBar session={session} workspace={workspace} variant="narrative" />
            </div>
          )}
          {/* Phone: Enter inserts a newline; the send button submits. */}
          {renderChatBody(false, false)}
        </div>
        {mobileVisible && mobileView && (
          <MobileDestination
            view={mobileView}
            ctx={viewContext('phone')}
            onShow={setMobileView}
            onBack={() => setMobileView(null)}
            needsInput={needsInput}
          />
        )}
        {mobileVisible && (
          <MobileToolsSheet
            open={toolsSheetOpen}
            onOpenChange={setToolsSheetOpen}
            {...toolsListProps}
            onShow={(v) => {
              setToolsSheetOpen(false);
              setMobileView(v);
            }}
            onStartAndPreview={() => {
              setToolsSheetOpen(false);
              controller.start();
              setMobileView('preview');
            }}
          />
        )}
      </div>

      {/* ─── Desktop (lg+) ─────────────────────────────────────────────── */}
      <div ref={desktopRef} className="@container/exec hidden lg:flex flex-col flex-1 min-w-0 min-h-0">
        <ExecutionHeader
          session={session}
          workspace={workspace}
          onClose={handleClose}
          isRunning={isRunning}
          hasBackgroundTasks={hasBackgroundTasks}
          workbench={{
            terminalOpen,
            onToggleTerminal: () => workbench.dispatch({ type: 'toggleTerminal' }),
            panelOpen,
            onTogglePanel: () => workbench.dispatch({ type: 'togglePanel' }),
            panelLabel: PANEL_VIEW_LABELS[wb.last],
          }}
        />
        <TakeoverBanner session={session} />
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
          <div ref={rowRef} className={cn('relative flex min-h-0 flex-1', terminalMax && 'hidden')}>
            {maximized && (
              <div key="strip" className="flex w-11 flex-shrink-0 flex-col items-center gap-2 border-r border-border py-2">
                <button
                  type="button"
                  onClick={() => workbench.dispatch({ type: 'toggleMaximize' })}
                  title="Bring the chat back (Esc)"
                  aria-label="Bring the chat back"
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <MessageSquare size={15} />
                </button>
                {(isRunning || needsInput) && (
                  <span
                    aria-label={needsInput ? 'Needs input' : 'Working'}
                    title={needsInput ? 'This chat needs input' : 'This chat is working'}
                    className={cn('h-1.5 w-1.5 animate-pulse rounded-full', needsInput ? 'bg-amber-500' : 'bg-emerald-500')}
                  />
                )}
                <span className="mt-1 max-h-60 truncate text-[11.5px] text-muted-foreground [writing-mode:vertical-rl] rotate-180">
                  {chatLabel}
                </span>
              </div>
            )}
            <div key="chat" className={cn('@container/chat relative flex min-h-0 min-w-0 flex-1 flex-col bg-background', maximized && 'hidden')}>
              {/* Desktop: Enter submits (Shift+Enter for a newline). */}
              {renderChatBody(true, !panelOpen)}
            </div>
            {panelOpen && desktopVisible && (
              <>
                {!maximized && (
                  <ResizeHandle
                    key="split"
                    axis="columns"
                    targetRef={panelRef}
                    containerRef={rowRef}
                    pct={workbench.panelPct}
                    minPct={25}
                    maxPct={80}
                    minOtherPx={340}
                    minTargetPx={380}
                    defaultPct={DEFAULT_PANEL_PCT}
                    onCommit={workbench.setPanelPct}
                    label="Resize the panel"
                  />
                )}
                <div
                  key="panel"
                  ref={panelRef}
                  style={maximized ? undefined : { width: `${workbench.panelPct}%` }}
                  className={cn('min-h-0 min-w-0', maximized ? 'flex-1' : 'flex-shrink-0')}
                >
                  <WorkbenchPanel
                    workbench={workbench}
                    ctx={viewContext('desktop')}
                    changedFiles={diffStats.data?.files ?? null}
                    linkedCount={linkedCount}
                    scratchHasContent={scratchHasContent}
                  />
                </div>
              </>
            )}
          </div>
          {terminalOpen && desktopVisible && (
            <>
              {!terminalMax && (
                <ResizeHandle
                  axis="rows"
                  targetRef={drawerRef}
                  containerRef={bodyRef}
                  pct={workbench.terminalPct}
                  minPct={12}
                  maxPct={80}
                  minOtherPx={200}
                  minTargetPx={120}
                  defaultPct={DEFAULT_TERMINAL_PCT}
                  onCommit={workbench.setTerminalPct}
                  label="Resize the terminal"
                />
              )}
              <div
                ref={drawerRef}
                style={terminalMax ? undefined : { height: `${workbench.terminalPct}%` }}
                className={cn('min-h-0', terminalMax ? 'flex-1' : 'flex-shrink-0')}
              >
                <TerminalDrawer
                  source={sessionFolder(session.id)}
                  disabled={terminalNotReady}
                  disabledReason={terminalNotReady ? 'Setting up worktree…' : undefined}
                  maximized={terminalMax}
                  onToggleMaximize={() => workbench.dispatch({ type: 'toggleTerminalMaximize' })}
                  onHide={() => workbench.dispatch({ type: 'toggleTerminal' })}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
