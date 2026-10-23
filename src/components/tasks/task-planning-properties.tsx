'use client';

import type { TaskRecord, UpdateTaskInput } from '@/db/types';
import { ENERGY_OPTIONS, EFFORT_OPTIONS } from './task-options';
import { TaskPriority } from './task-priority';
import { TaskDateField } from './task-date-field';
import { cn } from '@/lib/utils';

/** Private planning uses the same controls on personal and referenced work. */
export function TaskPlanningProperties({ task, save }: { task: TaskRecord; save: (patch: UpdateTaskInput) => void }) {
  return <>
    <span className="font-medium text-muted-foreground">Energy</span>
    <div className="flex items-center gap-1">{ENERGY_OPTIONS.map(option => <button key={option.value} type="button" onClick={() => save({ energy: task.energy === option.value ? null : option.value })} className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium', task.energy === option.value ? `${option.color} bg-current/10 ring-1 ring-current/20` : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground')}><option.icon size={10}/>{option.label}</button>)}</div>
    <span className="font-medium text-muted-foreground">Effort</span>
    <div className="flex flex-wrap items-center gap-1">{EFFORT_OPTIONS.map(option => <button key={option.value} type="button" onClick={() => save({ effort: task.effort === option.value ? null : option.value })} className={cn('rounded px-2 py-0.5 text-[11px] font-medium', task.effort === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground')}>{option.label}</button>)}</div>
    <span className="font-medium text-muted-foreground">Priority</span><TaskPriority taskId={task.id} status={task.status}/>
    <span className="font-medium text-muted-foreground">Snooze until</span><TaskDateField label="Snooze until" value={task.resurfaceAfter} onChange={resurfaceAfter => save({ resurfaceAfter })}/>
  </>;
}
