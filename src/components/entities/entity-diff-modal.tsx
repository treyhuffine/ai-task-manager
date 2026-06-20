'use client';

import { useMemo, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Undo2, Loader2, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { api, ApiError } from '@/lib/api/client';
import { lineDiff, splitDiff, type SplitRow } from '@/lib/executions/edit-diff';
import { DiffLines } from '@/components/executions/file-chip';
import { cn } from '@/lib/utils';
import type { EntityVersionRecord, EntityVersionSnapshot } from '@/db/types';

type EntityType = 'task' | 'note';

interface EntityDiffModalProps {
  open: boolean;
  onClose: () => void;
  entityType: EntityType;
  entityId: string;
}

interface FieldSpec {
  key: keyof EntityVersionSnapshot;
  label: string;
}

const TASK_PROPS: FieldSpec[] = [
  { key: 'status', label: 'Status' },
  { key: 'energy', label: 'Energy' },
  { key: 'effort', label: 'Effort' },
  { key: 'hardDeadline', label: 'Deadline' },
  { key: 'resurfaceAfter', label: 'Resurface' },
  { key: 'recurrence', label: 'Recurrence' },
  { key: 'blockedOn', label: 'Blocked on' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'userContext', label: 'Context' },
];

const NOTE_PROPS: FieldSpec[] = [
  { key: 'status', label: 'Status' },
  { key: 'url', label: 'URL' },
];

function str(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sourceLabel(source: EntityVersionRecord['source']): string {
  return source === 'ai' ? 'AI' : source === 'system' ? 'Revert' : 'You';
}

/**
 * Review + undo a single change to a note/task. Opened from the "view
 * changes" chip the in-document chat renders after the agent edits the
 * entity. Shows the diff between a version and the one before it; "Undo"
 * restores that earlier snapshot (itself recorded as a new version, so the
 * undo is undoable).
 */
export function EntityDiffModal({ open, onClose, entityType, entityId }: EntityDiffModalProps) {
  const qc = useQueryClient();
  const versionsKey = ['entity-versions', entityType, entityId] as const;

  const { data, isLoading, error } = useQuery({
    queryKey: versionsKey,
    queryFn: () =>
      api.get<{ versions: EntityVersionRecord[] }>(
        `/entity-versions?entityType=${entityType}&entityId=${entityId}`,
      ),
    enabled: open,
  });

  const versions = useMemo(() => data?.versions ?? [], [data]);
  // changeIndex i compares versions[i] (after) against versions[i+1] (before).
  const [changeIndex, setChangeIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const maxChangeIndex = Math.max(0, versions.length - 2);
  const idx = Math.min(changeIndex, maxChangeIndex);
  const after = versions[idx];
  const before = versions[idx + 1];

  const revert = useMutation({
    mutationFn: (versionId: string) => api.post(`/entity-versions/${versionId}/revert`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: [entityType, entityId] });
      qc.invalidateQueries({ queryKey: versionsKey });
      qc.invalidateQueries({ queryKey: ['deck'] });
      onClose();
    },
  });

  const noun = entityType;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-background shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            viewMode === 'split' ? 'max-w-4xl' : 'max-w-2xl',
          )}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Changes to this {noun}</DialogPrimitive.Title>
            <DialogPrimitive.Description>Review and undo a change to this {noun}.</DialogPrimitive.Description>
          </VisuallyHidden.Root>

          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border px-4 h-12 flex-shrink-0">
            <History size={14} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">Changes to this {noun}</span>
            {versions.length > 2 && (
              <div className="ml-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                <button
                  onClick={() => setChangeIndex((i) => Math.min(i + 1, maxChangeIndex))}
                  disabled={idx >= maxChangeIndex}
                  className="p-0.5 rounded hover:bg-accent disabled:opacity-30"
                  aria-label="Older change"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="tabular-nums">
                  {idx + 1} / {Math.max(1, versions.length - 1)}
                </span>
                <button
                  onClick={() => setChangeIndex((i) => Math.max(i - 1, 0))}
                  disabled={idx <= 0}
                  className="p-0.5 rounded hover:bg-accent disabled:opacity-30"
                  aria-label="Newer change"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <div className="flex rounded-md border border-border p-0.5 text-[10.5px]">
                {(['split', 'unified'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={cn(
                      'rounded px-1.5 py-0.5 capitalize transition-colors',
                      viewMode === m ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="text-center text-[12px] text-muted-foreground py-12">
                {error instanceof ApiError ? error.message : 'Couldn’t load change history.'}
              </p>
            ) : !after || !before ? (
              <p className="text-center text-[12px] text-muted-foreground py-12">
                No earlier version to compare — this {noun} has no recorded changes yet.
              </p>
            ) : (
              <DiffBody
                before={before.snapshot}
                after={after.snapshot}
                fields={entityType === 'task' ? TASK_PROPS : NOTE_PROPS}
                viewMode={viewMode}
              />
            )}
          </div>

          {/* Footer */}
          {after && before && (
            <div className="flex items-center gap-3 border-t border-border px-4 h-14 flex-shrink-0">
              <div className="text-[11px] text-muted-foreground">
                Changed by <span className="font-medium text-foreground/80">{sourceLabel(after.source)}</span>
                {' · '}
                {formatWhen(after.createdAt)}
              </div>
              <button
                onClick={() => revert.mutate(before.id)}
                disabled={revert.isPending}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {revert.isPending ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                Undo this change
              </button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DiffBody({
  before,
  after,
  fields,
  viewMode,
}: {
  before: EntityVersionSnapshot;
  after: EntityVersionSnapshot;
  fields: FieldSpec[];
  viewMode: 'split' | 'unified';
}) {
  const titleChanged = str(before.title) !== str(after.title);
  const bodyChanged = str(before.body) !== str(after.body);
  const changedProps = fields.filter((f) => str(before[f.key]) !== str(after[f.key]));

  if (!titleChanged && !bodyChanged && changedProps.length === 0) {
    return <p className="text-center text-[12px] text-muted-foreground py-8">No visible differences.</p>;
  }

  const renderDiff = (oldText: string, newText: string, extra?: string) =>
    viewMode === 'split' ? (
      <SideBySideDiff rows={splitDiff(oldText, newText)} className={cn('rounded border border-border/50', extra)} />
    ) : (
      <DiffLines lines={lineDiff(oldText, newText)} className={cn('rounded border border-border/50 p-2', extra)} />
    );

  return (
    <div className="space-y-4">
      {(titleChanged || bodyChanged) && viewMode === 'split' && (
        <div className="flex text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
          <span className="flex-1">Before</span>
          <span className="flex-1 pl-3">After</span>
        </div>
      )}

      {titleChanged && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Title</h3>
          {renderDiff(str(before.title), str(after.title))}
        </section>
      )}

      {bodyChanged && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Body</h3>
          {renderDiff(str(before.body), str(after.body), 'max-h-[45vh] overflow-y-auto')}
        </section>
      )}

      {changedProps.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Properties</h3>
          <div className="space-y-1">
            {changedProps.map((f) => (
              <div key={String(f.key)} className="flex items-baseline gap-2 text-[12px]">
                <span className="w-24 flex-shrink-0 text-muted-foreground">{f.label}</span>
                <span className="text-red-500/80 line-through decoration-red-500/40">{str(before[f.key]) || '—'}</span>
                <span className="text-muted-foreground/50">{'→'}</span>
                <span className={cn('text-emerald-600 dark:text-emerald-400')}>{str(after[f.key]) || '—'}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Side-by-side (split) diff ────────────────────────────────

function SideBySideDiff({ rows, className }: { rows: SplitRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className={cn('overflow-auto font-mono text-[11px] leading-relaxed', className)}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-stretch">
          <DiffCell cell={r.left} />
          <div className="w-px flex-shrink-0 bg-border/60" />
          <DiffCell cell={r.right} />
        </div>
      ))}
    </div>
  );
}

function DiffCell({ cell }: { cell: SplitRow['left'] | SplitRow['right'] }) {
  const sign = cell.kind === 'del' ? '−' : cell.kind === 'add' ? '+' : '';
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 gap-1.5 px-2 py-px',
        cell.kind === 'del' && 'bg-red-500/10',
        cell.kind === 'add' && 'bg-emerald-500/10',
      )}
    >
      <span className="w-6 flex-shrink-0 select-none text-right tabular-nums text-muted-foreground/35">
        {cell.lineNo ?? ''}
      </span>
      <span
        className={cn(
          'w-2 flex-shrink-0 select-none text-center',
          cell.kind === 'del' && 'text-red-500/70',
          cell.kind === 'add' && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {sign}
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-foreground/90">{cell.text ?? ''}</span>
    </div>
  );
}
