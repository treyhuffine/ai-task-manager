import { api } from './client';

export interface RecentItem {
  id: string;
  title: string;
  entity_type: 'task' | 'note';
  last_viewed_at: string;
}

export const recentsApi = {
  list(limit = 10): Promise<RecentItem[]> {
    return api.get<RecentItem[]>('/recents', { limit });
  },
};
