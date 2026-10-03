import { useLifecycleGuard } from '@/components/tasks/lifecycle-guard';
import type { TaskFilter, TaskRecord } from '@/db/types';
import { apiErrorCode, apiErrorDetails, apiErrorText } from '@/lib/api/client';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import { tasksApi } from '@/lib/api/tasks';
import { documentSaves } from '@/lib/client/document-saves';
import { entityKeys } from '@/lib/query/entity-keys';
import {
	optimisticPatch,
	optimisticRemove,
	optimisticTransition,
	rollbackOptimistic,
	settleEntity,
} from '@/lib/query/optimistic-entity';
import { targetState, type TransitionCommand } from '@/lib/tasks/lifecycle';
import { trpc } from '@/lib/trpc/client';
import type { RouterInputs } from '@/lib/trpc/router';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** A stable idempotency key per user action (safe re-fire on lost response). */
function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** `refetchInterval` keeps a surface someone watches (the board) current with
 * changes made elsewhere, like an agent moving a task mid-turn. */
export function useTasks(filter?: TaskFilter, opts: { refetchInterval?: number } = {}) {
  return useQuery({
    ...trpc.tasks.list.queryOptions(filter),
    refetchInterval: opts.refetchInterval,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    ...trpc.tasks.get.queryOptions({ id: id ?? '' }),
    enabled: !!id,
  });
}

/**
 * Attention badges (Blocked / Stalled / Review / Working) for a set of tasks.
 * Meant for Current Work and visible In-progress rows. Polls lightly so a live
 * agent's state (new output to review, a stall) surfaces without a reload.
 */
/** Task counts by canonical status (for lane count badges), optionally scoped
 * to an area. Kept fresh as tasks move between lanes. */
export function useTaskCounts(areaId?: string | null) {
  return useQuery({
    ...trpc.tasks.counts.queryOptions({ areaId: areaId ?? null }),
    staleTime: 5_000,
  });
}

export function useTaskAttention(ids: string[]) {
  const sortedIds = [...new Set(ids)].sort();
  return useQuery({
    ...trpc.tasks.attention.queryOptions({ ids: sortedIds }),
    // Large boards keep all badges. The server bounds each read to 200 IDs,
    // and the imperative helper splits larger sets without changing this key.
    queryFn: () => tasksApi.attention(sortedIds),
    enabled: ids.length > 0,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

/**
 * Real hard deadlines — overdue plus everything due within `withinDays` days
 * (default 7). Computed deterministically server-side with no model call, so
 * this is the trust floor that stays findable even when Deck generation is
 * unavailable. Polls lightly so a task that crosses into "due" surfaces without
 * a reload.
 */
export function useDeadlines(withinDays?: number) {
  return useQuery({
    ...trpc.tasks.deadlines.queryOptions({ withinDays }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation(trpc.tasks.create.mutationOptions({
    meta: { carriesInput: true },
    // Creates stay non-optimistic for the list (which filtered lists a new row
    // belongs to is decided server-side), but we seed the detail cache so
    // opening the freshly-created item is instant.
    onSuccess: (record) => qc.setQueryData(entityKeys.tasks.detail(record.id), record),
    onSettled: () => settleEntity(qc, 'tasks'),
  }));
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: trpc.tasks.update.mutationKey(),
    meta: { carriesInput: true },
    mutationFn: ({ id, ...input }: RouterInputs['tasks']['update']['patch'] & { id: string }) =>
      tasksApi.update(id, input),
    onMutate: async ({ id, ...input }) => ({
      snapshot: await optimisticPatch(qc, 'tasks', id, input),
    }),
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not save changes', { id: 'save-changes-failed' });
    },
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: trpc.tasks.delete.mutationKey(),
    mutationFn: async (id: string) => {
      await documentSaves.flush(`tasks:${id}`);
      return tasksApi.delete(id);
    },
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
  const guard = useLifecycleGuard();
  return useMutation({
    mutationKey: trpc.tasks.complete.mutationKey(),
    mutationFn: ({ id, note }: { id: string; note?: string }) => {
      // Pass the revision the client last saw so two rapid completes (e.g. a
      // recurring Todo->Todo double-click) can't both apply — the second sees a
      // stale count and conflicts instead of recording a duplicate occurrence.
      const cached = findCachedTask(qc, id) as { statusChangedCount?: number } | undefined;
      return tasksApi.complete(id, {
        note,
        idempotencyKey: newIdempotencyKey(),
        expectedStatusChangedCount: cached?.statusChangedCount,
      });
    },
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
    onError: (err, vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      // Open children and/or a running workstream need confirmation. Hand off to
      // the guard's resolve loop, which composes both confirmations and re-issues
      // with all acknowledgements — a dead-end toast otherwise.
      const code = apiErrorCode(err);
      const details = apiErrorDetails<{ requiresChoice?: boolean; requiresChildAck?: boolean }>(err);
      if ((code === 'active_execution' && details?.requiresChoice) || (code === 'conflict' && details?.requiresChildAck)) {
        void guard.resolve({ taskId: vars.id, command: 'complete' });
        return;
      }
      toast.error(apiErrorText(err));
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
  const guard = useLifecycleGuard();
  return useMutation({
    mutationKey: trpc.tasks.transition.mutationKey(),
    mutationFn: ({ id, command, expectedStatusChangedCount }: { id: string; command: TransitionCommand; expectedStatusChangedCount?: number }) =>
      tasksApi.transition(id, command, { idempotencyKey: newIdempotencyKey(), expectedStatusChangedCount }),
    onMutate: async ({ id, command }) => {
      const to = targetState(command);
      const extra = command === 'reopen' ? { completedAt: null } : {};
      return { snapshot: await optimisticTransition(qc, id, to, extra) };
    },
    onError: (err, vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      // Archiving / returning over a running workstream or open children needs
      // confirmation — hand off to the composing resolve loop. (Move to Consider
      // is a hard reject, so it falls through to a toast.)
      const code = apiErrorCode(err);
      const details = apiErrorDetails<{ requiresChoice?: boolean; requiresChildAck?: boolean }>(err);
      const guardable = vars.command === 'archive' || vars.command === 'return_to_todo';
      if (guardable && ((code === 'active_execution' && details?.requiresChoice) || (code === 'conflict' && details?.requiresChildAck))) {
        void guard.resolve({ taskId: vars.id, command: vars.command as 'archive' | 'return_to_todo' });
        return;
      }
      toast.error(apiErrorText(err));
    },
    onSettled: () => settleEntity(qc, 'tasks'),
  });
}

function findCachedTask(qc: QueryClient, id: string): TaskRecord | TaskListDTO | undefined {
  const single = qc.getQueryData<TaskRecord>(entityKeys.tasks.detail(id));
  if (single) return single;
  for (const [, data] of qc.getQueriesData<TaskListDTO[]>(trpc.tasks.list.pathFilter())) {
    if (Array.isArray(data)) {
      const hit = data.find((task) => task?.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}
