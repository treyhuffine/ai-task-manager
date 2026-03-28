"use client";

import { useState, useMemo, Fragment } from 'react';
import { GripVertical, Check, SkipForward, ChevronDown, ChevronRight, Crosshair, EyeOff, Eye } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { DeckItem, SubtaskItem } from '@/types/dashboard';

// ─── Helpers ────────────────────────────────────────────────────

function formatDeadline(deadline?: string): string | null {
  if (!deadline) return null;
  const date = new Date(deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDate = new Date(date);
  deadlineDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Overdue';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays <= 7) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Due ${days[date.getDay()]}`;
  }
  return `Due ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function isDeadlineUrgent(deadline?: string): boolean {
  if (!deadline) return false;
  const diffDays = Math.round((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return diffDays <= 1;
}

// ─── Pill components ────────────────────────────────────────────

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
      {children}
    </span>
  );
}

function DeadlinePill({ children, urgent }: { children: React.ReactNode; urgent: boolean }) {
  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
        urgent
          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  );
}

// ─── Subtask list ───────────────────────────────────────────────

interface SubtaskActions {
  onComplete: (subtaskId: string) => void;
  onDefer: (subtaskId: string) => void;
  onFocus?: (subtaskId: string) => void;
}

function Subtasks({ items, onCollapse, actions }: { items: SubtaskItem[]; onCollapse: () => void; actions: SubtaskActions }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const completed = items.filter(s => s.completed).length;
  const visibleItems = showCompleted ? items : items.filter(s => !s.completed);

  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={onCollapse}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
        >
          <ChevronDown className="w-3 h-3" />
          {completed}/{items.length} subtasks
        </button>
        {completed > 0 && (
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            {showCompleted ? 'hide' : 'show'} completed
          </button>
        )}
      </div>
      <div className="ml-4 space-y-px">
        {visibleItems.map(s => (
          <div
            key={s.id}
            className={cn(
              'group/subtask relative flex items-center gap-1 py-1 px-2 -mx-2 rounded-md transition-colors',
              s.completed
                ? 'text-muted-foreground/40'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            <span className="text-xs flex-1 min-w-0">
              {s.completed && <span className="mr-1 opacity-60">✓</span>}
              {s.title}
            </span>

            {/* Hover actions */}
            {!s.completed && (
              <div className="shrink-0 opacity-0 group-hover/subtask:opacity-100 transition-opacity flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => actions.onComplete(s.id)}
                      className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Done</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => actions.onDefer(s.id)}
                      className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <SkipForward className="w-3 h-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Defer</TooltipContent>
                </Tooltip>
                {actions.onFocus && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => actions.onFocus!(s.id)}
                        className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Crosshair className="w-3 h-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Focus</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Single sortable deck item ──────────────────────────────────

function SortableDeckItemCard({
  item,
  index,
  onComplete,
  onNotToday,
  onFocus,
  onSubtaskComplete,
  onSubtaskDefer,
  onSubtaskFocus,
}: {
  item: DeckItem;
  index: number;
  onComplete: (id: string) => void;
  onNotToday: (id: string) => void;
  onFocus?: (id: string) => void;
  onSubtaskComplete: (itemId: string, subtaskId: string) => void;
  onSubtaskDefer: (itemId: string, subtaskId: string) => void;
  onSubtaskFocus?: (itemId: string, subtaskId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [subtasksExpanded, setSubtasksExpanded] = useState(index === 0);
  const deadline = formatDeadline(item.hardDeadline);
  const urgent = isDeadlineUrgent(item.hardDeadline);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative py-2',
        isDragging && 'z-10 opacity-80 bg-background rounded-lg shadow-lg',
      )}
      {...attributes}
    >
      {/* Drag handle — visible on hover */}
      <div
        ref={setActivatorNodeRef}
        {...listeners}
        className="absolute left-0 top-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground/30" />
      </div>

      {/* Hover actions — top right */}
      <div className="absolute right-0 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onComplete(item.id)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Done</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onNotToday(item.id)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Not today</TooltipContent>
        </Tooltip>
        {onFocus && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onFocus(item.id)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Focus</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="pl-6 pr-20">
        {/* Title */}
        <div className="text-sm font-medium leading-snug">
          {item.parentTitle && (
            <span className="text-muted-foreground font-normal">{item.parentTitle} · </span>
          )}
          {item.title}
        </div>

        {/* Pills */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {item.areaName && <Pill>{item.areaName}</Pill>}
          {item.effort && <Pill>{item.effort}</Pill>}
          {item.estimatedMinutes && <Pill>~{item.estimatedMinutes}m</Pill>}
          {deadline && <DeadlinePill urgent={urgent}>{deadline}</DeadlinePill>}
        </div>

        {/* Rationale */}
        {item.rationale && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            {item.rationale}
          </p>
        )}

        {/* Continuity context (if present, on first item) */}
        {item.continuityContext && index === 0 && (
          <p className="text-xs text-muted-foreground/70 mt-1 italic leading-relaxed">
            {item.continuityContext}
          </p>
        )}

        {/* Subtasks */}
        {item.subtasks && item.subtasks.length > 0 && (
          subtasksExpanded ? (
            <Subtasks
              items={item.subtasks}
              onCollapse={() => setSubtasksExpanded(false)}
              actions={{
                onComplete: (subtaskId) => onSubtaskComplete(item.id, subtaskId),
                onDefer: (subtaskId) => onSubtaskDefer(item.id, subtaskId),
                onFocus: onSubtaskFocus ? (subtaskId) => onSubtaskFocus(item.id, subtaskId) : undefined,
              }}
            />
          ) : (
            <button
              onClick={() => setSubtasksExpanded(true)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground mt-2"
            >
              <ChevronRight className="w-3 h-3" />
              {item.subtasks.filter(s => s.completed).length}/{item.subtasks.length} subtasks
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ─── Main DeckStack ─────────────────────────────────────────────

interface DeckStackProps {
  items: DeckItem[];
  onComplete: (id: string) => void;
  onNotToday: (id: string) => void;
  onFocus?: (id: string) => void;
  onReorder: (items: DeckItem[]) => void;
  onSubtaskComplete: (itemId: string, subtaskId: string) => void;
  onSubtaskDefer: (itemId: string, subtaskId: string) => void;
  onSubtaskFocus?: (itemId: string, subtaskId: string) => void;
}

export function DeckStack({ items, onComplete, onNotToday, onFocus, onReorder, onSubtaskComplete, onSubtaskDefer, onSubtaskFocus }: DeckStackProps) {
  const [hideBelowIndex, setHideBelowIndex] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const itemIds = useMemo(() => items.map(i => i.id), [items]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(i => i.id === active.id);
    const newIndex = items.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  const isHidden = hideBelowIndex !== null;
  const hiddenCount = isHidden ? items.length - hideBelowIndex - 1 : 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div>
          {items.map((item, i) => {
            // If hidden, only show items up to hideBelowIndex
            if (isHidden && i > hideBelowIndex) return null;

            const isFirst = i === 0;
            const isLast = i === items.length - 1;
            // Show divider after this item (not after the last item)
            const showDivider = !isLast;
            // Always visible after item 0, hover-visible for others
            const alwaysVisible = isFirst;
            // This is the active hide point
            const isActiveHidePoint = hideBelowIndex === i;

            return (
              <Fragment key={item.id}>
                <SortableDeckItemCard
                  item={item}
                  index={i}
                  onComplete={onComplete}
                  onNotToday={onNotToday}
                  onFocus={onFocus}
                  onSubtaskComplete={onSubtaskComplete}
                  onSubtaskDefer={onSubtaskDefer}
                  onSubtaskFocus={onSubtaskFocus}
                />
                {showDivider && (
                  <button
                    onClick={() => setHideBelowIndex(isActiveHidePoint ? null : i)}
                    className={cn(
                      'w-full flex items-center gap-2 py-1 group/divider transition-opacity',
                      alwaysVisible || isActiveHidePoint
                        ? 'opacity-100'
                        : 'opacity-0 hover:opacity-100',
                    )}
                  >
                    <div className="flex-1 h-px bg-border/50" />
                    <span className="flex items-center gap-1 text-[9px] leading-none text-muted-foreground/40 group-hover/divider:text-muted-foreground/60 transition-colors shrink-0">
                      {isActiveHidePoint ? (
                        <>
                          <Eye className="w-3 h-3" />
                          Show {hiddenCount} more
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3 h-3" />
                          Hide items below
                        </>
                      )}
                    </span>
                    <div className="flex-1 h-px bg-border/50" />
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
