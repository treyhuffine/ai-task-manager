'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileSearch, Loader2, RotateCw } from 'lucide-react';
import { FileIcon } from '@/components/file-icon';
import { useSessionDiff, useWorktreeScope } from '@/hooks/use-execution';
import { apiErrorText } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { DiffLines } from '../file-chip';
import { summarizeChanges, filesLabel, type ChangedFileSummary } from './changes-summary';

interface ChangesViewProps {
  sessionId: string;
  /** The branch the worktree is compared against, for the header. */
  baseBranch: string | null;
  /** Open a file in the Files view (a drill-down, so it gets a way back). */
  onOpenFile: (path: string) => void;
}

const LETTER_CLASS: Record<ChangedFileSummary['letter'], string> = {
  M: 'text-amber-600 dark:text-amber-400',
  A: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-rose-600 dark:text-rose-400',
  R: 'text-sky-600 dark:text-sky-400',
};

/**
 * The Changes view: every file that differs from the base in this
 * worktree, each expandable to its diff inline. It covers the whole
 * worktree (every chat on the execution, committed or not), which the
 * header says, since one chat's turn may have touched only some of them.
 * Committing and pushing stays in the header's git chip.
 */
export function ChangesView({ sessionId, baseBranch, onOpenFile }: ChangesViewProps) {
  const qc = useQueryClient();
  const scope = useWorktreeScope(sessionId);
  const diff = useSessionDiff(sessionId);
  const summary = useMemo(() => summarizeChanges(diff.data), [diff.data]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const refresh = () => {
    if (scope) qc.invalidateQueries({ queryKey: [...scope, 'diff'] });
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="whitespace-nowrap text-[12.5px] font-semibold text-foreground">
          {diff.data ? `${filesLabel(summary.files.length)} changed` : 'Changes'}
        </span>
        {summary.files.length > 0 && (
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums opacity-80">
            <span className="text-emerald-600 dark:text-emerald-400">+{summary.additions}</span>{' '}
            <span className="text-rose-600 dark:text-rose-400">−{summary.deletions}</span>
          </span>
        )}
        <span
          className="min-w-0 truncate text-[11.5px] text-muted-foreground/80"
          title="Every change in this worktree, from every chat on this execution, committed or not"
        >
          in this worktree{baseBranch ? ` · against ${baseBranch}` : ''}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          disabled={diff.isFetching}
          title="Refresh"
          aria-label="Refresh changes"
          className="inline-flex size-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
        >
          {diff.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {diff.isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded bg-muted/40" />
            ))}
          </div>
        ) : diff.error ? (
          <Empty title="Couldn't load the changes" body={apiErrorText(diff.error)} />
        ) : summary.files.length === 0 ? (
          <Empty title="No changes yet" body="Nothing in this worktree differs from the base branch." />
        ) : (
          summary.files.map((f) => (
            <ChangeRow
              key={f.file.path}
              change={f}
              open={expanded.has(f.file.path)}
              onToggle={() => toggle(f.file.path)}
              onOpenFile={f.letter === 'D' ? undefined : () => onOpenFile(f.file.path)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ChangeRow({
  change,
  open,
  onToggle,
  onOpenFile,
}: {
  change: ChangedFileSummary;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: () => void;
}) {
  const { file, letter, dir, name, additions, deletions, binary } = change;
  return (
    <div className="border-b border-border">
      <div className="group flex h-9 items-center gap-2 pl-2 pr-2 hover:bg-muted/30">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={open ? 'Hide the diff' : 'Show the diff'}
        >
          <ChevronRight
            size={13}
            className={cn('flex-shrink-0 text-muted-foreground/60 transition-transform', open && 'rotate-90')}
          />
          <span className={cn('w-3 flex-shrink-0 font-mono text-[11px] font-bold', LETTER_CLASS[letter])}>{letter}</span>
          <FileIcon name={name} size={13} className="flex-shrink-0" />
          <span className="min-w-0 truncate text-[12.5px]">
            <span className="text-muted-foreground/70">{dir}</span>
            <span className="text-foreground">{name}</span>
          </span>
        </button>
        <span className="flex-shrink-0 font-mono text-[11px] tabular-nums">
          {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
          {additions > 0 && deletions > 0 && ' '}
          {deletions > 0 && <span className="text-rose-600 dark:text-rose-400">−{deletions}</span>}
        </span>
        {onOpenFile ? (
          <button
            type="button"
            onClick={onOpenFile}
            title="Open in Files"
            aria-label={`Open ${name} in Files`}
            className="inline-flex size-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <FileSearch size={13} />
          </button>
        ) : (
          <span className="w-6 flex-shrink-0" />
        )}
      </div>
      {open && (
        <div className="border-t border-border bg-muted/10 py-1">
          {file.oldPath && file.status === 'renamed' && (
            <div className="px-3 py-1 text-[11px] text-muted-foreground">Renamed from {file.oldPath}</div>
          )}
          {binary ? (
            <div className="px-3 py-2 text-[11.5px] text-muted-foreground">Binary file, no text diff.</div>
          ) : file.hunks.length === 0 ? (
            <div className="px-3 py-2 text-[11.5px] text-muted-foreground">No line changes.</div>
          ) : (
            file.hunks.map((h, i) => (
              <div key={i} className="mb-1">
                <div className="px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground/60">
                  @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
                </div>
                <DiffLines lines={h.lines} className="text-[11px]" />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <span className="text-[13px] font-medium text-foreground">{title}</span>
      <span className="max-w-sm text-[12px] text-muted-foreground">{body}</span>
    </div>
  );
}
