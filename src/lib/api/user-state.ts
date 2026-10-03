import type { UpdateUserStateInput } from '@/db/types';
import { trpcClient } from '@/lib/trpc/client';

export const userStateApi = {
  get() {
    return trpcClient.userState.list.query({});
  },

  update(input: UpdateUserStateInput) {
    return trpcClient.userState.update.mutate({body: input});
  },
};
