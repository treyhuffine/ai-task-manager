'use client';

import { GitBranch } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDiffStats } from '@/hooks/use-workspaces';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import type { ChatSessionRecord } from '@/db/types';
import { SessionRowMenu } from './session-row-menu';

interface SessionRowProps {
  session: ChatSessionRecord;
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
 * One session under a workspace. Left slot is the at-a-glance status
 * pip — colored when the session is active (working / pending /
 * unread), GitBranch when idle. Right slot is the relative timestamp,
 * with the kebab menu replacing it on hover.
 *
 * Pip-on-the-left makes the rail scannable: your eye runs the left
 * edge, picks out the colored rows, ignores the rest.
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
  const { data: diffStats } = useDiffStats(session.worktree_path ? session.id : null);

  const isStreaming = streamingSessionIds.has(session.id);
  const isPending = pendingInputSessionIds.has(session.id);

  // Match StatusView's unread derivation so both surfaces agree on
  // which sessions are flagged: the user's "Mark as unread" override
  // (unread_marker_at) wins even when no outcome event has landed.
  const outcomes = [
    session.last_outcome_event_at ?? '1970-01-01',
    session.unread_marker_at ?? '1970-01-01',
  ];
  const lastActivity = outcomes[0]! > outcomes[1]! ? outcomes[0]! : outcomes[1]!;
  const lastViewed = session.last_viewed_at ?? '1970-01-01';
  const isUnread = !isStreaming
    && lastActivity !== '1970-01-01'
    && lastActivity > lastViewed;

  const timestamp = session.last_outcome_event_at ?? session.started_at;
  const isActive = activeView === session.id;

  // Read receipt fires on navigate-away, not click-in (handled in
  // ExecutionView's cleanup). Clicking the row stays cheap and the
  // rail's buckets don't reshuffle out from under the user.
  const handleOpen = () => setActiveView(session.id);

  // Label is null for executions created via the no-modal flow until
  // the first user message arrives and the server derives one. Show a
  // muted placeholder until then so the row stays orientable.
  const label = session.label ?? 'Untitled';
  const labelIsPlaceholder = !session.label;

  return (
    <div
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={cn(
        'relative w-full group flex items-center gap-2 pl-5 pr-1.5 py-1.5 rounded-md transition-colors text-left cursor-pointer',
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
            'absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full transition-colors',
            isActive ? 'bg-foreground' : 'bg-transparent',
          )}
        />
      )}
      <StatusPip
        isStreaming={isStreaming}
        isPending={isPending}
        isUnread={isUnread}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className={cn(
            'text-[11px] truncate',
            labelIsPlaceholder ? 'italic text-muted-foreground/70' : 'font-medium',
            isUnread && !labelIsPlaceholder && 'font-semibold text-foreground',
          )}>{label}</span>
          {showWorkspaceLabel && (
            <span className="text-[9px] text-muted-foreground/60 truncate">· {showWorkspaceLabel}</span>
          )}
        </div>
        {diffStats && (
          <div className="flex items-center gap-1.5 text-[9px] font-mono leading-none mt-0.5">
            <span className="text-emerald-500/80">+{diffStats.additions}</span>
            <span className="text-rose-500/80">-{diffStats.deletions}</span>
          </div>
        )}
      </div>
      <div className="relative flex items-center gap-1 flex-shrink-0 text-[9px] min-h-[1.25rem]">
        {/* Timestamp stays put while idle; on hover the kebab fades in
            over it. The status pip on the left handles the at-a-glance
            "is this row hot" question without flashing. */}
        <span className="text-muted-foreground/60 transition-opacity group-hover:opacity-0 group-has-data-[state=open]:opacity-0">
          {formatCompactRelative(timestamp)}
        </span>
        <SessionRowMenu
          sessionId={session.id}
          workspaceId={session.workspace_id ?? null}
          workspaceIsGit={workspaceIsGit ?? false}
          isUnread={isUnread || isPending}
          label={label}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onCreateExecution={onCreateExecution}
          onOpenCreateFrom={onOpenCreateFrom}
          className="absolute right-0 top-1/2 -translate-y-1/2"
        />
      </div>
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
  if (isStreaming) {
    return (
      <span
        aria-label="working"
        title="Working"
        className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"
      />
    );
  }
  if (isPending) {
    return (
      <span
        aria-label="needs approval"
        title="Needs approval"
        className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"
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
