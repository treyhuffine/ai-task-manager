import { api } from './client';
import type {
  StreamRecord,
  CreateStreamInput,
  UpdateStreamInput,
  StreamFilter,
} from '@/db/types';

export const streamApi = {
  list(filter?: StreamFilter): Promise<StreamRecord[]> {
    return api.get<StreamRecord[]>('/stream', { query: filter as Record<string, string> });
  },

  create(input: CreateStreamInput): Promise<StreamRecord> {
    return api.post<StreamRecord>('/stream', input);
  },

  update(id: string, input: UpdateStreamInput): Promise<StreamRecord> {
    return api.patch<StreamRecord>(`/stream/${id}`, input);
  },

  dismiss(id: string): Promise<StreamRecord> {
    return api.patch<StreamRecord>(`/stream/${id}`, {
      status: 'dismissed',
      dismissed_by: 'user',
    });
  },
};
