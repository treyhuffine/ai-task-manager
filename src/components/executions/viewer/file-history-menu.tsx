'use client';

import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { FileIcon } from '@/components/file-icon';
import { useSessionTree } from '@/hooks/use-execution';
import { dispatchOpenFile } from '@/lib/entity-refs/open-file-event';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import {
  statusBadgeChar,
  statusBadgeColor,
} from '@/components/executions/file-tree/tree-entry-row';
import type { TreeEntryStatus } from '@/lib/api/sessions';
import type { FileHistoryEntry } from '@/hooks/use-file-history';
import { cn } from '@/lib/utils';

interface FileHistoryMenuProps {
  sessionId: string;
  /** Most-recent-first list, owned by `ExecutionView` via `useFileHistory`. */
  history: FileHistoryEntry[];
  /** Highlights the row for the file currently shown in the viewer. */
  selectedPath: string | null;
}

/**
 * "Recently opened files" affordance that sits at the right edge of the
 * viewer's tab strip. A small history icon opens a popover listing files
 * the user has opened in this execution, newest first, with a relative
 * timestamp and a git-status badge for edited files. An "Edited only"
 * filter narrows the list to files with pending changes.
 *
 * Picking a row reuses the existing `flow:open-file` channel, so the same
 * normalization / tab-swap / re-record path runs as a tree or chip click.
 */
export function FileHistoryMenu({ sessionId, history, selectedPath }: FileHistoryMenuProps) {
  const [open, setOpen] = useState(false);
  const [editedOnly, setEditedOnly] = useState(false);
  const tree = useSessionTree(sessionId);

  // Worktree-relative path → git status, for the badge and "edited"
  // filter. Shares TanStack's cache key with the file tree, so reading it
  // here adds no extra round trip.
  const statusByPath = useMemo(() => {
    const m = new Map<string, TreeEntryStatus>();
    for (const e of tree.data?.entries ?? []) {
      if (e.kind === 'file' && e.status) m.set(e.path, e.status);
    }
    return m;
  }, [tree.data]);

  const rows = useMemo(
    () => (editedOnly ? history.filter((h) => statusByPath.has(h.path)) : history),
    [history, editedOnly, statusByPath],
  );

  const handleOpen = (path: string) => {
    dispatchOpenFile(path);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Recently opened files"
          aria-label="Recently opened files"
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
            open && 'bg-muted text-foreground',
          )}
        >
          <History size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recent files
          </span>
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="file-history-edited-only"
              checked={editedOnly}
              onCheckedChange={(checked) => setEditedOnly(checked === true)}
            />
            <label
              htmlFor="file-history-edited-only"
              className="cursor-pointer select-none text-[11px] text-muted-foreground"
            >
              Edited only
            </label>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            {history.length === 0
              ? 'Files you open will appear here.'
              : 'No edited files in your history.'}
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {rows.map((entry) => {
              const status = statusByPath.get(entry.path);
              const isActive = entry.path === selectedPath;
              return (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => handleOpen(entry.path)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : 'text-foreground/80 hover:bg-muted/60',
                    )}
                  >
                    <FileIcon name={entry.path} size={13} className="shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'truncate text-[12px]',
                            status && statusBadgeColor(status),
                          )}
                        >
                          {basename(entry.path)}
                        </span>
                        {status && (
                          <span
                            className={cn(
                              'shrink-0 text-[10px] font-bold leading-none',
                              statusBadgeColor(status),
                            )}
                          >
                            {statusBadgeChar(status)}
                          </span>
                        )}
                      </span>
                      {dirname(entry.path) && (
                        <span className="truncate text-[10px] text-muted-foreground/60">
                          {dirname(entry.path)}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                      {formatCompactRelative(new Date(entry.openedAt).toISOString())}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}
