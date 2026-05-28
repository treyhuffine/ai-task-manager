'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Square,
  StickyNote,
  BookOpen,
  Search,
  ChevronRight,
  X,
  Plus,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionReferences } from '@/hooks/use-execution';
import { useTasks } from '@/hooks/use-tasks';
import { useDashboard } from '@/contexts/dashboard-context';
import { api } from '@/lib/api/client';
import type { ReferenceRow } from '@/lib/api/sessions';

export interface EntityChipInsert {
  kind: 'task' | 'note' | 'scratchpad';
  id: string;
  title: string;
  status?: string;
}

interface ReferencesPaneProps {
  sessionId: string;
  workspaceId: string | null;
  open: boolean;
  onClose: () => void;
  /**
   * Insert a task / note / scratchpad chip into the composer. Plumbed
   * through from ExecutionView's composerHandleRef so the pane stays
   * decoupled from the editor's internals.
   */
  onInsertChip: (attrs: EntityChipInsert) => void;
}

/**
 * The Notes & Tasks slide-over. Sibling to ScratchpadPane. Single
 * scrollable list with three tiered sections (Session → Workspace →
 * All) and a Cmd+K-style search at the top — no tabs. Sections only
 * render when they have at least one matching row, so a narrow search
 * collapses naturally.
 *
 * Each row's `→` inserts a task/note chip into the composer. The pane
 * stays open across pushes so the user can pick several in a row.
 *
 * Positioning is handled by the parent (ExecutionView places the pane
 * in an overlay div that covers tree + viewer); this component just
 * fills its container.
 */
export function ReferencesPane({
  sessionId,
  workspaceId,
  open,
  onClose,
  onInsertChip,
}: ReferencesPaneProps) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Always pull the full three-section payload — there are no tabs, so
  // there's no scope state. The slice/filter happens client-side.
  const referencesQuery = useSessionReferences(sessionId, 'all');

  // Esc closes when open; auto-focus search on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Reset search when the pane closes so the next open starts clean.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (r: ReferenceRow): boolean => {
      if (!q) return true;
      return (r.title ?? '').toLowerCase().includes(q);
    };
    const data = referencesQuery.data;
    return {
      inChat: data?.inChat.filter(match) ?? [],
      workspace: data?.workspace.filter(match) ?? [],
      all: data?.all.filter(match) ?? [],
    };
  }, [referencesQuery.data, search]);

  if (!open) return null;

  const isLoading = referencesQuery.isLoading;
  const totalMatches =
    filtered.inChat.length + filtered.workspace.length + filtered.all.length;

  return (
    <div
      className="flex flex-col h-full w-full bg-background border-l border-border shadow-xl"
      role="dialog"
      aria-label="Notes and tasks"
    >
      {/* ─── Header ───────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <BookOpen size={12} className="text-muted-foreground/80" />
        <span className="text-[12px] font-semibold text-foreground">Notes &amp; Tasks</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Close"
          title="Close (Esc)"
        >
          <X size={13} />
        </button>
      </div>

      {/* ─── Search ───────────────────────────────── */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-border">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks &amp; notes…"
            className={cn(
              'w-full pl-7 pr-3 py-1.5 rounded-md text-[12px]',
              'bg-muted/40 border border-transparent',
              'focus:outline-none focus:border-primary/40 focus:bg-background',
              'placeholder:text-muted-foreground/50',
            )}
          />
        </div>
      </div>

      {/* ─── Body ─────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
        {isLoading && (
          <div className="px-3 py-3 text-[11px] text-muted-foreground/70">Loading…</div>
        )}

        {!isLoading && (
          <>
            {filtered.inChat.length > 0 && (
              <Section title="In this chat" rows={filtered.inChat} onInsert={onInsertChip} />
            )}
            {filtered.workspace.length > 0 && (
              <Section title="In this workspace" rows={filtered.workspace} onInsert={onInsertChip} />
            )}
            {filtered.all.length > 0 && (
              <Section title="All" rows={filtered.all} onInsert={onInsertChip} />
            )}
            {totalMatches === 0 && (
              <div className="px-3 py-4 text-center text-[11px] text-muted-foreground/70">
                {search
                  ? `No tasks or notes match “${search}”.`
                  : workspaceId
                    ? 'Nothing here yet. Use "+ New" below to create one.'
                    : 'Nothing here yet. This chat has no workspace.'}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Footer: Add / Create ─────────────────── */}
      <div className="flex-shrink-0 border-t border-border p-2">
        <CreateRow workspaceId={workspaceId} sessionId={sessionId} onInsertChip={onInsertChip} />
      </div>
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────

function Section({
  title,
  rows,
  onInsert,
}: {
  title: string;
  rows: ReferenceRow[];
  onInsert: (attrs: EntityChipInsert) => void;
}) {
  return (
    <div>
      <div className="px-2 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
        {title}
        <span className="ml-1 text-muted-foreground/50 lowercase font-normal">
          · {rows.length}
        </span>
      </div>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <ReferenceListRow key={`${row.kind}:${row.id}`} row={row} onInsert={onInsert} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One row in the references list. Two actions per row:
 *   - Click the title area → open the task/note in its slideout for
 *     viewing. Uses the dashboard's slideout stack so the chat doesn't
 *     unload underneath.
 *   - "Include" button → push a `[[task:id]]` / `[[note:id]]` chip
 *     into the composer.
 *
 * Tasks with `subtaskCount > 0` get an expand chevron next to the
 * title. Expanding lazy-loads subtasks via `useTasks({ parentId })`
 * and renders them indented below, each with its own Include button —
 * for the "send one subtask at a time" flow.
 */
function ReferenceListRow({
  row,
  onInsert,
  depth = 0,
}: {
  row: ReferenceRow;
  onInsert: (attrs: EntityChipInsert) => void;
  depth?: number;
}) {
  const { openTask, openNote } = useDashboard();
  const [expanded, setExpanded] = useState(false);
  const hasSubtasks = row.kind === 'task' && (row.subtaskCount ?? 0) > 0;

  const Icon =
    row.kind === 'task'
      ? row.status === 'done'
        ? CheckSquare
        : Square
      : StickyNote;

  const handleOpen = () => {
    if (row.kind === 'task') openTask(row.id);
    else openNote(row.id);
  };

  const handleInclude = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInsert({ kind: row.kind, id: row.id, title: row.title, status: row.status });
  };

  const handleToggleSubtasks = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpen();
          }
        }}
        className={cn(
          'group flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer',
          'hover:bg-muted/40 transition-colors',
        )}
        style={depth > 0 ? { paddingLeft: `${0.5 + depth * 1}rem` } : undefined}
        title={`Open ${row.kind}`}
      >
        {hasSubtasks ? (
          <button
            type="button"
            onClick={handleToggleSubtasks}
            className="shrink-0 p-0.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
            aria-expanded={expanded}
          >
            <ChevronRight
              size={11}
              className={cn('transition-transform', expanded && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="w-[15px] shrink-0" />
        )}
        <Icon size={11} className="shrink-0 text-muted-foreground/80" />
        <span className="flex-1 min-w-0 text-[11.5px] text-foreground truncate">
          {row.title || (row.kind === 'task' ? 'Untitled task' : 'Untitled note')}
        </span>
        {hasSubtasks && !expanded && (
          <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
            {row.subtaskCount}
          </span>
        )}
        <button
          type="button"
          onClick={handleInclude}
          className={cn(
            'shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded',
            'text-[10.5px] font-medium',
            'bg-secondary text-secondary-foreground hover:bg-secondary/80',
            'transition-colors',
          )}
          aria-label={`Include ${row.kind} in chat`}
          title="Insert into the composer"
        >
          <Plus size={10} />
          Include
        </button>
      </div>
      {expanded && row.kind === 'task' && (
        <SubtaskList parentId={row.id} depth={depth + 1} onInsert={onInsert} />
      )}
    </li>
  );
}

function SubtaskList({
  parentId,
  depth,
  onInsert,
}: {
  parentId: string;
  depth: number;
  onInsert: (attrs: EntityChipInsert) => void;
}) {
  const { data: subtasks, isLoading } = useTasks({ parentId: parentId });
  const rows = (subtasks ?? []).filter((s) => s.status !== 'archived');

  if (isLoading) {
    return (
      <div
        className="text-[10.5px] text-muted-foreground/60 italic px-2 py-1"
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
      >
        Loading subtasks…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        className="text-[10.5px] text-muted-foreground/60 italic px-2 py-1"
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
      >
        No active subtasks.
      </div>
    );
  }
  return (
    <ul className="space-y-0.5">
      {rows.map((s) => (
        <ReferenceListRow
          key={`task:${s.id}`}
          depth={depth}
          row={{
            kind: 'task',
            id: s.id,
            title: s.title,
            status: s.status,
            areaId: s.areaId,
            workspaceId: s.workspaceId,
            updatedAt: s.updatedAt,
            subtaskCount: s.subtaskCount,
          }}
          onInsert={onInsert}
        />
      ))}
    </ul>
  );
}

// ─── Create row ──────────────────────────────────────────────────

function CreateRow({
  workspaceId,
  sessionId,
  onInsertChip,
}: {
  workspaceId: string | null;
  sessionId: string;
  onInsertChip: (attrs: EntityChipInsert) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'task' | 'note'>('idle');
  const [title, setTitle] = useState('');
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (input: { kind: 'task' | 'note'; title: string }) => {
      if (input.kind === 'task') {
        return api.post<{ id: string; title: string }>('/tasks', {
          title: input.title,
          workspaceId: workspaceId,
          rawInput: input.title,
        });
      }
      return api.post<{ id: string; title: string }>('/notes', {
        title: input.title,
        body: input.title,
        workspaceId: workspaceId,
      });
    },
    onSuccess: (created, input) => {
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'references'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'picker'] });
      onInsertChip({
        kind: input.kind,
        id: created.id,
        title: created.title || input.title,
      });
      setMode('idle');
      setTitle('');
    },
  });

  if (mode === 'idle') {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode('task')}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Plus size={11} />
          New task
        </button>
        <button
          type="button"
          onClick={() => setMode('note')}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Plus size={11} />
          New note
        </button>
        <span className="ml-auto text-[10px] text-muted-foreground/50">
          {workspaceId ? 'Scoped to this workspace' : 'No workspace'}
        </span>
      </div>
    );
  }

  const placeholder = mode === 'task' ? 'Task title' : 'Note title';

  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] font-semibold text-muted-foreground capitalize">
        {mode}:
      </span>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim()) {
            e.preventDefault();
            createMutation.mutate({ kind: mode, title: title.trim() });
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setMode('idle');
            setTitle('');
          }
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 px-2 py-1 text-[11.5px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        type="button"
        onClick={() => title.trim() && createMutation.mutate({ kind: mode, title: title.trim() })}
        disabled={!title.trim() || createMutation.isPending}
        className="px-2 py-1 text-[11px] font-medium bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 transition-colors"
      >
        {createMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Create'}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode('idle');
          setTitle('');
        }}
        className="p-1 rounded-md text-muted-foreground hover:text-foreground"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ─── Header button ───────────────────────────────────────────────

interface ReferencesButtonProps {
  count?: number;
  /** True when the references pane is currently visible. */
  open?: boolean;
  /** Toggles the pane — click again to close. */
  onClick: () => void;
}

export function ReferencesButton({ count, open, onClick }: ReferencesButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!open}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md',
        'text-[11px] font-medium transition-colors flex-shrink-0',
        open
          ? 'bg-primary/15 text-primary hover:bg-primary/20'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      )}
      title={open ? 'Close notes & tasks' : 'Notes & tasks for this session'}
      aria-label={open ? 'Close notes and tasks' : 'Notes and tasks'}
    >
      {open ? <X size={12} /> : <BookOpen size={12} />}
      <span>{open ? 'Close' : 'Notes & Tasks'}</span>
      {!open && count != null && count > 0 && (
        <span className="text-muted-foreground/80 tabular-nums">{count}</span>
      )}
    </button>
  );
}
