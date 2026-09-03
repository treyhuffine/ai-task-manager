import { api } from './client';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import type {
  TaskRecord,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
  TaskAttentionSignals,
} from '@/db/types';
import type { TransitionCommand } from '@/lib/tasks/lifecycle';

/** Server outcome of a lifecycle command (transition or completion). */
export interface LifecycleResult {
  task: TaskRecord;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  statusChangedCount: number;
  recurring?: boolean;
  nextRecurrenceAt?: string | null;
  replayed: boolean;
}

export const tasksApi = {
  list(filter?: TaskFilter): Promise<TaskListDTO[]> {
    return api.get<TaskListDTO[]>('/tasks', { query: filter as Record<string, string> });
  },

  get(id: string): Promise<TaskRecord> {
    return api.get<TaskRecord>(`/tasks/${id}`);
  },

  create(input: CreateTaskInput): Promise<TaskRecord> {
    return api.post<TaskRecord>('/tasks', input);
  },

  update(id: string, input: UpdateTaskInput): Promise<TaskRecord> {
    return api.patch<TaskRecord>(`/tasks/${id}`, input);
  },

  delete(id: string): Promise<void> {
    return api.delete(`/tasks/${id}`);
  },

  complete(
    id: string,
    opts: { note?: string; idempotencyKey?: string; expectedStatusChangedCount?: number; runtimeChoice?: 'keep_running' | 'stop_running_agent'; acknowledgedChildIds?: string[]; acknowledgedExecutionIds?: string[] } = {},
  ): Promise<LifecycleResult> {
    return api.post(`/tasks/${id}/complete`, opts);
  },

  /** The executions currently owning a task (for the active-agent warning). */
  executions(id: string): Promise<Array<{ id: string; label: string | null; status: string }>> {
    return api.get(`/tasks/${id}/executions`);
  },

  /** Reorder a task within its lane, server-side and atomic, against the full
   * sibling set (including Area-hidden cards). Pass the visible neighbor ids. */
  reorder(id: string, opts: { prevId?: string | null; nextId?: string | null }): Promise<{ sortKey: string }> {
    return api.post(`/tasks/${id}/reorder`, opts);
  },

  /** Batch attention badges for the given task ids. */
  attention(ids: string[]): Promise<Record<string, TaskAttentionSignals>> {
    if (ids.length === 0) return Promise.resolve({});
    return api.get(`/tasks/attention`, { query: { ids: ids.join(',') } });
  },

  /** Task counts by canonical status, optionally within an area. */
  counts(areaId?: string | null): Promise<Record<TaskStatus, number>> {
    return api.get(`/tasks/counts`, { query: areaId ? { areaId } : undefined });
  },

  /** Apply a semantic lifecycle transition (move_to_todo / move_to_consider /
   * start / return_to_todo / reopen / archive / restore). */
  transition(
    id: string,
    command: TransitionCommand,
    opts: { idempotencyKey?: string; expectedStatusChangedCount?: number; reason?: string; runtimeChoice?: 'keep_running' | 'stop_running_agent'; acknowledgedChildIds?: string[]; acknowledgedExecutionIds?: string[] } = {},
  ): Promise<LifecycleResult> {
    return api.post(`/tasks/${id}/transition`, { command, ...opts });
  },
};
