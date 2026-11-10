'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkNavigation } from '@/contexts/work-context';
import type { WorkspaceRecord } from '@/db/types';
import { useArchiveExecution } from '@/hooks/use-archive-execution';
import { useRunsOnSeveralDevices } from '@/hooks/use-devices';
import { useUpdateSession } from '@/hooks/use-execution';
import { useOpenablePr } from '@/hooks/use-execution-actions';
import { useOpener } from '@/hooks/use-opener';
import { useMarkSessionRead, useMarkSessionUnread, usePinSession, useUnpinSession } from '@/hooks/use-workspaces';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { detectClientPlatform, revealLabel } from '@/lib/client/deep-links';
import { useDeviceLabelMode } from '@/lib/client/device-label-mode';
import { useOpenInPreferredEditor } from '@/lib/client/editor-preference';
import { useTranscriptDensity } from '@/lib/client/transcript-density';
import { locationLabel, preparedFolder } from '@/lib/executions/location';
import { sessionFolder } from '@/lib/folders/source';
import { harnessDefinition, isKnownHarnessId, resumeCommandForHarness } from '@/lib/harness/registry';
import { cn } from '@/lib/utils';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { Archive, ArrowUpRight, Check, ChevronLeft, Copy, Eye, EyeOff, FolderOpen, Loader2, MoreHorizontal, Pin, PinOff, Rows3, SquareArrowOutUpRight, Zap } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ExecutionActionBar } from './action-bar/execution-action-bar';
import { ChatStatusText, useChatStatus } from './chat-status';
import { ChatTitleInput, useChatRename } from './chat-title-rename';
import { ExecutionTaskChips } from './execution-task-chips';
import { RestartMenuItem } from './restart-menu-item';
import { ResyncMenuItem } from './resync-menu-item';
import { LocationMenu, MoveActions } from './transfer/location-menu';
import { Tip } from '@/components/ui/tip';
import { CoordinationSettings } from '@/components/chat-ui/coordination/controls';
import { ExecutionResultsShortcut } from '@/components/results/execution-results-shortcut';
import { ScheduleChatButton } from '@/components/triggers/schedule-chat-button';
import { WorkbenchToggles } from './workbench/workbench-toggles';

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
  const { openAgent } = useWorkNavigation();
  const { archive } = useArchiveExecution();
  const markRead = useMarkSessionRead();
  const markUnread = useMarkSessionUnread();
  const pin = usePinSession();
  const unpin = useUnpinSession();

  // Click the title to rename it in place (chat-title-rename.tsx).
  const rename = useChatRename(session);
  const displayLabel = rename.label;

  const isArchived = session.status === 'archived';
  // Which device it runs on, by name (P3.1): the exception only. Work on
  // the home is unlabeled unless this browser asked to always show it.
  const severalDevices = useRunsOnSeveralDevices();
  const { mode: labelMode } = useDeviceLabelMode();
  const where = locationLabel(session, severalDevices, labelMode);
  // The chip opens the moves this screen can make (P4.2).
  const locationChip = where ? <LocationMenu session={session} workspace={workspace} name={where} /> : null;

  // The selected chat's status in words.
  const chatStatus = useChatStatus({ session, workspace, isRunning, hasBackgroundTasks });
  const statusEl = <ChatStatusText status={chatStatus} />;

  const handleArchive = () => {
    void archive({
      id: session.id,
      executionId: session.executionId,
      workspaceId: session.workspaceId,
      label: displayLabel,
    });
  };

  const labelElement = rename.editing ? (
    <ChatTitleInput rename={rename} className="flex-1 px-1.5 py-0.5 text-[13px] lg:text-[12.5px]" />
  ) : null;

  const archiveMenuItem = !isArchived && (
    <button
      onClick={handleArchive}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-destructive hover:bg-destructive/10 transition-colors"
    >
      <Archive size={11} />
      Archive chat
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

  // Its folder wherever it runs, opened on that device for a browser there (P3.5).
  const openFolder = preparedFolder(session);
  const worktreeLinks = openFolder ? <WorktreeDeepLinks sessionId={session.id} worktreePath={openFolder} /> : null;

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
  // The git box also mounts for a linked PR alone (no worktree, archived,
  // non-git), where it shows just the PR link.
  const showGit =
    (!!workspace?.isGit && (!!preparedFolder(session) || !!session.setupError)) || session.prNumber != null;

  // One menu for passive details and meta actions, shared by both layouts.
  const menu = (align: 'start' | 'end', triggerClass: string, iconSize: number) => (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <Tip label="Chat menu">
          <button type="button" aria-label="Chat menu" className={triggerClass}>
            <MoreHorizontal size={iconSize} />
          </button>
        </Tip>
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
              onClick={rename.begin}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
            >
              <Pencil12 />
              Rename
            </button>
            {pinMenuItem}
            {readStateMenuItem}
            <DensityMenuItem />
            {/* Up with the actions, not below the details block, where the
                menu's height cap used to push it out of sight. */}
            {archiveMenuItem}
          </div>

          <details className="border-t border-border p-3 text-xs"><summary className="cursor-pointer font-medium">Chat collaboration</summary><div className="pt-3"><CoordinationSettings sessionId={session.id} /></div></details>

          {/* The links render nothing on a screen that can't open the folder
              (a browser on another device), so the section's divider and
              padding go with them rather than leaving an empty bar. */}
          {worktreeLinks && <div className="border-t border-border p-1.5 empty:hidden">{worktreeLinks}</div>}

          {/* With no device chip, moving it lives here (P4.2). */}
          {!locationChip && <MoveActionsSection session={session} workspace={workspace} />}

          <div className="h-px bg-border" />
          <div className="p-2">
            <LinkPrSection session={session} />
          </div>

          <div className="h-px bg-border" />
          <div className="p-1"><RestartMenuItem sessionId={session.id} /></div>
          <div className="p-1 pt-0"><ResyncMenuItem sessionId={session.id} imported={session.surfaceKind === 'imported_agent'} /></div>

          <div className="h-px bg-border" />
          <div className="p-3 space-y-2.5 text-[12px]">
            <DetailRow label="Agent" value={workspace?.name ?? '-'} valueClass="font-medium text-foreground" />
            {session.location && (
              <DetailRow label="Device" value={session.location.name} valueClass="text-foreground" />
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
            <CopyableDetailRow label="Chat" value={session.id} copyLabel="chat id" />
            {session.executionId && (
              // The chat tabs that share this folder, branch and terminal.
              // Code calls it the execution, people know it as a workstream.
              <CopyableDetailRow label="Workstream" value={session.executionId} copyLabel="workstream id" />
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
              <Tip label="Rename">
                <button
                  type="button"
                  onClick={rename.begin}
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
              </Tip>
            )}
          </div>
          <div className="flex items-center gap-1.5 min-w-0 pl-0.5">
            {statusEl}
            {liveBadge}
            {locationChip}
          </div>
        </div>

        <ScheduleChatButton sessionId={session.id} compact className="p-2" />
        {session.executionId && <ExecutionResultsShortcut executionId={session.executionId} />}
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
            <Tip label={workspace.name} onlyWhenTextHidden>
              <button
                type="button"
                onClick={() => openAgent(workspace.id)}
                className="flex items-center gap-1.5 min-w-0 flex-shrink-0 rounded px-0.5 -mx-0.5 hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                {workspace.emoji && <span className="flex-shrink-0">{workspace.emoji}</span>}
                <span className="font-medium truncate max-w-[14rem] @max-[1120px]/exec:hidden">{workspace.name}</span>
              </button>
            </Tip>
          ) : (
            <span className="font-medium truncate">Agent</span>
          )}
          <span className="text-muted-foreground/40 flex-shrink-0" aria-hidden>›</span>
          {labelElement ?? (
            <Tip label="Rename">
              <button
                type="button"
                onClick={rename.begin}
                className={cn(
                  'truncate text-left rounded px-0.5 -mx-0.5 min-w-0 text-[13px]',
                  'hover:bg-muted/50 transition-colors cursor-text',
                  displayLabel ? 'text-foreground font-semibold' : 'text-muted-foreground/60 italic font-normal',
                )}
              >
                {displayLabel ?? 'Untitled'}
              </button>
            </Tip>
          )}
        </div>

        {statusEl}
        {liveBadge}
        {locationChip}
        {menu('start', 'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0', 14)}

        <span className="flex-1" />

        <ScheduleChatButton sessionId={session.id} />
        {session.executionId && <ExecutionResultsShortcut executionId={session.executionId} />}

        {workbench && (
          <WorkbenchToggles
            terminal={{ open: workbench.terminalOpen, onToggle: workbench.onToggleTerminal }}
            tools={{ open: workbench.panelOpen, onToggle: workbench.onTogglePanel, showLabel: workbench.panelLabel }}
            fold={{ label: '@max-[1040px]/exec:hidden', kbd: '@max-[1200px]/exec:hidden' }}
          />
        )}

        {showGit && workspace && (
          // The chip renders nothing in some states (a clean worktree with
          // no branch commits yet). `has-[>div:empty]` drops the divider too.
          <div className="flex flex-shrink-0 items-center gap-2 has-[>div:empty]:hidden">
            <span aria-hidden className="mx-1 h-5 w-px flex-shrink-0 bg-border" />
            <div className="flex-shrink-0">
              <ExecutionActionBar session={session} workspace={workspace} fit />
            </div>
          </div>
        )}
      </div>
      {/* What this workstream is working — one task or several. */}
      {session.executionId && <ExecutionTaskChips executionId={session.executionId} />}
    </div>
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
 * root, opened on the device it's on for a browser there (P3.5).
 * Moving the work to another device goes through the location menu.
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
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 w-20 flex-shrink-0">
        {label}
      </span>
      <span className={cn('flex-1 min-w-0 text-[12px]', valueClass)}>{value}</span>
    </div>
  );
}

/**
 * Detail row whose value is click-to-copy. Used for surfacing the
 * chat id (the session), workstream id (the execution), harness-side
 * session id, and resume command. Visible only when bound, so optional
 * rows stay out of the way for fresh sessions.
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
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 w-20 flex-shrink-0">
        {label}
      </span>
      <Tip label={`Copy ${copyLabel}`}>
        <button
          type="button"
          onClick={handleCopy}
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
      </Tip>
    </div>
  );
}

function resumeIdLabel(harness: string | null): string {
  return isKnownHarnessId(harness) ? `${harnessDefinition(harness).name} id` : 'Resume id';
}


interface LinkPrSectionProps {
  session: ChatSessionWithExecution;
}

/**
 * "Link this session to a PR by number/URL." Used when the PR's head
 * branch doesn't match the session's `branchName` — e.g. the PR was
 * opened from a fork, or the branch was renamed. The route prefers
 * the explicit link when set; clearing it falls back to branch match.
 */
function LinkPrSection({ session }: LinkPrSectionProps) {
  const sessionId = session.id;
  const linkedNumber = session.prNumber ?? null;
  const openablePr = useOpenablePr(session);
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
            Linked to{' '}
            {openablePr?.number === linkedNumber ? (
              <Tip label={`Open PR #${linkedNumber} on GitHub`}>
                <a
                  href={openablePr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-mono underline-offset-2 hover:underline"
                >
                  #{linkedNumber}
                  <ArrowUpRight size={11} className="opacity-70" />
                </a>
              </Tip>
            ) : (
              <span className="font-mono">#{linkedNumber}</span>
            )}
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

/** The moves from the … menu, divided off, or nothing when there are none. */
function MoveActionsSection({ session, workspace }: { session: ChatSessionWithExecution; workspace: WorkspaceRecord | null | undefined }) {
  if (!session.location || !workspace?.isGit) return null;
  return (
    <div className="border-t border-border p-1 empty:hidden">
      <MoveActions session={session} workspace={workspace} />
    </div>
  );
}
