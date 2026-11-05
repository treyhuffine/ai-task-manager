'use client';

import { useSearchParams } from 'next/navigation';
import { LinkedChatView } from '@/components/chat-ui/messages/linked-chat-view';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useViewportTier } from '@/hooks/use-viewport-tier';
import { useWorkNavigation, useWorkActivity } from '@/contexts/work-context';
import {
  useSession,
  useContinueSession,
  useSessionReferences,
  useScratchpad,
} from '@/hooks/use-execution';
import { useDiffStats, useReadOnOpen } from '@/hooks/use-workspaces';
import { useElementWidth } from '@/hooks/use-element-width';
import { cn } from '@/lib/utils';
import { ExecutionHeader } from './execution-header';
import { ExecutionChatTabs } from './execution-chat-tabs';
import { type ExecutionComposerHandle } from './execution-composer';
import { ExecutionChatColumn, useExecutionChat, useStartExecutionChat } from './execution-chat-column';
import { sessionFolder } from '@/lib/folders/source';
import { useOpenFileListener, toWorktreeRelative } from '@/lib/entity-refs/open-file-event';
import { useFileHistory } from '@/hooks/use-file-history';
import { ExecutionActionBar } from './action-bar/execution-action-bar';
import { ExecutionSkeleton } from './execution-skeleton';
import { useOpenReferenceListener } from '@/lib/entity-refs/open-event';
import { hot } from '@/lib/_debug/hot-path';
import { usePreviewController } from './preview/use-preview-controller';
import { runDotClass } from './preview/run-status';
import { useWorkbench, DEFAULT_PANEL_PCT } from './workbench/use-workbench';
import { useWorkbenchHotkeys } from './workbench/use-workbench-hotkeys';
import { useWorkbenchViewRequests, type WorkbenchViewAsk } from './workbench/view-request';
import { PANEL_VIEW_LABELS, type PanelView } from './workbench/workbench-state';
import { WorkbenchPanel } from './workbench/workbench-panel';
import { PanelSplit, TerminalSplit } from './workbench/workbench-layout';
import { ToolsBox, TOOLS_BOX_CLEARANCE } from './workbench/tools-box';
import { MobileDestination, MobileToolsSheet } from './workbench/mobile-workbench';
import type { WorkbenchViewContext } from './workbench/workbench-views';
import { useBesidePreview, useBesideRegion } from '@/components/chat-ui/artifacts/artifact-preview-provider';

interface ExecutionViewProps {
  sessionId: string;
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
export function ExecutionView(props: ExecutionViewProps) {
  const { data: session, error } = useSession(props.sessionId);
  const params = useSearchParams();
  const history = params.get('session') === props.sessionId && params.get('history') === '1';
  if (!session && !error) return <ExecutionSkeleton />;
  if (session && (history && session.status === 'archived' || session.type !== 'execution' && !session.executionId)) return <LinkedChatView session={session} />;
  return <ExecutionWorkbenchView {...props} />;
}

function ExecutionWorkbenchView({ sessionId }: ExecutionViewProps) {
  const { openAgent, openExecution, goHome } = useWorkNavigation();
  const { setActiveExecutionId, pendingInputSessionIds } = useWorkActivity();
  const qc = useQueryClient();
  // The chat itself: its row, runtime, stream, setup poll and turn-end
  // refreshes (execution-chat-column.tsx, shared with a chat open beside an
  // agent's main chat).
  const chat = useExecutionChat(sessionId);
  const { session, isLoading, error, workspace, isRunning, hasBackgroundTasks, worktreeScope, isSettingUp } = chat;

  // Tell the rail which execution is open so its (one-row-per-execution)
  // workspace-tree row stays highlighted even when the active chat is a
  // sibling, not the execution's primary chat. Cleared on unmount.
  useEffect(() => {
    setActiveExecutionId(session?.executionId ?? null);
  }, [session?.executionId, setActiveExecutionId]);
  useEffect(() => () => setActiveExecutionId(null), [setActiveExecutionId]);
  const continueWork = useContinueSession(sessionId);

  // The execution, not the chat, is what "which code am I looking at"
  // means. Every reset below keys off this: a new chat on the same
  // execution is the same worktree, the same files, the same terminal,
  // so selection, the workbench and the preview survive it.
  const executionId = session?.executionId ?? null;

  // Stable id for per-worktree UI state (workbench, file-open history).
  // Falls back to the chat's own id for execution-less sessions, matching
  // how the query scope resolves.
  const worktreeId = executionId ?? sessionId;

  // Start a fresh chat on this execution's worktree (the "New chat" button and
  // the composer's provider switcher), then navigate to it.
  const newChat = useStartExecutionChat(sessionId, openExecution);

  // Conductor-style auto-resume: opening an archived execution is the
  // signal to reopen: fire `continue` once on mount so the row flips to
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

  // Gate for the terminal's auto-spawn. Its cwd resolves to the session's
  // worktree, but `workspace` loads from a separate query than `session`,
  // so there's a window where the session is ready while `workspace` is
  // still `undefined`. Spawning then would land the PTY in the workspace's
  // main checkout for good (a PTY's cwd is frozen), so treat "workspace not
  // loaded yet" as not ready.
  const terminalNotReady =
    isSettingUp || (!!session?.workspaceId && workspace === undefined);

  // Worktree just landed (provisioning finished) → pull the file tree + diff
  // immediately. The tree was fetched empty while `worktreePath` was null, and
  // nothing else refetches it on this transition.
  // Its folder wherever it runs (P3.1): the worktree here, or the one its device prepared.
  const { folder } = chat;
  const prevWorktreeRef = useRef(!!folder);
  useEffect(() => {
    hot('effect ExecutionView.worktree-edge');
    const has = !!folder;
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
  }, [folder, sessionId, worktreeScope, qc]);

  // ── Which subtree is on screen ───────────────────────────────────────
  // Width 0 means hidden (this subtree, or this whole instance). Heavy
  // parts mount only where the width is real.
  const [desktopRef, desktopWidth] = useElementWidth<HTMLDivElement>();
  const [mobileRef, mobileWidth] = useElementWidth<HTMLDivElement>();
  // Which half the viewport shows, by the CSS breakpoint that hides the
  // other (lg): true desktop, false phone and tablet, null until known.
  // The chat body renders only in that half, so there's one composer and
  // one transcript, not two.
  const tier = useViewportTier();
  const wide = tier === null ? null : tier === 'desktop';
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

  // ── Files from the chat, beside it ──────────────────────────────────
  // A file card in the chat opens in the panel as the `file` view, a jump so
  // closing it goes back to what it covered. Per execution, like the panel.
  // The phone has no panel beside the chat, so its cards open large.
  const besideHost = `execution:${worktreeId}`;
  const besideFile = useBesidePreview(besideHost);
  useBesideRegion(besideHost, {
    available: desktopVisible,
    side: 'right',
    showing: desktopVisible && wb.view === 'file',
    show: () => workbenchRef.current.jump('file'),
  });
  // Closed (its tab's ×, Escape, moved to the large view), or gone with the
  // page: leave its view before the empty one paints. On the whole state, so
  // another execution's restored state is checked too.
  const workbenchDispatch = workbench.dispatch;
  useLayoutEffect(() => {
    if (besideFile) return;
    if (wb.view === 'file' || wb.last === 'file' || wb.from === 'file' || wb.covered !== null) workbenchDispatch({ type: 'fileClosed' });
  }, [besideFile, wb, workbenchDispatch]);

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
        const rel = toWorktreeRelative(detail.path, folder);
        if (!rel) return;
        selectFile(rel);
        openViewHere('files', 'jump');
      },
      [folder, selectFile, openViewHere],
    ),
  );

  // Transcript task / note chips fire `ri:open-reference`: show Notes & tasks.
  useOpenReferenceListener(useCallback(() => openViewHere('notes', 'jump'), [openViewHere]));

  // A view asked for from outside (Review in the archive dialog, a file
  // chip in this chat open beside its agent's main chat), usually just
  // before navigating here, so neither half may have measured yet: open it
  // on the half the viewport shows, or both while that's unknown.
  const wideRef = useRef(wide);
  wideRef.current = wide;
  const folderRef = useRef(folder);
  folderRef.current = folder;
  useWorkbenchViewRequests(
    session?.id === sessionId ? sessionId : null,
    useCallback(({ view, path }: WorkbenchViewAsk) => {
      const rel = path ? toWorktreeRelative(path, folderRef.current) : null;
      if (rel) selectFile(rel);
      if (wideRef.current !== false) workbenchRef.current.show(view);
      if (wideRef.current !== true) {
        setToolsSheetOpen(false);
        setMobileView(view);
      }
    }, [selectFile]),
  );

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
  const diffStats = useDiffStats(folder ? sessionId : null, executionId);
  const references = useSessionReferences(sessionId);
  const linkedCount = references.data?.pages[0]?.counts.inChat ?? 0;
  const { data: scratch } = useScratchpad(sessionId);
  const scratchHasContent = !!scratch?.scratchPad?.trim();

  // ── Keyboard: ⌃` terminal, ⌃. tools, ⌘P go to file, Escape restores then closes ─
  // The same keys as the agent view (use-workbench-hotkeys.ts).
  useWorkbenchHotkeys({
    enabled: desktopVisible,
    toggleTerminal: () => workbench.dispatch({ type: 'toggleTerminal' }),
    toggleTools: () => workbench.dispatch({ type: 'togglePanel' }),
    goToFile: () => workbench.show('files'),
    escape: () => {
      if (!wb.maximized && !wb.view) return false;
      workbench.dispatch({ type: 'escape' });
      return true;
    },
  });

  useReadOnOpen(sessionId);

  const handleClose = goHome;

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

  const isGitWorktree = !!workspace?.isGit && !!folder;
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
    // Its folder wherever it runs: the Files view's paths and Open are on that device (P3.5).
    worktreePath: folder,
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
    besideHost,
  });

  // Chat body: tabs, then the chat column (execution-chat-column.tsx).
  // Rendered in the phone (`lg:hidden`) or desktop (`hidden lg:flex`)
  // subtree, whichever the viewport shows. Enter follows the device, not
  // the layout (`useTouchFirst` in the editor).
  //
  // `withBox` floats the tools box over the chat's right side. Below
  // ~1390px of chat width the parts it would cover pad themselves clear of
  // it, and below ~1060px the box folds into an icon strip.
  const renderChatBody = (withBox: boolean) => (
    <ExecutionChatColumn
      chat={chat}
      composerRef={composerHandleRef}
      clearBox={withBox ? TOOLS_BOX_CLEARANCE : undefined}
      // Sibling-chat tabs: conversations only, never files.
      tabs={!!session.executionId && (
        <ExecutionChatTabs
          sessionId={session.id}
          executionId={session.executionId}
          onNewChat={() => newChat.start()}
          newChatPending={newChat.isPending}
        />
      )}
      overlay={withBox && desktopVisible && (
        <ToolsBox
          {...toolsListProps}
          onShow={workbench.show}
          onStartAndPreview={startAndPreview}
          terminal={{ open: wb.terminalOpen, onToggle: () => workbench.dispatch({ type: 'toggleTerminal' }) }}
        />
      )}
      onSwitchProvider={newChat.start}
      switchingProvider={newChat.isPending}
    />
  );

  const panelOpen = !!wb.view;
  const maximized = panelOpen && wb.maximized;
  const terminalOpen = wb.terminalOpen && !!session.workspaceId;
  const terminalMax = terminalOpen && wb.terminalMaximized;
  const runDot =
    controller.runStatus === 'stopped' || controller.runStatus === 'not-configured' || controller.runStatus === 'elsewhere'
      ? null
      : runDotClass(controller.runStatus);

  return (
    <>
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
          {(isGitWorktree || session.prNumber != null) && workspace && (
            // `empty:hidden`: the chip renders nothing in some states (a clean
            // worktree with no branch commits), and the row goes with it.
            <div className="flex-shrink-0 border-b border-border px-3 py-2 empty:hidden">
              <ExecutionActionBar session={session} workspace={workspace} />
            </div>
          )}
          {/* Only where the viewport shows this half (useViewportTier). */}
          {!wide && renderChatBody(false)}
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
        <TerminalSplit
          terminal={terminalOpen && desktopVisible ? {
            source: sessionFolder(session.id),
            disabled: terminalNotReady,
            disabledReason: terminalNotReady ? 'Setting up worktree…' : undefined,
            maximized: terminalMax,
            onToggleMaximize: () => workbench.dispatch({ type: 'toggleTerminalMaximize' }),
            onHide: () => workbench.dispatch({ type: 'toggleTerminal' }),
            pct: workbench.terminalPct,
            onCommitPct: workbench.setTerminalPct,
          } : null}
        >
          <PanelSplit
            chat={wide !== false && renderChatBody(!panelOpen)}
            chatHost={besideHost}
            chatStrip={{
              label: chatLabel,
              status: needsInput ? 'needsInput' : isRunning ? 'working' : null,
              onRestore: () => workbench.dispatch({ type: 'toggleMaximize' }),
            }}
            panel={{
              open: panelOpen,
              maximized,
              content: panelOpen && desktopVisible ? (
                <WorkbenchPanel
                  workbench={workbench}
                  ctx={viewContext('desktop')}
                  changedFiles={diffStats.data?.files ?? null}
                  linkedCount={linkedCount}
                  scratchHasContent={scratchHasContent}
                />
              ) : null,
              pct: workbench.panelPct,
              defaultPct: DEFAULT_PANEL_PCT,
              onCommitPct: workbench.setPanelPct,
            }}
          />
        </TerminalSplit>
      </div>
    </div>
    </>
  );
}
