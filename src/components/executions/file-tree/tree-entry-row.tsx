'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import type { TreeEntry, TreeEntryStatus } from '@/lib/api/sessions';
import { FileIcon, FolderIcon } from '@/components/file-icon';
import { TreeRowActions } from './tree-row-actions';
import { HighlightedText } from './match-highlight';

interface RowActionsHandlers {
  onRename: () => void;
  onDelete: () => void;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
  onCopyRelativePath?: () => void;
  onCopyAbsolutePath?: () => void;
  onReferenceInChat?: () => void;
}

interface DirRowProps {
  name: string;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  actions?: RowActionsHandlers;
  /** When set, matches in the rendered name get a highlight wrap. */
  highlightQuery?: string | null;
}

interface FileRowProps {
  entry: TreeEntry;
  /** Override label — used by 'changed' mode + filtered tree to show full path. */
  label?: string;
  depth: number;
  selected: boolean;
  onSelect: () => void;
  actions?: RowActionsHandlers;
  highlightQuery?: string | null;
  /** True while a write-file mutation is in flight for this path —
   *  swaps the M/A/D badge for a spinner. */
  saving?: boolean;
}

const INDENT_PX = 12;

export function TreeDirRow({
  name,
  depth,
  expanded,
  onToggle,
  actions,
  highlightQuery,
}: DirRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group flex w-full items-center gap-1 py-1 pr-2 text-left text-[12px] text-foreground/85 hover:bg-muted/60 transition-colors"
      style={{ paddingLeft: 6 + depth * INDENT_PX }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 flex-1 min-w-0 text-left"
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-muted-foreground/70" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-muted-foreground/70" />
        )}
        <FolderIcon name={name} opened={expanded} />
        <span className="truncate font-medium">
          <HighlightedText text={name} query={highlightQuery} />
        </span>
      </button>
      {actions && (
        <TreeRowActions
          kind="dir"
          visible={hover}
          onRename={actions.onRename}
          onDelete={actions.onDelete}
          onCreateFile={actions.onCreateFile}
          onCreateFolder={actions.onCreateFolder}
          onCopyRelativePath={actions.onCopyRelativePath}
          onCopyAbsolutePath={actions.onCopyAbsolutePath}
          onReferenceInChat={actions.onReferenceInChat}
        />
      )}
    </div>
  );
}

/**
 * A directory we show but don't let the user expand — its contents are
 * intentionally not listed (e.g. `node_modules`: present, but too big to browse
 * here). Muted, no chevron, with a hint to open it in an editor instead.
 */
export function CollapsedDirRow({ name, depth }: { name: string; depth: number }) {
  return (
    <div
      className="flex w-full items-center gap-1 py-1 pr-2 text-left text-[12px] text-muted-foreground/55"
      style={{ paddingLeft: 6 + depth * INDENT_PX }}
      title={`${name} is present but not browsable here. Open it in your editor`}
    >
      {/* keep the name aligned with expandable siblings (which have a chevron) */}
      <span className="w-3 shrink-0" />
      <FolderIcon name={name} opened={false} />
      <span className="truncate font-medium">{name}</span>
      <span className="ml-1.5 shrink-0 text-[10px] text-muted-foreground/40">open in editor</span>
    </div>
  );
}

export function TreeFileRow({
  entry,
  label,
  depth,
  selected,
  onSelect,
  actions,
  highlightQuery,
  saving,
}: FileRowProps) {
  const [hover, setHover] = useState(false);
  const statusBadge = entry.status ? statusBadgeChar(entry.status) : null;
  const statusColor = entry.status ? statusBadgeColor(entry.status) : '';
  const display = label ?? entry.name;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ paddingLeft: 18 + depth * INDENT_PX }}
      className={cn(
        'group flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[12px] transition-colors',
        selected
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground/80 hover:bg-muted/60',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
      >
        <FileIcon name={entry.name} />
        {/* Color the filename to match its git status, VS Code-style:
            modified=amber, added/untracked=emerald, deleted=rose. The
            badge color stays in sync because both sides of the row read
            from `statusBadgeColor`. */}
        <span className={cn('truncate flex-1', statusColor || undefined)}>
          <HighlightedText text={display} query={highlightQuery} />
        </span>
      </button>
      {/* Status + mtime hide when the kebab is visible so the row
          doesn't get crowded — the kebab is the user's primary affordance
          when they're reaching for the row. The save spinner takes
          precedence over the M/A/D badge while a write is in flight. */}
      {!hover && saving ? (
        <Loader2
          size={11}
          className="shrink-0 animate-spin text-muted-foreground/80"
          aria-label="Saving"
        />
      ) : (
        !hover &&
        statusBadge && (
          <span
            className={cn(
              'shrink-0 inline-flex items-center justify-center text-[10px] font-bold leading-none w-3.5',
              statusColor,
            )}
            title={entry.status}
          >
            {statusBadge}
          </span>
        )
      )}
      {!hover && !saving && entry.status && entry.mtime && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          {formatCompactRelative(entry.mtime)}
        </span>
      )}
      {actions && (
        <TreeRowActions
          kind="file"
          visible={hover}
          onRename={actions.onRename}
          onDelete={actions.onDelete}
          onCopyRelativePath={actions.onCopyRelativePath}
          onCopyAbsolutePath={actions.onCopyAbsolutePath}
          onReferenceInChat={actions.onReferenceInChat}
        />
      )}
    </div>
  );
}

export function statusBadgeChar(status: TreeEntryStatus): string {
  switch (status) {
    case 'modified':
    case 'staged':
      return 'M';
    case 'added':
    case 'untracked':
      return 'A';
    case 'deleted':
      return 'D';
  }
}

export function statusBadgeColor(status: TreeEntryStatus): string {
  switch (status) {
    case 'modified':
    case 'staged':
      return 'text-amber-500 dark:text-amber-400';
    case 'added':
    case 'untracked':
      return 'text-emerald-500 dark:text-emerald-400';
    case 'deleted':
      return 'text-rose-500 dark:text-rose-400';
  }
}

