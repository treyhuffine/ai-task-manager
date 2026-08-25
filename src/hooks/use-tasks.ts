import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { tasksApi } from '@/lib/api/tasks';
import {
  optimisticPatch,
  optimisticRemove,
  rollbackOptimistic,
  settleEntity,
} from '@/lib/query/optimistic-entity';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskRecord,
} from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

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
      tasksApi.complete(id, note),
    onMutate: async ({ id }) => {
      const patch = buildCompletePatch(qc, id);
      // Recurring tasks are not "done" on completion — the server bumps
      // nextRecurrenceAt and keeps them active, and we can't predict the next
      // occurrence client-side. Skip the optimistic flip and let settle
      // reconcile; a null patch means no snapshot to roll back.
      return { snapshot: patch ? await optimisticPatch(qc, 'tasks', id, patch) : undefined };
    },
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not complete task');
    },
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

/**
 * Read the task from whatever cache holds it (single-entity first, then any
 * list) to decide how to optimistically complete it. Returns null for recurring
 * tasks, which must not be flipped to `done`.
 */
function buildCompletePatch(qc: QueryClient, id: string): Record<string, unknown> | null {
  const cached = findCachedTask(qc, id);
  if (cached?.recurrence) return null;
  return { status: 'done', completedAt: new Date().toISOString() };
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
