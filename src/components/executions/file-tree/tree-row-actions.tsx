'use client';

import { MoreHorizontal, Pencil, Trash2, FilePlus, FolderPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface TreeRowActionsProps {
  kind: 'file' | 'dir';
  /** Always shown — the kebab fades in on hover but stays visible if open. */
  visible: boolean;
  onRename: () => void;
  onDelete: () => void;
  /** Only available for dirs — files don't get child-create entries. */
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
}

/**
 * The hover kebab on a tree row. Lives outside `tree-entry-row.tsx` so
 * the row stays a thin button + label, and the menu's portal-rendered
 * popover doesn't have to thread through the row's flex layout.
 *
 * The trigger swallows clicks (`stopPropagation`) so opening the menu
 * doesn't also fire the row's `onSelect`.
 */
export function TreeRowActions({
  kind,
  visible,
  onRename,
  onDelete,
  onCreateFile,
  onCreateFolder,
}: TreeRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => {
          e.stopPropagation();
        }}
        // The chevron stays in DOM so layout doesn't shift, but is
        // visually hidden until row hover OR menu open.
        className={cn(
          'inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-opacity shrink-0',
          'data-[state=open]:opacity-100',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        aria-label="Row actions"
      >
        <MoreHorizontal size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-40">
        {kind === 'dir' && onCreateFile && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onCreateFile();
            }}
          >
            <FilePlus size={14} />
            New file
          </DropdownMenuItem>
        )}
        {kind === 'dir' && onCreateFolder && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onCreateFolder();
            }}
          >
            <FolderPlus size={14} />
            New folder
          </DropdownMenuItem>
        )}
        {kind === 'dir' && (onCreateFile || onCreateFolder) && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          <Pencil size={14} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={14} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
