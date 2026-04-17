"use client";

import { useState, useCallback, useRef } from 'react';
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

type SortOption = 'sort_key' | 'last_viewed_at' | 'hard_deadline' | 'created_at' | 'updated_at';

export function TaskList() {
  const { theme, openTask } = useDashboard();
  const isDark = theme === 'dark';

  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('active');
  const [energyFilter, setEnergyFilter] = useState<Energy | 'all'>('all');
  const [areaFilter, setAreaFilter] = useState<string | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('sort_key');

  const filter = {
    ...(statusFilter !== 'all' ? { status: statusFilter as TaskStatus } : {}),
    ...(energyFilter !== 'all' ? { energy: energyFilter as Energy } : {}),
    ...(areaFilter !== 'all' ? { area_id: areaFilter } : {}),
    order_by: sortBy,
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
      // Uncomplete: set back to active, clear completed_at
      updateTask.mutate({ id, status: 'active', completed_at: null } as Parameters<typeof updateTask.mutate>[0]);
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
      resurface_after: date.toISOString(),
      times_deferred: undefined, // let the server handle increment ideally, but for now just set resurface
    } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleArchive = useCallback((id: string) => {
    updateTask.mutate({ id, status: 'archived' } as Parameters<typeof updateTask.mutate>[0]);
  }, [updateTask]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !tasks) return;

    const oldIndex = tasks.findIndex(t => t.id === active.id);
    const newIndex = tasks.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistic reorder in cache
    const reordered = arrayMove([...tasks], oldIndex, newIndex);

    // Compute new sort_key between neighbors in the reordered array
    const movedIdx = newIndex;
    const prevKey = movedIdx > 0 ? reordered[movedIdx - 1].sort_key : null;
    const nextKey = movedIdx < reordered.length - 1 ? reordered[movedIdx + 1].sort_key : null;
    const newKey = generateKeyBetween(prevKey ?? null, nextKey ?? null);

    // Apply optimistic update
    reordered[movedIdx] = { ...reordered[movedIdx], sort_key: newKey };
    const previousData = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, reordered);

    // PATCH in background, revert on error
    updateTask.mutate(
      { id: active.id as string, sort_key: newKey } as Parameters<typeof updateTask.mutate>[0],
      {
        onError: () => {
          queryClient.setQueryData(queryKey, previousData);
        },
      },
    );
  }, [tasks, updateTask, queryClient, queryKey]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className={cn(
        'px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0',
        isDark ? 'bg-card/50' : 'bg-muted'
      )}>
        {/* Status filter */}
        <div className="flex items-center gap-0.5 p-0.5 bg-card rounded border border-border">
          {(['active', 'done', 'archived', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
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

        {/* Energy filter */}
        <div className="flex items-center gap-0.5 p-0.5 bg-card rounded border border-border">
          {(['all', 'deep', 'light'] as const).map((e) => (
            <button
              key={e}
              onClick={() => setEnergyFilter(e)}
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

        {/* Area filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border">
              <Filter size={11} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Area</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={areaFilter} onValueChange={setAreaFilter}>
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
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <DropdownMenuRadioItem value="sort_key" className="text-xs">AI order</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="last_viewed_at" className="text-xs">Last viewed</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hard_deadline" className="text-xs">Deadline</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created_at" className="text-xs">Created</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated_at" className="text-xs">Updated</DropdownMenuRadioItem>
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
}

function VirtualTaskList({
  tasks, isLoading, error, sensors, onDragEnd,
  onComplete, onUpdate, onSnooze, onArchive, onOpen,
}: VirtualTaskListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tasks?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
    getItemKey: (index) => tasks?.[index]?.id ?? index,
  });

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
