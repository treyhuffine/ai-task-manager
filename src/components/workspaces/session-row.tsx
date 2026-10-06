'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { useDashboard } from '@/contexts/dashboard-context';
import { useArchiveExecution } from '@/hooks/use-archive-execution';
import { useUnpinSession } from '@/hooks/use-workspaces';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { cn } from '@/lib/utils';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { Archive, GitBranch, Moon, Pin, PinOff } from 'lucide-react';

import { executionView } from '@/lib/client/active-view';
import { StatusPip, useChatStatus } from './chat-status';
import { useSessionRowHover } from './session-hover-context';
import { SessionRowMenu } from './session-row-menu';
import { useWorkspaceSelection } from './workspace-selection-context';
import { Tip } from '@/components/ui/tip';

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
  /**
   * Suppress the inline "pinned" marker. Set by the Pinned group, where a
   * per-row pin glyph would just repeat the section title. The kebab still
   * offers Unpin regardless. Everywhere else the marker stays on so a pinned
   * execution is recognizable in its natural home under its workspace.
   */
  hidePinMarker?: boolean;
  /**
   * `compact` is the agents-first rail's thread row (docs/rail-agents-first.md):
   * one line, label then a right-aligned cluster (pin, where it runs, time)
   * that gives way to the kebab on hover. `regular` is the two-line row
   * (Pinned, Needs you). Neither shows diff stats: in the rail they don't
   * help decide where to go, they live in the execution's header.
   */
  density?: 'regular' | 'compact';
  /**
   * Idle past the inactive threshold (src/lib/sessions/inactive.ts). The row
   * dims, marks its age with a moon, and offers Archive (and Unpin when
   * pinned) on hover, so stale work is one click from gone.
   */
  inactive?: boolean;
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
  hidePinMarker,
  density = 'regular',
  inactive = false,
}: SessionRowProps) {
  const { activeSessionId, activeExecutionId, setActiveView } = useDashboard();
  const { rowRef, onMouseEnter, onMouseLeave, closeNow } = useSessionRowHover(session.id);

  // Multi-select for bulk archive lives only on the canonical tree row;
  // the needs-review duplicate stays plain navigation so a session can't
  // present two checkboxes. `selection` is null outside the workspace
  // nav (e.g. Pinned), which keeps the row inert there.
  const selection = useWorkspaceSelection();
  const selectable = variant === 'tree' && !!selection?.selecting;
  const selected = selectable && !!selection?.isSelected(session.id);

  // Working, needs input, unread, background: one reading for every rail row.
  const status = useChatStatus(session);
  const { isPending, isUnread } = status;

  // Activity, not outcome: this is the row's rank made visible. The unread
  // derivation above deliberately stays on `lastOutcomeEventAt`.
  const timestamp = session.lastActivityAt ?? session.lastOutcomeEventAt ?? session.startedAt;
  // This row stands for an execution (its primary chat). It's "active"
  // when the open view is its primary chat OR — in the tree — any sibling
  // chat of the same execution (tracked via activeExecutionId), so opening
  // a different chat from the in-execution history doesn't drop the
  // highlight onto nothing. needs-review rows stay strict (per-chat).
  const isActive =
    activeSessionId === session.id ||
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
    setActiveView(executionView(session.id));
  };

  // Title by the execution (stable across its chats), falling back to the
  // primary chat's label for legacy executions that were never named.
  // Null on both until the first user message derives one — show a muted
  // placeholder until then so the row stays orientable.
  const label = session.execution?.label ?? session.label ?? 'Untitled';
  const labelIsPlaceholder = !(session.execution?.label ?? session.label);
  const isPinned = !!session.execution?.pinnedAt;

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
        'relative w-full group flex gap-2 pr-1.5 rounded-md transition-[color,background-color,opacity] text-left cursor-pointer',
        // Compact: 32px, inset so the dot sits under the agent's icon.
        density === 'compact' ? 'items-center pl-4 h-8' : 'items-start pl-5 py-1',
        inactive && !isActive && !selected && 'opacity-60 hover:opacity-100',
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
          // Idle rows keep the branch glyph, so the row still parses as an
          // execution at rest.
          <StatusPip {...status} idle={<GitBranch size={10} className="flex-shrink-0 opacity-50" />} />
        )}
      </span>
      {density === 'compact' ? (
        <>
          <Tip label={label}>
            <span
              className={cn(
                'flex-1 min-w-0 truncate text-[11px]',
                labelIsPlaceholder ? 'italic text-muted-foreground/70' : 'font-medium',
                isUnread && !labelIsPlaceholder && 'font-semibold text-foreground',
              )}
            >
              {label}
            </span>
          </Tip>
          {/* Static tokens only, so nothing arrives late and moves. The
              kebab takes this slot on hover. */}
          <span
            className={cn(
              'flex flex-shrink-0 items-center gap-1.5 text-[9px] leading-none transition-opacity',
              !selectable && 'group-hover:opacity-0',
            )}
          >
            {isPinned && !hidePinMarker && (
              <Pin size={9} className="text-muted-foreground/50 fill-current -rotate-45" aria-label="Pinned" />
            )}
            {session.location && !session.location.isHome && (
              <Tip label={`Runs on ${session.location.name}`}>
                <span className="max-w-[5rem] truncate text-muted-foreground/60">
                  {session.location.name}
                </span>
              </Tip>
            )}
            {inactive && <Moon size={9} className="text-muted-foreground/60" aria-label="Inactive" />}
            <span className="text-muted-foreground/60 tabular-nums">{formatCompactRelative(timestamp)}</span>
          </span>
        </>
      ) : (
        <div className="flex-1 min-w-0">
          <Tip label={label}>
            <span
              className={cn(
                'block text-[11px] truncate',
                labelIsPlaceholder ? 'italic text-muted-foreground/70' : 'font-medium',
                isUnread && !labelIsPlaceholder && 'font-semibold text-foreground',
              )}
            >
              {label}
            </span>
          </Tip>
          {/* Metadata line: the timestamp anchors it, then the workspace
              tag (Pinned and Needs you) and where it runs. */}
          <div className="flex items-center gap-1.5 mt-0.5 text-[9px] leading-none">
            {isPinned && !hidePinMarker && (
              <Pin
                size={9}
                className="text-muted-foreground/50 fill-current flex-shrink-0 -rotate-45"
                aria-label="Pinned"
              />
            )}
            {inactive && (
              <Moon size={9} className="text-muted-foreground/60 flex-shrink-0" aria-label="Inactive" />
            )}
            <Tip label={inactive ? `Inactive: no activity for ${formatCompactRelative(timestamp)}` : undefined}>
              <span
                className="text-muted-foreground/60 flex-shrink-0"
              >
                {formatCompactRelative(timestamp)}
              </span>
            </Tip>
            {showWorkspaceLabel && (
              <span className="text-muted-foreground/50 truncate">· {showWorkspaceLabel}</span>
            )}
            {/* Work away from the home says where (P3.1). The home's own stays quiet. */}
            {session.location && !session.location.isHome && (
              <Tip label={`Runs on ${session.location.name}`}>
                <span className="text-muted-foreground/60 truncate">· {session.location.name}</span>
              </Tip>
            )}
          </div>
        </div>
      )}
      {/* The metadata cluster is left-anchored, so the row's right
          half is dead space — the kebab fades in there without hiding
          or displacing anything. Hidden in selection mode: the row's
          only job then is to toggle, and a per-row menu would invite a
          one-off archive that competes with the batch action. */}
      {!selectable && inactive && (
        <InactiveQuickActions sessionId={session.id} label={label} isPinned={isPinned} />
      )}
      {!selectable && (
        <SessionRowMenu
          sessionId={session.id}
          workspaceId={session.workspaceId ?? null}
          isUnread={isUnread || isPending}
          isPinned={isPinned}
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
 * One-click ways out for an inactive row, beside the kebab on hover: Unpin
 * (pinned rows) and Archive. Everything else stays in the kebab.
 */
function InactiveQuickActions({ sessionId, label, isPinned }: { sessionId: string; label: string; isPinned: boolean }) {
  const unpin = useUnpinSession();
  const { archive } = useArchiveExecution();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const button =
    'p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/40';
  return (
    <span
      onPointerDown={stop}
      className="absolute right-7 top-1/2 -translate-y-1/2 flex items-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
    >
      {isPinned && (
        <Tip label="Unpin">
          <button
            type="button"
            aria-label="Unpin"
            className={button}
            onClick={(e) => {
              stop(e);
              unpin.mutate(sessionId);
            }}
          >
            <PinOff size={12} />
          </button>
        </Tip>
      )}
      <Tip label="Archive">
        <button
          type="button"
          aria-label="Archive"
          className={button}
          onClick={(e) => {
            stop(e);
            void archive({ id: sessionId, label });
          }}
        >
          <Archive size={12} />
        </button>
      </Tip>
    </span>
  );
}

