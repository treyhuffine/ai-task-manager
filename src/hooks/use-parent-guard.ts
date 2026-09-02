'use client';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTasks } from '@/hooks/use-tasks';

/**
 * Completing or archiving a parent never cascades to its children — but doing
 * it silently while children are still open is surprising. This guard fetches a
 * task's open children and, if any exist, asks for one explicit confirmation
 * (making clear the children are left unchanged). Returns true to proceed.
 */
export function useParentGuard(taskId: string | null) {
  const confirm = useConfirm();
  const { data: children } = useTasks({ parentId: taskId ?? '__none__' });

  const openChildren = (children ?? []).filter((c) => c.status !== 'done' && c.status !== 'archived');

  return async function confirmIfHasOpenChildren(action: 'complete' | 'archive'): Promise<boolean> {
    const n = openChildren.length;
    if (n === 0) return true;
    return confirm({
      title: action === 'complete' ? 'Complete this task?' : 'Archive this task?',
      description: `It has ${n} open subtask${n > 1 ? 's' : ''}, which will be left unchanged.`,
      confirmLabel: action === 'complete' ? 'Complete anyway' : 'Archive anyway',
    });
  };
}
