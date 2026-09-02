'use client';

import { Check, CornerUpLeft, ListTree } from 'lucide-react';
import { useTasks, useTaskAttention } from '@/hooks/use-tasks';
import { useTaskLifecycle } from '@/hooks/use-task-lifecycle';
import { useDashboard } from '@/contexts/dashboard-context';
import { TaskBadges } from '@/components/tasks/task-badges';
import { LifecycleStatusControl } from '@/components/tasks/lifecycle-status-control';
import { StartWithAgentButton } from '@/components/tasks/start-with-agent-button';
import type { TaskAttentionSignals } from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import { cn } from '@/lib/utils';

/** Sort so the work that needs a human first floats up: Blocked, then Stalled,
 * then Review, then everything else (stable within a bucket). */
function attentionRank(s?: TaskAttentionSignals): number {
  if (!s) return 3;
  if (s.blocked) return 0;
  if (s.stalled) return 1;
  if (s.review) return 2;
  return 3;
}

/**
 * Current Work: every In-progress task, read from persisted lifecycle state (not
 * the deck plan or transient Focus). It sits above the generated daily stack so
 * what is actually underway is always visible, even when blocked, between
 * agents, or awaiting review. Grouped by attention need, then stable order.
 */
export function CurrentWorkSection() {
  const { data: tasks } = useTasks({ status: 'in_progress', orderBy: 'sortKey' });
  const ids = (tasks ?? []).map((t) => t.id);
  const { data: attention } = useTaskAttention(ids);
  const lifecycle = useTaskLifecycle();
  const { openTask } = useDashboard();

  if (!tasks || tasks.length === 0) return null;

  const sorted: TaskListDTO[] = [...tasks].sort(
    (a, b) => attentionRank(attention?.[a.id]) - attentionRank(attention?.[b.id]),
  );

  return (
    <section className="mb-3">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400">Current Work</h3>
        <span className="text-[10px] text-muted-foreground">{tasks.length}</span>
        <div className="ml-1 h-px flex-1 bg-border" />
      </div>

      <ul className="space-y-1">
        {sorted.map((task) => (
          <li
            key={task.id}
            className="group flex items-center gap-2 rounded-md border border-violet-500/20 bg-violet-500/[0.06] px-2.5 py-2 transition-colors hover:border-violet-500/40"
          >
            <button onClick={() => openTask(task.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[12px] font-medium text-foreground">{task.title || 'Untitled'}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <TaskBadges signals={attention?.[task.id]} size="xs" />
                {task.parentId && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground" title="Subtask">
                    <ListTree size={9} /> subtask
                  </span>
                )}
              </span>
            </button>

            <div
              className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <StartWithAgentButton task={task} variant="icon" />
              <ActionButton title="Return to Todo" onClick={() => lifecycle.returnToTodo(task.id)}>
                <CornerUpLeft size={13} />
              </ActionButton>
              <ActionButton title="Complete" onClick={() => lifecycle.complete(task.id)} className="text-emerald-600 dark:text-emerald-400">
                <Check size={14} />
              </ActionButton>
            </div>

            <span onClick={(e) => e.stopPropagation()}>
              <LifecycleStatusControl taskId={task.id} status={task.status} size="xs" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActionButton({
  title,
  onClick,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn('flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground', className)}
    >
      {children}
    </button>
  );
}
