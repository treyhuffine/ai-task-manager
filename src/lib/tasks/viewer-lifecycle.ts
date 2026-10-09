import { uuidv7 } from 'uuidv7';
import { completeTask, getTask, lifecyclePreflight, transitionTask } from '@/lib/db/queries';
import { coordinateLifecycleChange, type RuntimeChoice, type ScopeChange } from '@/lib/sessions/workstream';
import { inProcessWorkstreamRuntime } from '@/lib/sessions/workstream-runtime';
import { TaskLifecycleError, type TransitionCommand } from './lifecycle';

export interface ViewerLifecycleOptions {
  idempotencyKey?: string;
  expectedStatusChangedCount?: number;
  runtimeChoice?: RuntimeChoice;
  acknowledgedChildIds?: string[];
  acknowledgedExecutionIds?: string[];
}

/**
 * In a team space, the member changing the task's status. A team runs no
 * agents, so there's no workstream to coordinate, and the change is
 * recorded as theirs (docs/homes-spec.md §9.1).
 */
export interface TeamLifecycleActor {
  memberId: string;
}

/** Shared REST/tRPC behavior. Validate before touching a running workstream,
 * and never coordinate again when an idempotent command is replayed. */
export async function completeTaskForViewer(id: string, opts: ViewerLifecycleOptions & { note?: string }, member?: TeamLifecycleActor) {
  const task = getTask(id);
  if (!task) throw new TaskLifecycleError('not_found', 'Task not found');
  const pre = lifecyclePreflight({ taskId: id, command: 'complete', ...opts });
  if (!pre.replay && !member) await coordinateLifecycleChange({
    taskId: id, kind: 'displace', choice: opts.runtimeChoice,
    change: { taskId: id, taskTitle: task.title ?? '', action: 'completed' },
    acknowledgedExecutionIds: opts.acknowledgedExecutionIds, runtime: inProcessWorkstreamRuntime,
  });
  const result = completeTask(id, { ...opts, meta: { source: 'human', actorMemberId: member?.memberId ?? null } });
  if (!result) throw new TaskLifecycleError('not_found', 'Task not found');
  return result;
}

export async function transitionTaskForViewer(
  id: string,
  command: TransitionCommand,
  opts: ViewerLifecycleOptions & { reason?: string },
  member?: TeamLifecycleActor,
) {
  const idempotencyKey = opts.idempotencyKey ?? uuidv7();
  const pre = lifecyclePreflight({ taskId: id, command, ...opts, idempotencyKey });
  if (!pre.replay && !member && (command === 'archive' || command === 'return_to_todo' || command === 'move_to_consider')) {
    const task = getTask(id);
    const change: ScopeChange | undefined = command === 'archive'
      ? { taskId: id, taskTitle: task?.title ?? '', action: 'archived' }
      : command === 'return_to_todo' ? { taskId: id, taskTitle: task?.title ?? '', action: 'returned to Todo' } : undefined;
    await coordinateLifecycleChange({
      taskId: id, kind: command === 'move_to_consider' ? 'uncommit' : 'displace',
      choice: opts.runtimeChoice, change, acknowledgedExecutionIds: opts.acknowledgedExecutionIds,
      runtime: inProcessWorkstreamRuntime,
    });
  }
  return transitionTask({
    taskId: id, command, ...opts, idempotencyKey,
    meta: { source: 'human', actorMemberId: member?.memberId ?? null, reason: opts.reason ?? null },
  });
}
