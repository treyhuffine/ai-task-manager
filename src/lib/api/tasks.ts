import { api } from './client';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import type {
  TaskRecord,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
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
    opts: { note?: string; idempotencyKey?: string; expectedStatusChangedCount?: number } = {},
  ): Promise<LifecycleResult> {
    return api.post(`/tasks/${id}/complete`, opts);
  },

  /** Apply a semantic lifecycle transition (move_to_todo / move_to_consider /
   * start / return_to_todo / reopen / archive / restore). */
  transition(
    id: string,
    command: TransitionCommand,
    opts: { idempotencyKey?: string; expectedStatusChangedCount?: number; reason?: string } = {},
  ): Promise<LifecycleResult> {
    return api.post(`/tasks/${id}/transition`, { command, ...opts });
  },
};
