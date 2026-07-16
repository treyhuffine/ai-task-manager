import type { BackgroundTask } from '@/hooks/use-background-tasks';

/**
 * The transcript is useful while runtime status is still loading, but a
 * persisted nonterminal event can outlive its process after a server restart.
 * Once runtime status arrives, its task-id snapshot is authoritative. This is
 * per-task rather than session-wide so starting fresh work cannot resurrect an
 * orphaned historical start. Completed tasks remain available to transcript UI.
 */
export function selectVisibleBackgroundTasks(
  tasks: BackgroundTask[],
  runtimeHasBackgroundTasks: boolean | undefined,
  runtimeBackgroundTaskIds: string[] | undefined,
): BackgroundTask[] {
  if (runtimeHasBackgroundTasks === undefined) return tasks;
  const liveIds = new Set(runtimeHasBackgroundTasks ? runtimeBackgroundTaskIds ?? [] : []);
  return tasks.filter((task) => !task.isActive || liveIds.has(task.taskId));
}
