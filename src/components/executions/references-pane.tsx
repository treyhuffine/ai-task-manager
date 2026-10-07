'use client';

import { tasksApi } from '@/lib/api/tasks';
import { notesApi } from '@/lib/api/notes';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Square,
  StickyNote,
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
import type { ReferenceRow, ReferencesPage } from '@/lib/api/sessions';
import type { ReferenceSection } from '@/lib/sessions/contracts';
import { Tip } from '@/components/ui/tip';

export interface EntityChipInsert {
  kind: 'task' | 'note' | 'scratchpad';
  id: string;
  title: string;
  status?: string;
}

interface ReferencesPaneProps {
  sessionId: string;
  workspaceId: string | null;
  /**
   * Focus the search on mount. True when the user just opened Notes &
   * tasks, false when the panel restored it on load.
   */
  autoFocus?: boolean;
  /**
   * Insert a task / note / scratchpad chip into the composer. Plumbed
   * through from ExecutionView's composerHandleRef so the pane stays
   * decoupled from the editor's internals.
   */
  onInsertChip: (attrs: EntityChipInsert) => void;
}

const SECTION_TITLES: Record<ReferenceSection, string> = {
  inChat: 'In this chat',
  workspace: 'In this agent',
  all: 'All',
};
const SECTION_ORDER: readonly ReferenceSection[] = ['inChat', 'workspace', 'all'];

/**
 * Loaded pages bucketed by section, in section order. A row edited while
 * the user scrolls can reach two pages, so each shows once.
 */
function groupBySection(pages: ReferencesPage[] | undefined) {
  const seen = new Set<string>();
  const rows: Record<ReferenceSection, ReferenceRow[]> = { inChat: [], workspace: [], all: [] };
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      const key = `${row.kind}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows[row.section].push(row);
    }
  }
  return SECTION_ORDER.filter((section) => rows[section].length > 0)
    .map((section) => ({ section, rows: rows[section] }));
}

/**
 * The Notes & tasks view in the execution workbench panel. Sibling to
 * ScratchpadPane. One scrollable list in three sections (In this chat →
 * In this agent → All) under a search, no tabs. Sections render only
 * when they have rows, so a narrow search collapses naturally.
 *
 * The list is paged: the next page loads as the end scrolls into reach,
 * and a section's count is its whole size, not what's loaded. Search goes
 * to the server and covers every task and note title in the home.
 *
 * Each row's Include inserts a task/note chip into the composer. The pane
 * stays open across pushes so the user can pick several in a row.
 *
 * The panel owns the chrome (tab, close, expand), so this component just
 * fills its container.
 */
export function ReferencesPane({
  sessionId,
  workspaceId,
  autoFocus = false,
  onInsertChip,
}: ReferencesPaneProps) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // One request per settle rather than per keystroke. Earlier results stay
  // on screen until the new ones land.
  const term = useDeferredValue(search.trim());
  const {
    data,
    isLoading,
    isError,
    isPlaceholderData,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = useSessionReferences(sessionId, term);
  const searching = term !== search.trim() || isPlaceholderData;

  // Focus the search when the user just opened this view. A restored
  // panel leaves focus where it was.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [autoFocus]);

  // A new search starts at the top of its own list.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [term]);

  // The end of the list within ~a screen of view. Hidden (the panel keeps
  // this view mounted on another tab) it never intersects, so nothing loads.
  const [endInReach, setEndInReach] = useState(false);
  useEffect(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (!root || !end) return;
    const observer = new IntersectionObserver(
      ([entry]) => setEndInReach(entry.isIntersecting),
      { root, rootMargin: '0px 0px 320px 0px' },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  // Keeps loading while the end stays in reach, so a tall panel fills.
  // A failed page waits for Retry instead of looping.
  useEffect(() => {
    if (endInReach && hasNextPage && !isFetchingNextPage && !isFetchNextPageError && !searching) {
      void fetchNextPage();
    }
  }, [endInReach, hasNextPage, isFetchingNextPage, isFetchNextPageError, searching, fetchNextPage]);

  const sections = useMemo(() => groupBySection(data?.pages), [data]);
  const counts = data?.pages[0]?.counts;
  const total = counts ? counts.inChat + counts.workspace + counts.all : 0;

  return (
    <div className="flex flex-col h-full w-full bg-background" aria-label="Notes and tasks">

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
            placeholder="Search all tasks &amp; notes…"
            aria-label="Search all tasks and notes"
            className={cn(
              'w-full pl-7 pr-7 py-1.5 rounded-md text-[12px]',
              'bg-muted/40 border border-transparent',
              'focus:outline-none focus:border-primary/40 focus:bg-background',
              'placeholder:text-muted-foreground/50',
            )}
          />
          {searching && data && (
            <Loader2
              size={12}
              aria-label="Searching"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground/60"
            />
          )}
        </div>
      </div>

      {/* ─── Body ─────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        <div className="space-y-3">
          {isLoading && (
            <div className="px-3 py-3 text-[11px] text-muted-foreground/70">Loading…</div>
          )}

          {isError && !data && (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground/70">
              Couldn&rsquo;t load tasks and notes.{' '}
              <button type="button" onClick={() => void refetch()} className="underline hover:text-foreground">
                Retry
              </button>
            </div>
          )}

          {data && (
            <>
              {sections.map(({ section, rows }) => (
                <Section
                  key={section}
                  title={SECTION_TITLES[section]}
                  count={counts?.[section] ?? rows.length}
                  rows={rows}
                  onInsert={onInsertChip}
                />
              ))}
              {total === 0 && !searching && (
                <div className="px-3 py-4 text-center text-[11px] text-muted-foreground/70">
                  {term
                    ? `No tasks or notes match “${term}”.`
                    : workspaceId
                      ? 'Nothing here yet. Use "+ New" below to create one.'
                      : 'Nothing here yet. This chat has no agent.'}
                </div>
              )}
            </>
          )}
        </div>

        {/* Always mounted so the observer has one thing to watch. */}
        <div ref={endRef} aria-hidden className="h-px" />
        {isFetchingNextPage && (
          <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground/70">
            <Loader2 size={11} className="animate-spin" />
            Loading more…
          </div>
        )}
        {isFetchNextPageError && !isFetchingNextPage && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
            Couldn&rsquo;t load more.{' '}
            <button type="button" onClick={() => void fetchNextPage()} className="underline hover:text-foreground">
              Retry
            </button>
          </div>
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
  count,
  rows,
  onInsert,
}: {
  title: string;
  /** The whole section under the current search, loaded or not. */
  count: number;
  rows: ReferenceRow[];
  onInsert: (attrs: EntityChipInsert) => void;
}) {
  return (
    <div>
      <div className="px-2 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
        {title}
        <span className="ml-1 text-muted-foreground/50 lowercase font-normal tabular-nums">
          · {count}
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
  /** Subtasks render under their parent, outside any section. */
  row: Omit<ReferenceRow, 'section'>;
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
        <Tip label="Insert into the composer">
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
          >
            <Plus size={10} />
            Include
          </button>
        </Tip>
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
    meta: { carriesInput: true },
    mutationFn: async (input: { kind: 'task' | 'note'; title: string }) => {
      if (input.kind === 'task') {
        return tasksApi.create( {
          title: input.title,
          workspaceId: workspaceId,
          rawInput: input.title,
        });
      }
      return notesApi.create( {
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
          {workspaceId ? 'Scoped to this agent' : 'No agent'}
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
