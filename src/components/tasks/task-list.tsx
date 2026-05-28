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
import { Target, Filter, ArrowDownAz, Loader2, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTasks, useUpdateTask, useCompleteTask } from '@/hooks/use-tasks';
import { useAreas } from '@/hooks/use-areas';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { TaskRow } from './task-row';
import { cn } from '@/lib/utils';
import type { TaskStatus, Energy, TaskListRecord } from '@/db/types';

type SortOption = 'sortKey' | 'lastViewedAt' | 'hardDeadline' | 'createdAt' | 'updatedAt';

const SORT_LABELS: Record<SortOption, string> = {
  sortKey: 'Priority Order',
  lastViewedAt: 'Last viewed',
  hardDeadline: 'Deadline',
  createdAt: 'Created',
  updatedAt: 'Updated',
};

export function TaskList() {
  const { theme, openTask } = useDashboard();
  const isDark = theme === 'dark';

  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('active');
  const [energyFilter, setEnergyFilter] = useState<Energy | 'all'>('all');
  const [areaFilter, setAreaFilter] = useState<string | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('lastViewedAt');
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

  const filter = {
    ...(statusFilter !== 'all' ? { status: statusFilter as TaskStatus } : {}),
    ...(energyFilter !== 'all' ? { energy: energyFilter as Energy } : {}),
    ...(areaFilter !== 'all' ? { areaId: areaFilter } : {}),
    orderBy: sortBy,
  };

  const queryClient = useQueryClient();
  const { data: tasks, isLoading, error } = useTasks(filter);
  const { data: areas } = useAreas();
  const updateTask = useUpdateTask();
  const completeTask = useCompleteTask();
  const queryKey = ['tasks', filter];

  const sensors = useSensors(
    // Mouse: any small drag starts reorder
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Touch: long-press to reorder so normal taps/scrolls still work on mobile
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleComplete = useCallback((id: string) => {
    const task = tasks?.find(t => t.id === id);
    if (task?.status === 'done') {
      // Uncomplete: set back to active, clear completedAt
      updateTask.mutate({ id, status: 'active', completedAt: null } as Parameters<typeof updateTask.mutate>[0]);
    } else {
      completeTask.mutate({ id });
    }
  }, [tasks, completeTask, updateTask]);

  const handleUpdate = useCallback((id: string, field: string, value: unknown) => {
    updateTask.mutate({ id, [field]: value } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleSnooze = useCallback((id: string, days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    updateTask.mutate({
      id,
      resurfaceAfter: date.toISOString(),
      timesDeferred: undefined, // let the server handle increment ideally, but for now just set resurface
    } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleArchive = useCallback((id: string) => {
    updateTask.mutate({ id, status: 'archived' } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

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
      <div className={cn(
        'px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0',
        isDark ? 'bg-card/50' : 'bg-muted'
      )}>
        {/* Status filter — desktop inline segmented, mobile inside Filter dropdown */}
        <div className="hidden md:flex items-center gap-0.5 p-0.5 bg-card rounded border border-border">
          {(['active', 'done', 'archived', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); dismissSwitchBanner(); }}
              className={cn(
                'px-2 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-all',
                statusFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Energy filter — desktop inline segmented, mobile inside Filter dropdown */}
        <div className="hidden md:flex items-center gap-0.5 p-0.5 bg-card rounded border border-border">
          {(['all', 'deep', 'light'] as const).map((e) => (
            <button
              key={e}
              onClick={() => { setEnergyFilter(e); dismissSwitchBanner(); }}
              className={cn(
                'px-2 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-all',
                energyFilter === e
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Filter dropdown — Area on desktop, Status+Energy+Area on mobile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border">
              <Filter size={11} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <div className="md:hidden">
              <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Status</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={statusFilter}
                onValueChange={(v) => { setStatusFilter(v as TaskStatus | 'all'); dismissSwitchBanner(); }}
              >
                <DropdownMenuRadioItem value="active" className="text-xs">Active</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="done" className="text-xs">Done</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="archived" className="text-xs">Archived</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="all" className="text-xs">All</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
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
            </div>
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Area</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={areaFilter} onValueChange={(v) => { setAreaFilter(v); dismissSwitchBanner(); }}>
              <DropdownMenuRadioItem value="all" className="text-xs">All areas</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {areas?.map(area => (
                <DropdownMenuRadioItem key={area.id} value={area.id} className="text-xs">
                  {area.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border">
              <ArrowDownAz size={11} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => { setSortBy(v as SortOption); dismissSwitchBanner(); }}>
              <DropdownMenuRadioItem value="lastViewedAt" className="text-xs">Last viewed</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="sortKey" className="text-xs">Priority Order</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hardDeadline" className="text-xs">Deadline</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="createdAt" className="text-xs">Created</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updatedAt" className="text-xs">Updated</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('open-search', { detail: { initialQuery: 'task: ' } }))}
          className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border"
          title="Search tasks"
        >
          <Search size={11} />
        </button>
      </div>

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
      />
    </div>
  );
}

/* ── Virtualized inner list ── */

interface VirtualTaskListProps {
  tasks: TaskListRecord[] | undefined;
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
}

function VirtualTaskList({
  tasks, isLoading, error, sensors, onDragEnd,
  onComplete, onUpdate, onSnooze, onArchive, onOpen,
  dragEnabled, highlightId, onDragIntercept, onPickBucket,
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
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
          <Target size={20} className="opacity-30" />
          <p className="text-[11px]">No tasks found</p>
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
