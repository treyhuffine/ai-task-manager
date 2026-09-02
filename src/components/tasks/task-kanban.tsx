'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { generateKeyBetween } from 'fractional-indexing';
import { toast } from 'sonner';
import { Filter } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTasks } from '@/hooks/use-tasks';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';
import { useAreas } from '@/hooks/use-areas';
import { tasksApi } from '@/lib/api/tasks';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { KANBAN_COLUMNS, LANE_BY_KEY, laneStatus, columnDropCommand, laneForStatus, type TaskLane } from '@/lib/tasks/lanes';
import { STATUS_COLOR } from './lifecycle-status-control';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import type { TaskStatus } from '@/db/types';
import { cn } from '@/lib/utils';

type AreaMode = 'all' | 'none' | string; // 'all', 'none', or an area id

/** One draggable card. */
function KanbanCard({
  task,
  areaName,
  parentTitle,
  onOpen,
  showArea,
}: {
  task: TaskListDTO;
  areaName?: string | null;
  parentTitle?: string | null;
  onOpen: (id: string) => void;
  showArea: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status, lane: laneForStatus(task.status) },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group rounded-md border border-border bg-card p-2 text-xs shadow-sm',
        'hover:border-primary/40 cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}. ${task.status}. Press space to pick up and reorder or move between columns.`}
    >
      {parentTitle && (
        <div className="mb-0.5 truncate text-[10px] text-muted-foreground">{parentTitle} /</div>
      )}
      <div className="line-clamp-3 font-medium text-foreground">{task.title || 'Untitled'}</div>
      <div className="mt-1 flex items-center gap-2">
        {showArea && areaName && (
          <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{areaName}</span>
        )}
        {task.hardDeadline && (
          <span className="text-[10px] text-amber-600">{task.hardDeadline.slice(0, 10)}</span>
        )}
        {(task.subtaskCount ?? 0) > 0 && (
          <span className="text-[10px] text-muted-foreground">{task.subtaskCount} sub</span>
        )}
      </div>
    </div>
  );
}

/** One column (a droppable). */
function KanbanColumn({
  lane,
  tasks,
  areaName,
  parentTitleFor,
  onOpen,
  showArea,
}: {
  lane: TaskLane;
  tasks: TaskListDTO[];
  areaName: (id: string | null) => string | null;
  parentTitleFor: (id: string | null) => string | null;
  onOpen: (id: string) => void;
  showArea: boolean;
}) {
  const def = LANE_BY_KEY[lane];
  const { setNodeRef, isOver } = useDroppable({ id: `col:${lane}`, data: { lane } });
  return (
    <div className="flex min-w-[240px] flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className={cn('text-[10px] font-bold uppercase tracking-wider', STATUS_COLOR[def.status])}>{def.label}</span>
        <span className="text-[10px] text-muted-foreground">{tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-1.5 rounded-md p-1.5 transition-colors',
          isOver ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-muted/40',
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">{def.empty}</p>
          ) : (
            tasks.map((t) => (
              <KanbanCard
                key={t.id}
                task={t}
                areaName={areaName(t.areaId ?? null)}
                parentTitle={parentTitleFor(t.parentId ?? null)}
                onOpen={onOpen}
                showArea={showArea}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}

export function TaskKanban() {
  const qc = useQueryClient();
  const { openTask } = useDashboard();
  const lifecycle = useTaskLifecycle();
  const { data: areas } = useAreas();
  const [areaMode, setAreaMode] = useState<AreaMode>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const columns: TaskLane[] = showArchived ? [...KANBAN_COLUMNS, 'archived'] : KANBAN_COLUMNS;

  // One query per column, ordered by the shared sort contract.
  const consider = useTasks({ status: 'consider', orderBy: 'sortKey' });
  const todo = useTasks({ status: 'todo', orderBy: 'sortKey' });
  const current = useTasks({ status: 'in_progress', orderBy: 'sortKey' });
  const done = useTasks({ status: 'done', orderBy: 'sortKey' });
  const archived = useTasks({ status: 'archived', orderBy: 'sortKey' });

  const byLane: Record<TaskLane, TaskListDTO[]> = useMemo(() => {
    const inArea = (t: TaskListDTO) =>
      areaMode === 'all' ? true : areaMode === 'none' ? !t.areaId : t.areaId === areaMode;
    return {
      consider: (consider.data ?? []).filter(inArea),
      todo: (todo.data ?? []).filter(inArea),
      current: (current.data ?? []).filter(inArea),
      done: (done.data ?? []).filter(inArea),
      archived: (archived.data ?? []).filter(inArea),
    };
  }, [consider.data, todo.data, current.data, done.data, archived.data, areaMode]);

  const areaName = useCallback(
    (id: string | null) => (id ? areas?.find((a) => a.id === id)?.name ?? null : null),
    [areas],
  );
  // Parent breadcrumb lookup across every loaded column.
  const allById = useMemo(() => {
    const m = new Map<string, TaskListDTO>();
    for (const lane of Object.values(byLane)) for (const t of lane) m.set(t.id, t);
    return m;
  }, [byLane]);
  const parentTitleFor = useCallback((id: string | null) => (id ? allById.get(id)?.title ?? null : null), [allById]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const laneOfTask = useCallback(
    (id: string): TaskLane | null => {
      for (const lane of columns) if (byLane[lane].some((t) => t.id === id)) return lane;
      return null;
    },
    [byLane, columns],
  );

  const persistReorder = useCallback(
    (lane: TaskLane, orderedIds: string[], movedId: string) => {
      const idx = orderedIds.indexOf(movedId);
      const list = byLane[lane];
      const prev = idx > 0 ? list.find((t) => t.id === orderedIds[idx - 1])?.sortKey ?? null : null;
      const next = idx < orderedIds.length - 1 ? list.find((t) => t.id === orderedIds[idx + 1])?.sortKey ?? null : null;
      let key: string;
      try {
        key = generateKeyBetween(prev ?? null, next ?? null);
      } catch {
        key = generateKeyBetween(null, null);
      }
      // Optimistic: reorder the column's cache and stamp the new key.
      const qkey = ['tasks', { status: laneStatus(lane), orderBy: 'sortKey' }];
      qc.setQueryData<TaskListDTO[]>(qkey, (rows) =>
        rows ? [...rows].map((r) => (r.id === movedId ? { ...r, sortKey: key } : r)).sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? '')) : rows,
      );
      tasksApi.update(movedId, { sortKey: key }).catch(() => qc.invalidateQueries({ queryKey: ['tasks'] }));
    },
    [byLane, qc],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over) return;
      const activeLane = laneOfTask(String(active.id));
      if (!activeLane) return;

      // Resolve the destination lane: dropped on a column, or on a card in one.
      const overId = String(over.id);
      const overLane: TaskLane | null = overId.startsWith('col:')
        ? (overId.slice(4) as TaskLane)
        : laneOfTask(overId);
      if (!overLane) return;

      if (overLane === activeLane) {
        // Reorder within the column.
        const ids = byLane[activeLane].map((t) => t.id);
        const from = ids.indexOf(String(active.id));
        const to = overId.startsWith('col:') ? ids.length - 1 : ids.indexOf(overId);
        if (from === -1 || to === -1 || from === to) return;
        const reordered = [...ids];
        reordered.splice(from, 1);
        reordered.splice(to, 0, String(active.id));
        persistReorder(activeLane, reordered, String(active.id));
        return;
      }

      // Cross-column: map to a semantic command, reject illegal moves.
      const fromStatus = laneStatus(activeLane);
      const toStatus = laneStatus(overLane);
      const cmd = columnDropCommand(fromStatus as TaskStatus, toStatus as TaskStatus);
      if (!cmd) {
        toast.error(`Cannot move ${LANE_BY_KEY[activeLane].label} to ${LANE_BY_KEY[overLane].label}.`);
        return;
      }
      const id = String(active.id);
      if (cmd === 'complete') lifecycle.complete(id);
      else if (cmd === 'start') lifecycle.start(id);
      else if (cmd === 'move_to_todo') lifecycle.moveToTodo(id);
      else if (cmd === 'move_to_consider') lifecycle.moveToConsider(id);
      else if (cmd === 'return_to_todo') lifecycle.returnToTodo(id);
      else if (cmd === 'reopen') lifecycle.reopen(id);
      else if (cmd === 'restore') lifecycle.restore(id);
      else if (cmd === 'archive') lifecycle.archive(id);
    },
    [laneOfTask, byLane, persistReorder, lifecycle],
  );

  const activeTask = activeId ? allById.get(activeId) : null;
  const areaLabel = areaMode === 'all' ? 'All Areas' : areaMode === 'none' ? 'No Area' : areaName(areaMode) ?? 'Area';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            <Filter size={10} />
            <span className="max-w-[140px] truncate">{areaLabel}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-[9px] uppercase tracking-widest">Area</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={areaMode} onValueChange={setAreaMode}>
              <DropdownMenuRadioItem value="all" className="text-xs">All Areas</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none" className="text-xs">No Area</DropdownMenuRadioItem>
              {areas?.map((a) => (
                <DropdownMenuRadioItem key={a.id} value={a.id} className="text-xs">{a.name}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={cn('rounded border border-border px-2 py-1 text-[10px] font-medium uppercase tracking-wide', showArchived ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}
        >
          Archived
        </button>
      </div>

      <div className="flex-1 overflow-x-auto p-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="flex h-full items-start gap-3">
            {columns.map((lane) => (
              <KanbanColumn
                key={lane}
                lane={lane}
                tasks={byLane[lane]}
                areaName={areaName}
                parentTitleFor={parentTitleFor}
                onOpen={openTask}
                showArea={areaMode === 'all'}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? (
              <div className="rounded-md border border-primary/50 bg-card p-2 text-xs shadow-lg">
                <div className="line-clamp-3 font-medium">{activeTask.title || 'Untitled'}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
