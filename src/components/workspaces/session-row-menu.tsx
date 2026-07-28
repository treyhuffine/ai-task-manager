'use client';

import {
  MoreVertical, Archive, Eye, EyeOff, Settings, Plus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useMarkSessionRead,
  useMarkSessionUnread,
} from '@/hooks/use-workspaces';
import { useArchiveWithConfirm } from '@/hooks/use-archive-with-confirm';
import { cn } from '@/lib/utils';

interface SessionRowMenuProps {
  sessionId: string;
  workspaceId: string | null;
  /** True when the parent workspace is git-backed. Gates the
   *  "Execution from git…" item. */
  /**
   * Pre-classified read state. The menu hides Mark unread / Mark read
   * based on which one is the current state.
   */
  isUnread: boolean;
  label: string;
  /** Open the workspace settings sheet. Hidden when omitted. */
  onOpenWorkspaceSettings?: (id: string) => void;
  /** Open the launcher seeded with the row's workspace. Hidden when omitted. */
  onOpenLauncher?: (workspaceId: string) => void;
  className?: string;
}

/**
 * Shared per-session context menu. Three intent groups, separated by
 * dividers so the action set is scannable:
 *
 *   1. Read state — Mark read / Mark unread (toggles based on current).
 *   2. Workspace ops — New execution, Execution from git, Workspace
 *      settings. Lifted into the row menu so the by-status surface
 *      (which has no workspace tree) can still drive them.
 *   3. Destructive — Archive.
 *
 * Stops pointerdown so dnd-kit doesn't see the click as a drag start
 * and the row click handler doesn't fire when the menu is invoked.
 */
export function SessionRowMenu({
  sessionId,
  workspaceId,
  isUnread,
  label,
  onOpenWorkspaceSettings,
  onOpenLauncher,
  className,
}: SessionRowMenuProps) {
  const { confirmArchive } = useArchiveWithConfirm();
  const markRead = useMarkSessionRead();
  const markUnread = useMarkSessionUnread();

  const handleArchive = () => {
    void confirmArchive({ id: sessionId, label });
  };

  const showWorkspaceGroup =
    !!workspaceId && (!!onOpenLauncher || !!onOpenWorkspaceSettings);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Session actions"
          className={cn(
            'p-1 rounded transition-opacity text-muted-foreground/60 hover:text-foreground hover:bg-muted/40',
            // Hidden until hover OR open. We use opacity + pointer-events
            // instead of display:none so the trigger keeps a real
            // bounding rect — Radix anchors the popover from
            // getBoundingClientRect, and a display:none trigger collapses
            // to (0,0,0,0), slamming the menu to the viewport's top-left.
            // data-[state=open] is set by Radix on the trigger while
            // the menu is open, which keeps the button visible after
            // the mouse leaves the row.
            'opacity-0 pointer-events-none',
            'group-hover:opacity-100 group-hover:pointer-events-auto',
            'data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
            className,
          )}
        >
          <MoreVertical size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="text-[11px] min-w-[180px]"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {isUnread ? (
          <DropdownMenuItem onSelect={() => markRead.mutate(sessionId)}>
            <Eye size={12} /> Mark as read
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => markUnread.mutate(sessionId)}>
            <EyeOff size={12} /> Mark as unread
          </DropdownMenuItem>
        )}

        {showWorkspaceGroup && (
          <>
            <DropdownMenuSeparator />
            {onOpenLauncher && workspaceId && (
              <DropdownMenuItem onSelect={() => onOpenLauncher(workspaceId)}>
                <Plus size={12} /> Start work here…
              </DropdownMenuItem>
            )}
            {onOpenWorkspaceSettings && workspaceId && (
              <DropdownMenuItem onSelect={() => onOpenWorkspaceSettings(workspaceId)}>
                <Settings size={12} /> Workspace settings
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleArchive}>
          <Archive size={12} /> Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
