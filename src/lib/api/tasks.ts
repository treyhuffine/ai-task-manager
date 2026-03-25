import { api } from './client';
import type {
  TaskRecord,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
} from '@/db/types';

export const tasksApi = {
  list(filter?: TaskFilter): Promise<TaskRecord[]> {
    return api.get<TaskRecord[]>('/tasks', filter as Record<string, unknown>);
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
};
