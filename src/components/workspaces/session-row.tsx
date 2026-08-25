'use client';

import { GitBranch } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDiffStats } from '@/hooks/use-workspaces';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import type { ChatSessionWithExecution } from '@/db/types';
import { DiffStatsPair } from './diff-stats';
import { SessionRowMenu } from './session-row-menu';
import { useSessionRowHover } from './session-hover-context';
import { useWorkspaceSelection } from './workspace-selection-context';

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
  /** Open the "create from PR/branch/issue" modal for this row's workspace. */
  onOpenLauncher?: (workspaceId: string) => void;
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
  onOpenLauncher,
}: SessionRowProps) {
  const { activeView, activeExecutionId, setActiveView, streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const { data: diffStats } = useDiffStats(
    session.worktreePath ? session.id : null,
    session.executionId,
  );
  const { rowRef, onMouseEnter, onMouseLeave, closeNow } = useSessionRowHover(session.id);

  // Multi-select for bulk archive lives only on the canonical tree row;
  // the needs-review duplicate stays plain navigation so a session can't
  // present two checkboxes. `selection` is null outside the workspace
  // nav (e.g. the by-status surface), which keeps the row inert there.
  const selection = useWorkspaceSelection();
  const selectable = variant === 'tree' && !!selection?.selecting;
  const selected = selectable && !!selection?.isSelected(session.id);

  const isStreaming = streamingSessionIds.has(session.id);
  const isPending = pendingInputSessionIds.has(session.id);

  // Shared unread rule (isSessionUnread) so every surface agrees: the
  // user's "Mark as unread" override (unreadMarkerAt) or a fresh outcome
  // event beats the read receipt. The streaming overlay stays local — a
  // session you're actively watching isn't flagged unread.
  const isUnread = !isStreaming && isSessionUnread(session);

  // Activity, not outcome: this is the row's rank made visible. The unread
  // derivation above deliberately stays on `lastOutcomeEventAt`.
  const timestamp = session.lastActivityAt ?? session.lastOutcomeEventAt ?? session.startedAt;
  // This row stands for an execution (its primary chat). It's "active"
  // when the open view is its primary chat OR — in the tree — any sibling
  // chat of the same execution (tracked via activeExecutionId), so opening
  // a different chat from the in-execution history doesn't drop the
  // highlight onto nothing. needs-review rows stay strict (per-chat).
  const isActive =
    activeView === session.id ||
    (variant === 'tree' &&
      !!session.executionId &&
      activeExecutionId === session.executionId);

  // Read receipt fires on navigate-away, not click-in (handled in
  // ExecutionView's cleanup). Clicking the row stays cheap and the
  // rail's buckets don't reshuffle out from under the user. In selection
  // mode the same click toggles the checkbox instead of navigating, so
  // the whole row is the hit target.
  const handleOpen = () => {
    if (selectable) {
      selection!.toggle(session.id);
      return;
    }
    closeNow();
    setActiveView(session.id);
  };

  // Title by the execution (stable across its chats), falling back to the
  // primary chat's label for legacy executions that were never named.
  // Null on both until the first user message derives one — show a muted
  // placeholder until then so the row stays orientable.
  const label = session.execution?.label ?? session.label ?? 'Untitled';
  const labelIsPlaceholder = !(session.execution?.label ?? session.label);

  return (
    <div
      ref={rowRef}
      onClick={handleOpen}
      // Suppress the hover preview while selecting — the user is scanning
      // checkboxes, not previewing transcripts, and a popped panel would
      // just cover the rows they're trying to tick.
      onMouseEnter={selectable ? undefined : onMouseEnter}
      onMouseLeave={selectable ? undefined : onMouseLeave}
      role="button"
      aria-pressed={selectable ? selected : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={cn(
        'relative w-full group flex items-start gap-2 pl-5 pr-1.5 py-1 rounded-md transition-colors text-left cursor-pointer',
        selectable
          ? selected
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
          : isActive
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
          visually subordinate. In selection mode the pip is swapped for
          a checkbox in the same slot so nothing shifts. The checkbox is
          pointer-events-none — the row's onClick is the single source of
          toggle truth, so a click anywhere on the row (box included)
          flips selection exactly once. */}
      <span className="flex h-4 items-center flex-shrink-0">
        {selectable ? (
          <Checkbox
            checked={selected}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none size-3.5"
          />
        ) : (
          <StatusPip
            isStreaming={isStreaming}
            isPending={isPending}
            isUnread={isUnread}
          />
        )}
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
          or displacing anything. Hidden in selection mode: the row's
          only job then is to toggle, and a per-row menu would invite a
          one-off archive that competes with the batch action. */}
      {!selectable && (
        <SessionRowMenu
          sessionId={session.id}
          workspaceId={session.workspaceId ?? null}
          isUnread={isUnread || isPending}
          label={label}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onOpenLauncher={onOpenLauncher}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        />
      )}
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
