import { api } from './client';
import type {
  AreaRecord,
  CreateAreaInput,
  UpdateAreaInput,
  AreaFilter,
} from '@/db/types';

export const areasApi = {
  list(filter?: AreaFilter): Promise<AreaRecord[]> {
    return api.get<AreaRecord[]>('/areas', { query: filter as Record<string, string> });
  },

  get(id: string): Promise<AreaRecord> {
    return api.get<AreaRecord>(`/areas/${id}`);
  },

  create(input: CreateAreaInput): Promise<AreaRecord> {
    return api.post<AreaRecord>('/areas', input);
  },

  update(id: string, input: UpdateAreaInput): Promise<AreaRecord> {
    return api.patch<AreaRecord>(`/areas/${id}`, input);
  },
};
