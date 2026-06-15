'use client';

import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import { FileIcon } from '@/components/file-icon';
import { cn } from '@/lib/utils';
import { basename } from '@/lib/executions/tool-display';
import { dispatchOpenFile } from '@/lib/entity-refs/open-file-event';
import type { DiffLine, EditDiff } from '@/lib/executions/edit-diff';
import type { TurnFileEdit } from './transcript-grouping';

/**
 * Render a per-edit hunk as colored lines (add/del/ctx). Shared by the
 * chip hover card and the tool row's inline expansion.
 */
export function DiffLines({ lines, className }: { lines: DiffLine[]; className?: string }) {
  if (!lines.length) return null;
  return (
    <pre className={cn('overflow-x-auto rounded font-mono text-[10.5px] leading-[1.45]', className)}>
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap wrap-anywhere px-2',
            l.kind === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            l.kind === 'del' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
            l.kind === 'ctx' && 'text-muted-foreground/70',
          )}
        >
          <span className="select-none opacity-50">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '} </span>
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}

/** Compact "+N −M" counts. */
function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span className="flex-shrink-0 tabular-nums text-[10.5px] font-medium">
      {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
      {additions > 0 && deletions > 0 && <span> </span>}
      {deletions > 0 && <span className="text-rose-600 dark:text-rose-400">−{deletions}</span>}
    </span>
  );
}

interface FileChipProps {
  /** Absolute or worktree-relative path. Drives the icon + open action. */
  path: string;
  /** Per-edit diff for counts + hover preview. Omit for reads. */
  diff?: EditDiff | null;
  /** Override the displayed label (defaults to the path basename). */
  label?: string;
  className?: string;
}

/**
 * Conductor-style file chip: an outline button (background = surface, a
 * border) with the file-type icon, name, and +N/−M counts. Hover shows a
 * diff preview; click opens the file in the viewer.
 */
export function FileChip({ path, diff, label, className }: FileChipProps) {
  const name = label ?? basename(path);
  const hasDiff = !!diff && diff.lines.length > 0;

  const chip = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        dispatchOpenFile(path);
      }}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background',
        'px-1.5 py-0.5 text-[11px] text-foreground/90 transition-colors',
        'hover:bg-muted/50 hover:border-border',
        className,
      )}
    >
      <FileIcon name={name} size={13} />
      <span className="truncate font-medium">{name}</span>
      {diff && <DiffCounts additions={diff.additions} deletions={diff.deletions} />}
    </button>
  );

  if (!hasDiff) return chip;

  return (
    <HoverCardPrimitive.Root openDelay={120} closeDelay={60}>
      <HoverCardPrimitive.Trigger asChild>{chip}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-0 shadow-xl outline-none"
        >
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-[11px]">
            <FileIcon name={name} size={13} />
            <span className="truncate font-medium text-foreground">{name}</span>
            <span className="ml-auto"><DiffCounts additions={diff!.additions} deletions={diff!.deletions} /></span>
          </div>
          <div className="max-h-[18rem] overflow-auto py-1">
            <DiffLines lines={diff!.lines} />
          </div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

const FOOTER_MAX_CHIPS = 8;

/**
 * Per-turn "files changed" footer: every file written/edited in the turn
 * as a clickable chip with cumulative +/− counts. Overflow collapses to
 * a "+N more" tally. Counts come from the tool inputs; clicking a chip
 * opens the file (where the viewer shows the full git diff vs base).
 */
export function TurnFilesFooter({ files }: { files: TurnFileEdit[] }) {
  if (!files.length) return null;
  const shown = files.slice(0, FOOTER_MAX_CHIPS);
  const rest = files.slice(FOOTER_MAX_CHIPS);
  const restAdd = rest.reduce((s, f) => s + f.additions, 0);
  const restDel = rest.reduce((s, f) => s + f.deletions, 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10.5px] text-muted-foreground/70">
      <span className="font-medium">
        {files.length} file{files.length !== 1 ? 's' : ''} changed
      </span>
      {shown.map((f) => (
        <FileChip
          key={f.path}
          path={f.path}
          diff={{ path: f.path, kind: 'edit', additions: f.additions, deletions: f.deletions, lines: [] }}
        />
      ))}
      {rest.length > 0 && (
        <span className="tabular-nums">
          +{rest.length} more{' '}
          {restAdd > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{restAdd}</span>}{' '}
          {restDel > 0 && <span className="text-rose-600 dark:text-rose-400">−{restDel}</span>}
        </span>
      )}
    </div>
  );
}
