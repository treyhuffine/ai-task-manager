'use client';

import { Archive, Pin, PinOff } from 'lucide-react';
import { Tip } from '@/components/ui/tip';
import { useArchiveExecution } from '@/hooks/use-archive-execution';
import { usePinSession, useUnpinSession } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { SessionRowMenu } from './session-row-menu';

interface SessionRowActionsProps {
  sessionId: string;
  workspaceId: string | null;
  label: string;
  /** Read state for the menu's Mark read / Mark unread. */
  isUnread: boolean;
  /**
   * The row's pin. Undefined on rows that can't be pinned (an archived chat
   * in Recent), which drop the toggle.
   */
  isPinned?: boolean;
  /** Inactive rows add Archive, so stale work is one click from gone. */
  archivable?: boolean;
  onOpenWorkspaceSettings?: (id: string) => void;
  onOpenLauncher?: (workspaceId: string) => void;
  className?: string;
}

/**
 * A rail row's actions: Archive (inactive rows), the pin, then ⋯. The pin
 * sits beside ⋯ so pinning and unpinning are one click, and ⋯ keeps the rest.
 * Archive goes left of the pin, so the pin is in the same place on every row.
 *
 * They show while the row is hovered, its menu is open, or the keyboard is on
 * it. The rest of the time they take no width, so they sit at the end of the
 * row's own line rather than over it: the title gives way, and text that
 * yields to them (the time) wears `ROW_ACTIONS_GIVE_WAY`. Folded, they still
 * end where they end shown, so ⋯ never moves and its menu stays anchored to
 * it while it closes.
 *
 * Pointer, click and key events stop here: the row opens its chat on click
 * and on Enter, and dnd-kit would read a press as a drag start.
 */
export function SessionRowActions({
  sessionId,
  workspaceId,
  label,
  isUnread,
  isPinned,
  archivable = false,
  onOpenWorkspaceSettings,
  onOpenLauncher,
  className,
}: SessionRowActionsProps) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span
      onPointerDown={stop}
      onClick={stop}
      onKeyDown={stop}
      className={cn('flex flex-shrink-0 items-center justify-end', ROW_ACTIONS_REVEAL, className)}
    >
      {archivable && <ArchiveButton sessionId={sessionId} label={label} />}
      {isPinned !== undefined && <PinToggle sessionId={sessionId} isPinned={isPinned} />}
      <SessionRowMenu
        sessionId={sessionId}
        workspaceId={workspaceId}
        isUnread={isUnread}
        label={label}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onOpenLauncher={onOpenLauncher}
        revealOnRowHover={false}
      />
    </span>
  );
}

/**
 * No width until the row is hovered, its menu is open, or keyboard focus is
 * on the row or inside it. Folded, the buttons overflow to the left (the
 * cluster is end-aligned) and are clipped, so they can't be seen or clicked,
 * and ⋯ keeps the same rect for Radix to anchor its menu to.
 */
const ROW_ACTIONS_REVEAL = cn(
  'w-0 overflow-hidden opacity-0 transition-opacity',
  'group-hover:w-auto group-hover:overflow-visible group-hover:opacity-100',
  'group-has-data-[state=open]:w-auto group-has-data-[state=open]:overflow-visible group-has-data-[state=open]:opacity-100',
  'group-focus-visible:w-auto group-focus-visible:overflow-visible group-focus-visible:opacity-100',
  'group-has-[:focus-visible]:w-auto group-has-[:focus-visible]:overflow-visible group-has-[:focus-visible]:opacity-100',
);

/** Row text the actions replace while they show (the time at a row's end). */
export const ROW_ACTIONS_GIVE_WAY = cn(
  'group-hover:hidden group-has-data-[state=open]:hidden',
  'group-focus-visible:hidden group-has-[:focus-visible]:hidden',
);

const BUTTON =
  'flex items-center justify-center p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/40';

/**
 * Pin to top, or Unpin. A pinned row's pin is filled, the mark the row shows
 * at rest, and turns into the crossed-out pin under the pointer: it says what
 * the row is, then what a click does.
 */
function PinToggle({ sessionId, isPinned }: { sessionId: string; isPinned: boolean }) {
  const pin = usePinSession();
  const unpin = useUnpinSession();
  const action = isPinned ? 'Unpin' : 'Pin to top';
  return (
    <Tip label={action}>
      <button
        type="button"
        aria-label={action}
        className={cn(BUTTON, 'group/pin')}
        onClick={() => (isPinned ? unpin : pin).mutate(sessionId)}
      >
        {isPinned ? (
          <>
            <Pin size={12} className="fill-current -rotate-45 group-hover/pin:hidden" aria-hidden />
            <PinOff size={12} className="hidden group-hover/pin:block" aria-hidden />
          </>
        ) : (
          <Pin size={12} className="-rotate-45" aria-hidden />
        )}
      </button>
    </Tip>
  );
}

function ArchiveButton({ sessionId, label }: { sessionId: string; label: string }) {
  const { archive } = useArchiveExecution();
  return (
    <Tip label="Archive">
      <button
        type="button"
        aria-label="Archive"
        className={BUTTON}
        onClick={() => void archive({ id: sessionId, label })}
      >
        <Archive size={12} aria-hidden />
      </button>
    </Tip>
  );
}
