'use client';

import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { GitCompareArrows } from 'lucide-react';
import { FileIcon, FolderIcon } from '@/components/file-icon';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import type { DirtyArchive } from '@/hooks/use-workspaces';
import type { UncommittedFile } from '@/lib/workspaces/uncommitted-files';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

/** Same colors as the Changes view's A and M letters. */
const CHANGE_CLASS: Record<UncommittedFile['change'], string> = {
  untracked: 'text-emerald-600 dark:text-emerald-400',
  changed: 'text-amber-600 dark:text-amber-400',
};

const CHANGE_TITLE: Record<UncommittedFile['change'], string> = {
  untracked: 'Never committed. The whole file is deleted.',
  changed: 'Changed since the last commit. Those changes are deleted.',
};

/**
 * What to ask when an archive was refused because worktrees hold work that
 * isn't committed: the files each would lose, a way to review them first,
 * and Archive anyway. One execution reviews from the footer. Several each
 * get their own Review link above their files.
 */
export function archiveAnywayDialog(dirty: readonly DirtyArchive[], onReview: (id: string) => void): ConfirmOptions {
  const one = dirty.length === 1 ? dirty[0]! : null;
  return {
    title: 'Archive and delete uncommitted files?',
    description: one
      ? `"${one.label?.trim() || 'This execution'}" has work that isn't committed. Archiving removes its worktree, and these files go with it. Everything committed stays on its branch.`
      : `${dirty.length} of these executions have work that isn't committed. Archiving removes their worktrees, and these files go with them. Everything committed stays on each branch.`,
    content: one ? (
      <UncommittedFileList files={one.files} omitted={one.omitted} className="max-h-64" />
    ) : (
      <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
        {dirty.map((d) => (
          <section key={d.id} className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                {d.label?.trim() || 'Untitled'}
              </span>
              <AlertDialogPrimitive.Cancel asChild>
                <button
                  type="button"
                  onClick={() => onReview(d.id)}
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <GitCompareArrows size={12} /> Review
                </button>
              </AlertDialogPrimitive.Cancel>
            </div>
            <UncommittedFileList files={d.files} omitted={d.omitted} />
          </section>
        ))}
      </div>
    ),
    size: 'wide',
    confirmLabel: dirty.length > 1 ? `Archive ${dirty.length} anyway` : 'Archive anyway',
    tone: 'destructive',
    secondaryAction: one
      ? { label: 'Review changes', icon: <GitCompareArrows size={14} />, onSelect: () => onReview(one.id) }
      : undefined,
  };
}

/**
 * The files archiving would delete, one per row: the folder part muted so
 * the name reads first, and whether it's untracked or changed. A folder
 * row (`dir/`) only shows when git couldn't list its files one by one.
 * `files` is null when they couldn't be listed (a device running an older
 * worker).
 */
export function UncommittedFileList({
  files,
  omitted = 0,
  className,
}: {
  files: readonly UncommittedFile[] | null;
  /** Files past the listed cap, shown as a count after the list. */
  omitted?: number;
  className?: string;
}) {
  if (!files || files.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12.5px] text-muted-foreground">
        The files couldn&apos;t be listed. Review the changes to see them.
      </p>
    );
  }
  return (
    <ul
      aria-label="Files that would be deleted"
      className={cn('overflow-y-auto rounded-lg border border-border bg-muted/30 py-1', className)}
    >
      {files.map((file) => {
        const folder = file.path.endsWith('/');
        const trimmed = folder ? file.path.slice(0, -1) : file.path;
        const cut = trimmed.lastIndexOf('/') + 1;
        const dir = trimmed.slice(0, cut);
        const name = trimmed.slice(cut) + (folder ? '/' : '');
        return (
          <Tip key={file.path} label={file.path}>
            <li className="flex h-7 items-center gap-2 px-3">
              {folder ? (
                <FolderIcon name={name.slice(0, -1)} opened={false} size={13} className="flex-shrink-0" />
              ) : (
                <FileIcon name={name} size={13} className="flex-shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12.5px]">
                <span className="text-muted-foreground/70">{dir}</span>
                <span className="text-foreground">{name}</span>
              </span>
              <Tip label={CHANGE_TITLE[file.change]}>
                <span className={cn('flex-shrink-0 text-[11px]', CHANGE_CLASS[file.change])}>
                  {file.change}
                </span>
              </Tip>
            </li>
          </Tip>
        );
      })}
      {omitted > 0 && (
        <li className="flex h-7 items-center px-3 text-[12px] text-muted-foreground">
          and {omitted.toLocaleString()} more {omitted === 1 ? 'file' : 'files'}
        </li>
      )}
    </ul>
  );
}
