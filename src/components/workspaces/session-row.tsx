'use client';

import { GitBranch } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDiffStats } from '@/hooks/use-workspaces';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import type { ChatSessionWithExecution } from '@/db/types';
import { DiffStatsPair } from './diff-stats';
import { SessionRowMenu } from './session-row-menu';
import { useSessionRowHover } from './session-hover-context';

interface SessionRowProps {
  session: ChatSessionWithExecution;
  showWorkspaceLabel?: string;
  /**
   * Which surface this row is rendered on. Same session can render in
   * both `tree` (canonical home, under its workspace) and `needs-review`
   * (top-of-rail triage surface). Tree gets the full background-fill
   * selection state; needs-review gets a slim left accent so the two
   * duplicates don't compete visually when both are active.
   */
  variant?: 'tree' | 'needs-review';
  /** True when the parent workspace is git-backed — gates the
   *  "Execution from git…" item in the kebab menu. */
  workspaceIsGit?: boolean;
  /** Open the workspace settings sheet from the kebab menu. */
  onOpenWorkspaceSettings?: (id: string) => void;
  /** Create a new execution in this row's workspace. */
  onCreateExecution?: (workspaceId: string) => void;
  /** Open the "create from PR/branch/issue" modal for this row's workspace. */
  onOpenCreateFrom?: (workspaceId: string) => void;
}

/**
 * One session under a workspace. Two-line anatomy:
 *
 *   Line 1 — identity: the label, full width.
 *   Line 2 — metadata: timestamp, then (needs-review only) the
 *            workspace tag, then diff stats when non-zero.
 *
 * Line 2 always exists (the timestamp anchors it) so the async diff
 * stats can never change row height — they append after the static
 * tokens into empty space. Rows used to grow a second line when stats
 * landed, shifting every row below mid-click. Static content first,
 * async content last; nothing on screen ever moves.
 *
 * Pip-on-the-left makes the rail scannable: your eye runs the left
 * edge, picks out the colored rows, ignores the rest. The kebab fades
 * into the vacant right half on hover without displacing anything.
 */
export function SessionRow({
  session,
  showWorkspaceLabel,
  variant = 'tree',
  workspaceIsGit,
  onOpenWorkspaceSettings,
  onCreateExecution,
  onOpenCreateFrom,
}: SessionRowProps) {
  const { activeView, setActiveView, streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const { data: diffStats } = useDiffStats(session.worktreePath ? session.id : null);
  const { rowRef, onMouseEnter, onMouseLeave, closeNow } = useSessionRowHover(session.id);

  const isStreaming = streamingSessionIds.has(session.id);
  const isPending = pendingInputSessionIds.has(session.id);

  // Match StatusView's unread derivation so both surfaces agree on
  // which sessions are flagged: the user's "Mark as unread" override
  // (unreadMarkerAt) wins even when no outcome event has landed.
  const outcomes = [
    session.lastOutcomeEventAt ?? '1970-01-01',
    session.unreadMarkerAt ?? '1970-01-01',
  ];
  const lastActivity = outcomes[0]! > outcomes[1]! ? outcomes[0]! : outcomes[1]!;
  const lastViewed = session.lastViewedAt ?? '1970-01-01';
  const isUnread = !isStreaming
    && lastActivity !== '1970-01-01'
    && lastActivity > lastViewed;

  const timestamp = session.lastOutcomeEventAt ?? session.startedAt;
  const isActive = activeView === session.id;

  // Read receipt fires on navigate-away, not click-in (handled in
  // ExecutionView's cleanup). Clicking the row stays cheap and the
  // rail's buckets don't reshuffle out from under the user.
  const handleOpen = () => {
    closeNow();
    setActiveView(session.id);
  };

  // Label is null for executions created via the no-modal flow until
  // the first user message arrives and the server derives one. Show a
  // muted placeholder until then so the row stays orientable.
  const label = session.label ?? 'Untitled';
  const labelIsPlaceholder = !session.label;

  return (
    <div
      ref={rowRef}
      onClick={handleOpen}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={cn(
        'relative w-full group flex items-start gap-2 pl-5 pr-1.5 py-1 rounded-md transition-colors text-left cursor-pointer',
        isActive
          ? variant === 'needs-review'
            // Needs-review variant defers the background fill to the
            // canonical tree row below; the accent comes from the
            // absolute bar below so the rounded corners stay clean
            // and the row's horizontal padding stays intact.
            ? 'text-foreground'
            : 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
    >
      {/* Slim selection accent for the needs-review duplicate. Sits
          inside the row's rounded corners, transparent at rest,
          inherits the foreground color when active. Separate element
          (not a border) so it doesn't fight with rounded-md or eat
          into the row's left padding. */}
      {variant === 'needs-review' && (
        <span
          aria-hidden
          className={cn(
            'absolute left-1 top-1 bottom-1 w-[2px] rounded-full transition-colors',
            isActive ? 'bg-foreground' : 'bg-transparent',
          )}
        />
      )}
      {/* Pip centers against line 1 (the title), not the whole row —
          it reads with the label, and the metadata line below stays
          visually subordinate. */}
      <span className="flex h-4 items-center flex-shrink-0">
        <StatusPip
          isStreaming={isStreaming}
          isPending={isPending}
          isUnread={isUnread}
        />
      </span>
      <div className="flex-1 min-w-0">
        <span
          title={label}
          className={cn(
            'block text-[11px] truncate',
            labelIsPlaceholder ? 'italic text-muted-foreground/70' : 'font-medium',
            isUnread && !labelIsPlaceholder && 'font-semibold text-foreground',
          )}
        >
          {label}
        </span>
        {/* Metadata line, ordered static → async left to right: the
            timestamp anchors it, the workspace tag (needs-review only)
            is known at render, and the diff stats append last so their
            arrival lands in empty space and displaces nothing. */}
        <div className="flex items-center gap-1.5 mt-0.5 text-[9px] leading-none">
          <span className="text-muted-foreground/60 flex-shrink-0">
            {formatCompactRelative(timestamp)}
          </span>
          {showWorkspaceLabel && (
            <span className="text-muted-foreground/50 truncate">· {showWorkspaceLabel}</span>
          )}
          <DiffStatsPair stats={diffStats} className="flex-shrink-0" />
        </div>
      </div>
      {/* The metadata cluster is left-anchored, so the row's right
          half is dead space — the kebab fades in there without hiding
          or displacing anything. */}
      <SessionRowMenu
        sessionId={session.id}
        workspaceId={session.workspaceId ?? null}
        workspaceIsGit={workspaceIsGit ?? false}
        isUnread={isUnread || isPending}
        label={label}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onCreateExecution={onCreateExecution}
        onOpenCreateFrom={onOpenCreateFrom}
        className="absolute right-1 top-1/2 -translate-y-1/2"
      />
    </div>
  );
}

/**
 * 10px wide left-slot indicator. Replaces the GitBranch icon when the
 * session is in a non-idle state so a vertical scan picks out hot rows
 * by color before reading any text. Idle rows keep the GitBranch so
 * the row still parses as "this is an execution" at rest.
 */
function StatusPip({
  isStreaming,
  isPending,
  isUnread,
}: {
  isStreaming: boolean;
  isPending: boolean;
  isUnread: boolean;
}) {
  // Pending wins over streaming: the agent process is still alive but
  // blocked on a user response, so the green "working" pip would lie
  // about what's actually happening.
  if (isPending) {
    return (
      <span
        aria-label="needs input"
        title="Needs input"
        className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0"
      />
    );
  }
  if (isStreaming) {
    return (
      <span
        aria-label="working"
        title="Working"
        className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"
      />
    );
  }
  if (isUnread) {
    return (
      <span
        aria-label="unread"
        title="Unread"
        className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"
      />
    );
  }
  return <GitBranch size={10} className="flex-shrink-0 opacity-50" />;
}
