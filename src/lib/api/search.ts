import { api } from './client';

export type SearchMode = 'hybrid' | 'keyword' | 'vector';

export interface SearchResult {
  id: string;
  title: string | null;
  description?: string | null;
  body?: string | null;
  status: string;
  areaId?: string | null;
  createdAt: string;
  entityType: 'task' | 'note' | 'stream';
  snippet?: string;
  score?: number;
}

export const searchApi = {
  query(q: string, opts?: { mode?: SearchMode; limit?: number }): Promise<SearchResult[]> {
    return api.get<SearchResult[]>('/search', { query: { q, ...opts } });
  },
};
