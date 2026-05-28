import { api } from './client';

export interface RecentItem {
  id: string;
  title: string;
  entityType: 'task' | 'note';
  lastViewedAt: string;
  hasBody?: boolean;
}

export const recentsApi = {
  list(limit = 10): Promise<RecentItem[]> {
    return api.get<RecentItem[]>('/recents', { query: { limit } });
  },
};
