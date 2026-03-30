import { api } from './client';
import type { UserStateRecord, UpdateUserStateInput } from '@/db/types';

export const userStateApi = {
  get(): Promise<UserStateRecord> {
    return api.get<UserStateRecord>('/user-state');
  },

  update(input: UpdateUserStateInput): Promise<UserStateRecord> {
    return api.patch<UserStateRecord>('/user-state', input);
  },
};
