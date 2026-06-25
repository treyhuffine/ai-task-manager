'use client';

import { useMemo, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Undo2, Loader2, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { api } from '@/lib/api/client';
import { lineDiff, splitDiff, type SplitRow } from '@/lib/executions/edit-diff';
import { DiffLines } from '@/components/executions/file-chip';
import {
  useEntityVersions,
  groupVersions,
  EMPTY_SNAPSHOT,
  type ChangeGroup,
} from '@/hooks/use-entity-versions';
import { cn } from '@/lib/utils';
import type { EntityVersionSnapshot } from '@/db/types';

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

const NOTE_PROPS: FieldSpec[] = [{ key: 'status', label: 'Status' }, { key: 'url', label: 'URL' }];

function str(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function groupWho(g: ChangeGroup): string {
  return g.source === 'ai' ? 'AI' : g.source === 'system' ? 'Reverted' : 'You';
}

function groupLabel(g: ChangeGroup): string {
  const who = groupWho(g);
  if (g.source === 'system') return who;
  return g.count > 1 ? `${who} · ${g.count} edits` : who;
}

/**
 * Review + undo a change to a note/task. Changes are grouped by author-run
 * (see `groupVersions`), so the AI writing a body in several incremental saves
 * reads as one change — old file vs new file, side by side — and one undo
 * restores the state from before the run. Fixed-size frame so stepping through
 * changes doesn't reflow the dialog.
 */
export function EntityDiffModal({ open, onClose, entityType, entityId }: EntityDiffModalProps) {
  const qc = useQueryClient();
  const versionsKey = ['entity-versions', entityType, entityId] as const;
  const { data, isLoading, error } = useEntityVersions(entityType, entityId, open);

  const groups = useMemo(() => groupVersions(data?.versions ?? []), [data]);
  const [groupIndex, setGroupIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');

  const idx = Math.min(groupIndex, Math.max(0, groups.length - 1));
  const group = groups[idx] as ChangeGroup | undefined;
  const before = group?.before?.snapshot ?? EMPTY_SNAPSHOT;
  const after = group?.after.snapshot ?? EMPTY_SNAPSHOT;
  const canUndo = !!group?.before;

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
          // Fixed frame — width/height don't shift with content while paging
          // through changes. Body scrolls internally.
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(820px,86vh)] w-[min(1100px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Changes to this {noun}</DialogPrimitive.Title>
            <DialogPrimitive.Description>Review and undo a change to this {noun}.</DialogPrimitive.Description>
          </VisuallyHidden.Root>

          {/* Header */}
          <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border px-4">
            <History size={14} className="text-primary" />
            <span className="text-sm font-semibold text-foreground">Changes to this {noun}</span>
            {groups.length > 1 && (
              <div className="ml-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                <button
                  onClick={() => setGroupIndex((i) => Math.min(i + 1, groups.length - 1))}
                  disabled={idx >= groups.length - 1}
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                  aria-label="Older change"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="tabular-nums">
                  {idx + 1} / {groups.length}
                </span>
                <button
                  onClick={() => setGroupIndex((i) => Math.max(i - 1, 0))}
                  disabled={idx <= 0}
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
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
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="py-12 text-center text-[12px] text-muted-foreground">Couldn’t load change history.</p>
            ) : !group ? (
              <p className="py-12 text-center text-[12px] text-muted-foreground">
                No recorded changes for this {noun} yet.
              </p>
            ) : (
              <DiffBody
                before={before}
                after={after}
                fields={entityType === 'task' ? TASK_PROPS : NOTE_PROPS}
                viewMode={viewMode}
              />
            )}
          </div>

          {/* Footer */}
          {group && (
            <div className="flex h-14 flex-shrink-0 items-center gap-3 border-t border-border px-4">
              <div className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{groupLabel(group)}</span>
                {' · '}
                {formatWhen(group.after.createdAt)}
              </div>
              <button
                onClick={() => group.before && revert.mutate(group.before.id)}
                disabled={!canUndo || revert.isPending}
                title={canUndo ? 'Restore the version from before this change' : 'Nothing earlier to restore'}
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
    return <p className="py-8 text-center text-[12px] text-muted-foreground">No visible differences.</p>;
  }

  const renderDiff = (oldText: string, newText: string) =>
    viewMode === 'split' ? (
      <SideBySideDiff rows={splitDiff(oldText, newText)} className="rounded border border-border/50" />
    ) : (
      <DiffLines lines={lineDiff(oldText, newText)} className="rounded border border-border/50 p-2" />
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
          {renderDiff(str(before.body), str(after.body))}
        </section>
      )}

      {changedProps.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Properties</h3>
          <div className="space-y-1">
            {changedProps.map((f) => (
              <div key={String(f.key)} className="flex items-baseline gap-2 text-[12px]">
                <span className="w-24 flex-shrink-0 text-muted-foreground">{f.label}</span>
                <span className="text-red-500/80 line-through decoration-red-500/40">{str(before[f.key]) || '-'}</span>
                <span className="text-muted-foreground/50">{'→'}</span>
                <span className="text-emerald-600 dark:text-emerald-400">{str(after[f.key]) || '-'}</span>
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
