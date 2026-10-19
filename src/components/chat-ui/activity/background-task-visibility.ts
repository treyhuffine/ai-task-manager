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

/**
 * Task ids the runtime reports live that the loaded events don't describe.
 * The transcript loads its newest page only, so a long-lived task (a dev
 * server an agent left running) can start further back than that page.
 * Sorted, so the list is a stable cache key.
 */
export function missingLiveTaskIds(
  tasks: BackgroundTask[],
  runtimeHasBackgroundTasks: boolean | undefined,
  runtimeBackgroundTaskIds: string[] | undefined,
): string[] {
  if (!runtimeHasBackgroundTasks || !runtimeBackgroundTaskIds?.length) return [];
  const known = new Set(tasks.map((t) => t.taskId));
  return [...new Set(runtimeBackgroundTaskIds)].filter((id) => !known.has(id)).sort();
}

/** Merge extra events into a list: no duplicates, ordered like the transcript. */
export function mergeEventLists<T extends { id: string; createdAt: string }>(base: readonly T[], extra: readonly T[]): T[] {
  if (extra.length === 0) return base as T[];
  const byId = new Map<string, T>();
  for (const e of extra) byId.set(e.id, e);
  for (const e of base) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) =>
    a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * The runtime is the authority on what is live. If it reports a task the
 * events can't describe at all (not even after looking further back), still
 * show it, unnamed, so the strip never hides work that is running.
 */
export function withLivePlaceholders(
  tasks: BackgroundTask[],
  runtimeHasBackgroundTasks: boolean | undefined,
  runtimeBackgroundTaskIds: string[] | undefined,
): BackgroundTask[] {
  const missing = missingLiveTaskIds(tasks, runtimeHasBackgroundTasks, runtimeBackgroundTaskIds);
  if (missing.length === 0) return tasks;
  const now = new Date().toISOString();
  return [...tasks, ...missing.map((taskId) => ({ taskId, status: 'running' as const, updatedAt: now, isActive: true }))];
}
