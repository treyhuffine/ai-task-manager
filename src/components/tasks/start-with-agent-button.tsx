'use client';

import { Bot } from 'lucide-react';
import { openLauncher } from '@/components/workspaces/launcher/launcher-store';
import { cn } from '@/lib/utils';

interface TaskLike {
  id: string;
  title: string;
  status: string;
  workspaceId?: string | null;
  description?: string | null;
  body?: string | null;
  bodyExcerpt?: string | null;
}

/**
 * "Start with agent" (or "Continue with agent" for In-progress work): opens the
 * execution launcher pre-seeded with this task as context and its id for
 * ownership. On launch, the server records ownership and — for Consider/Todo —
 * atomically Starts the task (moves it to In progress). The launcher lets the
 * user confirm the workspace, model, and prompt first, so nothing dispatches by
 * surprise.
 */
export function StartWithAgentButton({
  task,
  variant = 'button',
  className,
}: {
  task: TaskLike;
  variant?: 'button' | 'icon' | 'menuitem';
  className?: string;
}) {
  const live = task.status === 'in_progress';
  const label = live ? 'Continue with agent' : 'Start with agent';

  const onClick = () =>
    openLauncher({
      taskId: task.id,
      workspaceId: task.workspaceId ?? undefined,
      contextTitle: task.title,
      contextBody: task.description || task.body || task.bodyExcerpt || '',
    });

  if (variant === 'icon') {
    return (
      <button
        title={label}
        aria-label={label}
        onClick={onClick}
        className={cn('flex h-7 w-7 items-center justify-center rounded text-violet-600 hover:bg-violet-500/10 dark:text-violet-400', className)}
      >
        <Bot size={14} />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border border-violet-500/30 bg-violet-500/5 px-2 py-1 text-[11px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-violet-400',
        className,
      )}
    >
      <Bot size={13} />
      {label}
    </button>
  );
}
