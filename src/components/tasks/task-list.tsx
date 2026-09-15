"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { generateKeyBetween } from 'fractional-indexing';
import { tasksApi } from '@/lib/api/tasks';
import { backfillSortKeys, computeBucketPlacement, type Bucket } from '@/lib/utils/bucket-placement';
import { Target, Filter, ArrowDownAz, Loader2, Plus, ChevronDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTasks, useUpdateTask, useCreateTask, useTaskCounts, useTaskAttention } from '@/hooks/use-tasks';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';
import { TASK_LANES, LANE_BY_KEY, laneStatus, ACTIVE_STATUSES, type TaskLane } from '@/lib/tasks/lanes';
import { useAreas } from '@/hooks/use-areas';
import type { TaskAttentionSignals } from '@/db/types';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  ListToolbar,
  ToolbarActiveDot,
  ToolbarSearchButton,
  toolbarButtonClass,
} from '@/components/shared/list-toolbar';
import { TaskViewToggle, type TaskView } from './task-view';
import { TaskRow } from './task-row';
import { todayLocalDate } from '@/lib/deck/date';
import type { Energy } from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

type SortOption = 'sortKey' | 'lastViewedAt' | 'hardDeadline' | 'createdAt' | 'updatedAt';

// A single lane, the aggregate "Active" working set (non-terminal statuses),
// or "All". 'active' and 'all' are multi-status views, not real lanes.
type LaneFilter = TaskLane | 'all' | 'active';

const SORT_LABELS: Record<SortOption, string> = {
  sortKey: 'Priority Order',
  lastViewedAt: 'Last viewed',
  hardDeadline: 'Deadline',
  createdAt: 'Created',
  updatedAt: 'Updated',
};

export function TaskList({ view, onViewChange }: { view?: TaskView; onViewChange?: (next: TaskView) => void } = {}) {
  const { openTask } = useDashboard();

  const [laneFilter, setLaneFilter] = useState<LaneFilter>('current');
  const [energyFilter, setEnergyFilter] = useState<Energy | 'all'>('all');
  const [areaFilter, setAreaFilter] = useState<string | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('sortKey');
  const [switchedFromSort, setSwitchedFromSort] = useState<SortOption | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const dismissSwitchBanner = useCallback(() => {
    setSwitchedFromSort(null);
    setHighlightId(null);
  }, []);

  // Highlight is transient feedback ("here's where it went"), not selection state.
  // Auto-clear so it doesn't read as a stuck/error state.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId]);

  // 'all' → no status filter; 'active' → the non-terminal union; a lane → its
  // single status. The query layer accepts an array and emits an IN clause.
  const statusFilter =
    laneFilter === 'all' ? undefined : laneFilter === 'active' ? ACTIVE_STATUSES : laneStatus(laneFilter);
  const filter = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(energyFilter !== 'all' ? { energy: energyFilter as Energy } : {}),
    ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
    orderBy: sortBy,
  };

  const queryClient = useQueryClient();
  const { data: tasks, isLoading, error } = useTasks(filter);
  const { data: areas } = useAreas();
  const { data: counts } = useTaskCounts(areaFilter !== 'all' ? areaFilter : null);
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const lifecycle = useTaskLifecycle();

  // Attention badges only matter for In-progress work, which appears in the
  // Current Work and Active views.
  const attentionIds = laneFilter === 'current' || laneFilter === 'active' ? (tasks ?? []).map((t) => t.id) : [];
  const { data: attention } = useTaskAttention(attentionIds);

  // Quick-create in the lane, defaulting to the lane's semantics: Consider
  // creates a possibility, Todo commits, Current Work creates a Todo then Starts
  // it (so lifecycle history stays valid). Active adds to Todo. Done/Archived/All
  // do not offer creation.
  const quickCreateLane: TaskLane | null =
    laneFilter === 'active'
      ? 'todo'
      : laneFilter !== 'all' && laneFilter !== 'done' && laneFilter !== 'archived'
        ? (laneFilter as TaskLane)
        : null;
  const handleQuickCreate = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed || !quickCreateLane) return;
      const status = quickCreateLane === 'consider' ? 'consider' : 'todo';
      const created = await createTask.mutateAsync({
        title: trimmed,
        rawInput: trimmed,
        status,
        ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
      } as Parameters<typeof createTask.mutateAsync>[0]);
      if (quickCreateLane === 'current' && created?.id) lifecycle.start(created.id);
    },
    [quickCreateLane, createTask, areaFilter, lifecycle],
  );

  const areaLabel =
    areaFilter === 'all'
      ? 'All Areas'
      : areas?.find((a) => a.id === areaFilter)?.name ?? 'All Areas';
  const queryKey = ['tasks', filter];

  // Filter menu holds Area + Energy; the trigger flags when either narrows the list.
  const filterActive = areaFilter !== 'all' || energyFilter !== 'all';
  const filterSummary =
    areaFilter !== 'all'
      ? areaLabel
      : energyFilter !== 'all'
        ? energyFilter === 'deep' ? 'Deep' : 'Light'
        : 'Filter';
  // Status is the primary selector; its trigger shows the active lane + count.
  const activeCount = (counts?.consider ?? 0) + (counts?.todo ?? 0) + (counts?.in_progress ?? 0);
  const laneLabel =
    laneFilter === 'all' ? 'All' : laneFilter === 'active' ? 'Active' : LANE_BY_KEY[laneFilter].label;
  const laneCount =
    laneFilter === 'all' ? undefined : laneFilter === 'active' ? activeCount : counts?.[laneStatus(laneFilter)];

  const sensors = useSensors(
    // Mouse: any small drag starts reorder
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Touch: long-press to reorder so normal taps/scrolls still work on mobile
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleComplete = useCallback((id: string) => {
    const task = tasks?.find(t => t.id === id);
    if (!task) return;
    // Terminal -> reopen/restore, otherwise complete. Routed through the shared
    // lifecycle actions (semantic commands), never a raw status write.
    lifecycle.toggle(id, task.status);
  }, [tasks, lifecycle]);

  const handleUpdate = useCallback((id: string, field: string, value: unknown) => {
    updateTask.mutate({ id, [field]: value } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleSnooze = useCallback((id: string, days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    updateTask.mutate({
      id,
      resurfaceAfter: todayLocalDate(date),
      timesDeferred: undefined, // let the server handle increment ideally, but for now just set resurface
    } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleArchive = useCallback((id: string) => {
    lifecycle.archive(id);
  }, [lifecycle]);

  const handleDragIntercept = useCallback((taskId: string) => {
    if (sortBy === 'sortKey') return;
    setSwitchedFromSort(sortBy);
    setSortBy('sortKey');
    setHighlightId(taskId);
  }, [sortBy]);

  const handleSwitchBack = useCallback(() => {
    if (!switchedFromSort) return;
    setSortBy(switchedFromSort);
    dismissSwitchBanner();
  }, [switchedFromSort, dismissSwitchBanner]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !tasks) return;
    if (sortBy !== 'sortKey') return;

    const oldIndex = tasks.findIndex(t => t.id === active.id);
    const newIndex = tasks.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Backfill any null sort_keys in the visible order. Tasks are created without a
    // sortKey; without this, generateKeyBetween(null, null) returns 'a0' which sorts
    // ahead of every keyed task and the dragged item jumps to the top.
    const normalized = backfillSortKeys(tasks);
    const normalizationPatches: { id: string; sortKey: string }[] = [];
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].sortKey !== normalized[i].sortKey) {
        normalizationPatches.push({ id: tasks[i].id, sortKey: normalized[i].sortKey! });
      }
    }

    // Reorder using the normalized (fully-keyed) list.
    const reordered = arrayMove(normalized, oldIndex, newIndex);

    // Compute the moved item's new key from its now-non-null neighbors.
    const movedIdx = newIndex;
    const prevKey = movedIdx > 0 ? reordered[movedIdx - 1].sortKey : null;
    const nextKey = movedIdx < reordered.length - 1 ? reordered[movedIdx + 1].sortKey : null;
    const newKey = generateKeyBetween(prevKey, nextKey);

    reordered[movedIdx] = { ...reordered[movedIdx], sortKey: newKey };
    const previousData = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, reordered);

    // Fire all PATCHes in parallel: normalization fixes for previously-null tasks,
    // plus the moved item's new key. Bypass the mutation hook so we don't trigger
    // N invalidations; we invalidate once at the end.
    const movedPatch = { id: active.id as string, sortKey: newKey };
    const allPatches = [
      ...normalizationPatches.filter(p => p.id !== movedPatch.id),
      movedPatch,
    ];

    Promise.all(allPatches.map(p => tasksApi.update(p.id, { sortKey: p.sortKey })))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      })
      .catch(() => {
        queryClient.setQueryData(queryKey, previousData);
      });
  }, [tasks, queryClient, queryKey, sortBy]);

  const handlePickBucket = useCallback((taskId: string, bucket: Bucket) => {
    if (!tasks) return;
    const placement = computeBucketPlacement(tasks, taskId, bucket);
    if (!placement) return;

    // If we're not in Priority Order, switch to it so the gesture's effect is visible.
    if (sortBy !== 'sortKey') {
      setSwitchedFromSort(sortBy);
      setSortBy('sortKey');
      setHighlightId(taskId);
    } else {
      setHighlightId(taskId);
    }

    // Optimistic cache update against the priority-ordered query.
    const priorityKey = ['tasks', { ...filter, orderBy: 'sortKey' as const }];
    const previousData = queryClient.getQueryData(priorityKey);
    queryClient.setQueryData(priorityKey, placement.reordered);

    const allPatches = [...placement.normalizationPatches, placement.movedPatch];
    Promise.all(allPatches.map(p => tasksApi.update(p.id, { sortKey: p.sortKey })))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      })
      .catch(() => {
        queryClient.setQueryData(priorityKey, previousData);
      });
  }, [tasks, sortBy, filter, queryClient]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <ListToolbar>
        {/* List / Board switcher (desktop surface only; mobile is list-only) */}
        {view && onViewChange && <TaskViewToggle value={view} onChange={onViewChange} />}

        {/* Status — primary selector (active lane + count) */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Status: ${laneLabel}`}
            className={toolbarButtonClass({ className: 'font-semibold' })}
          >
            <span className="max-w-[130px] truncate">{laneLabel}</span>
            {laneCount != null && laneCount > 0 && (
              <span className="tabular-nums opacity-60">{laneCount}</span>
            )}
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup
              value={laneFilter}
              onValueChange={(v) => { setLaneFilter(v as LaneFilter); dismissSwitchBanner(); }}
            >
              {/* Combined views — spelled out so they don't read as a status */}
              <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Views</DropdownMenuLabel>
              <DropdownMenuRadioItem value="all" className="text-xs">
                <span className="flex flex-1 flex-col gap-0.5">
                  <span>All</span>
                  <span className="text-[10px] font-normal text-muted-foreground">Every status</span>
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="active" className="text-xs">
                <span className="flex flex-1 flex-col gap-0.5">
                  <span>Active</span>
                  <span className="text-[10px] font-normal text-muted-foreground">In progress, Todo, Consider</span>
                </span>
                {activeCount > 0 && <span className="ml-2 tabular-nums text-muted-foreground">{activeCount}</span>}
              </DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {/* Actual statuses */}
              <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Status</DropdownMenuLabel>
              {TASK_LANES.map((l) => {
                const c = counts?.[laneStatus(l.key)];
                return (
                  <DropdownMenuRadioItem key={l.key} value={l.key} className="text-xs">
                    <span className="flex-1">{l.label}</span>
                    {c != null && c > 0 && <span className="ml-2 tabular-nums text-muted-foreground">{c}</span>}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        {/* Filter — Area + Energy */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={filterActive ? `Filter, active: ${filterSummary}` : 'Filter tasks'}
            className={toolbarButtonClass({ active: filterActive })}
          >
            <Filter className="size-3.5 shrink-0" />
            <span className="hidden @sm/lt:inline max-w-[120px] truncate">{filterSummary}</span>
            {filterActive && <ToolbarActiveDot />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Energy</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={energyFilter}
              onValueChange={(v) => { setEnergyFilter(v as Energy | 'all'); dismissSwitchBanner(); }}
            >
              <DropdownMenuRadioItem value="all" className="text-xs">All energies</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="deep" className="text-xs">Deep</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light" className="text-xs">Light</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Area</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={areaFilter} onValueChange={(v) => { setAreaFilter(v); dismissSwitchBanner(); }}>
              <DropdownMenuRadioItem value="all" className="text-xs">All Areas</DropdownMenuRadioItem>
              {areas?.map(area => (
                <DropdownMenuRadioItem key={area.id} value={area.id} className="text-xs">
                  {area.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort — icon plus the active sort's name when there's room */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Sort by ${SORT_LABELS[sortBy]}`}
            className={toolbarButtonClass()}
          >
            <ArrowDownAz className="size-3.5 shrink-0" />
            <span className="hidden @md/lt:inline">{SORT_LABELS[sortBy]}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => { setSortBy(v as SortOption); dismissSwitchBanner(); }}>
              <DropdownMenuRadioItem value="sortKey" className="text-xs">Priority Order</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="lastViewedAt" className="text-xs">Last viewed</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hardDeadline" className="text-xs">Deadline</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="createdAt" className="text-xs">Created</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updatedAt" className="text-xs">Updated</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarSearchButton
          label="Search tasks"
          onClick={() => document.dispatchEvent(new CustomEvent('open-search', { detail: { initialQuery: 'task: ' } }))}
        />
      </ListToolbar>

      {/* Sort-switch banner — sticky above the scroll area, inverted for emphasis */}
      {switchedFromSort && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-primary text-primary-foreground text-[11px] font-medium flex-shrink-0 shadow-sm">
          <span>
            Switched to <span className="font-bold">Priority Order</span> so you can reorder.
          </span>
          <button
            onClick={handleSwitchBack}
            className="px-2.5 py-1 rounded bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground text-[10px] font-semibold uppercase tracking-wider transition-colors"
          >
            Back to {SORT_LABELS[switchedFromSort]}
          </button>
        </div>
      )}

      {/* Quick-create in the current lane */}
      {quickCreateLane && (
        <QuickCreateRow
          lane={quickCreateLane}
          onCreate={handleQuickCreate}
        />
      )}

      {/* Task list */}
      <VirtualTaskList
        tasks={tasks}
        isLoading={isLoading}
        error={error}
        sensors={sensors}
        onDragEnd={handleDragEnd}
        onComplete={handleComplete}
        onUpdate={handleUpdate}
        onSnooze={handleSnooze}
        onArchive={handleArchive}
        onOpen={openTask}
        dragEnabled={sortBy === 'sortKey'}
        highlightId={highlightId}
        onDragIntercept={handleDragIntercept}
        onPickBucket={handlePickBucket}
        signals={attention}
        emptyText={
          laneFilter === 'active'
            ? 'Nothing active right now.'
            : laneFilter !== 'all'
              ? LANE_BY_KEY[laneFilter as TaskLane]?.empty ?? 'No tasks found.'
              : 'No tasks found.'
        }
      />
    </div>
  );
}

/* ── Quick-create row ── */

function QuickCreateRow({ lane, onCreate }: { lane: TaskLane; onCreate: (title: string) => void }) {
  const [value, setValue] = useState('');
  const placeholder =
    lane === 'consider'
      ? 'Park a possibility in Consider…'
      : lane === 'current'
        ? 'Start a task…'
        : 'Add a task to Todo…';
  const submit = () => {
    if (!value.trim()) return;
    onCreate(value);
    setValue('');
  };
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
      <Plus size={13} className="text-muted-foreground flex-shrink-0" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setValue('');
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}

/* ── Virtualized inner list ── */

interface VirtualTaskListProps {
  tasks: TaskListDTO[] | undefined;
  isLoading: boolean;
  error: Error | null;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onComplete: (id: string) => void;
  onUpdate: (id: string, field: string, value: unknown) => void;
  onSnooze: (id: string, days: number) => void;
  onArchive: (id: string) => void;
  onOpen: (id: string) => void;
  dragEnabled: boolean;
  highlightId: string | null;
  onDragIntercept: (id: string) => void;
  onPickBucket: (id: string, bucket: Bucket) => void;
  signals?: Record<string, TaskAttentionSignals>;
  emptyText: string;
}

function VirtualTaskList({
  tasks, isLoading, error, sensors, onDragEnd,
  onComplete, onUpdate, onSnooze, onArchive, onOpen,
  dragEnabled, highlightId, onDragIntercept, onPickBucket, signals, emptyText,
}: VirtualTaskListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tasks?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
    getItemKey: (index) => tasks?.[index]?.id ?? index,
  });

  // Scroll to + reveal the highlighted task once it's in the new sorted list
  const lastScrolledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId) {
      lastScrolledRef.current = null;
      return;
    }
    if (!tasks || lastScrolledRef.current === highlightId) return;
    const idx = tasks.findIndex(t => t.id === highlightId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'center' });
      lastScrolledRef.current = highlightId;
    }
  }, [highlightId, tasks, virtualizer]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
      {isLoading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center h-32 text-destructive text-[11px]">
          Failed to load tasks
        </div>
      )}
      {tasks && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 px-6 text-center">
          <Target size={20} className="opacity-30" />
          <p className="text-[11px]">{emptyText}</p>
        </div>
      )}
      {tasks && tasks.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const task = tasks[virtualRow.index];
                return (
                  <div
                    key={task.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <TaskRow
                      task={task}
                      onComplete={onComplete}
                      onUpdate={onUpdate}
                      onSnooze={onSnooze}
                      onArchive={onArchive}
                      onOpen={onOpen}
                      dragEnabled={dragEnabled}
                      isHighlighted={task.id === highlightId}
                      onDragIntercept={onDragIntercept}
                      onPickBucket={onPickBucket}
                      signals={signals?.[task.id]}
                    />
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
