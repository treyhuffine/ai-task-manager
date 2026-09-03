'use client';

import { useCompleteTask, useTransitionTask } from '@/hooks/use-tasks';
import type { TaskStatus } from '@/db/types';

/**
 * One shared set of lifecycle action callbacks, so List, slideout, detail page,
 * Area, Deck, and subtask surfaces stop each re-implementing complete / archive
 * / restore / reopen. Every action routes through the semantic endpoints
 * (transition_task / complete_task) — never a raw status write — so history,
 * idempotency, and invariants hold identically everywhere.
 */
export function useTaskLifecycle() {
  const transition = useTransitionTask();
  const complete = useCompleteTask();

  return {
    complete: (id: string, note?: string) => complete.mutate({ id, note }),
    /** Optional onSuccess lets a caller (e.g. the Deck) commit its own UI change
     * only after the transition actually applied, not optimistically. */
    start: (id: string, opts?: { onSuccess?: () => void }) => transition.mutate({ id, command: 'start' }, opts),
    archive: (id: string) => transition.mutate({ id, command: 'archive' }),
    restore: (id: string) => transition.mutate({ id, command: 'restore' }),
    reopen: (id: string) => transition.mutate({ id, command: 'reopen' }),
    moveToTodo: (id: string) => transition.mutate({ id, command: 'move_to_todo' }),
    moveToConsider: (id: string) => transition.mutate({ id, command: 'move_to_consider' }),
    returnToTodo: (id: string) => transition.mutate({ id, command: 'return_to_todo' }),
    /**
     * The primary "toggle" action for a checkbox-style control: a terminal task
     * reopens/restores, otherwise it completes. Committed/consider work
     * completes (todo/in_progress) or, from consider, has no direct complete so
     * we no-op rather than fabricate one.
     */
    toggle: (id: string, status: TaskStatus, note?: string) => {
      if (status === 'done') transition.mutate({ id, command: 'reopen' });
      else if (status === 'archived') transition.mutate({ id, command: 'restore' });
      else if (status === 'todo' || status === 'in_progress') complete.mutate({ id, note });
    },
    isPending: transition.isPending || complete.isPending,
  };
}
