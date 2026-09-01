import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { tasksApi } from '@/lib/api/tasks';
import { apiErrorText } from '@/lib/api/client';
import {
  optimisticPatch,
  optimisticRemove,
  optimisticTransition,
  rollbackOptimistic,
  settleEntity,
} from '@/lib/query/optimistic-entity';
import { targetState, type TransitionCommand } from '@/lib/tasks/lifecycle';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskRecord,
} from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

/** A stable idempotency key per user action (safe re-fire on lost response). */
function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const TASKS_KEY = ['tasks'] as const;

export function useTasks(filter?: TaskFilter) {
  return useQuery({
    queryKey: [...TASKS_KEY, filter],
    queryFn: () => tasksApi.list(filter),
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: [...TASKS_KEY, id],
    queryFn: () => tasksApi.get(id!),
    enabled: !!id,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASKS_KEY,
    mutationFn: (input: CreateTaskInput) => tasksApi.create(input),
    // Creates stay non-optimistic for the list (which filtered lists a new row
    // belongs to is decided server-side), but we seed the detail cache so
    // opening the freshly-created item is instant.
    onSuccess: (record) => qc.setQueryData([...TASKS_KEY, record.id], record),
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASKS_KEY,
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
      tasksApi.update(id, input),
    onMutate: async ({ id, ...input }) => ({
      snapshot: await optimisticPatch(qc, 'tasks', id, input),
    }),
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not save changes');
    },
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASKS_KEY,
    mutationFn: (id: string) => tasksApi.delete(id),
    onMutate: async (id) => ({ snapshot: await optimisticRemove(qc, 'tasks', id) }),
    onError: (_err, _id, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not delete task');
    },
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASKS_KEY,
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      tasksApi.complete(id, { note, idempotencyKey: newIdempotencyKey() }),
    onMutate: async ({ id }) => {
      // Recurring tasks are NOT "done" on completion — the server records the
      // occurrence, advances recurrence, and returns the task to Todo, none of
      // which we can predict client-side. Skip the optimistic flip and let
      // settle reconcile (null snapshot = nothing to roll back). Non-recurring
      // tasks flip to Done and leave their current lane immediately.
      const cached = findCachedTask(qc, id);
      if (cached?.recurrence) return { snapshot: undefined };
      return {
        snapshot: await optimisticTransition(qc, id, 'done', { completedAt: new Date().toISOString() }),
      };
    },
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not complete task');
    },
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

/**
 * Apply a semantic lifecycle transition (Start, Move to Todo/Consider, Return,
 * Reopen, Archive, Restore). Optimistically moves the row out of the lane it
 * left; settle places it in the destination lane. A stale-revision or
 * precondition failure rolls back and surfaces the server's actionable message.
 */
export function useTransitionTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TASKS_KEY,
    mutationFn: ({ id, command, expectedStatusChangedCount }: { id: string; command: TransitionCommand; expectedStatusChangedCount?: number }) =>
      tasksApi.transition(id, command, { idempotencyKey: newIdempotencyKey(), expectedStatusChangedCount }),
    onMutate: async ({ id, command }) => {
      const to = targetState(command);
      const extra = command === 'reopen' ? { completedAt: null } : {};
      return { snapshot: await optimisticTransition(qc, id, to, extra) };
    },
    onError: (err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error(apiErrorText(err));
    },
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

function findCachedTask(qc: QueryClient, id: string): TaskRecord | TaskListDTO | undefined {
  const single = qc.getQueryData<TaskRecord>([...TASKS_KEY, id]);
  if (single) return single;
  for (const [, data] of qc.getQueriesData<TaskListDTO[]>({ queryKey: TASKS_KEY })) {
    if (Array.isArray(data)) {
      const hit = data.find((task) => task?.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}
