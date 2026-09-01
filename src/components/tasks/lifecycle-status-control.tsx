'use client';

import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';
import {
  availableCommands,
  TASK_STATUS_LABELS,
  transitionLabel,
  type LifecycleCommand,
  type TaskStatus,
} from '@/lib/tasks/lifecycle';
import { cn } from '@/lib/utils';

/** Consistent status color across every surface. */
export const STATUS_COLOR: Record<TaskStatus, string> = {
  consider: 'text-amber-500',
  todo: 'text-blue-500',
  in_progress: 'text-violet-500',
  done: 'text-emerald-500',
  archived: 'text-muted-foreground',
};

/**
 * The one editable lifecycle status control, shared by list rows, task detail,
 * the slideout, linked-task context, and the Kanban card. It shows the current
 * status and offers ONLY the valid destinations from here, each invoking a
 * semantic lifecycle command (never a raw status write). Keyboard and screen
 * reader come free from the Radix dropdown.
 */
export function LifecycleStatusControl({
  taskId,
  status,
  className,
  size = 'sm',
}: {
  taskId: string;
  status: TaskStatus;
  className?: string;
  size?: 'sm' | 'xs';
}) {
  const lc = useTaskLifecycle();

  const dispatch = (cmd: LifecycleCommand) => {
    switch (cmd) {
      case 'complete': return lc.complete(taskId);
      case 'start': return lc.start(taskId);
      case 'move_to_todo': return lc.moveToTodo(taskId);
      case 'move_to_consider': return lc.moveToConsider(taskId);
      case 'return_to_todo': return lc.returnToTodo(taskId);
      case 'archive': return lc.archive(taskId);
      case 'reopen': return lc.reopen(taskId);
      case 'restore': return lc.restore(taskId);
    }
  };

  const commands = availableCommands(status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-1 rounded font-medium capitalize transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          size === 'xs' ? 'px-1 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-xs',
          STATUS_COLOR[status],
          className,
        )}
        aria-label={`Task status: ${TASK_STATUS_LABELS[status]}. Change status.`}
      >
        {TASK_STATUS_LABELS[status]}
        <ChevronDown size={size === 'xs' ? 10 : 12} className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {commands.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs">No actions available</DropdownMenuItem>
        ) : (
          commands.map((cmd) => (
            <DropdownMenuItem key={cmd} className="text-xs" onSelect={() => dispatch(cmd)}>
              {transitionLabel(cmd)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
