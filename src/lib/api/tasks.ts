import { api } from './client';
import type {
  TaskRecord,
  TaskListRecord,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
} from '@/db/types';

export const tasksApi = {
  list(filter?: TaskFilter): Promise<TaskListRecord[]> {
    return api.get<TaskListRecord[]>('/tasks', { query: filter as Record<string, string> });
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

  complete(id: string, note?: string): Promise<{ task: TaskRecord; recurring: boolean; nextRecurrenceAt?: string }> {
    return api.post(`/tasks/${id}/complete`, { note });
  },
};
