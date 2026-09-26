'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, MoreHorizontal, Archive, FolderOpen, SquareArrowOutUpRight, Zap, Copy, Check, Loader2, Rows3, Eye, EyeOff, Pin, PinOff } from 'lucide-react';
import { locationLabel, preparedFolder } from '@/lib/executions/location';
import { useComputer, useRunsOnSeveralComputers } from '@/hooks/use-computers';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useDashboard } from '@/contexts/dashboard-context';
import { HOTKEYS } from '@/constants/commands';
import { useArchiveWithConfirm } from '@/hooks/use-archive-with-confirm';
import { useDeliveries, useLastTurnEndedAt, useUpdateSession } from '@/hooks/use-execution';
import { useMarkSessionRead, useMarkSessionUnread, usePinSession, useUnpinSession } from '@/hooks/use-workspaces';
import { useOpener } from '@/hooks/use-opener';
import { sessionFolder } from '@/lib/folders/source';
import { useOpenInPreferredEditor } from '@/lib/client/editor-preference';
import { useTranscriptDensity } from '@/lib/client/transcript-density';
import { revealLabel, detectClientPlatform } from '@/lib/client/deep-links';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { ExecutionActionBar } from './action-bar/execution-action-bar';
import { TakeoverButton } from './takeover/takeover-button';
import { ResyncMenuItem } from './resync-menu-item';
import { RestartMenuItem } from './restart-menu-item';
import { deriveExecutionHeaderStatus, describeChatStatus, type ChatStatusTone } from './execution-header-status';
import { useSteadyRunning } from './steady-running';
import { LocationMenu } from './transfer/location-menu';
import { ExecutionTaskChips } from './execution-task-chips';
import { resumeCommandForHarness } from '@/lib/harness/registry';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { HOME_VIEW } from '@/lib/client/active-view';

interface ExecutionHeaderProps {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | undefined;
  /** Phone: the back button. (Desktop closes from the top bar and ⌘E.) */
  onClose: () => void;
  /** Live runtime state from this session's dedicated status stream. */
  isRunning: boolean;
  /** Authoritative active child/process state from this session's runtime stream. */
  hasBackgroundTasks: boolean;
  /** Desktop: the labeled Terminal and Tools toggles. */
  workbench?: {
    terminalOpen: boolean;
    onToggleTerminal: () => void;
    panelOpen: boolean;
    onTogglePanel: () => void;
    /** What the Tools toggle reopens, for its tooltip. */
    panelLabel: string;
  };
  /** Phone: opens the Tools sheet. */
  onOpenTools?: () => void;
  /** A small status dot for the phone's Tools button (the app is running, failed…). */
  toolsBadgeClass?: string | null;
}

const TONE_DOT: Record<ChatStatusTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  blue: 'bg-blue-500',
  muted: 'bg-transparent ring-[1.5px] ring-inset ring-muted-foreground/60',
};

const TONE_TEXT: Record<ChatStatusTone, string> = {
  green: 'text-muted-foreground',
  amber: 'text-amber-700 dark:text-amber-400',
  rose: 'text-rose-700 dark:text-rose-400',
  blue: 'text-muted-foreground',
  muted: 'text-muted-foreground',
};

/** Re-render on an interval so "Finished 5m ago" stays true. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
}

/**
 * The execution's header. Desktop: the agent and title, the selected chat's
 * status in words, the menu, then the labeled Terminal and Tools toggles
 * and, at the far right, the git chip (colored by state, with the one next
 * step). The header reads, the chip acts, and the toggles only change what
 * you're looking at.
 *
 * Phone: back, the title with the status under it, a Tools button that
 * opens the tools sheet, and the menu. The git chip gets its own row below.
 */
export function ExecutionHeader({
  session,
  workspace,
  onClose,
  isRunning,
  hasBackgroundTasks,
  workbench,
  onOpenTools,
  toolsBadgeClass,
}: ExecutionHeaderProps) {
  const { pendingInputSessionIds, setActiveView, openAgent } = useDashboard();
  const { confirmArchive } = useArchiveWithConfirm();
  const updateSession = useUpdateSession();
  const markRead = useMarkSessionRead();
  const markUnread = useMarkSessionUnread();
  const pin = usePinSession();
  const unpin = useUnpinSession();
  useMinuteTick();

  // Inline rename: click the label → swap to input. Enter / blur saves
  // via PATCH /api/sessions/:id; Escape cancels. The local draft holds
  // the in-progress text so React Query repaints from server data don't
  // clobber the user's edit while they're typing.
  //
  // `editingSessionId` also resets on session change without an effect.
  // ExecutionView doesn't remount on navigation, so a boolean alone
  // would let an in-flight rename carry into the next execution.
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = editingSessionId === session.id;

  // The header title is the EXECUTION's label — stable across chats. Starting
  // a new chat on the same execution gives that chat its own `session.label`
  // (the per-conversation title shown in the history dropdown) but leaves this
  // header title untouched. Fall back to the chat label only for the rare
  // non-execution case (an orphaned chat whose execution was hard-deleted).
  const displayLabel = session.execution?.label ?? session.label ?? null;

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [editing]);

  const beginRename = () => {
    setDraft(displayLabel ?? '');
    setEditingSessionId(session.id);
  };

  const commitRename = () => {
    const next = draft.trim();
    setEditingSessionId(null);
    if (next === (displayLabel ?? '')) return; // no-op
    // Rename the execution (the durable artifact) so the title survives a
    // "new chat". Orphaned chats with no execution fall back to their own label.
    if (session.executionId) {
      updateSession.mutate({ id: session.id, executionLabel: next || null });
    } else {
      updateSession.mutate({ id: session.id, label: next || null });
    }
  };

  const cancelRename = () => {
    setEditingSessionId(null);
    setDraft(displayLabel ?? '');
  };

  const lastTurnEndedAt = useLastTurnEndedAt(session.id);
  const isPending = pendingInputSessionIds.has(session.id);
  const isArchived = session.status === 'archived';
  const isSetupFailed = !!session.setupError;
  // Mirror ExecutionView's derivation: git workspace whose session
  // hasn't been provisioned yet. setupError wins (separate state) so
  // we don't render "setting up" forever on a failed provision.
  const isSettingUp =
    !!workspace && workspace.isGit === true && !preparedFolder(session) && !isSetupFailed;
  // Which computer it runs on, by name (P3.1): always when it's not the
  // home, and at home only when there are other computers to tell it from.
  const severalComputers = useRunsOnSeveralComputers();
  const where = locationLabel(session, severalComputers);
  // The chip opens the moves this screen can make (P4.2).
  const locationChip = where ? <LocationMenu session={session} workspace={workspace} name={where} /> : null;

  // Away from the home, what its computer is doing shapes the status: a
  // message waiting for it, or a turn under way when it lost contact (P3.2).
  const remote = session.location && !session.location.isHome ? session.location : null;
  const computer = useComputer(remote?.computerId);
  const { data: deliveries } = useDeliveries(remote ? session.id : null);
  const elsewhere = remote
    ? {
        // Until the list loads, assume connected rather than claim it dropped.
        connected: computer?.worker?.connected ?? true,
        asleep: computer?.worker?.reportedState === 'asleep',
        waiting: Object.values(deliveries ?? {}).some((d) => d.state === 'waiting'),
      }
    : null;

  // Whichever knows first that a turn ended: the session, or its transcript here.
  const lastOutcomeEventAt = [session.lastOutcomeEventAt, lastTurnEndedAt].filter(Boolean).sort().at(-1) ?? null;
  const steadyRunning = useSteadyRunning(isRunning, lastOutcomeEventAt);
  const statusKind = deriveExecutionHeaderStatus({
    isArchived,
    isSetupFailed,
    isSettingUp,
    isPending,
    isRunning: steadyRunning,
    hasBackgroundTasks,
    lastOutcomeEventAt,
    lastViewedAt: session.lastViewedAt,
    elsewhere,
  });
  // The selected chat's status in words. Status is text with a dot: no
  // border, no hover, so it never reads as a button.
  const chatStatus = describeChatStatus(
    statusKind,
    lastOutcomeEventAt,
    formatCompactRelative,
    remote ? { name: remote.name, lastSeenAt: computer?.lastSeenAt ?? null } : null,
  );
  const statusEl = (
    <span
      title={chatStatus.title}
      aria-label={`Status: ${chatStatus.label}${chatStatus.detail ? `, ${chatStatus.detail}` : ''}`}
      className={cn('inline-flex min-w-0 cursor-default items-center gap-1.5 whitespace-nowrap text-[12px]', TONE_TEXT[chatStatus.tone])}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', TONE_DOT[chatStatus.tone], chatStatus.pulse && 'animate-pulse')} />
      <span>{chatStatus.label}</span>
      {chatStatus.detail && <span className="truncate text-muted-foreground/80">· {chatStatus.detail}</span>}
    </span>
  );

  const handleArchive = () => {
    void confirmArchive({
      id: session.id,
      label: displayLabel,
      onArchived: () => setActiveView(HOME_VIEW),
    });
  };

  const labelElement = editing ? (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRename();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelRename();
        }
      }}
      placeholder="Untitled"
      maxLength={120}
      className="flex-1 min-w-0 bg-background border border-primary/40 rounded px-1.5 py-0.5 text-[13px] lg:text-[12.5px] font-semibold text-foreground focus:outline-none"
      spellCheck={false}
    />
  ) : null;

  const archiveMenuItem = !isArchived && (
    <button
      onClick={handleArchive}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-destructive hover:bg-destructive/10 transition-colors"
    >
      <Archive size={11} />
      Archive execution
    </button>
  );

  // Read-state toggle for the session menu — the same affordance the rail
  // rows expose, brought inside the execution view (and, since this header
  // is the mobile chrome too, onto mobile). `isSessionUnread` is the shared
  // rule (later of outcome event / unread marker vs the read receipt); the
  // running guard is the overlay the rail applies via bucket priority so a
  // live session is never flagged "unread".
  const isUnread = !isRunning && isSessionUnread(session);

  const readStateMenuItem = isUnread ? (
    <button
      onClick={() => markRead.mutate(session.id)}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
    >
      <Eye size={12} />
      Mark as read
    </button>
  ) : (
    <button
      onClick={() => markUnread.mutate(session.id)}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
    >
      <EyeOff size={12} />
      Mark as unread
    </button>
  );

  // Pin toggle — the same rail affordance, reachable from inside the open
  // execution. Hidden for archived sessions (only active executions live in
  // the rail, and archiving clears the pin anyway). Requires an execution to
  // pin against.
  const isPinned = !!session.execution?.pinnedAt;
  const pinMenuItem = !isArchived && session.executionId ? (
    isPinned ? (
      <button
        onClick={() => unpin.mutate(session.id)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
      >
        <PinOff size={12} />
        Unpin from rail
      </button>
    ) : (
      <button
        onClick={() => pin.mutate(session.id)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
      >
        <Pin size={12} />
        Pin to rail
      </button>
    )
  ) : null;

  // Its folder wherever it runs, opened on that computer for a browser there (P3.5).
  const openFolder = preparedFolder(session);
  const worktreeLinks = openFolder ? <WorktreeDeepLinks sessionId={session.id} worktreePath={openFolder} /> : null;

  const takeoverMenuItem = <TakeoverButton session={session} workspace={workspace} />;

  // Detect Live mode: git workspace whose session points at the
  // workspace's own cwd instead of a per-session worktree. Non-git
  // workspaces also run in cwd by default but that's not "Live mode"
  // — the badge is specifically for "you opted into shared state on a
  // git workspace."
  const isLive =
    !!workspace?.isGit && !!session.worktreePath && session.worktreePath === workspace.cwd;
  const liveBadge = isLive ? <LiveBadge branch={session.branchName} /> : null;
  const providerResumeCommand = session.externalSessionId
    ? resumeCommandForHarness(session.harness, session.externalSessionId)
    : null;
  const showGit = !!workspace?.isGit && (!!preparedFolder(session) || !!session.setupError);

  // One menu for passive details and meta actions, shared by both layouts.
  const menu = (align: 'start' | 'end', triggerClass: string, iconSize: number) => (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" aria-label="Execution menu" title="Execution menu" className={triggerClass}>
          <MoreHorizontal size={iconSize} />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-h-[min(80vh,640px)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-border bg-popover shadow-xl pointer-events-auto outline-none"
        >
          <div className="p-1">
            <button
              type="button"
              onClick={beginRename}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
            >
              <Pencil12 />
              Rename
            </button>
            {pinMenuItem}
            {readStateMenuItem}
            <DensityMenuItem />
          </div>

          {worktreeLinks && (
            <>
              <div className="h-px bg-border" />
              <div className="p-1.5">{worktreeLinks}</div>
            </>
          )}

          <div className="h-px bg-border" />
          <div className="p-1">{takeoverMenuItem}</div>

          <div className="h-px bg-border" />
          <div className="p-2">
            <LinkPrSection sessionId={session.id} linkedNumber={session.prNumber ?? null} />
          </div>

          <div className="h-px bg-border" />
          <div className="p-1"><RestartMenuItem sessionId={session.id} /></div>
          <div className="p-1 pt-0"><ResyncMenuItem sessionId={session.id} imported={session.surfaceKind === 'imported_agent'} /></div>

          <div className="h-px bg-border" />
          <div className="p-3 space-y-2.5 text-[12px]">
            <DetailRow label="Agent" value={workspace?.name ?? '-'} valueClass="font-medium text-foreground" />
            {session.location && (
              <DetailRow label="Computer" value={session.location.name} valueClass="text-foreground" />
            )}
            {workspace?.baseBranch && (
              <DetailRow label="Base" value={workspace.baseBranch} valueClass="font-mono text-foreground" />
            )}
            {session.branchName && (
              <DetailRow label="Branch" value={session.branchName} valueClass="font-mono text-foreground break-all" />
            )}
            {session.baseSha && (
              <DetailRow label="Base sha" value={`@${session.baseSha.slice(0, 7)}`} valueClass="font-mono text-foreground" />
            )}
            <DetailRow label="Status" value={chatStatus.label} valueClass="text-foreground" />
            <CopyableDetailRow label="Session" value={session.id} copyLabel="app session id" />
            {session.executionId && (
              <CopyableDetailRow label="Execution" value={session.executionId} copyLabel="execution id" />
            )}
            {session.externalSessionId && (
              <>
                <CopyableDetailRow
                  label={resumeIdLabel(session.harness)}
                  value={session.externalSessionId}
                  copyLabel={`${resumeIdLabel(session.harness).toLowerCase()}`}
                />
                {providerResumeCommand && (
                  <CopyableDetailRow label="Resume" value={providerResumeCommand} copyLabel="resume command" />
                )}
              </>
            )}
            {preparedFolder(session) && (
              <DetailRow label="Path" value={preparedFolder(session)!} valueClass="font-mono text-[11px] text-foreground/80 break-all" />
            )}
            {session.startedAt && (
              <DetailRow label="Started" value={new Date(session.startedAt).toLocaleString()} valueClass="text-foreground/85" />
            )}
            {session.prNumber != null && (
              <DetailRow label="Linked PR" value={`#${session.prNumber}`} valueClass="font-mono text-foreground" />
            )}
          </div>

          {archiveMenuItem && (
            <>
              <div className="h-px bg-border" />
              <div className="p-1">{archiveMenuItem}</div>
            </>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );

  return (
    <div className="flex-shrink-0 border-b border-border bg-background">
      {/* ─── Phone header (under lg) ────────────────────────── */}
      <div className="lg:hidden flex items-center gap-1 px-2 py-2">
        <button
          onClick={onClose}
          aria-label="Back"
          className="p-2 -ml-1 rounded-md text-muted-foreground active:bg-muted/40"
        >
          <ChevronLeft size={20} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {workspace?.emoji && <span className="text-base flex-shrink-0">{workspace.emoji}</span>}
            {labelElement ?? (
              <button
                type="button"
                onClick={beginRename}
                title="Rename"
                className={cn(
                  'truncate text-left rounded px-1 -mx-1 py-0.5',
                  'active:bg-muted/40 transition-colors cursor-text',
                  displayLabel
                    ? 'text-foreground font-semibold text-[14.5px]'
                    : 'text-muted-foreground/70 italic font-normal text-[14.5px]',
                )}
              >
                {displayLabel ?? 'Untitled'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 min-w-0 pl-0.5">
            {statusEl}
            {liveBadge}
            {locationChip}
          </div>
        </div>

        {onOpenTools && (
          <button
            type="button"
            onClick={onOpenTools}
            className="relative flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-foreground/90 active:bg-muted/50"
          >
            Tools
            {toolsBadgeClass && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', toolsBadgeClass)} />}
          </button>
        )}
        {menu('end', 'p-2 rounded-md text-muted-foreground active:bg-muted/40', 16)}
      </div>

      {/* ─── Desktop header (lg+) ────────────────────────────── */}
      <div className="hidden lg:flex items-center gap-2 px-3 h-11 min-w-0">
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground/80 min-w-0">
          {/* Breadcrumb: the agent opens its view, the way back up from
              the workbench to the oversight surface. */}
          {workspace ? (
            <button
              type="button"
              onClick={() => openAgent(workspace.id)}
              title={`Open ${workspace.name}`}
              className="flex items-center gap-1.5 min-w-0 flex-shrink-0 rounded px-0.5 -mx-0.5 hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {workspace.emoji && <span className="flex-shrink-0">{workspace.emoji}</span>}
              <span className="font-medium truncate max-w-[14rem] @max-[1120px]/exec:hidden">{workspace.name}</span>
            </button>
          ) : (
            <span className="font-medium truncate">Agent</span>
          )}
          <span className="text-muted-foreground/40 flex-shrink-0" aria-hidden>›</span>
          {labelElement ?? (
            <button
              type="button"
              onClick={beginRename}
              title="Rename"
              className={cn(
                'truncate text-left rounded px-0.5 -mx-0.5 min-w-0 text-[13px]',
                'hover:bg-muted/50 transition-colors cursor-text',
                displayLabel ? 'text-foreground font-semibold' : 'text-muted-foreground/60 italic font-normal',
              )}
            >
              {displayLabel ?? 'Untitled'}
            </button>
          )}
        </div>

        {statusEl}
        {liveBadge}
        {locationChip}
        {menu('start', 'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0', 14)}

        <span className="flex-1" />

        {workbench && (
          <>
            <ToggleButton
              on={workbench.terminalOpen}
              onClick={workbench.onToggleTerminal}
              label="Terminal"
              title={`${workbench.terminalOpen ? 'Hide' : 'Show'} the terminal (${HOTKEYS.toggleTerminal.label}). Shells keep running.`}
              icon={<BottomPanelIcon filled={workbench.terminalOpen} />}
            />
            <ToggleButton
              on={workbench.panelOpen}
              onClick={workbench.onTogglePanel}
              label="Tools"
              title={workbench.panelOpen ? 'Hide the tools panel' : `Show ${workbench.panelLabel}`}
              icon={<RightPanelIcon filled={workbench.panelOpen} />}
            />
          </>
        )}

        {showGit && workspace && (
          // The chip renders nothing in some states (a clean worktree with
          // no branch commits yet). `has-[>div:empty]` drops the divider too.
          <div className="flex flex-shrink-0 items-center gap-2 has-[>div:empty]:hidden">
            <span aria-hidden className="mx-1 h-5 w-px flex-shrink-0 bg-border" />
            <div className="flex-shrink-0">
              <ExecutionActionBar session={session} workspace={workspace} variant="narrative" fit />
            </div>
          </div>
        )}
      </div>
      {/* What this workstream is working — one task or several. */}
      {session.executionId && <ExecutionTaskChips executionId={session.executionId} />}
    </div>
  );
}

/**
 * A labeled layout toggle. The words are on purpose: the two panel glyphs
 * are nearly identical, and a redundant label costs less than a wrong
 * click. They fold to icons when the header runs out of room.
 */
function ToggleButton({
  on,
  onClick,
  label,
  title,
  icon,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        'flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors',
        on ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {icon}
      <span className="@max-[1040px]/exec:hidden">{label}</span>
    </button>
  );
}

function BottomPanelIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 15h18" />
      {filled && <path d="M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" />}
    </svg>
  );
}

function RightPanelIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      {filled && <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z" fill="currentColor" />}
    </svg>
  );
}

function Pencil12() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  );
}

/**
 * Transcript density (condensed ↔ full feed), as a menu toggle. Persists
 * via the shared `useTranscriptDensity` preference, so it stays in sync
 * with the Settings control and across tabs.
 */
function DensityMenuItem() {
  const { density, toggle } = useTranscriptDensity();
  const condensed = density === 'condensed';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={condensed}
      onClick={toggle}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
    >
      <Rows3 size={12} />
      Condensed transcript
      <span
        aria-hidden
        className={cn(
          'ml-auto inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors',
          condensed ? 'bg-foreground' : 'bg-muted-foreground/30',
        )}
      >
        <span className={cn('h-3 w-3 rounded-full bg-background transition-transform', condensed && 'translate-x-3')} />
      </span>
    </button>
  );
}

/**
 * Amber "LIVE" pill — surfaces "this session is running in the
 * workspace folder on the current branch, no worktree isolation." Same
 * detection logic as the dispatcher's `liveMode` flag: git workspace
 * whose session.worktreePath matches workspace.cwd. Tooltip explains
 * the consequences for users who land on a Live session without
 * remembering they started one.
 */
function LiveBadge({ branch }: { branch: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
            'bg-amber-500/15 text-amber-600 dark:text-amber-400',
            'text-[10px] font-semibold tracking-wide uppercase cursor-default',
          )}
        >
          <Zap size={9} />
          Live
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <div className="space-y-1 max-w-[260px]">
          <div className="font-semibold">Live session</div>
          <div className="text-[11px] opacity-90 leading-snug">
            Editing the agent&apos;s own folder directly on{' '}
            {branch ? (
              <span className="font-mono">{branch}</span>
            ) : (
              'the current branch'
            )}
            . No worktree isolation, commits land on that branch.
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}


/**
 * "Reveal in Finder" / "Open in editor" links scoped to the worktree
 * root. Both hide when the browser is on a remote client because the
 * worktree path doesn't exist on the user's laptop. Cross-machine work
 * goes through the takeover flow (separate UI surface).
 */
function WorktreeDeepLinks({ sessionId, worktreePath }: { sessionId: string; worktreePath: string }) {
  const { opener } = useOpener(sessionFolder(sessionId), worktreePath);
  const { label, openInEditor } = useOpenInPreferredEditor(opener);
  const [revealing, setRevealing] = useState(false);
  const [opening, setOpening] = useState(false);

  const handleReveal = useCallback(async () => {
    if (revealing) return;
    setRevealing(true);
    try {
      if (!opener) return;
      const res = await opener.open(worktreePath, 'finder');
      if (!res.ok) toast.error(res.message ?? "Couldn't open the folder");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open the folder');
    } finally {
      setRevealing(false);
    }
  }, [opener, worktreePath, revealing]);

  const handleOpenInEditor = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await openInEditor(worktreePath);
      if (!res.ok) {
        toast.error(
          res.reason === 'not_installed'
            ? `${label} isn't installed or its CLI isn't on PATH`
            : (res.message ?? `Couldn't open in ${label}`),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to open in ${label}`);
    } finally {
      setOpening(false);
    }
  }, [worktreePath, opening, openInEditor, label]);

  if (!opener) return null;

  const platform = detectClientPlatform();

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={handleReveal}
        disabled={revealing}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
      >
        {revealing ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
        {revealLabel(platform)}
      </button>
      <button
        type="button"
        onClick={handleOpenInEditor}
        disabled={opening}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
      >
        {opening ? <Loader2 size={12} className="animate-spin" /> : <SquareArrowOutUpRight size={12} />}
        Open in {label}
      </button>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 w-16 flex-shrink-0">
        {label}
      </span>
      <span className={cn('flex-1 min-w-0 text-[12px]', valueClass)}>{value}</span>
    </div>
  );
}

/**
 * Detail row whose value is click-to-copy. Used for surfacing the
 * app session id, durable execution id, harness-side session id, and
 * resume command. Visible only when bound, so optional rows stay out of
 * the way for fresh sessions.
 */
function CopyableDetailRow({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`Copied ${copyLabel}`);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('Copy failed');
    }
  };
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 w-16 flex-shrink-0">
        {label}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        title={`Copy ${copyLabel}`}
        className={cn(
          'group flex flex-1 min-w-0 items-center gap-1.5 text-left',
          'font-mono text-[11px] text-foreground/80 hover:text-foreground',
          'rounded px-1 -mx-1 py-0.5 hover:bg-muted/60 transition-colors',
        )}
      >
        <span className="flex-1 min-w-0 truncate">{value}</span>
        {copied ? (
          <Check size={11} className="flex-shrink-0 text-emerald-500" />
        ) : (
          <Copy size={11} className="flex-shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

function resumeIdLabel(harness: string | null): string {
  if (harness === 'claude') return 'Claude id';
  if (harness === 'codex') return 'Codex id';
  if (harness === 'cursor') return 'Cursor id';
  if (harness === 'opencode') return 'OpenCode id';
  return 'Resume id';
}


interface LinkPrSectionProps {
  sessionId: string;
  linkedNumber: number | null;
}

/**
 * "Link this session to a PR by number/URL." Used when the PR's head
 * branch doesn't match the session's `branchName` — e.g. the PR was
 * opened from a fork, or the branch was renamed. The route prefers
 * the explicit link when set; clearing it falls back to branch match.
 */
function LinkPrSection({ sessionId, linkedNumber }: LinkPrSectionProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSession();

  const handleLink = () => {
    const parsed = parsePrInput(input);
    if (!parsed) {
      setError('Paste a PR number or URL (e.g. 402 or https://github.com/owner/repo/pull/402).');
      return;
    }
    setError(null);
    update.mutate(
      { id: sessionId, prNumber: parsed },
      {
        onSuccess: () => setInput(''),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const handleUnlink = () => {
    setError(null);
    update.mutate({ id: sessionId, prNumber: null });
  };

  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
        Link PR
      </div>
      {linkedNumber != null ? (
        <div className="flex items-center justify-between gap-2 px-1 text-[12px]">
          <span className="text-foreground">
            Linked to <span className="font-mono">#{linkedNumber}</span>
          </span>
          <button
            type="button"
            onClick={handleUnlink}
            disabled={update.isPending}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Unlink
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleLink();
              }
            }}
            placeholder="PR number or URL"
            className="flex-1 min-w-0 px-2 py-1 text-[12px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={handleLink}
            disabled={!input.trim() || update.isPending}
            className="px-2 py-1 text-[11px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Link
          </button>
        </div>
      )}
      {error && (
        <div className="px-1 text-[10.5px] text-destructive">{error}</div>
      )}
    </div>
  );
}

function parsePrInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // Strip a leading `#` so "#402" works.
  const cleaned = s.replace(/^#/, '');
  // Plain integer.
  if (/^\d+$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // URL form: github.com/owner/repo/pull/<number>
  const m = s.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}
