"use client";

import { useState, useRef, useEffect } from 'react';
import {
  Check, Circle, Clock, Repeat, Lock,
  MoreHorizontal, Archive, Timer, GripVertical,
  Zap, Flame, ShieldAlert, AlignLeft, ListTree, ArrowUpDown,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { BUCKET_OPTIONS, type Bucket } from '@/lib/utils/bucket-placement';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { AreaSelect } from '@/components/shared/area-select';
import { LifecycleStatusControl } from '@/components/tasks/lifecycle-status-control';
import { TaskBadges } from '@/components/tasks/task-badges';
import { cn } from '@/lib/utils';
import { calendarDaysUntil, dateInputToStored, formatLocalDate, isPastDate } from '@/lib/dates';
import type { Energy, Effort, TaskAttentionSignals } from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

const ENERGY_COLORS: Record<string, string> = {
  deep: 'text-orange-500',
  light: 'text-sky-400',
};

const ENERGY_ICONS: Record<string, typeof Flame> = {
  deep: Flame,
  light: Zap,
};

const EFFORT_LABELS: Record<string, string> = {
  trivial: 'XS',
  small: 'S',
  medium: 'M',
  large: 'L',
  epic: 'XL',
};

const ENERGY_CYCLE: (Energy | null)[] = ['deep', 'light', null];
const EFFORT_CYCLE: (Effort | null)[] = ['trivial', 'small', 'medium', 'large', 'epic', null];

function formatDate(iso: string | null): string | null {
  const days = calendarDaysUntil(iso);
  if (days === null) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 0 && days <= 7) return `In ${days}d`;
  if (days < 0 && days >= -7) return `${Math.abs(days)}d ago`;
  return formatLocalDate(iso, { month: 'short', day: 'numeric' });
}

interface TaskRowProps {
  task: TaskListDTO;
  onComplete: (id: string) => void;
  onUpdate: (id: string, field: string, value: unknown) => void;
  onSnooze: (id: string, days: number) => void;
  onArchive: (id: string) => void;
  onOpen?: (id: string) => void;
  dragEnabled?: boolean;
  isHighlighted?: boolean;
  onDragIntercept?: (id: string) => void;
  onPickBucket?: (id: string, bucket: Bucket) => void;
  /** Derived attention badges, supplied for In-progress rows. */
  signals?: TaskAttentionSignals | null;
}

export function TaskRow({
  task, onComplete, onUpdate, onSnooze, onArchive, onOpen,
  dragEnabled = true, isHighlighted = false, onDragIntercept, onPickBucket, signals,
}: TaskRowProps) {
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [editingBoomerang, setEditingBoomerang] = useState(false);
  const [blockPopoverOpen, setBlockPopoverOpen] = useState(false);
  const blockInputRef = useRef<HTMLInputElement>(null);
  const isDone = task.status === 'done';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  // Mobile: long-press on the row drags. Desktop: drag from the handle only.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const deadline = formatDate(task.hardDeadline);
  const boomerang = formatDate(task.resurfaceAfter);

  const cycleEnergy = () => {
    const idx = ENERGY_CYCLE.indexOf(task.energy);
    const next = ENERGY_CYCLE[(idx + 1) % ENERGY_CYCLE.length];
    onUpdate(task.id, 'energy', next);
  };

  const cycleEffort = () => {
    const idx = EFFORT_CYCLE.indexOf(task.effort);
    const next = EFFORT_CYCLE[(idx + 1) % EFFORT_CYCLE.length];
    onUpdate(task.id, 'effort', next);
  };

  const EnergyIcon = task.energy ? ENERGY_ICONS[task.energy] : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isMobile && dragEnabled ? listeners : {})}
      className={cn(
        'group flex items-start gap-1.5 px-2 py-2 rounded-lg transition-all border border-transparent cursor-pointer',
        'hover:bg-card hover:border-border',
        isDragging && 'opacity-50 shadow-lg',
        isDone && 'opacity-50',
        isHighlighted && 'bg-primary/10 border-primary/30 ring-1 ring-primary/20',
      )}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          window.open(`/task/${task.id}`, '_blank')
        } else {
          onOpen?.(task.id)
        }
      }}
    >
      {/* Drag handle — desktop only. When drag is disabled (non-AI sort), pointerdown
          intercepts and asks the list to switch sort instead of starting a drag. */}
      <button
        {...(!isMobile && dragEnabled ? listeners : {})}
        className={cn(
          'hidden md:block mt-1 p-0.5 opacity-0 group-hover:opacity-40 hover:!opacity-100 text-muted-foreground transition-opacity',
          dragEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        )}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={dragEnabled ? undefined : (e) => {
          e.stopPropagation();
          onDragIntercept?.(task.id);
        }}
      >
        <GripVertical size={12} />
      </button>

      {/* Completion control — only where completing/reopening is the real
          action. Consider is not committed work (commit it via the status
          control), and Archived is history, so neither shows a checkbox that
          would silently do nothing or quietly restore. */}
      {task.status === 'consider' || task.status === 'archived' ? (
        <span
          className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border border-dashed border-muted-foreground/30"
          title={task.status === 'consider' ? 'Consider, commit it with the status control' : 'Archived'}
          aria-hidden
        />
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onComplete(task.id); }}
          title={isDone ? 'Reopen' : 'Complete'}
          aria-label={isDone ? 'Reopen task' : 'Complete task'}
          className={cn(
            'mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-all',
            isDone
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-muted-foreground/40 hover:border-primary hover:bg-primary/10',
          )}
        >
          {isDone && <Check size={10} strokeWidth={3} />}
        </button>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className={cn(
          'text-[12px] font-medium leading-tight line-clamp-2',
          isDone && 'line-through text-muted-foreground',
        )}>
          {task.title}
        </p>

        {/* Metadata row */}
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          {/* Editable lifecycle status */}
          <span onClick={(e) => e.stopPropagation()}>
            <LifecycleStatusControl taskId={task.id} status={task.status} size="xs" />
          </span>

          {/* Derived attention badges (In progress) */}
          <TaskBadges signals={signals} size="xs" />

          {/* Area */}
          <AreaSelect
            value={task.areaId}
            onChange={(areaId) => onUpdate(task.id, 'areaId', areaId)}
          />

          {/* Energy pill */}
          <button
            onClick={(e) => { e.stopPropagation(); cycleEnergy(); }}
            className={cn(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-colors hover:bg-muted',
              task.energy ? ENERGY_COLORS[task.energy] : 'text-muted-foreground/40',
            )}
            title={`Energy: ${task.energy ?? 'unset'} (click to cycle)`}
          >
            {EnergyIcon && <EnergyIcon size={8} />}
            {task.energy ?? '~'}
          </button>

          {/* Effort pill */}
          {(task.effort || false) && (
            <button
              onClick={(e) => { e.stopPropagation(); cycleEffort(); }}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider transition-colors hover:bg-muted"
              title={`Effort: ${task.effort} (click to cycle)`}
            >
              {EFFORT_LABELS[task.effort!] ?? task.effort}
            </button>
          )}

          {/* Deadline */}
          {deadline && !editingDeadline && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingDeadline(true); }}
              className={cn(
                'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-colors hover:bg-muted',
                isPastDate(task.hardDeadline)
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              <Clock size={8} /> {deadline}
            </button>
          )}
          {editingDeadline && (
            <input
              type="date"
              autoFocus
              defaultValue={task.hardDeadline?.split('T')[0] ?? ''}
              className="text-[10px] bg-card border border-border rounded px-1 py-0.5"
              onBlur={(e) => {
                setEditingDeadline(false);
                const val = e.target.value;
                onUpdate(task.id, 'hardDeadline', dateInputToStored(val));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingDeadline(false);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}

          {/* Boomerang */}
          {boomerang && !editingBoomerang && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingBoomerang(true); }}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold text-muted-foreground/60 uppercase tracking-wider transition-colors hover:bg-muted"
              title="Click to edit resurface date"
            >
              <Timer size={8} /> {boomerang}
            </button>
          )}
          {editingBoomerang && (
            <input
              type="date"
              autoFocus
              defaultValue={task.resurfaceAfter?.split('T')[0] ?? ''}
              className="text-[10px] bg-card border border-border rounded px-1 py-0.5"
              onBlur={(e) => {
                setEditingBoomerang(false);
                const val = e.target.value;
                onUpdate(task.id, 'resurfaceAfter', dateInputToStored(val));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingBoomerang(false);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}

          {/* Recurrence */}
          {task.recurrence && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold text-primary/60 uppercase tracking-wider">
              <Repeat size={8} /> {task.recurrence}
            </span>
          )}

          {/* Blocked */}
          {task.blockedOn && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold text-amber-500 uppercase tracking-wider">
              <Lock size={8} /> Blocked
            </span>
          )}

          {/* Has body */}
          {task.bodyLen > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center px-1 py-0.5 text-foreground/60">
                    <AlignLeft size={8} />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] whitespace-pre-wrap text-xs leading-relaxed line-clamp-5">
                  {task.bodyExcerpt}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Has subtasks */}
          {task.subtaskCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-foreground/60 text-[8.5px] font-medium">
                    <ListTree size={8} /> {task.subtaskCount}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="block max-w-[280px] text-xs">
                  <p className="font-semibold mb-1">{task.subtaskCount} subtask{task.subtaskCount === 1 ? '' : 's'}</p>
                  <ul className="space-y-0.5">
                    {task.subtaskPreview?.split('|||').map((title, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-1.5 w-1 h-1 rounded-full bg-current flex-shrink-0" />
                        <span className="line-clamp-1">{title}</span>
                      </li>
                    ))}
                  </ul>
                  {task.subtaskCount > 4 && (
                    <p className="mt-1 text-[10px] opacity-70">+{task.subtaskCount - 4} more</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {onPickBucket && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-xs">
                    <ArrowUpDown size={12} className="mr-2" /> Priority
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-32">
                    {BUCKET_OPTIONS.map(opt => (
                      <DropdownMenuItem
                        key={opt.value}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickBucket(task.id, opt.value);
                        }}
                        className="text-xs"
                      >
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => onSnooze(task.id, 1)} className="text-xs">
              <Timer size={12} className="mr-2" /> Snooze 1 day
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(task.id, 3)} className="text-xs">
              <Timer size={12} className="mr-2" /> Snooze 3 days
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(task.id, 7)} className="text-xs">
              <Timer size={12} className="mr-2" /> Snooze 1 week
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {!task.effort && (
              <DropdownMenuItem onClick={() => cycleEffort()} className="text-xs">
                Set effort
              </DropdownMenuItem>
            )}
            {!task.hardDeadline && (
              <DropdownMenuItem onClick={() => setEditingDeadline(true)} className="text-xs">
                <Clock size={12} className="mr-2" /> Set deadline
              </DropdownMenuItem>
            )}
            {!task.blockedOn && (
              <DropdownMenuItem
                onClick={() => setBlockPopoverOpen(true)}
                className="text-xs"
              >
                <Lock size={12} className="mr-2" /> Block
              </DropdownMenuItem>
            )}
            {task.blockedOn && (
              <DropdownMenuItem
                onClick={() => {
                  onUpdate(task.id, 'blockedOn', null);
                  onUpdate(task.id, 'blockedSince', null);
                }}
                className="text-xs"
              >
                <ShieldAlert size={12} className="mr-2" /> Unblock
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onArchive(task.id)}
              className="text-xs text-destructive"
            >
              <Archive size={12} className="mr-2" /> Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Block popover */}
        <Popover open={blockPopoverOpen} onOpenChange={setBlockPopoverOpen}>
          <PopoverTrigger asChild>
            <span />
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="end">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Blocked on</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const val = blockInputRef.current?.value.trim();
              if (val) {
                onUpdate(task.id, 'blockedOn', val);
                onUpdate(task.id, 'blockedSince', new Date().toISOString());
              }
              setBlockPopoverOpen(false);
            }}>
              <input
                ref={blockInputRef}
                type="text"
                autoFocus
                placeholder="e.g. waiting on design review"
                className="w-full text-[11px] bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex justify-end gap-1 mt-1.5">
                <PopoverClose asChild>
                  <button type="button" className="text-[10px] px-2 py-0.5 rounded text-muted-foreground hover:bg-muted">Cancel</button>
                </PopoverClose>
                <button type="submit" className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90">Block</button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
