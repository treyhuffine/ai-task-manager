'use client';

import type { ReactNode } from 'react';
import { Archive, MoreHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ENTITY_HEADER } from './entity-header';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Shared task/note chrome. Audience, navigation and contextual controls are slots. */
export function EntityDetailHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2', ENTITY_HEADER, className)}>{children}</div>;
}

/** Archive/delete keep the same menu and accessibility in every document surface. */
export function EntityActionsMenu({ onArchive, onDelete, archiveLabel = 'Archive', deleteLabel = 'Delete', children }: {
  onArchive?: () => void; onDelete?: () => void; archiveLabel?: string; deleteLabel?: string; children?: ReactNode;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label="More actions" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"><MoreHorizontal size={15} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-48 text-xs">
      {children}
      {onArchive && <DropdownMenuItem onSelect={onArchive}><Archive size={13} /> {archiveLabel}</DropdownMenuItem>}
      {onDelete && <DropdownMenuItem onSelect={onDelete} className="text-destructive"><Trash2 size={13} /> {deleteLabel}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
