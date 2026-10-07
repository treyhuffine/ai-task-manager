'use client';

import { useDashboard } from '@/contexts/dashboard-context';
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ListTodo } from 'lucide-react';
import { Tip } from '@/components/ui/tip';

/**
 * "Working on" — the tasks an execution is associated with, shown in the header
 * so the link is obvious the moment the workstream opens. An execution can work
 * SEVERAL tasks (the many-to-many model), so this lists each non-terminal one as
 * a clickable chip. Taskless quick work, or an execution whose tasks are all
 * finished, shows nothing.
 */
export function ExecutionTaskChips({ executionId }: { executionId: string }) {
  const { openTask } = useDashboard();
  const { data } = useQuery({
    queryKey: ['executions', executionId, 'tasks'],
    queryFn: () => trpcClient.executions.tasksGet.query({params: {id: executionId}}),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });

  const active = (data ?? []).filter((t) => t.status !== 'done' && t.status !== 'archived');
  if (active.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2 pb-1.5 pt-0.5">
      <span className="inline-flex flex-shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        <ListTodo size={11} aria-hidden />
        {active.length > 1 ? 'Working on' : 'Task'}
      </span>
      {active.map((t) => (
        <Tip key={t.id} label={t.title || 'Untitled'} onlyWhenTextHidden>
          <button
            onClick={() => openTask(t.id)}
            className={cn(
              'inline-flex max-w-[16rem] items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors',
              t.status === 'in_progress'
                ? 'border-violet-500/30 bg-violet-500/[0.06] text-foreground hover:border-violet-500/50'
                : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="truncate">{t.title || 'Untitled'}</span>
          </button>
        </Tip>
      ))}
    </div>
  );
}
